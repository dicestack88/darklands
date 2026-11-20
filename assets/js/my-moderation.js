(() => {
  "use strict";
  const config=window.DARKLANDS_CONFIG;
  const ready=config?.SUPABASE_URL&&config?.SUPABASE_ANON_KEY&&!config.SUPABASE_ANON_KEY.includes("PASTE_YOUR_")&&window.supabase?.createClient;
  const db=ready?window.supabase.createClient(config.SUPABASE_URL,config.SUPABASE_ANON_KEY):null;
  const $=id=>document.getElementById(id);
  const status=$("my-moderation-status"),content=$("my-moderation-content");
  const say=message=>{status.textContent=message;};
  const date=value=>new Date(value).toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short"});
  const node=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
  const empty=(root,message)=>{root.replaceChildren(node("p","moderation-empty",message));};
  async function start(){
    if(!db){say("Account services aren't configured.");return;}
    const {data,error}=await db.auth.getUser(),user=data?.user;
    if(error||!user){location.replace(new URL("login.html",config.SITE_URL));return;}
    content.hidden=false;
    const [actionsResult,restrictionsResult,appealsResult]=await Promise.all([
      db.from("dimension_moderation_actions").select("id,action_type,reason,created_at").eq("target_user_id",user.id).order("created_at",{ascending:false}).limit(100),
      db.from("dimension_account_restrictions").select("id,restriction_type,reason,starts_at,expires_at,active").eq("user_id",user.id).order("created_at",{ascending:false}),
      db.from("dimension_moderation_appeals").select("id,action_id,status,appeal_text,submitted_at,reviewed_at,moderator_note").eq("user_id",user.id).order("submitted_at",{ascending:false})
    ]);
    for(const r of [actionsResult,restrictionsResult,appealsResult])if(r.error)throw r.error;
    const actions=actionsResult.data||[],restrictions=restrictionsResult.data||[],appeals=appealsResult.data||[];
    const restrictionRoot=$("my-restrictions");restrictionRoot.replaceChildren();
    const active=restrictions.filter(r=>r.active&&(!r.expires_at||new Date(r.expires_at)>new Date()));
    if(!active.length)empty(restrictionRoot,"No active account restrictions.");
    else for(const r of active){
      const card=node("article","moderation-report"),body=node("div","moderation-report-body");
      body.append(node("div","moderation-meta","ACTIVE RESTRICTION"),node("h3","moderation-report-title",r.restriction_type.toUpperCase()),node("p","moderation-report-details",r.reason),node("p","moderation-id",r.expires_at?"Expires "+date(r.expires_at):"No expiry has been set."));
      card.append(body);restrictionRoot.append(card);
    }
    const appealByAction=new Map(appeals.map(a=>[a.action_id,a]));
    const actionRoot=$("my-actions");actionRoot.replaceChildren();
    if(!actions.length)empty(actionRoot,"No moderation actions have been recorded.");
    else for(const action of actions){
      const card=node("article","moderation-report"),body=node("div","moderation-report-body");
      body.append(node("div","moderation-meta",date(action.created_at)),node("h3","moderation-report-title",action.action_type.replaceAll("_"," ").toUpperCase()),node("p","moderation-report-details",action.reason||"No reason supplied."));
      const eligible=["warning","timeout","suspension"].includes(action.action_type)&&new Date(action.created_at)>Date.now()-30*86400000;
      const existing=appealByAction.get(action.id);
      if(eligible&&!existing){
        const form=node("form","my-appeal-form"),label=node("label","","Appeal this action");
        const input=node("textarea","moderation-note");input.required=true;input.minLength=10;input.maxLength=2000;input.placeholder="Explain why you believe this decision should be reviewed (10–2,000 characters).";
        const submit=node("button","moderation-action approve","Submit appeal");submit.type="submit";
        form.append(label,input,submit);
        form.addEventListener("submit",async e=>{
          e.preventDefault();if(input.value.trim().length<10)return;
          submit.disabled=true;submit.textContent="Submitting…";
          const {error}=await db.rpc("dimension_submit_moderation_appeal",{p_action_id:action.id,p_appeal_text:input.value.trim()});
          if(error){say(error.message||"Your appeal could not be submitted.");submit.disabled=false;submit.textContent="Submit appeal";return;}
          say("Your appeal has been submitted.");await start();
        });
        body.append(form);
      }else if(existing)body.append(node("p","moderation-id","Appeal status · "+existing.status.toUpperCase()));
      else if(eligible)body.append(node("p","moderation-id","Appeal window has expired."));
      card.append(body);actionRoot.append(card);
    }
    const appealRoot=$("my-appeals");appealRoot.replaceChildren();
    if(!appeals.length)empty(appealRoot,"You haven't submitted any appeals.");
    else for(const appeal of appeals){
      const card=node("article","moderation-report"),body=node("div","moderation-report-body");
      body.append(node("div","moderation-meta",date(appeal.submitted_at)),node("h3","moderation-report-title","APPEAL · "+appeal.status.toUpperCase()),node("p","moderation-report-details",appeal.appeal_text));
      if(appeal.moderator_note)body.append(node("p","moderation-id","Moderator note · "+appeal.moderator_note));
      card.append(body);appealRoot.append(card);
    }
    say("Your account moderation history is up to date.");
  }
  start().catch(error=>say(error.message||"Could not load your moderation status."));
})();