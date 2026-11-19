document.querySelectorAll("[data-toggle-password]").forEach((button)=>{button.addEventListener("click",()=>{const field=document.getElementById(button.dataset.togglePassword);if(!field)return;const reveal=field.type==="password";field.type=reveal?"text":"password";button.textContent=reveal?"Hide":"Show";button.setAttribute("aria-label",reveal?"Hide password":"Show password");});});
document.querySelectorAll("[data-demo-form]").forEach((form)=>{form.addEventListener("submit",(event)=>{event.preventDefault();const message=form.querySelector(".form-message");if(message)message.textContent="This is a design preview. Account creation and login will be enabled after the secure backend is connected.";});});
document.querySelectorAll("[data-not-ready]").forEach((link)=>{link.addEventListener("click",(event)=>{event.preventDefault();const message=document.querySelector(".form-message");if(message)message.textContent="Password recovery will be added with the account backend.";});});
document.querySelectorAll("[data-twofa-status]").forEach((status)=>{
  const toggle=document.getElementById("twofa-toggle");
  if(!toggle)return;
  const update=()=>{status.textContent=toggle.checked?"Preview enabled — an extra sign-in verification step would be required.":"Currently off — sign-in will use your normal login method.";};
  toggle.addEventListener("change",update);
});
