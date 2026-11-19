(() => {
  const button = document.getElementById("run-connection-check");
  const status = document.getElementById("connection-status");
  const detail = document.getElementById("connection-detail");
  const message = document.getElementById("connection-message");
  if (!button) return;

  button.addEventListener("click", async () => {
    const config = window.DARKLANDS_CONFIG;
    if (!config || !config.SUPABASE_URL || !config.SUPABASE_ANON_KEY ||
        config.SUPABASE_ANON_KEY.includes("PASTE_YOUR_")) {
      status.textContent = "Configuration missing";
      detail.textContent = "The public Supabase URL or publishable key is not configured.";
      message.textContent = "Check assets/js/supabase-config.js.";
      message.style.color = "#ffaaa9";
      return;
    }

    button.disabled = true;
    button.textContent = "Checking…";
    status.textContent = "Connecting…";
    detail.textContent = "Contacting the Supabase Auth health endpoint.";
    message.textContent = "";

    try {
      const endpoint = config.SUPABASE_URL.replace(/\/$/, "") + "/auth/v1/health";
      const response = await fetch(endpoint, {
        method: "GET",
        headers: { apikey: config.SUPABASE_ANON_KEY },
        cache: "no-store"
      });
      if (!response.ok) throw new Error("Supabase returned HTTP " + response.status + ".");
      const result = await response.json();
      if (!result || result.name !== "GoTrue") throw new Error("The endpoint responded, but the expected Auth health response was not received.");

      status.textContent = "Connected";
      detail.textContent = "Supabase Auth responded successfully" + (result.version ? " (version " + result.version + ")." : ".");
      message.textContent = "Connection check passed. No account was created.";
      message.style.color = "#bdc9ff";
    } catch (error) {
      status.textContent = "Connection not confirmed";
      detail.textContent = error && error.message ? error.message : "The request could not be completed.";
      message.textContent = "Check the project URL, publishable key, and browser connection. Registration remains closed.";
      message.style.color = "#ffaaa9";
    } finally {
      button.disabled = false;
      button.innerHTML = 'Test connection <span aria-hidden="true">→</span>';
    }
  });
})();