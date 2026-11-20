(() => {
  "use strict";
  const config=window.DARKLANDS_CONFIG;
  const ready=config?.SUPABASE_URL&&config?.SUPABASE_ANON_KEY&&!config.SUPABASE_ANON_KEY.includes("PASTE_YOUR_")&&window.supabase?.createClient;
  const client=ready?window.supabase.createClient(config.SUPABASE_URL,config.SUPABASE_ANON_KEY):null;
  const $=id=>document.getElementById(id);
  const status=$("analytics-status"),dashboard=$("analytics-dashboard"),range=$("analytics-range");
  const ownerTools=$("owner-analytics-tools"),creatorForm=$("analytics-creator-form"),creatorSearch=$("analytics-creator-search"),creatorSelect=$("analytics-creator-select");
  let targetUserId=null;
  const fmt=value=>Number(value||0).toLocaleString();
  const say=value=>status.textContent=value;
  function render(data){
    const totals=data.totals||{};
    for(const key of ["views","likes","comments","reposts","saves","clips"]) $("stat-"+key).textContent=fmt(totals[key]);
    const chart=$("analytics-chart");chart.replaceChildren();
    const days=data.daily||[],max=Math.max(1,...days.map(d=>Number(d.views)||0));
    for(const [i,day] of days.entries()){
      const wrap=document.createElement("div");wrap.className="analytics-bar-wrap";
      const bar=document.createElement("div");bar.className="analytics-bar";bar.style.height=Math.max(3,(Number(day.views)||0)/max*100)+"%";bar.title=new Date(day.date+"T00:00:00").toLocaleDateString()+": "+fmt(day.views)+" views";
      const label=document.createElement("small");label.textContent=(i===0||i===days.length-1||i%5===0)?new Date(day.date+"T00:00:00").toLocaleDateString(undefined,{day:"numeric",month:"short"}):"";
      wrap.append(bar,label);chart.append(wrap);
    }
    const tbody=$("analytics-clips");tbody.replaceChildren();
    for(const clip of data.clips||[]){
      const row=document.createElement("tr");
      const title=document.createElement("td");title.className="analytics-clip-title";title.textContent=clip.caption||"Untitled clip";
      row.append(title);
      for(const key of ["views","likes","comments","reposts","saves"]){const cell=document.createElement("td");cell.textContent=fmt(clip[key]);row.append(cell);}
      tbody.append(row);
    }
    if(!(data.clips||[]).length){const row=document.createElement("tr"),cell=document.createElement("td");cell.colSpan=6;cell.className="analytics-empty";cell.textContent="Your approved clips will appear here once they're published.";row.append(cell);tbody.append(row);}
    dashboard.hidden=false;
  }
  async function load(){
    if(!client){say("Analytics services are unavailable. Please try again later.");return;}
    say("Loading your creator analytics…");dashboard.hidden=true;
    const {data,error}=await client.rpc("dimension_get_creator_analytics",{p_days:Number(range.value),p_user_id:targetUserId});
    if(error){say(error.message?.includes("permission")||error.code==="42501"?"You can only view analytics for your own clips.":"Analytics couldn't be loaded. Please refresh and try again.");return;}
    render(data||{});
    say("Your private creator analytics are up to date.");
  }
  async function start(){
    if(!client){say("Account services aren't configured.");return;}
    const {data,error}=await client.auth.getUser();
    if(error||!data?.user){say("Please sign in to view creator analytics.");return;}
    const {data:isOwner}=await client.rpc("dimension_is_owner");
    if(isOwner===true){ownerTools.hidden=false;}
    await load();
  }
  creatorForm.addEventListener("submit",async event=>{
    event.preventDefault();
    const query=creatorSearch.value.trim();
    if(!query){targetUserId=null;creatorSelect.hidden=true;await load();return;}
    const {data,error}=await client.rpc("dimension_search_role_members",{p_query:query});
    if(error){say("Creator search is unavailable.");return;}
    creatorSelect.replaceChildren();
    for(const member of data||[]){const option=document.createElement("option");option.value=member.user_id;option.textContent=(member.display_name||member.username)+" (@"+member.username+")";creatorSelect.append(option);}
    if(!creatorSelect.options.length){say("No matching creator found.");creatorSelect.hidden=true;return;}
    creatorSelect.hidden=false;
    targetUserId=creatorSelect.value;
    await load();
  });
  creatorSelect.addEventListener("change",()=>{targetUserId=creatorSelect.value;load();});
  range.addEventListener("change",load);
  start().catch(()=>say("Analytics couldn't be loaded. Please refresh and try again."));
})();