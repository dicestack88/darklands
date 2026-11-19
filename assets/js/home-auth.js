(() => {
  const config = window.DARKLANDS_CONFIG;
  if (!config || !window.supabase?.createClient) return;

  const client = window.supabase.createClient(
    config.SUPABASE_URL,
    config.SUPABASE_ANON_KEY
  );

  // Keep invitation callbacks on their dedicated password-setup route.
  const hashParams = new URLSearchParams(window.location.hash.slice(1));
  if (hashParams.get("type") === "invite") return;

  client.auth.getSession().then(({ data, error }) => {
    if (error) {
      console.warn("Darklands session check failed:", error.message);
      return;
    }

    if (data.session) {
      window.location.replace(new URL("clips.html", config.SITE_URL).toString());
    }
  }).catch(error => {
    console.warn("Darklands session check failed:", error);
  });
})();
