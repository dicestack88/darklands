(() => {
  const config=window.DARKLANDS_CONFIG;
  const ready=config&&config.SUPABASE_ANON_KEY&&!config.SUPABASE_ANON_KEY.includes("PASTE_YOUR_")&&window.supabase?.createClient;
  const client=ready?window.supabase.createClient(config.SUPABASE_URL,config.SUPABASE_ANON_KEY):null;
  const $=id=>document.getElementById(id);
  const status=$("creator-status");
  const showError=message=>{status.textContent=message;};
  const initials=name=>(name||"D").trim().split(/\s+/).slice(0,2).map(x=>x[0]||"").join("").toUpperCase();
  function makeVideo(clip,url,options={}){
    const card=document.createElement("article");card.className="creator-video-card";
    if(options.reposted){card.classList.add("is-repost");const tag=document.createElement("div");tag.className="creator-repost-tag";tag.textContent="⟳ REPOSTED";card.append(tag);}
    const video=document.createElement("video");video.src=url;video.controls=true;video.playsInline=true;video.preload="metadata";
    const caption=document.createElement("p");caption.textContent=clip.caption||"A moment from the community.";
    const date=document.createElement("span");date.textContent=(options.reposted?"Reposted · ":"")+new Date(options.repostedAt||clip.created_at).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"});
    card.append(video,caption,date);return card;
  }
  async function start(){
    if(!client){showError("Account services aren't available right now.");return;}
    const {data:auth,error:authError}=await client.auth.getUser();
    if(authError||!auth?.user){window.location.replace(new URL("login.html",config.SITE_URL).toString());return;}
    const username=new URLSearchParams(location.search).get("u");
    if(!username||!/^[a-z0-9_]{3,20}$/.test(username)){showError("That creator profile couldn't be found.");return;}
    const {data:profile,error}=await client.from("profiles").select("id,username,display_name,bio,avatar_url,banner_url,created_at").eq("username",username).maybeSingle();
    if(error||!profile){showError("This creator profile doesn't exist or is unavailable.");return;}
    $("creator-name").textContent=profile.display_name;
    $("creator-handle").textContent="@"+profile.username;
    $("creator-bio").textContent=profile.bio||"No bio added yet.";
    const avatar=$("creator-avatar");
    if(profile.avatar_url&&/^https?:\/\//i.test(profile.avatar_url)){const img=document.createElement("img");img.src=profile.avatar_url;img.alt="";avatar.replaceChildren(img);}else avatar.textContent=initials(profile.display_name);

    if(profile.banner_url&&/^https?:\/\//i.test(profile.banner_url)){
      $("creator-cover").style.backgroundImage="linear-gradient(90deg,rgba(5,8,15,.18),rgba(5,8,15,.05)),url("+JSON.stringify(profile.banner_url)+")";
      $("creator-cover").classList.add("has-custom-banner");
    }
    const ownProfile=auth.user.id===profile.id;
    const followButton=$("creator-follow-button");
    const messageButton=$("creator-message-button");
    if(!ownProfile){messageButton.hidden=false;messageButton.addEventListener("click",async()=>{const body=window.prompt("Write your first message (max 1000 characters):");if(body===null)return;messageButton.disabled=true;const result=await client.rpc("dimension_send_message_request",{p_recipient:profile.id,p_body:body});messageButton.disabled=false;if(result.error){showError(result.error.message||"Could not send the message.");return;}window.location.href=new URL("messages.html?c="+encodeURIComponent(result.data),config.SITE_URL).toString();});}
    $("creator-own-label").hidden=!ownProfile;
    const [{count:followerCount,error:followerError},{count:followingCount,error:followingError}]=await Promise.all([
      client.from("user_follows").select("follower_id",{count:"exact",head:true}).eq("following_id",profile.id),
      client.from("user_follows").select("following_id",{count:"exact",head:true}).eq("follower_id",profile.id)
    ]);
    if(followerError||followingError){showError("We couldn't load this creator's follow stats.");return;}
    $("creator-followers-count").textContent=Number(followerCount||0).toLocaleString();
    $("creator-following-count").textContent=Number(followingCount||0).toLocaleString();
    if(!ownProfile){
      followButton.hidden=false;
      const {data:existingFollow,error:followCheckError}=await client.from("user_follows").select("follower_id").eq("follower_id",auth.user.id).eq("following_id",profile.id).maybeSingle();
      if(followCheckError){showError("We couldn't check your follow status.");return;}
      let following=Boolean(existingFollow);
      const paintFollow=()=>{followButton.textContent=following?"Following":"Follow";followButton.classList.toggle("is-following",following);followButton.setAttribute("aria-pressed",String(following));};
      paintFollow();
      followButton.addEventListener("click",async()=>{
        if(followButton.disabled)return;
        const previous=following;following=!previous;paintFollow();followButton.disabled=true;
        const result=previous
          ? await client.from("user_follows").delete().eq("follower_id",auth.user.id).eq("following_id",profile.id)
          : await client.from("user_follows").insert({follower_id:auth.user.id,following_id:profile.id});
        if(result.error){following=previous;paintFollow();showError("Your follow couldn't be updated. Please try again.");}
        else {
          const count=Number($("creator-followers-count").textContent.replace(/,/g,""));
          $("creator-followers-count").textContent=Math.max(0,count+(following?1:-1)).toLocaleString();
        }
        followButton.disabled=false;
      });
    }
    const [{data:clips,error:clipsError},{data:repostRows,error:repostError}]=await Promise.all([
      client.from("clips").select("id,caption,storage_path,created_at").eq("user_id",profile.id).eq("status","approved").order("created_at",{ascending:false}).limit(60),
      client.from("clip_reposts").select("clip_id,created_at").eq("user_id",profile.id).order("created_at",{ascending:false}).limit(60)
    ]);
    if(clipsError||repostError){showError("The creator loaded, but their posts and reposts couldn't be fetched.");return;}
    const ownClips=clips||[];
    const ownIds=new Set(ownClips.map(c=>c.id));
    const repostIds=[...new Set((repostRows||[]).map(r=>r.clip_id).filter(id=>!ownIds.has(id)))];
    let repostClips=[];
    if(repostIds.length){
      const {data,error:repostedClipsError}=await client.from("clips").select("id,caption,storage_path,created_at").in("id",repostIds).eq("status","approved");
      if(repostedClipsError){showError("Your posts loaded, but reposts couldn't be fetched.");return;}
      repostClips=repostedClips||[];
    }
    const repostById=new Map((repostRows||[]).map(row=>[row.clip_id,row]));
    const clipIds=ownClips.map(c=>c.id);
    let likes=0;
    if(clipIds.length){const {count,error:likeError}=await client.from("clip_likes").select("clip_id",{count:"exact",head:true}).in("clip_id",clipIds);if(!likeError)likes=count||0;}
    $("creator-clips-count").textContent=String(ownClips.length);
    $("creator-likes-count").textContent=String(likes);
    const grid=$("creator-videos");grid.replaceChildren();
    const entries=[
      ...ownClips.map(clip=>({clip,reposted:false})),
      ...repostClips.map(clip=>({clip,reposted:true,repostedAt:repostById.get(clip.id)?.created_at}))
    ].sort((a,b)=>new Date(b.repostedAt||b.clip.created_at)-new Date(a.repostedAt||a.clip.created_at));
    for(const entry of entries){
      const {clip}=entry;
      const {data:signed,error:signedError}=await client.storage.from("darklands-clips").createSignedUrl(clip.storage_path,3600);
      if(!signedError&&signed?.signedUrl)grid.append(makeVideo(clip,signed.signedUrl,entry));
    }
    if(!grid.children.length){const empty=document.createElement("p");empty.className="creator-empty";empty.textContent="No approved clips or reposts yet. Check back later.";grid.append(empty);}
    $("creator-profile").hidden=false;$("creator-videos-section").hidden=false;status.hidden=true;
    document.title=profile.display_name+" (@"+profile.username+") — Darklands";
  }
  start().catch(()=>showError("Something went wrong while loading this creator."));
})();