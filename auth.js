(() => {
  const opener = document.querySelector('[data-google-auth]');
  const dialog = document.getElementById('account-dialog');
  if (!opener || !dialog) return;

  const words = {
    de: {
      label: 'Konto', title: 'Mein Konto', close: 'Schließen', retry: 'Erneut prüfen',
      loading: 'Dein Anmeldestatus wird geladen.',
      ready: 'Melde dich mit deinem Google-Konto bei DVN CLOTHING an.',
      pending: 'Der Google-Login wird eingerichtet. Bei Fragen erreichst du uns per E-Mail.',
      member: 'Du bist mit diesem Google-Konto angemeldet.',
      error: 'Dein Konto ist gerade nicht erreichbar. Bitte versuche es erneut.',
      login: 'Mit Google anmelden', logout: 'Abmelden', leaving: 'Wird abgemeldet …',
      denied: 'Die Anmeldung wurde abgebrochen oder ist fehlgeschlagen. Du kannst sie erneut starten.',
      logoutError: 'Die Abmeldung ist fehlgeschlagen. Bitte versuche es erneut.'
    },
    en: {
      label: 'Account', title: 'My account', close: 'Close', retry: 'Check again',
      loading: 'Checking your sign-in status.',
      ready: 'Sign in to DVN CLOTHING with your Google account.',
      pending: 'Google sign-in is being set up. You can reach us by email in the meantime.',
      member: 'You’re signed in with this Google account.',
      error: 'Your account is temporarily unavailable. Please try again.',
      login: 'Sign in with Google', logout: 'Sign out', leaving: 'Signing out …',
      denied: 'Sign-in was cancelled or unsuccessful. You can try again.',
      logoutError: 'We couldn’t sign you out. Please try again.'
    }
  };
  const find = (selector) => dialog.querySelector(selector);
  const close = find('[data-account-close]');
  const start = find('[data-account-start]');
  const retry = find('[data-account-retry]');
  const logout = find('[data-account-logout]');
  const error = find('[data-account-error]');
  let mode = 'loading';
  let notice = '';
  let user = null;
  let requestID = 0;
  let signingOut = false;

  function render() {
    const text = words[document.documentElement.lang] || words.de;
    opener.setAttribute('aria-label', text.title);
    opener.querySelector('[data-account-label]').textContent = text.label;
    find('#account-title').textContent = text.title;
    close.setAttribute('aria-label', text.close);
    find('#account-summary').textContent = text[mode];
    find('[data-account-identity]').hidden = mode !== 'member';
    find('[data-account-name]').textContent = user?.name || '';
    find('[data-account-email]').textContent = user?.email || '';
    start.hidden = mode !== 'ready';
    if (mode === 'ready') start.href = '/api/auth/start';
    else start.removeAttribute('href');
    start.textContent = text.login;
    retry.hidden = !['error', 'pending'].includes(mode);
    retry.textContent = text.retry;
    logout.hidden = mode !== 'member';
    logout.disabled = signingOut;
    logout.textContent = signingOut ? text.leaving : text.logout;
    find('[data-account-contact]').hidden = !['error', 'pending'].includes(mode);
    error.hidden = !notice;
    error.textContent = text[notice] || '';
  }

  async function checkSession() {
    if (signingOut) return;
    const current = ++requestID;
    mode = 'loading';
    render();
    try {
      const response = await fetch('/api/auth/session', {
        credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10000)
      });
      if (current !== requestID) return;
      if (response.status === 404 || (response.ok && response.headers.get('Content-Type')?.includes('text/html'))) {
        mode = 'pending';
      } else {
        if (!response.ok) throw new Error('Session unavailable');
        const session = await response.json();
        if (current !== requestID) return;
        if (typeof session.configured !== 'boolean') throw new Error('Unexpected response');
        user = session.configured ? session.user : null;
        mode = session.configured ? (user ? 'member' : 'ready') : 'pending';
      }
    } catch {
      if (current !== requestID) return;
      mode = 'error';
    }
    render();
  }

  function openDialog() {
    if (!dialog.open) dialog.showModal();
    checkSession();
  }
  opener.addEventListener('click', openDialog);
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { notice = ''; opener.focus(); });
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  });
  retry.addEventListener('click', checkSession);
  logout.addEventListener('click', async () => {
    if (signingOut) return;
    signingOut = true;
    notice = '';
    render();
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(10000)
      });
      if (response.status !== 204) throw new Error('Logout failed');
      user = null;
      mode = 'ready';
    } catch {
      notice = 'logoutError';
    } finally {
      signingOut = false;
      render();
    }
  });
  document.addEventListener('dvn:languagechange', render);
  window.addEventListener('pageshow', (event) => { if (event.persisted && dialog.open) checkSession(); });
  render();
  const url = new URL(window.location.href);
  const result = url.searchParams.get('login');
  if (result === 'complete' || result === 'failed') {
    url.searchParams.delete('login');
    window.history.replaceState(window.history.state, '', url);
    notice = result === 'failed' ? 'denied' : '';
    openDialog();
  }
})();
