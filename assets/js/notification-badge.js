(() => {
  const config=window.DARKLANDS_CONFIG;
  if(!config?.SUPABASE_URL||!config?.SUPABASE_ANON_KEY||!window.supabase?.createClient)return;
  const client=window.supabase.createClient(config.SUPABASE_URL,config.SUPABASE_ANON_KEY);
  async function update(){
    const {data,error}=await client.auth.getUser();
    if(error||!data?.user)return;
    const {count,error:countError}=await client.from("notifications").select("id",{count:"exact",head:true}).is("read_at",null);
    if(countError)return;
    document.querySelectorAll(".notification-nav-count").forEach(node=>{
      node.textContent=count>99?"99+":String(count||0);
      node.hidden=!count;
      node.parentElement?.setAttribute("aria-label",count?"Notifications, "+count+" unread":"Notifications");
    });
  }
  update();
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)update();});
  document.addEventListener("darklands:notifications-updated",update);
})();