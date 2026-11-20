(() => {
  const controls = document.querySelectorAll('[data-google-auth]');
  if (!controls.length) return;
  const loginText = { de: 'Mit Google anmelden', en: 'Sign in with Google' };
  const logoutText = { de: 'Abmelden', en: 'Sign out' };
  let user = null;
  let configured = false;

  function render() {
    if (!configured) return;
    const language = document.documentElement.lang === 'en' ? 'en' : 'de';
    controls.forEach((control) => {
      control.hidden = false;
      const label = control.querySelector('[data-google-auth-label]');
      label.textContent = user ? `${user.name} · ${logoutText[language]}` : loginText[language];
      control.setAttribute('aria-label', label.textContent);
    });
  }

  fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' })
    .then((response) => response.ok ? response.json() : null)
    .then((session) => {
      if (!session?.configured) return;
      configured = true;
      user = session.user;
      render();
    })
    .catch(() => {});

  controls.forEach((control) => control.addEventListener('click', async () => {
    if (!user) { window.location.assign('/api/auth/start'); return; }
    const result = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    if (result.ok) { user = null; render(); }
  }));
  document.addEventListener('dvn:languagechange', render);
})();
