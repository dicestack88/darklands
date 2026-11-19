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

  function createClipCard(clip, profile, url, likes, commentCount, saveRows = [], repostRows = []) {
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

    const save = document.createElement("button");
    save.type = "button";
    save.className = "clip-action clip-save";
    let saved = saveRows.some(row => row.user_id === currentUser.id);
    const paintSave = () => { save.classList.toggle("liked", saved); save.innerHTML = '<span aria-hidden="true">' + (saved ? "▣" : "▢") + '</span><small>' + (saved ? "Saved" : "Save") + '</small>'; };
    paintSave();
    save.addEventListener("click", async event => {
      event.stopPropagation(); if (save.disabled) return;
      const previous = saved; saved = !saved; paintSave(); save.disabled = true;
      const result = previous
        ? await client.from("clip_saves").delete().eq("clip_id", clip.id).eq("user_id", currentUser.id)
        : await client.from("clip_saves").insert({ clip_id: clip.id, user_id: currentUser.id });
      if (result.error) { saved = previous; paintSave(); say("Couldn't update your saved clips. Please try again."); }
      save.disabled = false;
    });

    const repost = document.createElement("button");
    repost.type = "button";
    repost.className = "clip-action clip-repost";
    let reposted = repostRows.some(row => row.user_id === currentUser.id);
    const paintRepost = () => { repost.classList.toggle("liked", reposted); repost.innerHTML = '<span aria-hidden="true">⟳</span><small>' + (repostRows.length + (reposted && !repostRows.some(row => row.user_id === currentUser.id) ? 1 : 0)) + ' · ' + (reposted ? "Reposted" : "Repost") + '</small>'; };
    paintRepost();
    repost.addEventListener("click", async event => {
      event.stopPropagation(); if (repost.disabled) return;
      const previous = reposted; reposted = !reposted; paintRepost(); repost.disabled = true;
      const result = previous
        ? await client.from("clip_reposts").delete().eq("clip_id", clip.id).eq("user_id", currentUser.id)
        : await client.from("clip_reposts").insert({ clip_id: clip.id, user_id: currentUser.id });
      if (result.error) { reposted = previous; paintRepost(); say("Couldn't update your repost. Please try again."); }
      else { if (previous) repostRows = repostRows.filter(row => row.user_id !== currentUser.id); else repostRows = [...repostRows, { user_id: currentUser.id }]; paintRepost(); }
      repost.disabled = false;
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

    let replyTo = null;
    const loadComments = async () => {
      commentsList.replaceChildren();
      const loading = document.createElement("p"); loading.className = "clip-comments-empty"; loading.textContent = "Loading comments…"; commentsList.append(loading);
      const [{ data, error }, { data: heartRows, error: heartError }] = await Promise.all([
        client.from("clip_comments").select("id, user_id, body, created_at, parent_comment_id").eq("clip_id", clip.id).order("created_at", { ascending: true }).limit(150),
        client.from("clip_comment_likes").select("comment_id, user_id").limit(1000)
      ]);
      commentsList.replaceChildren();
      if (error || heartError) { const failed=document.createElement("p");failed.className="clip-comments-empty";failed.textContent="Comments couldn't load. Please try again.";commentsList.append(failed);return; }
      if (!data?.length) { const empty=document.createElement("p");empty.className="clip-comments-empty";empty.textContent="No comments yet. Start the conversation.";commentsList.append(empty); }
      else {
        const ids=[...new Set(data.map(item=>item.user_id))];
        const {data:authors}=await client.from("profiles").select("id,username,display_name").in("id",ids);
        const authorMap=new Map((authors||[]).map(author=>[author.id,author]));
        const roots=data.filter(item=>!item.parent_comment_id);
        const replies=new Map();
        for(const item of data.filter(item=>item.parent_comment_id)){if(!replies.has(item.parent_comment_id))replies.set(item.parent_comment_id,[]);replies.get(item.parent_comment_id).push(item);}
        const renderComment=(item,isReply=false)=>{
          const row=document.createElement("article");row.className="clip-comment"+(isReply?" clip-comment-reply":"");
          const authorProfile=authorMap.get(item.user_id);
          const author=document.createElement("strong");author.textContent=authorProfile?.display_name||"Darklands member";
          const handle=document.createElement("span");handle.className="clip-comment-handle";handle.textContent="@"+(authorProfile?.username||"member")+" · "+new Date(item.created_at).toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short"});
          const body=document.createElement("p");body.textContent=item.body;
          const controls=document.createElement("div");controls.className="clip-comment-controls";
          const hearts=heartRows.filter(row=>row.comment_id===item.id);let hearted=hearts.some(row=>row.user_id===currentUser.id);
          const heart=document.createElement("button");heart.type="button";heart.className="clip-comment-control"+(hearted?" liked":"");heart.textContent=(hearted?"♥ ":"♡ ")+hearts.length;
          heart.addEventListener("click",async()=>{
            if(heart.disabled)return;const before=hearted;hearted=!hearted;heart.disabled=true;heart.classList.toggle("liked",hearted);heart.textContent=(hearted?"♥ ":"♡ ")+(hearts.length+(hearted?1:-1));
            const result=before?await client.from("clip_comment_likes").delete().eq("comment_id",item.id).eq("user_id",currentUser.id):await client.from("clip_comment_likes").insert({comment_id:item.id,user_id:currentUser.id});
            if(result.error){hearted=before;heart.classList.toggle("liked",hearted);heart.textContent=(hearted?"♥ ":"♡ ")+hearts.length;say("Couldn't update that comment heart.");}
            heart.disabled=false;
          });
          controls.append(heart);
          if(!isReply){const reply=document.createElement("button");reply.type="button";reply.className="clip-comment-control";reply.textContent="Reply";reply.addEventListener("click",()=>{replyTo=item.id;commentInput.placeholder="Replying to "+(authorProfile?.display_name||"comment")+"…";commentInput.focus();commentSubmit.textContent="Reply";});controls.append(reply);}
          row.append(author,handle,body,controls);
          if(!isReply){for(const child of replies.get(item.id)||[])row.append(renderComment(child,true));}
          return row;
        };
        for(const item of roots)commentsList.append(renderComment(item));
        for(const item of data.filter(item=>item.parent_comment_id&&!roots.some(root=>root.id===item.parent_comment_id)))commentsList.append(renderComment(item,true));
      }
      comment.querySelector("small").textContent=String(data?.length||0);
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
        clip_id: clip.id, user_id: currentUser.id, body, parent_comment_id: replyTo
      });
      if (error) {
        say("Couldn't post your comment. Please try again.");
      } else {
        commentInput.value = "";
        replyTo = null; commentInput.placeholder = "Add a comment…"; commentSubmit.textContent = "Post";
        await loadComments();
      }
      commentSubmit.disabled = false;
      commentSubmit.textContent = "Post";
    });

    const fullscreen = document.createElement("button");
    fullscreen.type = "button";
    fullscreen.className = "clip-action clip-fullscreen";
    fullscreen.innerHTML = '<span aria-hidden="true">⛶</span><small>Fullscreen</small>';
    fullscreen.setAttribute("aria-label", "View clip fullscreen");
    fullscreen.addEventListener("click", async event => {
      event.stopPropagation();
      try {
        if (document.fullscreenElement === card) await document.exitFullscreen();
        else if (card.requestFullscreen) await card.requestFullscreen();
        else say("Fullscreen isn't supported by this browser.");
      } catch (_) { say("Fullscreen couldn't be opened. Try your browser's fullscreen shortcut."); }
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
    actions.append(like, comment, save, repost, share, fullscreen);

    const hint = document.createElement("span");
    hint.className = "clip-play-hint";
    hint.textContent = "Tap video to play";
    hint.hidden = true;
    card.append(video, shade, sound, creator, caption, date, actions, commentsPanel, hint);
    return card;
  }


  function searchCreatorCard(profile) {
    const card=document.createElement("a");
    card.className="discover-creator-card";
    card.href=page("profile.html")+"?u="+encodeURIComponent(profile.username);
    const avatar=document.createElement("span");avatar.className="discover-avatar";
    if(profile.avatar_url&&/^https?:\/\//i.test(profile.avatar_url)){
      const image=document.createElement("img");image.src=profile.avatar_url;image.alt="";image.loading="lazy";avatar.append(image);
    }else avatar.textContent=initials(profile.display_name);
    const info=document.createElement("span");info.className="discover-creator-info";
    const name=document.createElement("strong");name.textContent=profile.display_name||"Darklands member";
    const handle=document.createElement("small");handle.textContent="@"+profile.username;
    info.append(name,handle);
    const arrow=document.createElement("span");arrow.className="discover-arrow";arrow.textContent="↗";
    card.append(avatar,info,arrow);return card;
  }

  async function runSearch(term) {
    const results=$("clips-search-results");
    if(!results)return;
    const query=term.trim().replace(/[^a-zA-Z0-9 _-]/g,"").replace(/\s+/g," ").slice(0,60);
    results.hidden=false;results.replaceChildren();
    if(query.length<2){
      const hint=document.createElement("p");hint.className="discover-empty";hint.textContent="Type at least 2 characters to search.";results.append(hint);return;
    }
    const loading=document.createElement("p");loading.className="discover-empty";loading.textContent="Searching creators and clips…";results.append(loading);
    try{
      const pattern="%"+query+"%";
      const [byName,byHandle,clipResult]=await Promise.all([
        client.from("profiles").select("id,username,display_name,avatar_url").ilike("display_name",pattern).limit(12),
        client.from("profiles").select("id,username,display_name,avatar_url").ilike("username",pattern).limit(12),
        client.from("clips").select("id,user_id,caption,storage_path,created_at").eq("status","approved").ilike("caption",pattern).order("created_at",{ascending:false}).limit(12)
      ]);
      if(byName.error)throw byName.error;if(byHandle.error)throw byHandle.error;if(clipResult.error)throw clipResult.error;
      const creatorMap=new Map();
      for(const profile of [...(byName.data||[]),...(byHandle.data||[])])creatorMap.set(profile.id,profile);
      const creatorSection=document.createElement("section");creatorSection.className="discover-result-section";
      const creatorHeading=document.createElement("h3");creatorHeading.textContent="Creators";
      const creatorGrid=document.createElement("div");creatorGrid.className="discover-creator-grid";
      for(const profile of creatorMap.values())creatorGrid.append(searchCreatorCard(profile));
      creatorSection.append(creatorHeading,creatorGrid);
      if(!creatorMap.size){const empty=document.createElement("p");empty.className="discover-muted";empty.textContent="No creators found for this search.";creatorSection.append(empty);}
      const clipSection=document.createElement("section");clipSection.className="discover-result-section";
      const clipHeading=document.createElement("h3");clipHeading.textContent="Clips";
      const clipGrid=document.createElement("div");clipGrid.className="discover-clip-grid";
      const clips=clipResult.data||[];
      if(clips.length){
        const ids=[...new Set(clips.map(clip=>clip.user_id))];
        const {data:profiles,error:profilesError}=await client.from("profiles").select("id,username,display_name,avatar_url").in("id",ids);
        if(profilesError)throw profilesError;
        const map=new Map((profiles||[]).map(profile=>[profile.id,profile]));
        for(const clip of clips){
          const [signedResult]=await Promise.all([client.storage.from("darklands-clips").createSignedUrl(clip.storage_path,3600)]);
          if(signedResult.error||!signedResult.data?.signedUrl)continue;
          const card=document.createElement("article");card.className="discover-clip-card";
          const video=document.createElement("video");video.src=signedResult.data.signedUrl;video.controls=true;video.muted=true;video.playsInline=true;video.preload="metadata";
          const details=document.createElement("div");details.className="discover-clip-details";
          const caption=document.createElement("p");caption.textContent=clip.caption||"A community clip";
          const profile=map.get(clip.user_id);
          const creator=document.createElement("a");creator.className="discover-clip-creator";creator.textContent=profile?"@"+profile.username:"Darklands member";
          if(profile?.username)creator.href=page("profile.html")+"?u="+encodeURIComponent(profile.username);
          details.append(caption,creator);card.append(video,details);clipGrid.append(card);
        }
      }
      clipSection.append(clipHeading,clipGrid);
      if(!clipGrid.children.length){const empty=document.createElement("p");empty.className="discover-muted";empty.textContent="No approved clips found for this search.";clipSection.append(empty);}
      results.replaceChildren(creatorSection,clipSection);
    }catch(error){
      results.replaceChildren();const failed=document.createElement("p");failed.className="discover-empty";failed.textContent="Search isn't available right now. Please try again.";results.append(failed);
    }
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
      const [{ data: likeRows, error: likesError }, { data: commentRows, error: commentsError }, { data: saveRows, error: savesError }, { data: repostRows, error: repostsError }] = await Promise.all([
        client.from("clip_likes").select("clip_id, user_id").in("clip_id", clipIds),
        client.from("clip_comments").select("id, clip_id").in("clip_id", clipIds),
        client.from("clip_saves").select("clip_id, user_id").in("clip_id", clipIds),
        client.from("clip_reposts").select("clip_id, user_id").in("clip_id", clipIds)
      ]);
      if (likesError) throw likesError;
      if (commentsError) throw commentsError;
      if (savesError) throw savesError;
      if (repostsError) throw repostsError;
      const likesByClip = new Map();
      const commentsByClip = new Map();
      const savesByClip = new Map();
      const repostsByClip = new Map();
      for (const row of likeRows || []) {
        if (!likesByClip.has(row.clip_id)) likesByClip.set(row.clip_id, []);
        likesByClip.get(row.clip_id).push(row);
      }
      for (const row of commentRows || []) commentsByClip.set(row.clip_id, (commentsByClip.get(row.clip_id) || 0) + 1);
      for (const row of saveRows || []) { if (!savesByClip.has(row.clip_id)) savesByClip.set(row.clip_id, []); savesByClip.get(row.clip_id).push(row); }
      for (const row of repostRows || []) { if (!repostsByClip.has(row.clip_id)) repostsByClip.set(row.clip_id, []); repostsByClip.get(row.clip_id).push(row); }
      const prepared = await Promise.all(clips.map(async clip => {
        const { data: signed, error: signedError } = await client.storage.from("darklands-clips")
          .createSignedUrl(clip.storage_path, 3600);
        return signedError || !signed?.signedUrl ? null : { clip, profile: profileMap.get(clip.user_id), url: signed.signedUrl };
      }));
      for (const item of prepared) {
        if (!item) continue;
        const card = createClipCard(item.clip, item.profile, item.url, likesByClip.get(item.clip.id) || [], commentsByClip.get(item.clip.id) || 0, savesByClip.get(item.clip.id) || [], repostsByClip.get(item.clip.id) || []);
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

  $("clips-search-form").addEventListener("submit",event=>{event.preventDefault();runSearch($("clips-search-input").value);});
  $("clips-search-input").addEventListener("keydown",event=>{if(event.key==="Escape"){$("clips-search-input").value="";$("clips-search-results").hidden=true;}});
  $("feed-tab").addEventListener("click", () => showPanel("feed"));
  $("upload-toggle").addEventListener("click", () => showPanel("upload"));
  $("upload-close").addEventListener("click", () => showPanel("feed"));
  $("submissions-toggle").addEventListener("click", () => showPanel("submissions"));
  $("clips-refresh").addEventListener("click", loadClips);
  loadMoreButton.addEventListener("click", () => loadFeed(false));
  feed.addEventListener("scroll", () => {
    if (feed.scrollTop + feed.clientHeight >= feed.scrollHeight - 500 && hasMore) loadFeed(false);
  }, { passive: true });

  document.addEventListener("keydown", event => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (target && (target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(target.tagName))) return;
    const cards = [...feed.querySelectorAll(".clip-card")];
    if (!cards.length) return;
    const active = cards.find(card => {
      const rect = card.getBoundingClientRect();
      return rect.top < window.innerHeight * 0.65 && rect.bottom > window.innerHeight * 0.35;
    }) || cards[0];
    const video = active.querySelector("video");
    if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else active.requestFullscreen?.().catch(() => say("Fullscreen isn't available here."));
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const index = cards.indexOf(active);
      const next = cards[Math.max(0, Math.min(cards.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))];
      next?.scrollIntoView({behavior:"smooth",block:"start"});
    } else if (event.code === "Space" && video) {
      event.preventDefault();
      if (video.paused) video.play().catch(() => {});
      else video.pause();
    }
  });

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