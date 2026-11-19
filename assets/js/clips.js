(() => {
  const config = window.DARKLANDS_CONFIG;
  const keyReady = config && config.SUPABASE_ANON_KEY && !config.SUPABASE_ANON_KEY.includes("PASTE_YOUR_");
  const clientReady = keyReady && window.supabase && window.supabase.createClient;
  const client = clientReady ? window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY) : null;
  const $ = id => document.getElementById(id);
  const status = $("clips-status");
  const uploadPanel = $("clips-upload-panel");
  const submissions = $("clips-submissions");
  const feedLayout = $("clips-feed-layout");
  const feed = $("clips-feed");
  const form = $("clip-upload-form");
  const fileInput = $("clip-file");
  const captionInput = $("clip-caption");
  const message = $("clip-upload-message");
  const uploadButton = $("clip-upload-button");
  const list = $("clips-list");
  const loadMoreButton = $("clips-load-more");
  const MAX_BYTES = 50 * 1024 * 1024;
  const ALLOWED_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
  const PAGE_SIZE = 10;
  let currentUser = null;
  let feedOffset = 0;
  let feedLoading = false;
  let hasMore = true;
  let observer = null;

  const say = text => { if (status) status.textContent = text; };
  const feedback = (text, error = false) => {
    if (!message) return;
    message.textContent = text;
    message.style.color = error ? "#ffaaa9" : "#bdc9ff";
  };
  const verified = user => Boolean(user && (user.email_confirmed_at || user.confirmed_at));
  const page = name => new URL(name, config.SITE_URL).toString();
  const formatDate = value => new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const initials = name => (name || "D").trim().split(/\s+/).slice(0, 2).map(part => part[0] || "").join("").toUpperCase();

  function showPanel(name) {
    const isUpload = name === "upload";
    const isSubmissions = name === "submissions";
    uploadPanel.hidden = !isUpload;
    submissions.hidden = !isSubmissions;
    feedLayout.hidden = isSubmissions;
    $("feed-tab").classList.toggle("active", !isUpload && !isSubmissions);
    $("upload-toggle").classList.toggle("active", isUpload);
    $("submissions-toggle").classList.toggle("active", isSubmissions);
    if (!isUpload && !isSubmissions) feed.scrollTop = 0;
  }

  function renderSubmission(clip, url) {
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
    const { data, error } = await client.from("clips")
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
      const { data: signed, error: signedError } = await client.storage.from("darklands-clips").createSignedUrl(clip.storage_path, 3600);
      if (!signedError && signed?.signedUrl) list.append(renderSubmission(clip, signed.signedUrl));
    }
    if (!list.children.length) {
      const unavailable = document.createElement("p");
      unavailable.className = "clips-empty";
      unavailable.textContent = "Your clip records loaded, but their video files couldn't be opened.";
      list.append(unavailable);
    }
  }

  function feedState(title, detail) {
    const state = document.createElement("div");
    state.className = "clips-feed-state";
    const heading = document.createElement("strong");
    heading.textContent = title;
    const copy = document.createElement("p");
    copy.textContent = detail;
    state.append(heading, copy);
    return state;
  }

  function activateVideo(video) {
    if (!video || video.dataset.ready === "1") return;
    video.dataset.ready = "1";
    video.muted = true;
    video.play().catch(() => {
      const hint = video.closest(".clip-card")?.querySelector(".clip-play-hint");
      if (hint) hint.hidden = false;
    });
  }

  function createClipCard(clip, profile, url) {
    const card = document.createElement("article");
    card.className = "clip-card";
    card.dataset.clipId = clip.id;

    const video = document.createElement("video");
    video.className = "clip-feed-video";
    video.src = url;
    video.playsInline = true;
    video.muted = true;
    video.loop = true;
    video.preload = "metadata";
    video.setAttribute("aria-label", "Community clip. Tap to pause or play.");
    video.addEventListener("click", () => {
      if (video.paused) video.play().catch(() => {});
      else video.pause();
    });

    const shade = document.createElement("div");
    shade.className = "clip-card-shade";

    const sound = document.createElement("button");
    sound.className = "clip-sound-toggle";
    sound.type = "button";
    sound.textContent = "Muted";
    sound.setAttribute("aria-label", "Turn sound on");
    sound.addEventListener("click", event => {
      event.stopPropagation();
      video.muted = !video.muted;
      sound.textContent = video.muted ? "Muted" : "Sound on";
      sound.setAttribute("aria-label", video.muted ? "Turn sound on" : "Mute video");
    });

    const creator = document.createElement("div");
    creator.className = "clip-creator";
    const avatar = document.createElement("span");
    avatar.className = "clip-avatar";
    if (profile?.avatar_url && /^https?:\/\//i.test(profile.avatar_url)) {
      const image = document.createElement("img");
      image.src = profile.avatar_url;
      image.alt = "";
      image.referrerPolicy = "no-referrer";
      avatar.append(image);
    } else avatar.textContent = initials(profile?.display_name);
    const identity = document.createElement("div");
    identity.className = "clip-identity";
    const display = document.createElement("strong");
    display.textContent = profile?.display_name || "Darklands member";
    const username = document.createElement("span");
    username.textContent = "@" + (profile?.username || "member");
    identity.append(display, username);
    creator.append(avatar, identity);

    const caption = document.createElement("p");
    caption.className = "clip-feed-caption";
    caption.textContent = clip.caption || "A moment from the community.";
    const date = document.createElement("span");
    date.className = "clip-feed-date";
    date.textContent = formatDate(clip.created_at);

    const actions = document.createElement("div");
    actions.className = "clip-actions";
    const like = document.createElement("button");
    like.type = "button";
    like.className = "clip-action is-coming";
    like.disabled = true;
    like.innerHTML = '<span aria-hidden="true">♡</span><small>Likes soon</small>';
    like.setAttribute("aria-label", "Likes coming soon");
    const comment = document.createElement("button");
    comment.type = "button";
    comment.className = "clip-action is-coming";
    comment.disabled = true;
    comment.innerHTML = '<span aria-hidden="true">▢</span><small>Comments soon</small>';
    comment.setAttribute("aria-label", "Comments coming soon");
    const share = document.createElement("button");
    share.type = "button";
    share.className = "clip-action";
    share.innerHTML = '<span aria-hidden="true">↗</span><small>Share</small>';
    share.addEventListener("click", async () => {
      const shareData = { title: "Darklands clip", text: caption.textContent, url: window.location.href.split("#")[0] + "#clip-" + clip.id };
      try {
        if (navigator.share) await navigator.share(shareData);
        else if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(shareData.url);
          share.querySelector("small").textContent = "Copied";
          setTimeout(() => { share.querySelector("small").textContent = "Share"; }, 1800);
        }
      } catch (error) {
        if (error.name !== "AbortError") say("Sharing isn't available in this browser.");
      }
    });
    actions.append(like, comment, share);

    const hint = document.createElement("span");
    hint.className = "clip-play-hint";
    hint.textContent = "Tap video to play";
    hint.hidden = true;
    card.append(video, shade, sound, creator, caption, date, actions, hint);
    return card;
  }

  async function loadFeed(reset = false) {
    if (feedLoading || (!hasMore && !reset)) return;
    feedLoading = true;
    loadMoreButton.disabled = true;
    loadMoreButton.textContent = "Loading…";
    if (reset) {
      feedOffset = 0;
      hasMore = true;
      feed.replaceChildren(feedState("Finding your next clip…", "Loading approved videos from the community."));
    }
    try {
      const { data: clips, error } = await client.from("clips")
        .select("id, user_id, caption, storage_path, created_at")
        .eq("status", "approved")
        .order("created_at", { ascending: false })
        .range(feedOffset, feedOffset + PAGE_SIZE - 1);
      if (error) throw error;
      if (reset) feed.replaceChildren();
      if (!clips?.length && feedOffset === 0) {
        feed.append(feedState("It's quiet in here… for now.", "No approved clips yet. Be the first to share a moment."));
        hasMore = false;
        loadMoreButton.hidden = true;
        return;
      }
      if (!clips?.length) {
        hasMore = false;
        loadMoreButton.hidden = true;
        return;
      }
      const userIds = [...new Set(clips.map(clip => clip.user_id))];
      const { data: profiles, error: profileError } = await client.from("profiles")
        .select("id, username, display_name, avatar_url")
        .in("id", userIds);
      if (profileError) throw profileError;
      const profileMap = new Map((profiles || []).map(profile => [profile.id, profile]));
      const prepared = await Promise.all(clips.map(async clip => {
        const { data: signed, error: signedError } = await client.storage.from("darklands-clips")
          .createSignedUrl(clip.storage_path, 3600);
        return signedError || !signed?.signedUrl ? null : { clip, profile: profileMap.get(clip.user_id), url: signed.signedUrl };
      }));
      for (const item of prepared) {
        if (!item) continue;
        const card = createClipCard(item.clip, item.profile, item.url);
        feed.append(card);
        if (observer) observer.observe(card);
        if (window.location.hash === "#clip-" + item.clip.id) card.scrollIntoView();
      }
      feedOffset += clips.length;
      hasMore = clips.length === PAGE_SIZE;
      loadMoreButton.hidden = !hasMore;
      if (!feed.children.length) feed.append(feedState("Videos couldn't load.", "Refresh the page and try again."));
    } catch (error) {
      if (reset) feed.replaceChildren();
      feed.append(feedState("We couldn't load the feed.", "Check your connection and refresh to try again."));
      say("The community feed couldn't be loaded.");
      loadMoreButton.hidden = true;
    } finally {
      feedLoading = false;
      loadMoreButton.disabled = false;
      loadMoreButton.textContent = "Load more clips";
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
      say("You're signed in. Enjoy the feed.");
      observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          const video = entry.target.querySelector("video");
          if (!video) return;
          if (entry.isIntersecting && entry.intersectionRatio >= 0.65) {
            feed.querySelectorAll("video").forEach(other => { if (other !== video) other.pause(); });
            activateVideo(video);
          } else video.pause();
        });
      }, { root: feed, threshold: [0, 0.25, 0.65, 1] });
      await loadFeed(true);
      await loadClips();
    } catch (error) {
      say("We couldn't verify your session. Please log in again.");
      await client.auth.signOut();
      window.location.replace(page("login.html"));
    }
  }

  $("feed-tab").addEventListener("click", () => showPanel("feed"));
  $("upload-toggle").addEventListener("click", () => showPanel("upload"));
  $("upload-close").addEventListener("click", () => showPanel("feed"));
  $("submissions-toggle").addEventListener("click", () => showPanel("submissions"));
  $("clips-refresh").addEventListener("click", loadClips);
  loadMoreButton.addEventListener("click", () => loadFeed(false));
  feed.addEventListener("scroll", () => {
    if (feed.scrollTop + feed.clientHeight >= feed.scrollHeight - 500 && hasMore) loadFeed(false);
  }, { passive: true });

  if (captionInput) captionInput.addEventListener("input", () => {
    $("clip-caption-count").textContent = captionInput.value.length + " / 300";
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
      const { error: uploadError } = await client.storage.from("darklands-clips")
        .upload(storagePath, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      uploaded = true;
      const { error: insertError } = await client.from("clips").insert({
        user_id: currentUser.id, caption, storage_path: storagePath
      });
      if (insertError) throw insertError;
      form.reset();
      $("clip-caption-count").textContent = "0 / 300";
      feedback("Upload complete. Your clip is now pending review.");
      await loadClips();
      showPanel("submissions");
    } catch (error) {
      if (uploaded) await client.storage.from("darklands-clips").remove([storagePath]);
      feedback(error.message || "Upload failed. Please try again.", true);
    } finally {
      uploadButton.disabled = false;
      uploadButton.innerHTML = 'Upload for review <span aria-hidden="true">↗</span>';
      fileInput.disabled = false;
      captionInput.disabled = false;
    }
  });

  $("clips-logout").addEventListener("click", async () => {
    const logout = $("clips-logout");
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