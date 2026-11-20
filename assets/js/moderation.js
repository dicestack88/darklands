(() => {
  "use strict";
  const config=window.DARKLANDS_CONFIG;
  const ready=config?.SUPABASE_URL&&config?.SUPABASE_ANON_KEY&&!config.SUPABASE_ANON_KEY.includes("PASTE_YOUR_")&&window.supabase?.createClient;
  const db=ready?window.supabase.createClient(config.SUPABASE_URL,config.SUPABASE_ANON_KEY):null;
  const $=id=>document.getElementById(id);
  const status=$("moderation-status"),contentRoot=$("moderation-content");
  const roots={
    clips:$("moderation-clips"),clipReports:$("moderation-reports"),
    messageReports:$("moderation-message-reports"),contentReports:$("moderation-content-reports"),
    appeals:$("moderation-appeals"),history:$("moderation-history")
  };
  const roleSection=$("moderation-role-section"),roleSearch=$("moderation-role-search"),
    roleQuery=$("moderation-role-query"),roleResults=$("moderation-role-results");
  const verified=user=>Boolean(user&&(user.email_confirmed_at||user.confirmed_at));
  const page=name=>new URL(name,config.SITE_URL).toString();
  const say=message=>{status.textContent=message;};
  const date=value=>new Date(value).toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short"});
  const empty=(root,message)=>{const p=document.createElement("p");p.className="moderation-empty";p.textContent=message;root.replaceChildren(p);};
  const node=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;};
  function button(label,kind,handler){
    const b=node("button","moderation-action "+(kind||""),label);b.type="button";
    b.addEventListener("click",async()=>{b.disabled=true;const old=b.textContent;b.textContent="Working…";try{await handler();b.disabled=false;b.textContent=old;}catch(e){say(e.message||"Action failed. Refresh and try again.");b.disabled=false;b.textContent=old;}});
    return b;
  }
  async function signedVideo(path){
    const {data,error}=await db.storage.from("darklands-clips").createSignedUrl(path,900);
    if(error||!data?.signedUrl)throw new Error("Video preview unavailable.");
    return data.signedUrl;
  }
  async function renderClip(clip){
    const card=node("article","moderation-card"),video=node("video","moderation-video");
    video.controls=true;video.preload="metadata";video.src=await signedVideo(clip.storage_path);
    const body=node("div","moderation-card-body"),meta=node("div","moderation-meta");
    meta.append(node("span","moderation-pill",String(clip.status).toUpperCase()),node("time","",date(clip.created_at)));
    const actions=node("div","moderation-actions");
    actions.append(
      button("Approve clip","approve",async()=>{const {error}=await db.rpc("moderate_clip",{p_clip_id:clip.id,p_new_status:"approved"});if(error)throw error;say("Clip approved.");await loadQueue();}),
      button("Reject clip","reject",async()=>{const {error}=await db.rpc("moderate_clip",{p_clip_id:clip.id,p_new_status:"rejected"});if(error)throw error;say("Clip rejected.");await loadQueue();})
    );
    body.append(meta,node("p","moderation-caption",clip.caption||"No caption"),node("p","moderation-id","Clip · "+clip.id),actions);
    card.append(video,body);return card;
  }
  async function applyAccountAction(userId,action,reason,contextType,contextId,duration){
    const {error}=await db.rpc("dimension_moderation_apply_action",{
      p_target_user_id:userId,p_action:action,p_reason:reason||"Community guidelines review",
      p_duration_hours:duration??null,p_context_type:contextType||null,p_context_id:contextId||null
    });
    if(error)throw error;
    say(action==="warning"?"Warning recorded.":action==="timeout"?"Temporary restriction applied.":"Account suspension applied.");
    await Promise.all([loadQueue(),loadHistory()]);
  }
  function renderReportCard({report,targetUserId,targetLabel,table,contextType}){
    const card=node("article","moderation-report"),body=node("div","moderation-report-body");
    const meta=node("div","moderation-meta");
    meta.append(node("span","moderation-pill",String(report.reason||"report").replaceAll("_"," ").toUpperCase()),node("time","",date(report.created_at)));
    const details=node("p","moderation-report-details",report.details||"No additional details provided.");
    const target=node("div","moderation-report-clip");
    target.append(node("strong","","Reported "+(targetLabel||"item")),node("p","",report.target_summary||("Account ID · "+(targetUserId||"unavailable"))));
    const note=node("textarea","moderation-note");note.maxLength=500;note.placeholder="Optional moderator note (max 500 characters)";note.value=report.moderator_note||"";
    note.setAttribute("aria-label","Moderator note");
    const actions=node("div","moderation-actions");
    const review=async nextStatus=>{
      const {error}=await db.from(table).update({review_status:nextStatus,moderator_note:note.value.trim()}).eq("id",report.id).select("id").single();
      if(error)throw error;say("Report marked "+nextStatus+".");await loadQueue();await loadHistory();
    };
    actions.append(
      button("Mark reviewed","",()=>review("reviewed")),
      button("Action taken","approve",()=>review("actioned")),
      button("Dismiss","reject",()=>review("dismissed"))
    );
    if(targetUserId){
      const reason=("Reported for "+String(report.reason||"a community guidelines concern").replaceAll("_"," ")+(report.details?": "+report.details:"")).slice(0,500);
      actions.append(
        button("Warn account","",()=>applyAccountAction(targetUserId,"warning",reason,contextType,report.id,null)),
        button("Timeout 24h","",()=>applyAccountAction(targetUserId,"timeout",reason,contextType,report.id,24)),
        button("Timeout 7d","",()=>applyAccountAction(targetUserId,"timeout",reason,contextType,report.id,168)),
        button("Suspend 30d","reject",()=>window.confirm("Apply a 30-day account suspension?")?applyAccountAction(targetUserId,"suspension",reason,contextType,report.id,720):undefined),
        button("Suspend 1y","reject",()=>window.confirm("Apply a one-year account suspension?")?applyAccountAction(targetUserId,"suspension",reason,contextType,report.id,8760):undefined),
        button("Suspend indefinitely","reject",()=>window.confirm("Apply an indefinite account suspension?")?applyAccountAction(targetUserId,"suspension",reason,contextType,report.id,null):undefined),
        button("Lift restriction","",()=>window.confirm("Lift this member's active restriction?")?applyAccountAction(targetUserId,"restriction_lifted","Restriction reviewed by moderation",contextType,report.id,null):undefined)
      );
    }
    body.append(meta,node("h3","moderation-report-title",targetLabel||"Community report"),details,target,note,actions);
    card.append(body);return card;
  }
  async function loadQueue(){
    say("Loading moderation queues…");
    Object.values(roots).slice(0,4).forEach(root=>root?.setAttribute("aria-busy","true"));
    try{
      const [pending,clipReports,messageReports,contentReports]=await Promise.all([
        db.from("clips").select("id,user_id,caption,storage_path,status,created_at").eq("status","pending").order("created_at",{ascending:true}),
        db.from("clip_reports").select("id,clip_id,reason,details,created_at,review_status,moderator_note").eq("review_status","open").order("created_at",{ascending:true}),
        db.from("message_reports").select("id,reporter_id,conversation_id,reason,details,created_at,review_status,moderator_note").eq("review_status","open").order("created_at",{ascending:true}),
        db.from("dimension_content_reports").select("id,target_type,target_id,target_user_id,reason,details,created_at,review_status,moderator_note").eq("review_status","open").order("created_at",{ascending:true})
      ]);
      for(const r of [pending,clipReports,messageReports,contentReports])if(r.error)throw r.error;
      roots.clips.replaceChildren();
      if(!pending.data?.length)empty(roots.clips,"The review queue is clear. No pending clips.");
      else for(const clip of pending.data){try{roots.clips.append(await renderClip(clip));}catch(_){roots.clips.append(node("p","moderation-empty","Clip "+clip.id+" was found, but its preview failed to load."));}}
      const clipIds=[...new Set((clipReports.data||[]).map(r=>r.clip_id))];
      let clipMap=new Map();
      if(clipIds.length){
        const {data,error}=await db.from("clips").select("id,user_id,caption,status").in("id",clipIds);
        if(error)throw error;clipMap=new Map((data||[]).map(c=>[c.id,c]));
      }
      roots.clipReports.replaceChildren();
      if(!clipReports.data?.length)empty(roots.clipReports,"No open clip reports.");
      else for(const report of clipReports.data){
        const clip=clipMap.get(report.clip_id);
        const item={...report,target_summary:clip?(clip.caption||"No caption")+" · Status: "+clip.status:"Reported clip unavailable"};
        roots.clipReports.append(renderReportCard({report:item,targetUserId:clip?.user_id,targetLabel:"Clip report",table:"clip_reports",contextType:"clip_report"}));
      }
      roots.messageReports.replaceChildren();
      if(!messageReports.data?.length)empty(roots.messageReports,"No open message reports.");
      else{
        const {data:targets,error}=await db.rpc("dimension_moderation_message_report_targets");
        if(error)throw error;
        const targetMap=new Map((targets||[]).map(item=>[item.report_id,item.target_user_id]));
        for(const report of messageReports.data){
          roots.messageReports.append(renderReportCard({report,targetUserId:targetMap.get(report.id),targetLabel:"Message report",table:"message_reports",contextType:"message_report"}));
        }
      }
      roots.contentReports.replaceChildren();
      if(!contentReports.data?.length)empty(roots.contentReports,"No open account or comment reports.");
      else for(const report of contentReports.data){
        const item={...report,target_summary:report.target_type==="account"?"Reported member account":"Comment · "+report.target_id};
        roots.contentReports.append(renderReportCard({report:item,targetUserId:report.target_user_id,targetLabel:report.target_type==="account"?"Account report":"Comment report",table:"dimension_content_reports",contextType:report.target_type}));
      }
      say("Moderator access verified. All report queues are up to date.");
    }finally{Object.values(roots).slice(0,4).forEach(root=>root?.removeAttribute("aria-busy"));}
  }
  async function loadAppeals(){
    const root=roots.appeals;
    const {data,error}=await db.from("dimension_moderation_appeals").select("id,action_id,user_id,appeal_text,submitted_at,status,moderator_note").eq("status","open").order("submitted_at",{ascending:true}).limit(100);
    if(error)throw error;root.replaceChildren();
    if(!data?.length){empty(root,"No open appeals.");return;}
    for(const appeal of data){
      const card=node("article","moderation-report"),body=node("div","moderation-report-body");
      body.append(node("div","moderation-meta","SUBMITTED "+date(appeal.submitted_at)),node("h3","moderation-report-title","Appeal"),node("p","moderation-report-details",appeal.appeal_text),node("p","moderation-id","Member · "+appeal.user_id));
      const note=node("textarea","moderation-note");note.maxLength=500;note.placeholder="Optional decision note";
      const actions=node("div","moderation-actions");
      for(const [decision,label,kind] of [["accepted","Accept appeal","approve"],["denied","Deny appeal","reject"]]){
        actions.append(button(label,kind,async()=>{
          const {error}=await db.rpc("dimension_review_moderation_appeal",{p_appeal_id:appeal.id,p_decision:decision,p_moderator_note:note.value.trim()});
          if(error)throw error;say("Appeal "+decision+".");await loadAppeals();await loadHistory();
        }));
      }
      body.append(note,actions);card.append(body);root.append(card);
    }
  }
  async function loadHistory(){
    const root=roots.history;
    const {data,error}=await db.from("dimension_moderation_actions").select("id,target_user_id,moderator_id,action_type,reason,moderator_note,context_type,created_at").order("created_at",{ascending:false}).limit(60);
    if(error)throw error;root.replaceChildren();
    if(!data?.length){empty(root,"No moderation actions have been recorded.");return;}
    for(const item of data){
      const card=node("article","moderation-history-row");
      const title=node("strong","",String(item.action_type).replaceAll("_"," ").toUpperCase());
      const when=node("time","",date(item.created_at));
      const reason=node("p","moderation-report-details",item.reason||"No reason recorded");
      const ids=node("p","moderation-id","Member · "+item.target_user_id+"  |  Moderator · "+(item.moderator_id||"deleted account"));
      card.append(title,when,reason,ids);root.append(card);
    }
  }
  async function loadRoleMembers(query=""){
    if(!roleResults)return;
    roleResults.setAttribute("aria-busy","true");
    const {data,error}=await db.rpc("dimension_search_role_members",{p_query:query});
    roleResults.removeAttribute("aria-busy");if(error)throw error;roleResults.replaceChildren();
    if(!data?.length){empty(roleResults,"No matching members found.");return;}
    for(const member of data){
      const row=node("article","moderation-role-row"),identity=node("div","moderation-role-identity");
      identity.append(node("strong","",member.display_name||member.username),node("span","","@"+member.username));
      const controls=node("div","moderation-role-controls"),select=node("select","moderation-role-select");
      select.setAttribute("aria-label","Role for @"+member.username);
      for(const [value,label] of [["member","Member"],["supporter","Supporter"],["moderator","Moderator"]]){const option=node("option","",label);option.value=value;select.append(option);}
      const isOwner=member.role==="owner";
      if(isOwner){select.replaceChildren();const option=node("option","","Owner");option.value="owner";select.append(option);select.disabled=true;}
      else select.value=member.role||"member";
      const save=button(isOwner?"Protected":"Save role","approve",async()=>{
        const {error}=await db.rpc("dimension_set_member_role",{p_user_id:member.user_id,p_role:select.value});
        if(error)throw error;say("Updated @"+member.username+"'s role.");await loadRoleMembers(roleQuery.value.trim());
      });
      save.disabled=isOwner;controls.append(select,save);row.append(identity,controls);roleResults.append(row);
    }
  }
  async function start(){
    if(!db){say("Account services aren't configured. Please try again later.");return;}
    try{
      const {data,error}=await db.auth.getUser(),user=data?.user;
      if(error||!verified(user)){await db.auth.signOut();location.replace(page("login.html"));return;}
      const [{data:isMod,error:modError},{data:isOwner,error:ownerError}]=await Promise.all([db.rpc("is_darklands_moderator"),db.rpc("dimension_is_owner")]);
      if(modError)throw modError;if(ownerError)throw ownerError;
      if(isMod!==true){say("Access denied. This account does not have moderation access.");return;}
      contentRoot.hidden=false;
      if(isOwner===true&&roleSection){roleSection.hidden=false;await loadRoleMembers("");}
      await Promise.all([loadQueue(),loadAppeals(),loadHistory()]);
    }catch(e){say(e.message||"We couldn't verify moderator access.");}
  }
  if(roleSearch)roleSearch.addEventListener("submit",e=>{e.preventDefault();loadRoleMembers(roleQuery.value.trim()).catch(err=>say(err.message));});
  $("moderation-refresh")?.addEventListener("click",()=>Promise.all([loadQueue(),loadAppeals(),loadHistory()]).catch(e=>say(e.message||"Refresh failed.")));
  $("moderation-logout")?.addEventListener("click",async()=>{const {error}=await db.auth.signOut();if(error){say("Could not sign out.");return;}location.replace(page("login.html"));});
  start();
})();