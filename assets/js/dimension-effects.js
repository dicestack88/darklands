(() => {
  "use strict";
  if (window.__dimensionPageEffectsInstalled) return;
  window.__dimensionPageEffectsInstalled = true;

  const root = document.documentElement;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const loader = document.createElement("div");
  loader.className = "dimension-page-loader";
  loader.setAttribute("role", "status");
  loader.setAttribute("aria-live", "polite");
  loader.setAttribute("aria-label", "Loading Dicestack Dimension");
  loader.innerHTML = '<div class="dimension-loader-content"><div class="dimension-loader-mark" aria-hidden="true">D</div><span>DICESTACK DIMENSION</span><span class="dimension-loader-caption">PREPARING YOUR SPACE</span></div>';
  document.body.append(loader);

  let loaderStartedAt = performance.now();
  root.classList.add("dimension-loading");
  const finishInitialLoad = () => {
    const remaining = Math.max(0, 420 - (performance.now() - loaderStartedAt));
    window.setTimeout(() => root.classList.remove("dimension-loading"), remaining);
  };
  if (document.readyState === "complete") finishInitialLoad();
  else window.addEventListener("load", finishInitialLoad, { once: true });

  window.addEventListener("pageshow", () => root.classList.remove("dimension-loading"));

  if (reduceMotion) return;
  document.addEventListener("click", event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest("a[href]");
    if (!link || link.target && link.target !== "_self" || link.hasAttribute("download") || link.dataset.noTransition !== undefined) return;
    let destination;
    try { destination = new URL(link.href, location.href); } catch { return; }
    if (destination.origin !== location.origin || destination.pathname === location.pathname && destination.search === location.search || destination.hash && destination.pathname === location.pathname && destination.search === location.search) return;
    if (!destination.pathname.includes("/dimension/")) return;
    event.preventDefault();
    root.classList.add("dimension-loading");
    window.setTimeout(() => location.assign(destination.href), 170);
  });
})();