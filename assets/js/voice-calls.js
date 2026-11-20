(() => {
  const config=window.DARKLANDS_CONFIG;
  if(!config?.SUPABASE_URL||!config?.SUPABASE_ANON_KEY||!window.supabase?.createClient)return;
  const db=window.supabase.createClient(config.SUPABASE_URL,config.SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true}});
  const $=id=>document.getElementById(id);
  const ui={button:$("voice-call-button"),status:$("voice-call-status"),dialog:$("voice-call-dialog"),incoming:$("incoming-call-dialog"),incomingFrom:$("incoming-call-from"),accept:$("accept-voice-call"),decline:$("decline-voice-call"),end:$("end-voice-call"),mute:$("mute-voice-call"),callTitle:$("voice-call-title"),callDetail:$("voice-call-detail"),audio:$("voice-remote-audio")};
  if(!ui.button||!ui.dialog||!ui.incoming)return;
  let user=null,conversation=null,call=null,pc=null,localStream=null,callRowsChannel=null,signalChannel=null,pendingOffer=null,pendingIce=[],remoteAudioStream=null,muted=false,ringTimer=null,signalBusy=false;
  const say=t=>{if(ui.status)ui.status.textContent=t;};
  const otherId=()=>call?(call.caller_id===user.id?call.callee_id:call.caller_id):null;
  const setButton=()=>{const unavailable=!user||!conversation||conversation.status!=="accepted"||!!call;ui.button.hidden=unavailable;ui.button.disabled=unavailable;};
  const closeDialog=d=>{if(d?.open)d.close();};
  const sendSignal=async(type,payload)=>{
    if(!call||!otherId())return;
    const {error}=await db.rpc("dimension_send_voice_signal",{p_call:call.id,p_recipient:otherId(),p_signal_type:type,p_payload:payload});
    if(error)throw error;
  };
  const clearMedia=()=>{
    if(pc){pc.onicecandidate=null;pc.ontrack=null;pc.onconnectionstatechange=null;pc.close();pc=null;}
    if(localStream){localStream.getTracks().forEach(track=>track.stop());localStream=null;}
    if(ui.audio){ui.audio.pause();ui.audio.srcObject=null;}
    pendingIce=[];pendingOffer=null;muted=false;
    if(ui.mute){ui.mute.textContent="Mute microphone";ui.mute.setAttribute("aria-pressed","false");}
    clearTimeout(ringTimer);
  };
  const resetCall=(message)=>{
    clearMedia();call=null;signalBusy=false;closeDialog(ui.dialog);closeDialog(ui.incoming);setButton();
    if(message)say(message);
  };
  const createPeer=async()=>{
    pc=new RTCPeerConnection({iceServers:[
      {urls:"stun:stun.l.google.com:19302"},
      {urls:"stun:stun1.l.google.com:19302"}
    ]});
    remoteAudioStream=new MediaStream();
    ui.audio.srcObject=remoteAudioStream;
    pc.ontrack=e=>{
      const streams=e.streams||[];
      if(streams[0])ui.audio.srcObject=streams[0];
      else{remoteAudioStream.addTrack(e.track);ui.audio.srcObject=remoteAudioStream;}
      ui.audio.play().catch(()=>say("Your browser blocked audio playback. Use the page controls to resume audio."));
    };
    pc.onicecandidate=e=>{
      if(e.candidate)sendSignal("ice",e.candidate.toJSON()).catch(()=>say("A connection update couldn't be sent."));
    };
    pc.onconnectionstatechange=()=>{
      if(!pc)return;
      if(pc.connectionState==="connected"){ui.callTitle.textContent="Voice call connected";ui.callDetail.textContent="Your microphone is active. You can mute or end the call.";say("Voice call connected.");}
      if(pc.connectionState==="failed"||pc.connectionState==="disconnected"){
        say("The call connection was interrupted. You can try ending the call and calling again.");
      }
    };
    localStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
    localStream.getAudioTracks().forEach(track=>pc.addTrack(track,localStream));
    return pc;
  };
  const flushIce=async()=>{
    if(!pc?.remoteDescription)return;
    for(const candidate of pendingIce.splice(0)){
      try{await pc.addIceCandidate(new RTCIceCandidate(candidate));}catch(e){console.warn("Could not add call ICE candidate",e);}
    }
  };
  const handleSignal=async row=>{
    if(!call||row.call_id!==call.id||row.recipient_id!==user.id)return;
    try{
      if(row.signal_type==="offer"){
        pendingOffer=row.payload;
        window.dispatchEvent(new CustomEvent("dimension:voice-offer",{detail:{callId:call.id}}));
        if(pc?.remoteDescription)return;
      }else if(row.signal_type==="answer"){
        if(!pc||pc.remoteDescription)return;
        await pc.setRemoteDescription(new RTCSessionDescription(row.payload));
        await flushIce();
      }else if(row.signal_type==="ice"){
        if(pc?.remoteDescription){try{await pc.addIceCandidate(new RTCIceCandidate(row.payload));}catch(e){console.warn("Could not add call ICE candidate",e);}}
        else pendingIce.push(row.payload);
      }
    }catch(error){console.error("Voice call signalling error",error);say("The call connection could not be completed.");}
  };
  const loadPendingSignals=async()=>{
    if(!call)return;
    const {data,error}=await db.from("voice_call_signals").select("call_id,recipient_id,signal_type,payload,created_at").eq("call_id",call.id).eq("recipient_id",user.id).order("created_at",{ascending:true}).limit(120);
    if(error)throw error;
    for(const row of data||[])await handleSignal(row);
  };
  const subscribeSignals=()=>{
    if(signalChannel)db.removeChannel(signalChannel);
    signalChannel=db.channel("dimension-voice-signals-"+user.id).on("postgres_changes",{event:"INSERT",schema:"public",table:"voice_call_signals",filter:"recipient_id=eq."+user.id},payload=>handleSignal(payload.new)).subscribe();
  };
  const showIncoming=async row=>{
    if(call&&call.id!==row.id)return;
    call=row;pendingOffer=null;pendingIce=[];
    const {data:person}=await db.from("profiles").select("display_name,username").eq("id",row.caller_id).maybeSingle();
    ui.incomingFrom.textContent=person?.display_name||person?.username||"A Dimension member";
    if(!ui.incoming.open)ui.incoming.showModal();
    say("Incoming voice call.");
    ringTimer=setTimeout(async()=>{
      if(call?.id!==row.id)return;
      await db.rpc("dimension_mark_missed_voice_call",{p_call:row.id});
      resetCall("Missed voice call.");
    },Math.max(0,new Date(row.expires_at).getTime()-Date.now()));
  };
  const onCallUpdate=async row=>{
    if(row.status==="ringing"&&row.callee_id===user.id&&!call){await showIncoming(row);return;}
    if(!call||row.id!==call.id)return;
    call=row;
    if(["declined","missed","cancelled","ended"].includes(row.status)){
      resetCall(row.status==="declined"?"Call declined.":row.status==="missed"?"Missed call.":row.status==="cancelled"?"Call cancelled.":"Call ended.");
    }
  };
  const subscribeCalls=()=>{
    callRowsChannel=db.channel("dimension-voice-calls-"+user.id)
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"voice_calls",filter:"callee_id=eq."+user.id},payload=>onCallUpdate(payload.new))
      .on("postgres_changes",{event:"UPDATE",schema:"public",table:"voice_calls",filter:"caller_id=eq."+user.id},payload=>onCallUpdate(payload.new))
      .on("postgres_changes",{event:"UPDATE",schema:"public",table:"voice_calls",filter:"callee_id=eq."+user.id},payload=>onCallUpdate(payload.new))
      .subscribe();
  };
  const startCall=async()=>{
    if(!conversation||conversation.status!=="accepted"||call)return;
    if(!navigator.mediaDevices?.getUserMedia||!window.RTCPeerConnection){say("Voice calling is not supported by this browser.");return;}
    ui.button.disabled=true;say("Starting your call…");
    const {data:callId,error}=await db.rpc("dimension_start_voice_call",{p_conversation:conversation.id});
    if(error){ui.button.disabled=false;say(error.message||"Couldn't start this call.");return;}
    call={id:callId,conversation_id:conversation.id,caller_id:user.id,callee_id:conversation.otherUserId,status:"ringing"};
    ui.callTitle.textContent="Calling…";ui.callDetail.textContent="Waiting for the other member to answer.";
    ui.dialog.showModal();setButton();
    try{
      await createPeer();
      const offer=await pc.createOffer();
      await pc.setLocalDescription(offer);
      await sendSignal("offer",pc.localDescription.toJSON());
      say("Calling "+(conversation.displayName||"member")+"…");
      ringTimer=setTimeout(async()=>{
        if(!call||call.status!=="ringing")return;
        await db.rpc("dimension_end_voice_call",{p_call:call.id});
        resetCall("No answer. Call ended.");
      },45000);
    }catch(error){
      console.error("Could not start voice call",error);
      await db.rpc("dimension_end_voice_call",{p_call:call.id});
      resetCall(error.name==="NotAllowedError"?"Microphone permission was denied.":"Couldn't access your microphone or start the call.");
    }
  };
  const waitForOffer=()=>new Promise((resolve,reject)=>{if(pendingOffer){resolve(pendingOffer);return;}const onOffer=e=>{if(e.detail?.callId!==call?.id)return;cleanup();resolve(pendingOffer);};const timer=setTimeout(()=>{cleanup();reject(new Error("The caller offer has not arrived yet."));},8000);const cleanup=()=>{clearTimeout(timer);window.removeEventListener("dimension:voice-offer",onOffer);};window.addEventListener("dimension:voice-offer",onOffer);});
  const acceptCall=async()=>{
    if(!call||call.callee_id!==user.id||signalBusy)return;
    signalBusy=true;ui.accept.disabled=true;
    const {error}=await db.rpc("dimension_answer_voice_call",{p_call:call.id});
    if(error){signalBusy=false;ui.accept.disabled=false;resetCall(error.message||"This call is no longer available.");return;}
    call.status="active";clearTimeout(ringTimer);closeDialog(ui.incoming);
    ui.callTitle.textContent="Connecting voice call…";ui.callDetail.textContent="Your microphone is only active while this call is connected.";
    ui.dialog.showModal();
    try{
      await createPeer();
      await loadPendingSignals();
      if(!pendingOffer)throw new Error("The caller's connection offer hasn't arrived yet.");
      await pc.setRemoteDescription(new RTCSessionDescription(pendingOffer));
      await flushIce();
      const answer=await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await sendSignal("answer",pc.localDescription.toJSON());
      ui.callTitle.textContent="Voice call connecting…";ui.callDetail.textContent="You can mute your microphone or end the call.";
      say("Connecting voice call…");
    }catch(error){
      console.error("Could not answer voice call",error);
      await db.rpc("dimension_end_voice_call",{p_call:call.id});
      resetCall(error.name==="NotAllowedError"?"Microphone permission was denied.":"Couldn't connect this call. Try again.");
    }finally{signalBusy=false;ui.accept.disabled=false;}
  };
  const declineCall=async()=>{
    if(!call)return;
    const id=call.id;ui.decline.disabled=true;
    const {error}=await db.rpc("dimension_decline_voice_call",{p_call:id});
    ui.decline.disabled=false;
    resetCall(error?"This call is no longer available.":"Call declined.");
  };
  const endCall=async()=>{
    if(!call)return;
    const id=call.id;ui.end.disabled=true;
    const {error}=await db.rpc("dimension_end_voice_call",{p_call:id});
    ui.end.disabled=false;
    resetCall(error?"Call has already ended.":"Call ended.");
  };
  ui.button.addEventListener("click",startCall);
  ui.accept.addEventListener("click",acceptCall);
  ui.decline.addEventListener("click",declineCall);
  ui.end.addEventListener("click",endCall);
  ui.mute.addEventListener("click",()=>{
    if(!localStream)return;
    muted=!muted;localStream.getAudioTracks().forEach(track=>track.enabled=!muted);
    ui.mute.textContent=muted?"Unmute microphone":"Mute microphone";
    ui.mute.setAttribute("aria-pressed",String(muted));
    say(muted?"Microphone muted.":"Microphone on.");
  });
  window.addEventListener("dimension:conversation-opened",event=>{
    conversation=event.detail||null;setButton();
  });
  window.addEventListener("dimension:conversation-closed",()=>{conversation=null;setButton();});
  async function start(){
    const {data,error}=await db.auth.getUser();
    if(error||!data?.user)return;
    user=data.user;
    setButton();subscribeSignals();subscribeCalls();
    const {data:incoming}=await db.from("voice_calls").select("id,conversation_id,caller_id,callee_id,status,expires_at").eq("callee_id",user.id).eq("status","ringing").gt("expires_at",new Date().toISOString()).order("created_at",{ascending:false}).limit(1);
    if(incoming?.[0])await showIncoming(incoming[0]);
  }
  window.addEventListener("pagehide",()=>{
    if(call?.id)db.rpc("dimension_end_voice_call",{p_call:call.id});
    clearMedia();
  });
  start().catch(error=>{console.error("Voice calling setup failed",error);say("Voice calling couldn't be initialized.");});
})();