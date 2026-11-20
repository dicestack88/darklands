(() => {
  "use strict";

  const config = window.DARKLANDS_CONFIG;
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = "assets/css/navigation.css";
  document.head.append(css);

  const header = document.querySelector(".site-header") || (() => {
    const element = document.createElement("header");
    element.className = "site-header";
    document.body.prepend(element);
    return element;
  })();

  const nav = header.querySelector("nav") || document.createElement("nav");
  nav.className = "dimension-unified-nav";
  nav.setAttribute("aria-label", "Main navigation");

  const brand = header.querySelector(".brand") || (() => {
    const element = document.createElement("a");
    element.className = "brand";
    element.href = "index.html";
    element.setAttribute("aria-label", "Dicestack Dimension home");
    element.innerHTML = '<span class="brand-mark">D</span><span>DICESTACK DIMENSION</span>';
    return element;
  })();

  const oldLogout = header.querySelector('button[id*="logout"]');
  const notificationCount = header.querySelector(".notification-nav-count");

  nav.replaceChildren();
  nav.append(brand);

  const menu = document.createElement("button");
  menu.type = "button";
  menu.className = "dimension-sidebar-toggle";
  menu.setAttribute("aria-label", "Open navigation menu");
  menu.setAttribute("aria-expanded", "false");
  menu.innerHTML = '<span aria-hidden="true">☰</span><span>Menu</span>';
  nav.append(menu);

  const links = [
    ["Discover", "clips.html", ["clips.html"]],
    ["Messages", "messages.html", ["messages.html"]],
    ["My profile", "profile.html", ["profile.html"]],
    ["Notifications", "notifications.html", ["notifications.html"]],
    ["My account", "app.html", ["app.html"]],
    ["Home", "index.html", ["index.html", ""]],
    ["Settings", "settings.html", ["settings.html"]]
  ];

  const currentFile = location.pathname.split("/").filter(Boolean).pop() || "index.html";
  const linkElements = [];

  for (const [label, href, matches] of links) {
    const anchor = document.createElement("a");
    anchor.className = "dimension-nav-link";
    anchor.href = href;
    anchor.textContent = label;
    if (matches.includes(currentFile) || (currentFile === "index.html" && matches.includes(""))) {
      anchor.setAttribute("aria-current", "page");
    }
    nav.append(anchor);
    linkElements.push(anchor);
  }

  const notificationLink = linkElements.find(link => link.textContent === "Notifications");
  if (notificationCount) {
    notificationCount.hidden = notificationCount.hidden;
    notificationLink.append(notificationCount);
  }

  const moderatorLink = document.createElement("a");
  moderatorLink.className = "dimension-nav-link dimension-moderation-link";
  moderatorLink.href = "moderation.html";
  moderatorLink.textContent = "Moderation";
  moderatorLink.hidden = true;
  if (currentFile === "moderation.html") moderatorLink.setAttribute("aria-current", "page");
  nav.append(moderatorLink);

  const guestLogin = document.createElement("a");
  guestLogin.className = "dimension-auth-link nav-login";
  guestLogin.href = "login.html";
  guestLogin.textContent = "Log in";
  nav.append(guestLogin);

  const guestRegister = document.createElement("a");
  guestRegister.className = "dimension-auth-link dimension-register-link nav-register";
  guestRegister.href = "register.html";
  guestRegister.textContent = "Create account";
  nav.append(guestRegister);

  if (oldLogout) {
    oldLogout.classList.add("dimension-logout");
    oldLogout.textContent = "Log out";
    nav.append(oldLogout);
  }

  header.replaceChildren(nav);

  const backdrop = document.createElement("button");
  backdrop.type = "button";
  backdrop.className = "dimension-nav-backdrop";
  backdrop.setAttribute("aria-label", "Close navigation menu");
  document.body.append(backdrop);

  const closeMenu = () => {
    document.documentElement.classList.remove("dimension-nav-open");
    menu.setAttribute("aria-expanded", "false");
    menu.setAttribute("aria-label", "Open navigation menu");
  };

  menu.addEventListener("click", () => {
    const open = document.documentElement.classList.toggle("dimension-nav-open");
    menu.setAttribute("aria-expanded", String(open));
    menu.setAttribute("aria-label", open ? "Close navigation menu" : "Open navigation menu");
  });
  backdrop.addEventListener("click", closeMenu);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeMenu();
  });

  const syncAuthNavigation = () => {
    const liveConfig = window.DARKLANDS_CONFIG || config;
    if (liveConfig?.SUPABASE_URL && liveConfig?.SUPABASE_ANON_KEY && window.supabase?.createClient) {
      const client = window.supabase.createClient(liveConfig.SUPABASE_URL, liveConfig.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true }
      });
      client.auth.getUser().then(async ({ data }) => {
        const signedIn = Boolean(data?.user);
        guestLogin.hidden = signedIn;
        guestRegister.hidden = signedIn;
        if (oldLogout) oldLogout.hidden = !signedIn;
        if (!signedIn) return;
        const { data: isModerator, error } = await client.rpc("is_darklands_moderator");
        if (!error && isModerator === true) moderatorLink.hidden = false;
      }).catch(() => {});
    } else if (oldLogout) {
      oldLogout.hidden = true;
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", syncAuthNavigation, { once: true });
  } else {
    syncAuthNavigation();
  }
})();