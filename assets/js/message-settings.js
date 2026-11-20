(() => {
 const config=window.DARKLANDS_CONFIG;
 if(!config?.SUPABASE_URL||!config?.SUPABASE_ANON_KEY||!window.supabase?.createClient)return;
 const db=window.supabase.createClient(config.SUPABASE_URL,config.SUPABASE_ANON_KEY);
 const select=document.getElementById("message-privacy-setting"),save=document.getElementById("save-message-privacy"),status=document.getElementById("message-privacy-status");
 if(!select||!save)return;
 const say=t=>{status.textContent=t;};
 async function start(){
  const {data,error}=await db.auth.getUser();
  if(error||!data?.user){say("Sign in to manage messaging privacy.");select.disabled=true;save.disabled=true;return;}
  const {data:profile,error:profileError}=await db.from("profiles").select("message_privacy").eq("id",data.user.id).single();
  if(profileError){say("Messaging privacy is unavailable until the messaging database setup is complete.");select.disabled=true;save.disabled=true;return;}
  select.value=profile.message_privacy||"requests";say("Your messaging privacy is saved.");
 }
 save.addEventListener("click",async()=>{
  save.disabled=true;say("Saving…");
  const {data}=await db.auth.getUser();
  if(!data?.user){say("Please sign in again.");save.disabled=false;return;}
  const {error}=await db.from("profiles").update({message_privacy:select.value}).eq("id",data.user.id);
  say(error?"Couldn't save this setting. Please try again.":"Messaging privacy updated.");
  save.disabled=false;
 });
 start().catch(()=>say("Couldn't load messaging privacy."));
})();