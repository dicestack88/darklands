/* Dimension is dark-only. The ecosystem uses one shared glass material. */
(() => {
  "use strict";
  const root = document.documentElement;
  root.dataset.theme = "dark";
  root.style.colorScheme = "dark";
  root.classList.remove("light-mode");
  document.body?.classList.remove("light-mode");
  try { localStorage.setItem("darklands-theme", "dark"); } catch (_) {}
  document.getElementById("darklands-theme-toggle")?.remove();
})();
