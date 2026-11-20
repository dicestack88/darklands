(() => {
  "use strict";
  const config=window.DARKLANDS_CONFIG;
  const ready=config?.SUPABASE_URL&&config?.SUPABASE_ANON_KEY&&window.supabase?.createClient;
  const client=ready?window.supabase.createClient(config.SUPABASE_URL,config.SUPABASE_ANON_KEY):null;
  const $=id=>document.getElementById(id);
  const status=$("discover-status");
  const results=$("discover-search-results");
  const form=$("discover-search-form");
  const input=$("discover-search-input");
  const page=name=>new URL(name,config.SITE_URL).toString();
  const initials=name=>(name||"D").trim().split(/\s+/).slice(0,2).map(part=>part[0]||"").join("").toUpperCase();
  let searchTimer=null;
  let searchSequence=0;

  function creatorCard(profile){
    const card=document.createElement("a");
    card.className="discover-creator-card";
    card.href=page("profile.html")+"?u="+encodeURIComponent(profile.username);
    const avatar=document.createElement("span");
    avatar.className="discover-avatar";
    if(profile.avatar_url&&/^https?:\/\//i.test(profile.avatar_url)){
      const image=document.createElement("img");image.src=profile.avatar_url;image.alt="";image.loading="lazy";avatar.append(image);
    }else avatar.textContent=initials(profile.display_name);
    const info=document.createElement("span");info.className="discover-creator-info";
    const name=document.createElement("strong");name.textContent=profile.display_name||"Dimension member";
    const handle=document.createElement("small");handle.textContent="@"+profile.username;
    info.append(name,handle);
    const arrow=document.createElement("span");arrow.className="discover-arrow";arrow.textContent="↗";
    card.append(avatar,info,arrow);
    return card;
  }

  async function search(term){
    const requestId=++searchSequence;
    const query=term.trim().replace(/[^a-zA-Z0-9 _-]/g,"").replace(/\s+/g," ").slice(0,60);
    results.hidden=false;
    results.replaceChildren();
    if(query.length<2){results.hidden=true;return;}
    const loading=document.createElement("p");
    loading.className="discover-empty";
    loading.textContent="Searching creators and approved clips…";
    results.append(loading);
    try{
      const pattern="%"+query+"%";
      const [byName,byHandle,clipResult]=await Promise.all([
        client.from("profiles").select("id,username,display_name,avatar_url").ilike("display_name",pattern).limit(8),
        client.from("profiles").select("id,username,display_name,avatar_url").ilike("username",pattern).limit(8),
        client.from("clips").select("id,user_id,caption,storage_path,created_at").eq("status","approved").ilike("caption",pattern).order("created_at",{ascending:false}).limit(5)
      ]);
      if(requestId!==searchSequence)return;
      if(byName.error)throw byName.error;
      if(byHandle.error)throw byHandle.error;
      if(clipResult.error)throw clipResult.error;

      const creatorMap=new Map();
      for(const profile of [...(byName.data||[]),...(byHandle.data||[])])creatorMap.set(profile.id,profile);
      const creatorSection=document.createElement("section");creatorSection.className="discover-result-section";
      const creatorHeading=document.createElement("h3");creatorHeading.textContent="Creators";
      const creatorGrid=document.createElement("div");creatorGrid.className="discover-creator-grid";
      for(const profile of creatorMap.values())creatorGrid.append(creatorCard(profile));
      creatorSection.append(creatorHeading,creatorGrid);
      if(!creatorMap.size){const empty=document.createElement("p");empty.className="discover-muted";empty.textContent="No matching creators.";creatorSection.append(empty);}

      const clipSection=document.createElement("section");clipSection.className="discover-result-section";
      const clipHeading=document.createElement("h3");clipHeading.textContent="Clips";
      const clipGrid=document.createElement("div");clipGrid.className="discover-clip-grid";
      const clips=clipResult.data||[];
      if(clips.length){
        const ids=[...new Set(clips.map(clip=>clip.user_id))];
        const {data:profiles,error:profilesError}=await client.from("profiles").select("id,username,display_name").in("id",ids);
        if(profilesError)throw profilesError;
        if(requestId!==searchSequence)return;
        const profileMap=new Map((profiles||[]).map(profile=>[profile.id,profile]));
        for(const clip of clips){
          const {data:signed,error:signedError}=await client.storage.from("darklands-clips").createSignedUrl(clip.storage_path,900);
          if(requestId!==searchSequence)return;
          if(signedError||!signed?.signedUrl)continue;
          const card=document.createElement("article");card.className="discover-clip-card";
          const video=document.createElement("video");video.src=signed.signedUrl;video.controls=true;video.muted=true;video.playsInline=true;video.preload="none";
          const details=document.createElement("div");details.className="discover-clip-details";
          const caption=document.createElement("p");caption.textContent=clip.caption||"A community clip";
          const profile=profileMap.get(clip.user_id);
          const creator=document.createElement("a");creator.className="discover-clip-creator";creator.textContent=profile?"@"+profile.username:"Dimension member";
          if(profile?.username)creator.href=page("profile.html")+"?u="+encodeURIComponent(profile.username);
          details.append(caption,creator);card.append(video,details);clipGrid.append(card);
        }
      }
      clipSection.append(clipHeading,clipGrid);
      if(!clipGrid.children.length){const empty=document.createElement("p");empty.className="discover-muted";empty.textContent="No matching clips.";clipSection.append(empty);}
      if(requestId===searchSequence)results.replaceChildren(creatorSection,clipSection);
    }catch(error){
      if(requestId!==searchSequence)return;
      results.replaceChildren();
      const failed=document.createElement("p");failed.className="discover-empty";failed.textContent="Search isn't available right now. Please try again.";
      results.append(failed);
    }
  }

  form.addEventListener("submit",event=>{
    event.preventDefault();
    if(searchTimer)clearTimeout(searchTimer);
    search(input.value);
  });
  input.addEventListener("input",()=>{
    if(searchTimer)clearTimeout(searchTimer);
    const term=input.value.trim();
    if(term.length<2){searchSequence++;results.hidden=true;results.replaceChildren();return;}
    results.hidden=false;
    const hint=document.createElement("p");hint.className="discover-empty";hint.textContent="Finding creators and clips…";
    results.replaceChildren(hint);
    searchTimer=setTimeout(()=>search(term),260);
  });
  input.addEventListener("keydown",event=>{
    if(event.key==="Escape"){
      if(searchTimer)clearTimeout(searchTimer);
      searchSequence++;input.value="";results.hidden=true;results.replaceChildren();
    }
  });

  (async()=>{
    if(!client){status.textContent="Account services are unavailable. Please try again later.";return;}
    const {data,error}=await client.auth.getUser();
    const user=data?.user;
    if(error||!user||!(user.email_confirmed_at||user.confirmed_at)){
      await client.auth.signOut();
      location.replace(page("login.html"));return;
    }
    status.textContent="You're signed in. Search creators and approved clips across the community.";
  })().catch(()=>{status.textContent="We couldn't verify your session. Please log in again.";});
})();
