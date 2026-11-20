(() => {
  const config = window.DARKLANDS_CONFIG;
  const ready = config && config.SUPABASE_URL && config.SUPABASE_ANON_KEY &&
    window.supabase && window.supabase.createClient;
  const client = ready ? window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY) : null;
  const page = name => new URL(name, config.SITE_URL).toString();
  const message = (element, value, error = false) => {
    if (!element) return;
    element.textContent = value;
    element.style.color = error ? "#ffaaa9" : "#bdc9ff";
  };

  document.querySelectorAll("[data-google-signin]").forEach(button => {
    button.addEventListener("click", async () => {
      const target = document.getElementById("auth-message");
      if (!client) return message(target, "Account services aren't configured yet. Please try again later.", true);
      button.disabled = true;
      button.dataset.originalText = button.textContent;
      button.textContent = "Connecting to Google…";
      try {
        const { error } = await client.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: page("complete-profile.html"),
            queryParams: { prompt: "select_account" }
          }
        });
        if (error) throw error;
      } catch (error) {
        message(target, error.message || "Google sign-in could not be started. Please try again.", true);
        button.disabled = false;
        button.textContent = button.dataset.originalText || "Continue with Google";
      }
    });
  });

  const form = document.getElementById("profile-setup-form");
  if (!form || !client) {
    if (form) message(document.getElementById("profile-setup-status"), "Account services aren't configured yet.", true);
    return;
  }

  const status = document.getElementById("profile-setup-status");
  const feedback = document.getElementById("profile-setup-message");
  const logout = document.getElementById("profile-logout");

  const checkProfile = async () => {
    message(status, "Checking your Google sign-in…");
    try {
      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError || !userData.user) {
        window.location.replace(page("login.html"));
        return;
      }

      const { data: profile, error: profileError } = await client
        .from("profiles").select("id").eq("id", userData.user.id).maybeSingle();

      if (profileError) throw profileError;
      if (profile) {
        window.location.replace(page("settings.html"));
        return;
      }

      message(status, "Choose your permanent Dicestack Dimension username and display name.");
      form.hidden = false;
    } catch (error) {
      message(status, "We couldn't check your profile. Please try again.", true);
      message(feedback, error.message || "Profile check failed.", true);
    }
  };

  checkProfile();

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const username = form.elements.username.value.trim().toLowerCase();
    const displayName = form.elements.display_name.value.trim();
    if (!/^[a-z0-9_]{3,20}$/.test(username)) {
      return message(feedback, "Username must be 3–20 characters using lowercase letters, numbers or underscores.", true);
    }
    if (displayName.length < 1 || displayName.length > 32) {
      return message(feedback, "Display name must be between 1 and 32 characters.", true);
    }

    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = "Creating profile…";
    message(feedback, "");
    try {
      const { error } = await client.rpc("complete_darklands_profile", {
        p_username: username,
        p_display_name: displayName
      });
      if (error) {
        if (/duplicate key|profiles_username_lower_unique|already exists/i.test(error.message)) {
          throw new Error("That username is already taken, or this account already has a profile. Try another username.");
        }
        throw error;
      }
      message(feedback, "Profile created! Opening Dicestack Dimension…");
      window.location.replace(page("settings.html"));
    } catch (error) {
      message(feedback, error.message || "We couldn't create your profile. Please try again.", true);
      submit.disabled = false;
      submit.textContent = "Create Dicestack Dimension profile →";
    }
  });

  if (logout) logout.addEventListener("click", async () => {
    logout.disabled = true;
    const { error } = await client.auth.signOut();
    if (error) {
      logout.disabled = false;
      message(feedback, "Could not sign out. Please try again.", true);
      return;
    }
    window.location.replace(page("login.html"));
  });
})();