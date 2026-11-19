(() => {
  "use strict";
  const KEY = "darklands-theme";
  let saved = "dark";
  try { saved = localStorage.getItem(KEY) === "light" ? "light" : "dark"; } catch (_) {}
  const root = document.documentElement;
  root.dataset.theme = saved;
  root.style.colorScheme = saved;
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = "assets/css/theme.css";
  document.head.appendChild(css);

  const mount = () => {
    if (document.getElementById("darklands-theme-toggle")) return;
    const nav = document.querySelector(".header-nav, .creator-nav, .clips-header-nav, .moderation-nav, .notifications-nav, .site-header");
    if (!nav) return;
    const button = document.createElement("button");
    button.type = "button";
    button.id = "darklands-theme-toggle";
    button.className = "theme-toggle";
    button.setAttribute("aria-label", saved === "dark" ? "Switch to light mode" : "Switch to dark mode");
    button.setAttribute("aria-pressed", String(saved === "light"));
    button.innerHTML = '<span class="theme-toggle-icon" aria-hidden="true">' + (saved === "dark" ? "☀" : "☾") + '</span><span class="theme-toggle-label">' + (saved === "dark" ? "Light mode" : "Dark mode") + '</span>';
    button.addEventListener("click", () => {
      saved = root.dataset.theme === "light" ? "dark" : "light";
      root.dataset.theme = saved;
      root.style.colorScheme = saved;
      try { localStorage.setItem(KEY, saved); } catch (_) {}
      button.setAttribute("aria-label", saved === "dark" ? "Switch to light mode" : "Switch to dark mode");
      button.setAttribute("aria-pressed", String(saved === "light"));
      button.innerHTML = '<span class="theme-toggle-icon" aria-hidden="true">' + (saved === "dark" ? "☀" : "☾") + '</span><span class="theme-toggle-label">' + (saved === "dark" ? "Light mode" : "Dark mode") + '</span>';
    });
    nav.appendChild(button);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
})();