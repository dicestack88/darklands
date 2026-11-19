(() => {
  const form = document.getElementById("set-password-form");
  if (!form) return;
  const message = form.querySelector(".form-message");
  const submit = form.querySelector('button[type="submit"]');
  const config = window.DARKLANDS_CONFIG;
  const ready = config && config.SUPABASE_URL && config.SUPABASE_ANON_KEY && window.supabase;
  if (!ready) {
    message.textContent = "Account services aren't available right now. Please try again later.";
    return;
  }
  const client = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
  const showError = text => { message.textContent = text; message.style.color = "#ffaaa9"; };
  (async () => {
    const { data, error } = await client.auth.getSession();
    if (error || !data.session || !data.session.user) {
      showError("This invitation link is no longer active. Please ask the Darklands administrator to send a new invitation.");
      submit.disabled = true;
    }
  })();
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const password = form.elements.password.value;
    const confirmation = form.elements["confirm-password"].value;
    if (password.length < 8) return showError("Use at least 8 characters.");
    if (password !== confirmation) return showError("The passwords don't match.");
    submit.disabled = true;
    submit.textContent = "Saving…";
    message.textContent = "";
    try {
      const { data: sessionData } = await client.auth.getSession();
      if (!sessionData.session) throw new Error("Your invitation session has expired. Please request a new invitation.");
      const { error } = await client.auth.updateUser({ password });
      if (error) throw error;
      form.reset();
      message.style.color = "#bdc9ff";
      message.textContent = "Password saved! Your account is ready for the final profile and moderator setup. Keep this tab open.";
      submit.textContent = "Password saved";
    } catch (error) {
      showError(error.message || "Couldn't save your password. Please try again.");
      submit.disabled = false;
      submit.textContent = "Save password →";
    }
  });
})();