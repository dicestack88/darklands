(() => {
  "use strict";

  const config = window.DARKLANDS_CONFIG;
  for (const href of ["assets/css/navigation.css", "assets/css/ecosystem-glass.css"]) {
    if (!document.querySelector(`link[href="${href}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      document.head.append(link);
    }
  }

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
  const logoutButton = oldLogout || document.createElement("button");
  const notificationCount = header.querySelector(".notification-nav-count");

  nav.replaceChildren();
  nav.append(brand);

  const ecosystem = document.createElement("details");
  ecosystem.className = "dimension-ecosystem-switcher";
  ecosystem.innerHTML = `
    <summary aria-label="Open Dicestack apps"><span class="ecosystem-switcher-mark">✦</span><span>Dicestack apps</span><span class="ecosystem-switcher-chevron" aria-hidden="true">⌄</span></summary>
    <div class="ecosystem-switcher-panel">
      <span class="ecosystem-switcher-label">THE DICESTACK ECOSYSTEM</span>
      <a href="https://dicestack88.github.io/"><span>⌂</span><span><strong>Dicestack hub</strong><small>Main website & projects</small></span><b>↗</b></a>
      <a href="https://dicestack88.github.io/launcher.html"><span>⌘</span><span><strong>Launcher</strong><small>Eaglercraft clients & games</small></span><b>↗</b></a>
      <a href="https://dicestack88.github.io/socials.html"><span>▶</span><span><strong>YouTube</strong><small>Videos & creator updates</small></span><b>↗</b></a>
    </div>`;
  nav.append(ecosystem);

  const menu = document.createElement("button");
  menu.type = "button";
  menu.className = "dimension-sidebar-toggle";
  menu.setAttribute("aria-label", "Open navigation menu");
  menu.setAttribute("aria-expanded", "false");
  menu.innerHTML = '<span aria-hidden="true">☰</span><span>Menu</span>';
  nav.append(menu);

  const links = [
    ["Discover", "discover.html", ["discover.html"]],
    ["Clips", "clips.html", ["clips.html"]],
    ["Messages", "messages.html", ["messages.html"]],
    ["My profile", "profile.html", ["profile.html"]],
    ["Notifications", "notifications.html", ["notifications.html"]],
    ["Home", "index.html", ["index.html", ""]],
    ["Settings", "settings.html", ["settings.html"]],
    ["Analytics", "analytics.html", ["analytics.html"]],
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

  if (!oldLogout) {
    logoutButton.type = "button";
    logoutButton.id = "dimension-logout";
    logoutButton.addEventListener("click", async () => {
      const liveConfig = window.DARKLANDS_CONFIG;
      if (!liveConfig?.SUPABASE_URL || !liveConfig?.SUPABASE_ANON_KEY || !window.supabase?.createClient) return;
      const client = window.supabase.createClient(liveConfig.SUPABASE_URL, liveConfig.SUPABASE_ANON_KEY);
      const { error } = await client.auth.signOut();
      if (!error) location.href = "login.html";
    });
  }
  logoutButton.classList.add("dimension-logout");
  logoutButton.textContent = "Log out";
  nav.append(logoutButton);

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
  ecosystem.addEventListener("click", event => {
    if (event.target.closest("a")) ecosystem.open = false;
  });
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
        guestRegister.hidden = signedIn || liveConfig?.REGISTRATION_ENABLED !== true;
        logoutButton.hidden = !signedIn;
        moderatorLink.hidden = !signedIn;
      }).catch(() => {});
    } else {
      logoutButton.hidden = true;
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", syncAuthNavigation, { once: true });
  } else {
    syncAuthNavigation();
  }
})();