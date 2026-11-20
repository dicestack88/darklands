(() => {
  const config=window.DARKLANDS_CONFIG;
  const ready=config&&config.SUPABASE_URL&&config.SUPABASE_ANON_KEY&&window.supabase?.createClient;
  const db=ready?window.supabase.createClient(config.SUPABASE_URL,config.SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true}}):null;
  const $=id=>document.getElementById(id);
  const el={status:$("messages-status"),list:$("conversation-list"),stream:$("message-stream"),empty:$("chat-empty"),active:$("chat-active"),workspace:document.querySelector(".messages-workspace"),tabs:[...document.querySelectorAll(".message-tab")],search:$("conversation-search"),requestCount:$("request-count"),presence:$("my-presence"),presenceDot:$("my-presence-dot"),chatName:$("chat-name"),chatAvatar:$("chat-avatar"),chatPresence:$("chat-presence"),requestBanner:$("request-banner"),composer:$("message-form"),input:$("message-input"),length:$("message-length"),emoji:$("emoji-picker"),dialog:$("new-message-dialog"),reportDialog:$("report-dialog")};
  let user=null,profiles=new Map(),conversations=[],current=null,folder="chats",channel=null,heartbeat=null,idleTimer=null,lastActivity=Date.now(),myProfile=null;
  const page=name=>new URL(name,config.SITE_URL).toString();
  const say=t=>{el.status.textContent=t;};
  const initials=p=>(p?.display_name||p?.username||"D").trim().split(/\s+/).slice(0,2).map(s=>s[0]||"").join("").toUpperCase();
  const presence=p=>{if(!p)return "offline";if(p.presence_status==="offline"||p.presence_status==="dnd")return p.presence_status;if(!p.last_seen_at||Date.now()-new Date(p.last_seen_at).getTime()>90000)return "offline";if(p.presence_status==="idle"||Date.now()-new Date(p.last_seen_at).getTime()>300000)return "idle";return "online";};
  const avatar=(node,p)=>{node.replaceChildren();if(p?.avatar_url&&/^https?:\/\//i.test(p.avatar_url)){const img=document.createElement("img");img.src=p.avatar_url;img.alt="";node.append(img);}else node.textContent=initials(p);};
  const otherId=c=>c.user_one===user.id?c.user_two:c.user_one;
  const profile=id=>profiles.get(id);
  const fmtTime=d=>new Date(d).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"});
  async function refreshProfiles(ids){const missing=[...new Set(ids)].filter(id=>!profiles.has(id));if(!missing.length)return;const {data,error}=await db.from("profiles").select("id,username,display_name,avatar_url,presence_status,last_seen_at,message_privacy").in("id",missing);if(error)throw error;(data||[]).forEach(p=>profiles.set(p.id,p));}
  async function loadConversations(){
    const {data,error}=await db.from("conversations").select("id,user_one,user_two,requested_by,status,last_message_at,updated_at").order("last_message_at",{ascending:false}).limit(100);
    if(error)throw error;
    conversations=data||[];
    await refreshProfiles(conversations.map(otherId));
    await renderList();
  }
  function visibleConversations(){const q=el.search.value.trim().toLowerCase();return conversations.filter(c=>folder==="requests"?c.status==="pending"&&c.requested_by!==user.id:(c.status==="accepted"||(c.status==="pending"&&c.requested_by===user.id))).filter(c=>{const p=profile(otherId(c));return !q||(p?.username||"").toLowerCase().includes(q)||(p?.display_name||"").toLowerCase().includes(q);});}
  let listRenderToken=0;
  async function renderList(){
    const token=++listRenderToken;
    const requests=conversations.filter(c=>c.status==="pending"&&c.requested_by!==user.id).length;
    el.requestCount.hidden=!requests;el.requestCount.textContent=requests;
    el.list.replaceChildren();
    const rows=visibleConversations();
    if(!rows.length){const p=document.createElement("p");p.className="message-empty";p.textContent=folder==="requests"?"No message requests right now.":"No conversations yet. Start one with a creator.";el.list.append(p);return;}
    // Fetch recent message data once for the whole inbox instead of two sequential
    // database round-trips per conversation. The UI only displays a capped 9+ badge.
    const ids=rows.map(c=>c.id);
    const {data:recent,error}=await db.from("messages").select("conversation_id,body,created_at,sender_id,read_at").in("conversation_id",ids).order("created_at",{ascending:false}).limit(1500);
    if(token!==listRenderToken)return;
    if(error){say("Some inbox previews couldn't be loaded.");}
    const latest=new Map(),unread=new Map();
    for(const m of recent||[]){
      if(!latest.has(m.conversation_id))latest.set(m.conversation_id,m);
      if(m.sender_id!==user.id&&!m.read_at)unread.set(m.conversation_id,(unread.get(m.conversation_id)||0)+1);
    }
    const fragment=document.createDocumentFragment();
    for(const c of rows){
      const p=profile(otherId(c)),last=latest.get(c.id),row=document.createElement("button");
      row.type="button";row.className="conversation-row"+(current?.id===c.id?" active":"");
      const av=document.createElement("span");av.className="conversation-avatar";avatar(av,p);
      const copy=document.createElement("span");copy.className="conversation-copy";
      const name=document.createElement("strong");name.textContent=p?.display_name||"Dimension member";
      const preview=document.createElement("span");preview.textContent=last?(last.sender_id===user.id?"You: ":"")+last.body:(c.status==="pending"?"Message request":"Start the conversation");
      copy.append(name,preview);
      const meta=document.createElement("span");meta.className="conversation-meta";
      const time=document.createElement("span");time.textContent=last?fmtTime(last.created_at):"";meta.append(time);
      const count=unread.get(c.id)||0;
      if(count){const pill=document.createElement("span");pill.className="unread-pill";pill.textContent="9+";meta.append(pill);}
      row.append(av,copy,meta);row.addEventListener("click",()=>openConversation(c.id));fragment.append(row);
    }
    if(token===listRenderToken)el.list.replaceChildren(fragment);
  }
  async function loadMessages(){
    el.stream.replaceChildren();const {data,error}=await db.from("messages").select("id,sender_id,body,created_at,read_at").eq("conversation_id",current.id).order("created_at",{ascending:true}).limit(200);
    if(error){const p=document.createElement("p");p.className="message-empty";p.textContent="Messages could not be loaded.";el.stream.append(p);return;}
    if(!data?.length){const p=document.createElement("p");p.className="message-empty";p.textContent="Say hello to start your conversation.";el.stream.append(p);}
    (data||[]).forEach(m=>{const b=document.createElement("article");b.className="message-bubble"+(m.sender_id===user.id?" mine":"");const body=document.createElement("p");body.textContent=m.body;const time=document.createElement("time");time.textContent=fmtTime(m.created_at)+(m.sender_id===user.id&&m.read_at?" · Read":"");b.append(body,time);el.stream.append(b);});
    el.stream.scrollTop=el.stream.scrollHeight;
    const unread=(data||[]).filter(m=>m.sender_id!==user.id&&!m.read_at).map(m=>m.id);if(unread.length)await db.from("messages").update({read_at:new Date().toISOString()}).in("id",unread);
  }
  async function openConversation(id){
    current=conversations.find(c=>c.id===id);if(!current)return;
    const p=profile(otherId(current));el.empty.hidden=true;el.active.hidden=false;el.workspace.classList.add("chat-open");avatar(el.chatAvatar,p);el.chatName.textContent=p?.display_name||"Dimension member";el.chatPresence.textContent=presence(p).toUpperCase();el.chatPresence.dataset.status=presence(p);
    const incoming=current.status==="pending"&&current.requested_by!==user.id;el.requestBanner.hidden=!incoming;el.composer.hidden=current.status!=="accepted";
    if(current.status==="pending"&&current.requested_by===user.id){el.requestBanner.hidden=false;el.requestBanner.querySelector("strong").textContent="Request sent";el.requestBanner.querySelector("p").textContent="You can chat once this member accepts your request.";el.requestBanner.querySelector(".request-actions").hidden=true;}
    else el.requestBanner.querySelector(".request-actions").hidden=false;
    await loadMessages();renderList();
    if(channel)await db.removeChannel(channel);
    const openedId=current.id;
    channel=db.channel("dimension-chat-"+openedId).on("postgres_changes",{event:"*",schema:"public",table:"messages",filter:"conversation_id=eq."+openedId},async()=>{if(current?.id!==openedId)return;await loadMessages();await loadConversations();}).on("postgres_changes",{event:"UPDATE",schema:"public",table:"profiles",filter:"id=eq."+otherId(current)},async payload=>{profiles.set(payload.new.id,payload.new);el.chatPresence.textContent=presence(payload.new).toUpperCase();el.chatPresence.dataset.status=presence(payload.new);}).subscribe();
  }
  function switchFolder(next){folder=next;el.tabs.forEach(t=>t.classList.toggle("active",t.dataset.folder===folder));current=null;el.empty.hidden=false;el.active.hidden=true;el.workspace.classList.remove("chat-open");renderList();}
  async function loadBlocked(){const {data,error}=await db.from("user_blocks").select("blocked_id,created_at").eq("blocker_id",user.id).order("created_at",{ascending:false});const box=$("blocked-list");box.replaceChildren();if(error)return;await refreshProfiles((data||[]).map(x=>x.blocked_id));if(!data?.length){const p=document.createElement("p");p.className="message-empty";p.textContent="You haven't blocked anyone.";box.append(p);return;}for(const b of data){const row=document.createElement("div");row.className="blocked-row";const name=document.createElement("span");name.textContent=profile(b.blocked_id)?.display_name||"Member";const btn=document.createElement("button");btn.className="unblock-button";btn.textContent="Unblock";btn.addEventListener("click",async()=>{const {error}=await db.rpc("dimension_unblock_member",{p_member:b.blocked_id});if(error){say("Couldn't unblock this member.");return;}await loadBlocked();say("Member unblocked.");});row.append(name,btn);box.append(row);}}
  async function updatePresence(value){el.presenceDot.dataset.status=value;const {error}=await db.rpc("dimension_touch_presence",{p_status:value});if(error)say("Couldn't update your status.");if(myProfile)myProfile.presence_status=value;}
  function resetIdle(){lastActivity=Date.now();if(myProfile?.presence_status==="online"||myProfile?.presence_status==="idle"){if(myProfile.presence_status!=="online"){updatePresence("online");el.presence.value="online";}clearTimeout(idleTimer);idleTimer=setTimeout(()=>{if(el.presence.value==="online"){el.presence.value="idle";updatePresence("idle");}},300000);}}
  async function searchMembers(term){const box=$("member-search-results");box.replaceChildren();const q=term.trim().replace(/^@/,"").replace(/[^a-zA-Z0-9_ ]/g,"");if(q.length<2){box.textContent="Enter at least two characters.";return;}const {data,error}=await db.from("profiles").select("id,username,display_name,avatar_url,presence_status,last_seen_at").or("username.ilike.%"+q+"%,display_name.ilike.%"+q+"%").neq("id",user.id).limit(12);if(error){box.textContent="Member search is unavailable.";return;}await refreshProfiles((data||[]).map(p=>p.id));if(!data?.length){box.textContent="No members found.";return;}for(const p of data){const row=document.createElement("div");row.className="member-result";const av=document.createElement("span");av.className="member-avatar";avatar(av,p);const copy=document.createElement("div");const name=document.createElement("strong");name.textContent=p.display_name;const handle=document.createElement("span");handle.textContent="@"+p.username;copy.append(name,handle);const btn=document.createElement("button");btn.textContent="Message";btn.addEventListener("click",async()=>{const body=window.prompt("Write the first message (max 1000 characters):");if(body===null)return;const {data:cid,error}=await db.rpc("dimension_send_message_request",{p_recipient:p.id,p_body:body});if(error){say(error.message||"Couldn't send the message request.");return;}el.dialog.close();await loadConversations();switchFolder("chats");await openConversation(cid);say("Your message has been sent.");});row.append(av,copy,btn);box.append(row);}}
  async function start(){
    if(!db){say("Account services are unavailable.");return;}
    const {data,error}=await db.auth.getUser();user=data?.user;if(error||!user){window.location.replace(page("login.html"));return;}
    const {data:profileData,error:profileError}=await db.from("profiles").select("id,username,display_name,avatar_url,message_privacy,presence_status,last_seen_at").eq("id",user.id).single();
    if(profileError||!profileData){say("Finish setting up your profile before messaging.");return;}myProfile=profileData;el.presence.value=myProfile.presence_status||"online";el.presenceDot.dataset.status=el.presence.value;
    await updatePresence(el.presence.value);await loadConversations();await loadBlocked();say("Your messages are private to the people in each conversation.");const requestedConversation=new URLSearchParams(location.search).get("c");if(requestedConversation&&conversations.some(c=>c.id===requestedConversation))await openConversation(requestedConversation);
    heartbeat=setInterval(()=>{if(document.visibilityState==="visible")db.rpc("dimension_touch_presence",{});},30000);
    resetIdle();
    db.channel("dimension-inbox-"+user.id).on("postgres_changes",{event:"*",schema:"public",table:"conversations"},async()=>{await loadConversations();if(current){const updated=conversations.find(c=>c.id===current.id);if(updated){current=updated;const incoming=current.status==="pending"&&current.requested_by!==user.id;el.requestBanner.hidden=!incoming;el.composer.hidden=current.status!=="accepted";if(current.status==="pending"&&current.requested_by===user.id){el.requestBanner.hidden=false;el.requestBanner.querySelector("strong").textContent="Request sent";el.requestBanner.querySelector("p").textContent="You can chat once this member accepts your request.";el.requestBanner.querySelector(".request-actions").hidden=true;}else{el.requestBanner.querySelector(".request-actions").hidden=false;}}else{current=null;el.active.hidden=true;el.empty.hidden=false;el.workspace.classList.remove("chat-open");}}}).subscribe();
  }
  el.tabs.forEach(t=>t.addEventListener("click",()=>switchFolder(t.dataset.folder)));
  el.search.addEventListener("input",renderList);
  $("new-message").addEventListener("click",()=>$("new-message-dialog").showModal());
  $("empty-new-message").addEventListener("click",()=>$("new-message-dialog").showModal());
  $("member-search-form").addEventListener("submit",e=>{e.preventDefault();searchMembers($("member-search-input").value);});
  el.presence.addEventListener("change",()=>updatePresence(el.presence.value));
  $("blocked-toggle").addEventListener("click",()=>{$("blocked-list").hidden=!$("blocked-list").hidden;});
  $("accept-request").addEventListener("click",async()=>{const {error}=await db.rpc("dimension_accept_message_request",{p_conversation:current.id});if(error){say(error.message);return;}await loadConversations();await openConversation(current.id);say("Request accepted. You can now chat.");});
  $("decline-request").addEventListener("click",async()=>{if(!current)return;const {error}=await db.rpc("dimension_decline_message_request",{p_conversation:current.id});if(error){say(error.message);return;}current=null;await loadConversations();el.active.hidden=true;el.empty.hidden=false;el.workspace.classList.remove("chat-open");say("Request declined.");});
  $("chat-block").addEventListener("click",async()=>{if(!current)return;const p=profile(otherId(current));if(!window.confirm("Block "+(p?.display_name||"this member")+"? They won't be able to message you."))return;const {error}=await db.rpc("dimension_block_member",{p_member:otherId(current)});if(error){say(error.message);return;}current=null;await loadConversations();await loadBlocked();el.active.hidden=true;el.empty.hidden=false;el.workspace.classList.remove("chat-open");say("Member blocked.");});
  $("chat-report").addEventListener("click",()=>el.reportDialog.showModal());
  $("report-form").addEventListener("submit",async e=>{e.preventDefault();const {error}=await db.from("message_reports").insert({reporter_id:user.id,conversation_id:current.id,reason:$("report-reason").value,details:$("report-details").value.trim()});if(error){say("Couldn't submit this report.");return;}el.reportDialog.close();say("Report submitted. Thanks for helping keep the community safe.");});
  el.input.addEventListener("input",()=>{el.length.textContent=el.input.value.length+"/1000";el.input.style.height="auto";el.input.style.height=Math.min(el.input.scrollHeight,120)+"px";});
  $("message-form").addEventListener("submit",async e=>{e.preventDefault();const body=el.input.value.trim();if(!body||!current)return;const send=$("message-form").querySelector(".send-button");send.disabled=true;const {error}=await db.from("messages").insert({conversation_id:current.id,sender_id:user.id,body});send.disabled=false;if(error){say(error.message||"Message couldn't be sent.");return;}el.input.value="";el.length.textContent="0/1000";await loadMessages();await loadConversations();});
  const emojis=["😀","😄","😁","😂","🥹","😊","😍","🤔","😎","😭","😅","🙌","👏","🔥","✨","💜","💙","💖","❤️","👍","👎","🙏","🎉","🎮","⚽","👀","💯","🤝","🫡","😴","🚀","🌈","⭐","☀️","🍀","🫶","😮","😬","🥳","🤩","💀","🗿","🐐","🎯"];
  emojis.forEach(emoji=>{const b=document.createElement("button");b.type="button";b.textContent=emoji;b.addEventListener("click",()=>{const start=el.input.selectionStart,end=el.input.selectionEnd;el.input.setRangeText(emoji,start,end,"end");el.input.dispatchEvent(new Event("input"));el.emoji.hidden=true;el.input.focus();});el.emoji.append(b);});
  $("emoji-toggle").addEventListener("click",()=>el.emoji.hidden=!el.emoji.hidden);
  document.addEventListener("click",e=>{if(!el.emoji.contains(e.target)&&e.target!==$("emoji-toggle"))el.emoji.hidden=true;});
  ["pointerdown","keydown","scroll"].forEach(evt=>document.addEventListener(evt,resetIdle,{passive:true}));
  $("messages-logout").addEventListener("click",async()=>{await db.auth.signOut();window.location.replace(page("login.html"));});
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")db?.rpc("dimension_touch_presence",{});});
  window.addEventListener("pagehide",()=>{clearInterval(heartbeat);if(channel)db?.removeChannel(channel);});
  start().catch(()=>say("Something went wrong loading messages. Refresh and try again."));
})();