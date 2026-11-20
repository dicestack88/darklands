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
      .select("username, display_name, bio, avatar_url, banner_url, message_privacy")
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
    const profileName = document.getElementById("settings-profile-name");
    const profileUsername = document.getElementById("settings-profile-username");
    const nameInput = document.getElementById("account-display-name");
    const bioInput = document.getElementById("profile-bio");
    const bioPreview = document.getElementById("profile-bio-preview");
    const bioCount = document.getElementById("bio-count");
    const avatarPreview = document.getElementById("account-avatar-preview");
    const bannerPreview = document.getElementById("account-banner-preview");
    if (profileName) profileName.textContent = profile?.display_name || "Your profile";
    if (profileUsername) profileUsername.textContent = profile?.username ? "@" + profile.username : "";
    if (nameInput) nameInput.value = profile?.display_name || "";
    if (bioInput) bioInput.value = profile?.bio || "";
    if (bioPreview) bioPreview.textContent = profile?.bio || "No bio added yet.";
    if (bioCount && bioInput) bioCount.textContent = bioInput.value.length + " / 160";
    if (avatarPreview && profile?.avatar_url) { avatarPreview.src = profile.avatar_url; avatarPreview.hidden = false; }
    if (bannerPreview && profile?.banner_url) {
      bannerPreview.style.backgroundImage = "linear-gradient(90deg,rgba(5,8,15,.18),rgba(5,8,15,.05)),url(" + JSON.stringify(profile.banner_url) + ")";
      bannerPreview.classList.add("has-banner"); bannerPreview.textContent = "";
    }

    if (bioInput && bioCount) bioInput.addEventListener("input", () => { bioCount.textContent = bioInput.value.length + " / 160"; });

    const customizeForm = document.getElementById("account-customize-form");
    if (customizeForm) customizeForm.addEventListener("submit", async event => {
      event.preventDefault();
      const message = document.getElementById("account-customize-message");
      const save = customizeForm.querySelector('button[type="submit"]');
      const displayName = nameInput.value.trim();
      const avatarFile = document.getElementById("account-avatar-file").files[0];
      const bannerFile = document.getElementById("account-banner-file").files[0];
      const allowed = ["image/jpeg", "image/png", "image/webp"];
      if (!displayName || displayName.length > 32) { message.textContent = "Display name must be 1–32 characters."; return; }
      for (const file of [avatarFile, bannerFile]) if (file && (!allowed.includes(file.type) || file.size > 5 * 1024 * 1024)) { message.textContent = "Choose a JPG, PNG or WebP image no larger than 5 MB."; return; }
      save.disabled = true; save.textContent = "Saving…"; message.textContent = "";
      const uploaded = [];
      try {
        const updates = { display_name: displayName };
        const upload = async (file, kind) => {
          if (!file) return null;
          const ext = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" })[file.type];
          const path = userId + "/" + kind + "-" + crypto.randomUUID() + "." + ext;
          const { error } = await db.storage.from("darklands-profile-media").upload(path, file, { contentType: file.type, upsert: false });
          if (error) throw error;
          uploaded.push(path);
          return db.storage.from("darklands-profile-media").getPublicUrl(path).data.publicUrl;
        };
        if (avatarFile) updates.avatar_url = await upload(avatarFile, "avatar");
        if (bannerFile) updates.banner_url = await upload(bannerFile, "banner");
        const { error } = await db.from("profiles").update(updates).eq("id", userId);
        if (error) throw error;
        if (profileName) profileName.textContent = displayName;
        if (displayNameEl) displayNameEl.textContent = displayName;
        if (avatarPreview && updates.avatar_url) { avatarPreview.src = updates.avatar_url; avatarPreview.hidden = false; }
        if (bannerPreview && updates.banner_url) { bannerPreview.style.backgroundImage = "linear-gradient(90deg,rgba(5,8,15,.18),rgba(5,8,15,.05)),url(" + JSON.stringify(updates.banner_url) + ")"; bannerPreview.classList.add("has-banner"); bannerPreview.textContent = ""; }
        message.textContent = "Your profile appearance has been saved.";
        document.getElementById("account-avatar-file").value = "";
        document.getElementById("account-banner-file").value = "";
      } catch (error) {
        if (uploaded.length) await db.storage.from("darklands-profile-media").remove(uploaded);
        message.textContent = "We couldn't save your changes. Please try again.";
      } finally { save.disabled = false; save.innerHTML = 'Save profile appearance <span aria-hidden="true">↗</span>'; }
    });

    const bioForm = document.getElementById("profile-form");
    if (bioForm) bioForm.addEventListener("submit", async event => {
      event.preventDefault();
      const bio = bioInput.value.trim();
      const message = document.getElementById("profile-message");
      const save = bioForm.querySelector('button[type="submit"]');
      if (bio.length > 160) { message.textContent = "Your bio must be 160 characters or fewer."; return; }
      save.disabled = true; save.textContent = "Saving…"; message.textContent = "";
      const { error } = await db.from("profiles").update({ bio }).eq("id", userId);
      message.textContent = error ? "We couldn't save your bio. Please try again." : "Your bio has been saved.";
      if (!error && bioPreview) bioPreview.textContent = bio || "No bio added yet.";
      save.disabled = false; save.innerHTML = 'Save bio <span aria-hidden="true">↗</span>';
    });
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