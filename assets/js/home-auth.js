(() => {
  const config = window.DARKLANDS_CONFIG;
  if (!config || !window.supabase?.createClient) return;

  const client = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
  const hashParams = new URLSearchParams(window.location.hash.slice(1));
  if (hashParams.get("type") === "invite") return;

  const publicHome = document.getElementById("home-public");
  const memberHome = document.getElementById("home-member");
  const greeting = document.getElementById("home-greeting");
  const username = document.getElementById("home-username");

  client.auth.getSession().then(async ({ data, error }) => {
    if (error) {
      console.warn("Dicestack Dimension session check failed:", error.message);
      return;
    }
    if (!data.session) return;

    publicHome?.setAttribute("hidden", "");
    if (memberHome) memberHome.hidden = false;

    try {
      const { data: profile } = await client
        .from("profiles")
        .select("display_name, username")
        .eq("id", data.session.user.id)
        .maybeSingle();

      const displayName = profile?.display_name?.trim();
      if (greeting) greeting.textContent = displayName
        ? `Good to see you, ${displayName}. What would you like to do today?`
        : "Your community, all in one place.";
      if (username && profile?.username) username.textContent = `@${profile.username}`;
    } catch (profileError) {
      console.warn("Could not load the home profile greeting:", profileError);
    }
  }).catch(error => {
    console.warn("Dicestack Dimension session check failed:", error);
  });
})();
