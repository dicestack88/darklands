(() => {
  const config = window.DARKLANDS_CONFIG;
  const keyReady = config && config.SUPABASE_ANON_KEY && !config.SUPABASE_ANON_KEY.includes("PASTE_YOUR_");
  const clientReady = keyReady && window.supabase && window.supabase.createClient;
  const client = clientReady ? window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY) : null;
  const status = document.getElementById("moderation-status");
  const content = document.getElementById("moderation-content");
  const clipsRoot = document.getElementById("moderation-clips");
  const reportsRoot = document.getElementById("moderation-reports");
  const roleSection = document.getElementById("moderation-role-section");
  const roleSearch = document.getElementById("moderation-role-search");
  const roleQuery = document.getElementById("moderation-role-query");
  const roleResults = document.getElementById("moderation-role-results");
  const refreshButton = document.getElementById("moderation-refresh");
  const logoutButton = document.getElementById("moderation-logout");
  const verified = user => Boolean(user && (user.email_confirmed_at || user.confirmed_at));
  const page = name => new URL(name, config.SITE_URL).toString();
  const say = message => { status.textContent = message; };
  const date = value => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  function empty(root, message) {
    const node = document.createElement("p");
    node.className = "moderation-empty";
    node.textContent = message;
    root.replaceChildren(node);
  }

  function actionButton(label, kind, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "moderation-action " + (kind || "");
    button.textContent = label;
    button.addEventListener("click", async () => {
      button.disabled = true;
      const oldLabel = button.textContent;
      button.textContent = "Working…";
      try {
        await handler();
        await loadQueue();
      } catch (error) {
        say(error.message || "That action couldn't be completed. Please refresh and try again.");
        button.disabled = false;
        button.textContent = oldLabel;
      }
    });
    return button;
  }

  async function signedVideo(path) {
    const { data, error } = await client.storage.from("darklands-clips").createSignedUrl(path, 900);
    if (error || !data?.signedUrl) throw new Error("A clip video couldn't be opened. Check the moderator storage policy.");
    return data.signedUrl;
  }

  async function renderClip(clip) {
    const card = document.createElement("article");
    card.className = "moderation-card";
    const video = document.createElement("video");
    video.className = "moderation-video";
    video.controls = true;
    video.preload = "metadata";
    video.src = await signedVideo(clip.storage_path);
    video.setAttribute("aria-label", "Clip awaiting moderation");

    const body = document.createElement("div");
    body.className = "moderation-card-body";
    const meta = document.createElement("div");
    meta.className = "moderation-meta";
    const pill = document.createElement("span");
    pill.className = "moderation-pill";
    pill.textContent = clip.status.toUpperCase();
    const time = document.createElement("time");
    time.textContent = date(clip.created_at);
    meta.append(pill, time);

    const caption = document.createElement("p");
    caption.className = "moderation-caption";
    caption.textContent = clip.caption || "No caption";
    const id = document.createElement("p");
    id.className = "moderation-id";
    id.textContent = "Clip ID · " + clip.id;
    const actions = document.createElement("div");
    actions.className = "moderation-actions";
    actions.append(
      actionButton("Approve clip", "approve", async () => {
        const { error } = await client.rpc("moderate_clip", { p_clip_id: clip.id, p_new_status: "approved" });
        if (error) throw error;
        say("Clip approved.");
      }),
      actionButton("Reject clip", "reject", async () => {
        const { error } = await client.rpc("moderate_clip", { p_clip_id: clip.id, p_new_status: "rejected" });
        if (error) throw error;
        say("Clip rejected.");
      })
    );
    body.append(meta, caption, id, actions);
    card.append(video, body);
    return card;
  }

  async function renderReport(report, clip) {
    const card = document.createElement("article");
    card.className = "moderation-report";
    const body = document.createElement("div");
    body.className = "moderation-report-body";
    const meta = document.createElement("div");
    meta.className = "moderation-meta";
    const pill = document.createElement("span");
    pill.className = "moderation-pill";
    pill.textContent = report.reason.replaceAll("_", " ").toUpperCase();
    const time = document.createElement("time");
    time.textContent = date(report.created_at);
    meta.append(pill, time);

    const title = document.createElement("h3");
    title.className = "moderation-report-title";
    title.textContent = "Community report";
    const details = document.createElement("p");
    details.className = "moderation-report-details";
    details.textContent = report.details || "No additional details provided.";
    const target = document.createElement("div");
    target.className = "moderation-report-clip";
    const targetTitle = document.createElement("strong");
    targetTitle.textContent = "Reported clip";
    const targetCaption = document.createElement("p");
    targetCaption.textContent = clip ? (clip.caption || "No caption") + " · Current status: " + clip.status : "The reported clip is no longer available.";
    target.append(targetTitle, targetCaption);

    const note = document.createElement("textarea");
    note.className = "moderation-note";
    note.maxLength = 500;
    note.placeholder = "Optional moderator note (max 500 characters)";
    note.value = report.moderator_note || "";
    note.setAttribute("aria-label", "Moderator note for report");
    const actions = document.createElement("div");
    actions.className = "moderation-actions";
    const save = nextStatus => async () => {
      const { error } = await client.from("clip_reports")
        .update({ review_status: nextStatus, moderator_note: note.value.trim() })
        .eq("id", report.id)
        .select("id")
        .single();
      if (error) throw error;
      say("Report marked " + nextStatus + ".");
    };
    actions.append(
      actionButton("Mark reviewed", "", save("reviewed")),
      actionButton("Action taken", "approve", save("actioned")),
      actionButton("Dismiss report", "reject", save("dismissed"))
    );
    body.append(meta, title, details, target, note, actions);
    card.append(body);
    return card;
  }

  async function loadQueue() {
    say("Loading moderation queue…");
    clipsRoot.setAttribute("aria-busy", "true");
    reportsRoot.setAttribute("aria-busy", "true");
    try {
      const [clipResult, reportResult] = await Promise.all([
        client.from("clips").select("id, caption, storage_path, status, created_at").eq("status", "pending").order("created_at", { ascending: true }),
        client.from("clip_reports").select("id, clip_id, reason, details, created_at, review_status, moderator_note").eq("review_status", "open").order("created_at", { ascending: true })
      ]);
      if (clipResult.error) throw clipResult.error;
      if (reportResult.error) throw reportResult.error;

      clipsRoot.replaceChildren();
      if (!clipResult.data?.length) {
        empty(clipsRoot, "The review queue is clear. No pending clips.");
      } else {
        for (const clip of clipResult.data) {
          try { clipsRoot.append(await renderClip(clip)); }
          catch (error) {
            const failed = document.createElement("p");
            failed.className = "moderation-empty";
            failed.textContent = "Clip " + clip.id + " was found, but its video preview failed to load.";
            clipsRoot.append(failed);
          }
        }
      }

      reportsRoot.replaceChildren();
      if (!reportResult.data?.length) {
        empty(reportsRoot, "No open community reports.");
      } else {
        const ids = [...new Set(reportResult.data.map(report => report.clip_id))];
        const { data: clips, error: lookupError } = await client.from("clips")
          .select("id, caption, status").in("id", ids);
        if (lookupError) throw lookupError;
        const clipMap = new Map((clips || []).map(clip => [clip.id, clip]));
        for (const report of reportResult.data) reportsRoot.append(await renderReport(report, clipMap.get(report.clip_id)));
      }
      say("Moderator access verified. Queue updated.");
    } finally {
      clipsRoot.removeAttribute("aria-busy");
      reportsRoot.removeAttribute("aria-busy");
    }
  }

  async function loadRoleMembers(query="") {
    if(!roleResults)return;
    roleResults.setAttribute("aria-busy","true");
    const {data,error}=await client.rpc("dimension_search_role_members",{p_query:query});
    roleResults.removeAttribute("aria-busy");
    if(error)throw error;
    roleResults.replaceChildren();
    if(!data?.length){empty(roleResults,"No matching members found.");return;}
    for(const member of data){
      const row=document.createElement("article");
      row.className="moderation-role-row";
      const identity=document.createElement("div");
      identity.className="moderation-role-identity";
      const name=document.createElement("strong");
      name.textContent=member.display_name||member.username;
      const handle=document.createElement("span");
      handle.textContent="@"+member.username;
      identity.append(name,handle);
      const controls=document.createElement("div");
      controls.className="moderation-role-controls";
      const select=document.createElement("select");
      select.className="moderation-role-select";
      select.setAttribute("aria-label","Role for @"+member.username);
      for(const [value,label] of [["member","Member"],["supporter","Supporter"],["moderator","Moderator"]]){
        const option=document.createElement("option");option.value=value;option.textContent=label;select.append(option);
      }
      const isOwner=member.role==="owner";
      if(isOwner){
        select.replaceChildren();
        const option=document.createElement("option");option.value="owner";option.textContent="Owner";select.append(option);
        select.disabled=true;
      }else select.value=member.role||"member";
      const save=document.createElement("button");
      save.type="button";save.className="moderation-action approve";save.textContent=isOwner?"Protected":"Save role";
      save.disabled=isOwner;
      save.addEventListener("click",async()=>{
        save.disabled=true;save.textContent="Saving…";
        const {error:saveError}=await client.rpc("dimension_set_member_role",{p_user_id:member.user_id,p_role:select.value});
        if(saveError){say(saveError.message||"The member role could not be updated.");save.disabled=false;save.textContent="Save role";return;}
        say("Updated @"+member.username+"'s role.");
        await loadRoleMembers(roleQuery.value.trim());
      });
      controls.append(select,save);
      row.append(identity,controls);
      roleResults.append(row);
    }
  }

  async function start() {
    if (!client) { say("Account services aren't configured. Please try again later."); return; }
    try {
      const { data, error } = await client.auth.getUser();
      const user = data?.user;
      if (error || !verified(user)) {
        await client.auth.signOut();
        window.location.replace(page("login.html"));
        return;
      }
      const [{data:isModerator,error:accessError},{data:isOwner,error:ownerError}]=await Promise.all([
        client.rpc("is_darklands_moderator"),
        client.rpc("dimension_is_owner")
      ]);
      if(accessError)throw accessError;
      if(ownerError)throw ownerError;
      if(isModerator!==true){
        say("Access denied. This account does not have moderation access.");
        return;
      }
      content.hidden=false;
      if(isOwner===true&&roleSection){
        roleSection.hidden=false;
        await loadRoleMembers("");
      }
      await loadQueue();
    } catch (error) {
      say(error.message || "We couldn't verify moderator access. Please try again later.");
    }
  }

  if(roleSearch)roleSearch.addEventListener("submit",event=>{
    event.preventDefault();
    loadRoleMembers(roleQuery.value.trim()).catch(error=>say(error.message||"Member search failed."));
  });
  if (refreshButton) refreshButton.addEventListener("click", () => loadQueue().catch(error => say(error.message || "Refresh failed.")));
  if (logoutButton && client) logoutButton.addEventListener("click", async () => {
    logoutButton.disabled = true;
    const { error } = await client.auth.signOut();
    if (error) {
      logoutButton.disabled = false;
      say("Could not sign out. Please try again.");
      return;
    }
    window.location.replace(page("login.html"));
  });

  start();
})();