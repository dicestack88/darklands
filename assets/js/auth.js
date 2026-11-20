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
        window.location.assign(sitePage("settings.html"));
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
          if (data.session && isVerified(data.user)) { window.location.assign(sitePage("settings.html")); return; }
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

    if (!client) {
      setStatus("Account services are not configured yet.");
    } else {
      (async () => {
        try {
          // Validate the current user with Supabase Auth instead of trusting
          // only a locally cached session.
          const { data, error } = await client.auth.getUser();
          const user = data && data.user;

          if (error || !isVerified(user)) {
            await client.auth.signOut();
            window.location.replace(sitePage("login.html"));
            return;
          }

          const { data: profile, error: profileError } = await client
            .from("profiles")
            .select("username, display_name, bio, avatar_url, banner_url")
            .eq("id", user.id)
            .single();

          if (profileError || !profile) {
            setStatus("Your account is signed in, but your profile could not be loaded. Please try again later.");
            return;
          }

          const displayName = document.getElementById("app-display-name");
          const username = document.getElementById("app-username");
          const displayNameNode = displayName;
          const bioPreview = document.getElementById("profile-bio-preview");
          const bioInput = document.getElementById("profile-bio");
          const bioCount = document.getElementById("bio-count");
          const profileForm = document.getElementById("profile-form");
          const profileMessage = document.getElementById("profile-message");

          if (displayName) displayName.textContent = profile.display_name;
          if (username) username.textContent = "@" + profile.username;
          if (bioPreview) bioPreview.textContent = profile.bio || "No bio added yet.";
          if (bioInput) bioInput.value = profile.bio || "";
          if (bioCount && bioInput) bioCount.textContent = bioInput.value.length + " / 160";

          if (bioInput && bioCount) {
            bioInput.addEventListener("input", () => {
              bioCount.textContent = bioInput.value.length + " / 160";
            });
          }


          const customizeForm=document.getElementById("account-customize-form");
          if(customizeForm){
            const nameInput=document.getElementById("account-display-name");
            const avatarInput=document.getElementById("account-avatar-file");
            const bannerInput=document.getElementById("account-banner-file");
            const customizeMessage=document.getElementById("account-customize-message");
            const avatarPreview=document.getElementById("account-avatar-preview");
            const bannerPreview=document.getElementById("account-banner-preview");
            nameInput.value=profile.display_name||"";
            if(profile.avatar_url){avatarPreview.src=profile.avatar_url;avatarPreview.hidden=false;}
            if(profile.banner_url){bannerPreview.style.backgroundImage="linear-gradient(90deg,rgba(5,8,15,.18),rgba(5,8,15,.05)),url("+JSON.stringify(profile.banner_url)+")";bannerPreview.classList.add("has-banner");bannerPreview.textContent="";}
            customizeForm.addEventListener("submit",async event=>{
              event.preventDefault();
              customizeMessage.textContent="";
              const displayName=nameInput.value.trim();
              const avatarFile=avatarInput.files[0];
              const bannerFile=bannerInput.files[0];
              if(displayName.length<1||displayName.length>32){customizeMessage.textContent="Display name must be 1–32 characters.";return;}
              const allowed=["image/jpeg","image/png","image/webp"];
              for(const file of [avatarFile,bannerFile]){
                if(file&&(!allowed.includes(file.type)||file.size>5*1024*1024)){customizeMessage.textContent="Choose a JPG, PNG or WebP image no larger than 5 MB.";return;}
              }
              const save=customizeForm.querySelector('button[type="submit"]');
              save.disabled=true;save.textContent="Saving…";
              const uploaded=[];
              try{
                const updates={display_name:displayName};
                const upload=async(file,kind)=>{
                  if(!file)return null;
                  const ext=({"image/jpeg":"jpg","image/png":"png","image/webp":"webp"})[file.type];
                  const path=user.id+"/"+kind+"-"+crypto.randomUUID()+"."+ext;
                  const {error:uploadError}=await client.storage.from("darklands-profile-media").upload(path,file,{contentType:file.type,upsert:false});
                  if(uploadError)throw uploadError;
                  uploaded.push(path);
                  return client.storage.from("darklands-profile-media").getPublicUrl(path).data.publicUrl;
                };
                if(avatarFile)updates.avatar_url=await upload(avatarFile,"avatar");
                if(bannerFile)updates.banner_url=await upload(bannerFile,"banner");
                const {error:updateError}=await client.from("profiles").update(updates).eq("id",user.id);
                if(updateError)throw updateError;
                if(displayName)displayNameNode.textContent=displayName;
                if(avatarPreview&&updates.avatar_url){avatarPreview.src=updates.avatar_url;avatarPreview.hidden=false;}
                if(bannerPreview&&updates.banner_url){bannerPreview.style.backgroundImage="linear-gradient(90deg,rgba(5,8,15,.18),rgba(5,8,15,.05)),url("+JSON.stringify(updates.banner_url)+")";bannerPreview.classList.add("has-banner");bannerPreview.textContent="";}
                customizeMessage.textContent="Your account appearance has been saved.";
                avatarInput.value="";bannerInput.value="";
              }catch(error){
                if(uploaded.length)await client.storage.from("darklands-profile-media").remove(uploaded);
                customizeMessage.textContent="We couldn't save your changes. Please try again.";
              }finally{save.disabled=false;save.innerHTML='Save account appearance <span aria-hidden="true">↗</span>';}
            });
          }
          if (profileForm && bioInput && profileMessage) {
            profileForm.addEventListener("submit", async event => {
              event.preventDefault();
              const bio = bioInput.value.trim();
              if (bio.length > 160) {
                profileMessage.textContent = "Your bio must be 160 characters or fewer.";
                return;
              }

              const saveButton = profileForm.querySelector('button[type="submit"]');
              if (saveButton) {
                saveButton.disabled = true;
                saveButton.textContent = "Saving…";
              }
              profileMessage.textContent = "";

              try {
                const { error: updateError } = await client
                  .from("profiles")
                  .update({ bio })
                  .eq("id", user.id);

                if (updateError) throw updateError;
                if (bioPreview) bioPreview.textContent = bio || "No bio added yet.";
                profileMessage.textContent = "Your bio has been saved.";
              } catch (saveError) {
                profileMessage.textContent = "We couldn't save your bio. Please try again.";
              } finally {
                if (saveButton) {
                  saveButton.disabled = false;
                  saveButton.innerHTML = 'Save bio <span aria-hidden="true">↗</span>';
                }
              }
            });
          }

          if (content) content.hidden = false;
          setStatus("Signed in and email verified.");
        } catch (error) {
          setStatus("We couldn't verify your session. Please log in again.");
          await client.auth.signOut();
          window.location.replace(sitePage("login.html"));
        }
      })();
    }

    const logout = document.getElementById("logout-button");
    if (logout && client) logout.addEventListener("click", async () => {
      logout.disabled = true;
      try {
        const { error } = await client.auth.signOut();
        if (error) throw error;
        window.location.replace(sitePage("login.html"));
      } catch (error) {
        logout.disabled = false;
        setStatus("Could not sign out. Please try again.");
      }
    });
  }
})();