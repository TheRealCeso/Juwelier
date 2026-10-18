const demoLoginForm = document.getElementById('demo-login-form');
const demoLoginError = document.getElementById('login-error');

demoLoginForm?.addEventListener('submit', event => {
  event.preventDefault();
  const username = demoLoginForm.elements.username.value;
  const password = demoLoginForm.elements.password.value;

  if (username === 'Test' && password === 'Test') {
    // A local demo gate only. Never use this credential check to protect real records.
    sessionStorage.setItem('juwelier-goek-demo', '1');
    demoLoginForm.reset();
    const next = new URLSearchParams(window.location.search).get('next');
    window.location.assign(next === 'belegarchiv.html' ? next : 'ankauf.html');
    return;
  }

  demoLoginError.hidden = false;
  demoLoginForm.elements.password.value = '';
  demoLoginForm.elements.password.focus();
});
