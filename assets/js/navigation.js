(() => {
  "use strict";
  const config = window.DARKLANDS_CONFIG;
  const navCss = document.createElement("link");navCss.rel="stylesheet";navCss.href="assets/css/navigation.css";document.head.append(navCss);
  const links = [
    ["Home","index.html"],["Clips","clips.html"],["Messages","messages.html"],
    ["Notifications","notifications.html"],["My account","app.html"],["Settings","settings.html"]
  ];
  const nav = document.querySelector(".header-nav,.creator-nav,.clips-header-nav,.messages-top-nav,.moderation-header-nav,.moderation-nav,.notifications-nav,.site-header nav") || (() => {
    const n=document.createElement("nav");n.className="dimension-global-nav";document.body.prepend(n);return n;
  })();
  nav.classList.add("dimension-unified-nav");
  const existing = new Set([...nav.querySelectorAll("a")].map(a=>new URL(a.href,location.href).pathname));
  links.forEach(([label,href])=>{
    const url=new URL(href,location.href);
    if(existing.has(url.pathname))return;
    const a=document.createElement("a");a.className="text-link dimension-nav-link";a.href=url.href;a.textContent=label;nav.append(a);
  });
  const moderatorLink=document.createElement("a");
  moderatorLink.className="text-link dimension-moderation-link";
  moderatorLink.href=new URL("moderation.html",location.href).href;
  moderatorLink.textContent="Moderation";
  moderatorLink.hidden=true;
  nav.append(moderatorLink);
  const logout=nav.querySelector('button[id$="logout"],button[id*="logout"]');
  if(logout)nav.append(logout);

  const toggle=document.createElement("button");
  toggle.type="button";toggle.className="dimension-sidebar-toggle";
  toggle.setAttribute("aria-label","Open navigation sidebar");toggle.setAttribute("aria-expanded","false");
  toggle.innerHTML='<span aria-hidden="true">☰</span><span>Menu</span>';
  nav.prepend(toggle);
  const backdrop=document.createElement("button");
  backdrop.type="button";backdrop.className="dimension-nav-backdrop";
  backdrop.setAttribute("aria-label","Close navigation sidebar");
  const close=()=>{document.documentElement.classList.remove("dimension-nav-open");toggle.setAttribute("aria-expanded","false");toggle.setAttribute("aria-label","Open navigation sidebar");};
  toggle.addEventListener("click",()=>{
    const open=document.documentElement.classList.toggle("dimension-nav-open");
    toggle.setAttribute("aria-expanded",String(open));
    toggle.setAttribute("aria-label",open?"Close navigation sidebar":"Open navigation sidebar");
  });
  backdrop.addEventListener("click",close);
  document.body.append(backdrop);
  document.addEventListener("keydown",e=>{if(e.key==="Escape")close();});

  const current=new URL(location.href).pathname;
  nav.querySelectorAll("a").forEach(a=>{if(new URL(a.href).pathname===current)a.setAttribute("aria-current","page");});

  if(config?.SUPABASE_URL&&config?.SUPABASE_ANON_KEY&&window.supabase?.createClient){
    const client=window.supabase.createClient(config.SUPABASE_URL,config.SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true}});
    client.auth.getUser().then(async({data})=>{
      const signedIn=Boolean(data?.user);
      nav.querySelectorAll(".nav-login,.nav-register").forEach(link=>{
        link.hidden=signedIn;
      });
      if(!signedIn)return;
      const {data:isModerator,error}=await client.rpc("is_darklands_moderator");
      if(!error&&isModerator===true)moderatorLink.hidden=false;
    }).catch(()=>{});
  }
})();