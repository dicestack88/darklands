(() => {
  "use strict";
  const config = window.DARKLANDS_CONFIG;
  const emailEl = document.getElementById("settings-email");
  const providerEl = document.getElementById("settings-provider");
  const usernameEl = document.getElementById("settings-username");
  const displayNameEl = document.getElementById("settings-display-name");
  const accountStatus = document.getElementById("settings-account-status");
  const privacySelect = document.getElementById("message-privacy-setting");
  const privacySave = document.getElementById("save-message-privacy");
  const privacyStatus = document.getElementById("message-privacy-status");

  if (!config?.SUPABASE_URL || !config?.SUPABASE_ANON_KEY || !window.supabase?.createClient) {
    accountStatus.textContent = "Account services are temporarily unavailable.";
    privacyStatus.textContent = "Messaging settings are unavailable.";
    return;
  }

  const db = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
  let userId = null;

  const load = async () => {
    const { data, error } = await db.auth.getUser();
    if (error || !data?.user) {
      emailEl.textContent = "Not signed in";
      providerEl.textContent = "—";
      usernameEl.textContent = "—";
      displayNameEl.textContent = "—";
      accountStatus.textContent = "Sign in to view and change your account settings.";
      privacyStatus.textContent = "Sign in to manage messaging privacy.";
      return;
    }

    const user = data.user;
    userId = user.id;
    emailEl.textContent = user.email || "Not provided";
    const provider = user.app_metadata?.provider || "google";
    providerEl.textContent = provider === "google" ? "Google" : provider;
    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("username, display_name, message_privacy")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      usernameEl.textContent = "Unavailable";
      displayNameEl.textContent = "Unavailable";
      accountStatus.textContent = "Your account is signed in, but profile details could not be loaded.";
      privacyStatus.textContent = "Couldn't load your messaging preference. Please refresh.";
      return;
    }

    usernameEl.textContent = profile?.username ? "@" + profile.username : "Not set up";
    displayNameEl.textContent = profile?.display_name || "Not set up";
    accountStatus.textContent = "You're signed in to Dicestack Dimension.";
    if (profile) {
      privacySelect.value = profile.message_privacy || "requests";
      privacySelect.disabled = false;
      privacySave.disabled = false;
      privacyStatus.textContent = "Your saved messaging preference is loaded.";
    } else {
      privacyStatus.textContent = "Complete your profile before changing messaging privacy.";
    }
  };

  privacySave.addEventListener("click", async () => {
    if (!userId) return;
    privacySave.disabled = true;
    privacyStatus.textContent = "Saving…";
    const { error } = await db.from("profiles")
      .update({ message_privacy: privacySelect.value })
      .eq("id", userId);
    privacyStatus.textContent = error
      ? "Couldn't save this preference. Please try again."
      : "Messaging privacy updated.";
    privacySave.disabled = false;
  });

  load().catch(() => {
    accountStatus.textContent = "Couldn't load your account details. Please refresh.";
    privacyStatus.textContent = "Couldn't load messaging privacy.";
  });
})();