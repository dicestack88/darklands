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

  function createClipCard(clip, profile, url, likes, commentCount) {
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
    const identity = document.createElement("a");
    identity.className = "clip-identity clip-creator-link";
    identity.href = profile?.username ? page("profile.html") + "?u=" + encodeURIComponent(profile.username) : "#";
    identity.setAttribute("aria-label", "View creator profile");
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
    like.className = "clip-action clip-like";
    let likeRows = likes || [];
    let liked = likeRows.some(row => row.user_id === currentUser.id);
    const paintLike = () => {
      like.classList.toggle("liked", liked);
      like.querySelector("span").textContent = liked ? "♥" : "♡";
      like.querySelector("small").textContent = String(likeRows.length);
      like.setAttribute("aria-label", (liked ? "Unlike" : "Like") + " clip, " + likeRows.length + " likes");
    };
    like.innerHTML = '<span aria-hidden="true">♡</span><small>0</small>';
    paintLike();
    like.addEventListener("click", async event => {
      event.stopPropagation();
      if (like.disabled) return;
      const wasLiked = liked;
      const previousRows = likeRows;
      liked = !wasLiked;
      likeRows = wasLiked
        ? likeRows.filter(row => row.user_id !== currentUser.id)
        : [...likeRows, { user_id: currentUser.id }];
      paintLike();
      like.disabled = true;
      const result = wasLiked
        ? await client.from("clip_likes").delete().eq("clip_id", clip.id).eq("user_id", currentUser.id)
        : await client.from("clip_likes").insert({ clip_id: clip.id, user_id: currentUser.id });
      if (result.error) {
        liked = wasLiked;
        likeRows = previousRows;
        paintLike();
        say("Couldn't update your like. Please try again.");
      }
      like.disabled = false;
    });

    const comment = document.createElement("button");
    comment.type = "button";
    comment.className = "clip-action";
    comment.innerHTML = '<span aria-hidden="true">▢</span><small>' + (commentCount || 0) + '</small>';
    comment.setAttribute("aria-label", "View comments");
    const commentsPanel = document.createElement("section");
    commentsPanel.className = "clip-comments-panel";
    commentsPanel.hidden = true;
    commentsPanel.setAttribute("aria-label", "Clip comments");
    const commentsHeader = document.createElement("div");
    commentsHeader.className = "clip-comments-header";
    const commentsTitle = document.createElement("strong");
    commentsTitle.textContent = "Comments";
    const closeComments = document.createElement("button");
    closeComments.type = "button";
    closeComments.className = "clip-comments-close";
    closeComments.textContent = "×";
    closeComments.setAttribute("aria-label", "Close comments");
    commentsHeader.append(commentsTitle, closeComments);
    const commentsList = document.createElement("div");
    commentsList.className = "clip-comments-list";
    const commentForm = document.createElement("form");
    commentForm.className = "clip-comment-form";
    const commentInput = document.createElement("textarea");
    commentInput.maxLength = 500;
    commentInput.rows = 2;
    commentInput.placeholder = "Add a comment…";
    commentInput.required = true;
    commentInput.setAttribute("aria-label", "Write a comment");
    const commentSubmit = document.createElement("button");
    commentSubmit.type = "submit";
    commentSubmit.textContent = "Post";
    commentForm.append(commentInput, commentSubmit);
    commentsPanel.append(commentsHeader, commentsList, commentForm);

    const loadComments = async () => {
      commentsList.replaceChildren();
      const loading = document.createElement("p");
      loading.className = "clip-comments-empty";
      loading.textContent = "Loading comments…";
      commentsList.append(loading);
      const { data, error } = await client.from("clip_comments")
        .select("id, user_id, body, created_at")
        .eq("clip_id", clip.id)
        .order("created_at", { ascending: true })
        .limit(100);
      commentsList.replaceChildren();
      if (error) {
        const failed = document.createElement("p");
        failed.className = "clip-comments-empty";
        failed.textContent = "Comments couldn't load. Please try again.";
        commentsList.append(failed);
        return;
      }
      if (!data?.length) {
        const empty = document.createElement("p");
        empty.className = "clip-comments-empty";
        empty.textContent = "No comments yet. Start the conversation.";
        commentsList.append(empty);
      } else {
        const ids = [...new Set(data.map(item => item.user_id))];
        const { data: authors } = await client.from("profiles")
          .select("id, username, display_name, avatar_url")
          .in("id", ids);
        const authorMap = new Map((authors || []).map(author => [author.id, author]));
        for (const item of data) {
          const row = document.createElement("article");
          row.className = "clip-comment";
          const author = document.createElement("strong");
          const authorProfile = authorMap.get(item.user_id);
          author.textContent = authorProfile?.display_name || "Darklands member";
          const handle = document.createElement("span");
          handle.className = "clip-comment-handle";
          handle.textContent = "@" + (authorProfile?.username || "member") + " · " + new Date(item.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
          const body = document.createElement("p");
          body.textContent = item.body;
          row.append(author, handle, body);
          commentsList.append(row);
        }
      }
      comment.querySelector("small").textContent = String(data?.length || 0);
    };

    comment.addEventListener("click", async event => {
      event.stopPropagation();
      const opening = commentsPanel.hidden;
      commentsPanel.hidden = !opening;
      if (opening) await loadComments();
    });
    closeComments.addEventListener("click", () => { commentsPanel.hidden = true; });
    commentForm.addEventListener("submit", async event => {
      event.preventDefault();
      const body = commentInput.value.trim();
      if (!body || commentSubmit.disabled) return;
      commentSubmit.disabled = true;
      commentSubmit.textContent = "Posting…";
      const { error } = await client.from("clip_comments").insert({
        clip_id: clip.id, user_id: currentUser.id, body
      });
      if (error) {
        say("Couldn't post your comment. Please try again.");
      } else {
        commentInput.value = "";
        await loadComments();
      }
      commentSubmit.disabled = false;
      commentSubmit.textContent = "Post";
    });

    const share = document.createElement("button");
    share.type = "button";
    share.className = "clip-action";
    share.innerHTML = '<span aria-hidden="true">↗</span><small>Share</small>';
    share.addEventListener("click", async event => {
      event.stopPropagation();
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
    card.append(video, shade, sound, creator, caption, date, actions, commentsPanel, hint);
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
      const clipIds = clips.map(clip => clip.id);
      const [{ data: likeRows, error: likesError }, { data: commentRows, error: commentsError }] = await Promise.all([
        client.from("clip_likes").select("clip_id, user_id").in("clip_id", clipIds),
        client.from("clip_comments").select("id, clip_id").in("clip_id", clipIds)
      ]);
      if (likesError) throw likesError;
      if (commentsError) throw commentsError;
      const likesByClip = new Map();
      const commentsByClip = new Map();
      for (const row of likeRows || []) {
        if (!likesByClip.has(row.clip_id)) likesByClip.set(row.clip_id, []);
        likesByClip.get(row.clip_id).push(row);
      }
      for (const row of commentRows || []) {
        commentsByClip.set(row.clip_id, (commentsByClip.get(row.clip_id) || 0) + 1);
      }
      const prepared = await Promise.all(clips.map(async clip => {
        const { data: signed, error: signedError } = await client.storage.from("darklands-clips")
          .createSignedUrl(clip.storage_path, 3600);
        return signedError || !signed?.signedUrl ? null : { clip, profile: profileMap.get(clip.user_id), url: signed.signedUrl };
      }));
      for (const item of prepared) {
        if (!item) continue;
        const card = createClipCard(item.clip, item.profile, item.url, likesByClip.get(item.clip.id) || [], commentsByClip.get(item.clip.id) || 0);
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
      const {data:ownProfile}=await client.from("profiles").select("username").eq("id",currentUser.id).maybeSingle();
      const ownProfileLink=$("clips-own-profile");
      if(ownProfile?.username&&ownProfileLink)ownProfileLink.href=page("profile.html")+"?u="+encodeURIComponent(ownProfile.username);
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