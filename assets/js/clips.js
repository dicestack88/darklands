(() => {
  const config = window.DARKLANDS_CONFIG;
  const keyReady = config && config.SUPABASE_ANON_KEY && !config.SUPABASE_ANON_KEY.includes("PASTE_YOUR_");
  const clientReady = keyReady && window.supabase && window.supabase.createClient;
  const client = clientReady ? window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY) : null;
  const status = document.getElementById("clips-status");
  const uploadPanel = document.getElementById("clips-upload-panel");
  const submissions = document.getElementById("clips-submissions");
  const form = document.getElementById("clip-upload-form");
  const fileInput = document.getElementById("clip-file");
  const captionInput = document.getElementById("clip-caption");
  const message = document.getElementById("clip-upload-message");
  const uploadButton = document.getElementById("clip-upload-button");
  const list = document.getElementById("clips-list");
  const MAX_BYTES = 50 * 1024 * 1024;
  const ALLOWED_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
  let currentUser = null;

  const say = (text) => { if (status) status.textContent = text; };
  const feedback = (text, error = false) => {
    if (!message) return;
    message.textContent = text;
    message.style.color = error ? "#ffaaa9" : "#bdc9ff";
  };
  const verified = user => Boolean(user && (user.email_confirmed_at || user.confirmed_at));
  const page = name => new URL(name, config.SITE_URL).toString();
  const formatDate = value => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  function renderClip(clip, url) {
    const article = document.createElement("article");
    article.className = "clip-submission";
    const media = document.createElement("video");
    media.className = "clip-video";
    media.controls = true;
    media.preload = "metadata";
    media.src = url;
    media.setAttribute("aria-label", "Your uploaded clip");
    const details = document.createElement("div");
    details.className = "clip-submission-details";
    const top = document.createElement("div");
    top.className = "clip-submission-top";
    const badge = document.createElement("span");
    badge.className = "clip-status-badge status-" + clip.status;
    badge.textContent = clip.status.toUpperCase();
    const date = document.createElement("time");
    date.textContent = formatDate(clip.created_at);
    top.append(badge, date);
    const caption = document.createElement("p");
    caption.className = "clip-submission-caption";
    caption.textContent = clip.caption || "No caption";
    details.append(top, caption);
    article.append(media, details);
    return article;
  }

  async function loadClips() {
    list.replaceChildren();
    const loading = document.createElement("p");
    loading.className = "clips-empty";
    loading.textContent = "Loading your clips…";
    list.append(loading);
    const { data, error } = await client
      .from("clips")
      .select("id, caption, storage_path, status, created_at")
      .eq("user_id", currentUser.id)
      .order("created_at", { ascending: false });
    if (error) {
      list.replaceChildren();
      const failed = document.createElement("p");
      failed.className = "clips-empty";
      failed.textContent = "We couldn't load your submissions. Please refresh and try again.";
      list.append(failed);
      return;
    }
    list.replaceChildren();
    if (!data || data.length === 0) {
      const empty = document.createElement("p");
      empty.className = "clips-empty";
      empty.textContent = "You haven't uploaded any clips yet. Your submissions will appear here.";
      list.append(empty);
      return;
    }
    for (const clip of data) {
      const { data: signed, error: signedError } = await client.storage
        .from("darklands-clips")
        .createSignedUrl(clip.storage_path, 3600);
      if (signedError || !signed?.signedUrl) continue;
      list.append(renderClip(clip, signed.signedUrl));
    }
    if (!list.children.length) {
      const unavailable = document.createElement("p");
      unavailable.className = "clips-empty";
      unavailable.textContent = "Your clip records loaded, but their video files couldn't be opened.";
      list.append(unavailable);
    }
  }

  async function start() {
    if (!client) {
      say("Account services aren't configured. Please try again later.");
      return;
    }
    try {
      const { data, error } = await client.auth.getUser();
      currentUser = data && data.user;
      if (error || !verified(currentUser)) {
        await client.auth.signOut();
        window.location.replace(page("login.html"));
        return;
      }
      say("Signed in and email verified.");
      uploadPanel.hidden = false;
      submissions.hidden = false;
      await loadClips();
    } catch (error) {
      say("We couldn't verify your session. Please log in again.");
      await client.auth.signOut();
      window.location.replace(page("login.html"));
    }
  }

  if (captionInput) captionInput.addEventListener("input", () => {
    document.getElementById("clip-caption-count").textContent = captionInput.value.length + " / 300";
  });

  if (form) form.addEventListener("submit", async event => {
    event.preventDefault();
    feedback("");
    const file = fileInput.files && fileInput.files[0];
    const caption = captionInput.value.trim();
    if (!file) return feedback("Choose a video file first.", true);
    if (!ALLOWED_TYPES.includes(file.type)) return feedback("Please choose an MP4, WebM or MOV video.", true);
    if (file.size > MAX_BYTES) return feedback("That video is larger than the 50 MB limit.", true);
    if (caption.length > 300) return feedback("Your caption must be 300 characters or fewer.", true);

    uploadButton.disabled = true;
    uploadButton.textContent = "Uploading…";
    fileInput.disabled = true;
    captionInput.disabled = true;
    const objectName = crypto.randomUUID() + "-" + file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-90);
    const storagePath = currentUser.id + "/" + objectName;
    let uploaded = false;
    try {
      const { error: uploadError } = await client.storage
        .from("darklands-clips")
        .upload(storagePath, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      uploaded = true;

      const { error: insertError } = await client.from("clips").insert({
        user_id: currentUser.id,
        caption,
        storage_path: storagePath,
        status: "pending"
      });
      if (insertError) throw insertError;

      form.reset();
      document.getElementById("clip-caption-count").textContent = "0 / 300";
      feedback("Upload complete. Your clip is now pending review.");
      await loadClips();
    } catch (error) {
      if (uploaded) {
        await client.storage.from("darklands-clips").remove([storagePath]);
      }
      feedback(error.message || "Upload failed. Please try again.", true);
    } finally {
      uploadButton.disabled = false;
      uploadButton.innerHTML = 'Upload for review <span aria-hidden="true">↗</span>';
      fileInput.disabled = false;
      captionInput.disabled = false;
    }
  });

  const refresh = document.getElementById("clips-refresh");
  if (refresh) refresh.addEventListener("click", loadClips);
  const logout = document.getElementById("clips-logout");
  if (logout) logout.addEventListener("click", async () => {
    logout.disabled = true;
    const { error } = await client.auth.signOut();
    if (error) {
      logout.disabled = false;
      say("Could not sign out. Please try again.");
      return;
    }
    window.location.replace(page("login.html"));
  });

  start();
})();