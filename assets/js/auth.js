(() => {
  const config = window.DARKLANDS_CONFIG;
  const keyReady = config && config.SUPABASE_ANON_KEY && !config.SUPABASE_ANON_KEY.includes("PASTE_YOUR_");
  const clientReady = keyReady && window.supabase && window.supabase.createClient;
  const client = clientReady ? window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY) : null;
  const showMessage = (form, message, isError = false) => {
    const target = form && form.querySelector(".form-message");
    if (target) { target.textContent = message; target.style.color = isError ? "#ffaaa9" : "#bdc9ff"; }
  };
  const setBusy = (form, busy, label) => {
    const button = form.querySelector('button[type="submit"]');
    if (!button) return;
    if (busy) { button.dataset.originalLabel = button.textContent; button.disabled = true; button.textContent = label; }
    else { button.disabled = false; if (button.dataset.originalLabel) button.textContent = button.dataset.originalLabel; }
  };
  const isVerified = user => Boolean(user && (user.email_confirmed_at || user.confirmed_at));
  const sitePage = name => new URL(name, config.SITE_URL).toString();

  const loginForm = document.getElementById("login-form");
  if (loginForm) {
    const params = new URLSearchParams(window.location.search);
    if (params.get("verified") === "1") showMessage(loginForm, "Email verified. You can now log in.");
    if (params.get("reset") === "1") showMessage(loginForm, "Password updated. Please log in.");
    loginForm.addEventListener("submit", async event => {
      event.preventDefault();
      if (!client) return showMessage(loginForm, "Account services aren't configured yet. Please check back soon.", true);
      setBusy(loginForm, true, "Signing in…");
      try {
        const { data, error } = await client.auth.signInWithPassword({ email: loginForm.elements.email.value.trim(), password: loginForm.elements.password.value });
        if (error) throw error;
        if (!isVerified(data.user)) {
          await client.auth.signOut();
          throw new Error("Please verify your email address before logging in. Check your inbox for the confirmation link.");
        }
        window.location.assign(sitePage("app.html"));
      } catch (error) {
        showMessage(loginForm, error.message || "Unable to log in. Please try again.", true);
        setBusy(loginForm, false);
      }
    });
  }

  const registerForm = document.getElementById("register-form");
  if (registerForm) {
    const note = document.getElementById("registration-note");
    const submit = registerForm.querySelector('button[type="submit"]');
    if (!config || !config.REGISTRATION_ENABLED) {
      registerForm.querySelectorAll("input, button").forEach(control => { control.disabled = true; });
      if (note) note.textContent = "Registration is temporarily closed while we test account security. No account details are being collected.";
      showMessage(registerForm, "New account registration is currently closed.");
    } else if (!client) {
      showMessage(registerForm, "Account services aren't configured yet. Registration is unavailable.", true);
      if (submit) submit.disabled = true;
    } else {
      registerForm.addEventListener("submit", async event => {
        event.preventDefault();
        const username = registerForm.elements.username.value.trim().toLowerCase();
        const displayName = registerForm.elements.display_name.value.trim();
        const email = registerForm.elements.email.value.trim();
        const password = registerForm.elements.password.value;
        if (!/^[a-z0-9_]{3,20}$/.test(username)) return showMessage(registerForm, "Username must be 3–20 characters using letters, numbers or underscores.", true);
        if (displayName.length < 1 || displayName.length > 32) return showMessage(registerForm, "Display name must be between 1 and 32 characters.", true);
        setBusy(registerForm, true, "Creating account…");
        try {
          const { data, error } = await client.auth.signUp({ email, password, options: { emailRedirectTo: sitePage("login.html?verified=1"), data: { username, display_name: displayName } } });
          if (error) throw error;
          if (data.session && isVerified(data.user)) { window.location.assign(sitePage("app.html")); return; }
          registerForm.reset();
          showMessage(registerForm, "Account request received. Check your email for a verification link. You won't be able to log in until you verify it.");
        } catch (error) {
          showMessage(registerForm, error.message || "Unable to create the account. Please try again.", true);
        } finally { setBusy(registerForm, false); }
      });
    }
  }

  const notReady = document.querySelector("[data-not-ready]");
  if (notReady) notReady.addEventListener("click", event => {
    event.preventDefault();
    showMessage(document.getElementById("login-form"), "Password recovery will be added in the next account-system update.");
  });

  if (document.getElementById("protected-app")) {
    const status = document.getElementById("app-status");
    const content = document.getElementById("app-content");
    const setStatus = message => { if (status) status.textContent = message; };
    if (!client) setStatus("Account services are not configured yet.");
    else client.auth.getSession().then(async ({ data, error }) => {
      const session = data && data.session;
      if (error || !session || !isVerified(session.user)) {
        await client.auth.signOut();
        window.location.replace(sitePage("login.html"));
        return;
      }
      const { data: profile, error: profileError } = await client.from("profiles").select("username, display_name, bio, avatar_url").eq("id", session.user.id).single();
      if (profileError) { setStatus("Your account is signed in, but your profile could not be loaded. Please contact support."); return; }
      document.getElementById("app-display-name").textContent = profile.display_name;
      document.getElementById("app-username").textContent = "@" + profile.username;
      if (content) content.hidden = false;
      setStatus("Signed in and email verified.");
    });
    const logout = document.getElementById("logout-button");
    if (logout && client) logout.addEventListener("click", async () => {
      logout.disabled = true;
      const { error } = await client.auth.signOut();
      if (error) { logout.disabled = false; setStatus("Could not sign out. Please try again."); }
      else window.location.replace(sitePage("login.html"));
    });
  }
})();