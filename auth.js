(() => {
  'use strict';
  const opener = document.querySelector('[data-google-auth]');
  const dialog = document.getElementById('account-dialog');
  if (!opener || !dialog) return;
  const find = (selector) => dialog.querySelector(selector);
  const words = {
    de: {
      label: 'Anmelden', eyebrow: 'DVN Konto', close: 'Schließen', loading: 'Dein Anmeldestatus wird geladen.',
      guestTitle: 'Willkommen zurück', guest: 'Melde dich an, um deinen Warenkorb und dein Profil zu verwalten.',
      cart: 'Melde dich für deinen Warenkorb an. Danach kannst du deine Auswahl hinzufügen.',
      google: 'Mit Google fortfahren', googlePending: 'Google-Anmeldung wird eingerichtet.', or: 'oder',
      emailLabel: 'E-Mail-Adresse', placeholder: 'name@beispiel.de', send: 'Mit E-Mail fortfahren',
      mailHint: 'Wir senden dir einen einmaligen Anmeldecode.', mailPending: 'Die Anmeldung per E-Mail wird eingerichtet.',
      sending: 'Code wird gesendet …', codeTitle: 'Prüfe dein Postfach', code: 'Gib den sechsstelligen Code für {email} ein. Er ist zehn Minuten gültig.',
      codeLabel: 'Anmeldecode', verify: 'Code bestätigen', checking: 'Code wird geprüft …', resend: 'Code erneut senden',
      wait: 'Erneut senden in {s} s', changeEmail: 'E-Mail ändern', resent: 'Ein neuer Code wurde versendet.',
      memberTitle: 'Mein Konto', member: 'Du bist bei DVN CLOTHING angemeldet.', edit: 'Profil bearbeiten', logout: 'Abmelden', leaving: 'Wird abgemeldet …',
      profile: 'Wähle, welcher Name und welches Foto in deinem Konto erscheinen.', nameLabel: 'Anzeigename',
      changePhoto: 'Foto auswählen', removePhoto: 'Foto entfernen', save: 'Änderungen speichern', saving: 'Wird gespeichert …',
      cancel: 'Abbrechen', saved: 'Dein Profil wurde gespeichert.', photoError: 'Wähle eine JPG-, PNG- oder WebP-Datei bis 5 MB.',
      sessionError: 'Dein Konto ist gerade nicht erreichbar. Bitte versuche es erneut.', retry: 'Erneut prüfen',
      invalidCode: 'Der Code ist falsch oder abgelaufen. Prüfe die Eingabe oder fordere einen neuen Code an.',
      limit: 'Zu viele Versuche. Warte einen Moment und versuche es erneut.', sendError: 'Der Code konnte nicht versendet werden. Bitte versuche es erneut.',
      verifyError: 'Der Code konnte nicht geprüft werden. Bitte versuche es erneut.', logoutError: 'Die Abmeldung ist fehlgeschlagen. Bitte versuche es erneut.',
      profileError: 'Dein Profil konnte nicht gespeichert werden. Bitte prüfe deine Angaben und versuche es erneut.',
      denied: 'Die Anmeldung wurde abgebrochen oder ist fehlgeschlagen.', expired: 'Bitte melde dich erneut an.',
      nameInvalid: 'Gib einen Anzeigenamen ein.'
    },
    en: {
      label: 'Sign in', eyebrow: 'DVN Account', close: 'Close', loading: 'Checking your sign-in status.',
      guestTitle: 'Welcome back', guest: 'Sign in to manage your bag and profile.',
      cart: 'Sign in to use your bag. You can then add your selection.',
      google: 'Continue with Google', googlePending: 'Google sign-in is being set up.', or: 'or',
      emailLabel: 'Email address', placeholder: 'you@example.com', send: 'Continue with email',
      mailHint: 'We’ll email you a one-time sign-in code.', mailPending: 'Email sign-in is being set up.',
      sending: 'Sending code …', codeTitle: 'Check your inbox', code: 'Enter the six-digit code sent to {email}. It is valid for ten minutes.',
      codeLabel: 'Sign-in code', verify: 'Verify code', checking: 'Verifying code …', resend: 'Resend code',
      wait: 'Resend in {s}s', changeEmail: 'Change email', resent: 'A new code has been sent.',
      memberTitle: 'My account', member: 'You’re signed in to DVN CLOTHING.', edit: 'Edit profile', logout: 'Sign out', leaving: 'Signing out …',
      profile: 'Choose the name and photo that appear on your account.', nameLabel: 'Display name',
      changePhoto: 'Choose photo', removePhoto: 'Remove photo', save: 'Save changes', saving: 'Saving …',
      cancel: 'Cancel', saved: 'Your profile has been saved.', photoError: 'Choose a JPG, PNG or WebP image up to 5 MB.',
      sessionError: 'Your account is temporarily unavailable. Please try again.', retry: 'Check again',
      invalidCode: 'The code is incorrect or has expired. Check the code or request a new one.',
      limit: 'Too many attempts. Wait a moment and try again.', sendError: 'We couldn’t send your code. Please try again.',
      verifyError: 'We couldn’t verify your code. Please try again.', logoutError: 'We couldn’t sign you out. Please try again.',
      profileError: 'We couldn’t save your profile. Check the details and try again.',
      denied: 'Sign-in was cancelled or unsuccessful.', expired: 'Please sign in again.',
      nameInvalid: 'Enter a display name.'
    }
  };
  let user = null;
  let session = {};
  let sessionRequest = null;
  let sessionKnown = false;
  let page = 'loading';
  let action = '';
  let error = '';
  let feedback = '';
  let cartIntent = false;
  let email = '';
  let resendAt = 0;
  let timer;
  let draftAvatar;
  let previousFocus;
  const language = () => document.documentElement.lang === 'en' ? 'en' : 'de';
  const mail = find('#account-mail');
  const code = find('#account-code');
  const name = find('#account-display-name');
  const photo = find('#account-photo');

  function setUser(next) {
    const changed = !sessionKnown || JSON.stringify(user) !== JSON.stringify(next);
    user = next;
    sessionKnown = true;
    if (changed) document.dispatchEvent(new CustomEvent('dvn:authchange', { detail: { user } }));
  }

  function avatar(target, person, picture) {
    if (target.dataset.picture === picture && target.dataset.name === person) return;
    target.dataset.picture = picture;
    target.dataset.name = person;
    target.textContent = Array.from(person.trim())[0]?.toLocaleUpperCase() || 'D';
    let safe = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/i.test(picture);
    if (!safe && picture) {
      try {
        const url = new URL(picture);
        safe = url.protocol === 'https:' && url.hostname.endsWith('.googleusercontent.com');
      } catch { /* The initial remains visible. */ }
    }
    if (!safe) return;
    const img = new Image();
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => img.remove(), { once: true });
    img.src = picture;
    target.append(img);
  }

  function render() {
    const t = words[language()];
    dialog.querySelectorAll('[data-account-copy]').forEach(el => { el.textContent = t[el.dataset.accountCopy]; });
    const title = page === 'member' ? t.memberTitle : page === 'profile' ? t.edit : page === 'code' ? t.codeTitle : t.guestTitle;
    find('#account-title').textContent = title;
    const summaries = { loading: t.loading, error: t.sessionError, guest: cartIntent ? t.cart : t.guest, member: t.member, profile: t.profile, code: t.code.replace('{email}', email) };
    find('#account-summary').textContent = summaries[page];
    find('[data-account-close]').setAttribute('aria-label', t.close);
    opener.setAttribute('aria-label', user ? t.memberTitle + ' · ' + (user.name || user.email) : t.label);
    opener.querySelector('[data-account-label]').textContent = user?.name || t.label;
    opener.querySelector('svg').toggleAttribute('hidden', Boolean(user));
    const headerAvatar = opener.querySelector('[data-header-avatar]');
    headerAvatar.hidden = !user;
    if (user) avatar(headerAvatar, user.name || user.email, user.picture || '');
    find('[data-account-guest]').hidden = page !== 'guest';
    find('[data-account-code-form]').hidden = page !== 'code';
    find('[data-account-profile-form]').hidden = page !== 'profile';
    find('[data-account-member]').hidden = page !== 'member';
    const retry = find('[data-account-retry]');
    retry.hidden = page !== 'error' && !(page === 'guest' && !session.configured && !session.emailConfigured);
    mail.placeholder = t.placeholder;
    const start = find('[data-account-start]');
    if (session.configured && !action) {
      start.href = '/api/auth/start';
      start.removeAttribute('aria-disabled');
    } else {
      start.removeAttribute('href');
      start.setAttribute('aria-disabled', 'true');
    }
    find('[data-google-pending]').hidden = Boolean(session.configured);
    mail.disabled = !session.emailConfigured || Boolean(action);
    find('[data-account-submit-email]').disabled = mail.disabled;
    find('[data-account-submit-email]').textContent = action === 'send' ? t.sending : t.send;
    find('[data-account-mail-hint]').textContent = session.emailConfigured ? t.mailHint : t.mailPending;
    const seconds = Math.max(0, Math.ceil((resendAt - Date.now()) / 1000));
    const resend = find('[data-account-resend]');
    resend.textContent = seconds ? t.wait.replace('{s}', seconds) : t.resend;
    resend.disabled = Boolean(action) || seconds > 0;
    if (!seconds) clearInterval(timer);
    find('[data-account-back]').disabled = Boolean(action);
    find('[data-account-verify]').disabled = Boolean(action);
    find('[data-account-verify]').textContent = action === 'verify' ? t.checking : t.verify;
    code.disabled = Boolean(action);
    const alert = find('[data-account-error]');
    alert.hidden = !error;
    alert.textContent = t[error] || '';
    const confirmation = find('[data-account-feedback]');
    confirmation.hidden = !feedback;
    confirmation.textContent = t[feedback] || '';
    find('[data-account-edit]').hidden = !session.profileConfigured;
    find('[data-account-logout]').textContent = action === 'logout' ? t.leaving : t.logout;
    dialog.querySelectorAll('[data-account-edit], [data-account-logout], [data-account-save], [data-account-cancel], #account-photo, #account-display-name, [data-remove-photo]').forEach(el => { el.disabled = Boolean(action); });
    find('[data-account-save]').textContent = action === 'save' ? t.saving : t.save;
    if (user) {
      const display = user.name || user.email;
      find('[data-account-name]').textContent = display;
      find('[data-account-email]').textContent = user.email;
      avatar(find('[data-dialog-avatar]'), display, user.picture || '');
      const editPicture = draftAvatar ?? user.picture ?? '';
      avatar(find('[data-edit-avatar]'), name.value || display, editPicture);
      find('[data-remove-photo]').hidden = !editPicture;
    }
  }

  async function api(path, body) {
    const options = { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) };
    if (body !== undefined) Object.assign(options, { method: 'POST', body: JSON.stringify(body) });
    if (body !== undefined) options.headers['Content-Type'] = 'application/json';
    const response = await fetch('/api/auth/' + path, options);
    if (!response.ok) throw Object.assign(new Error('Account request failed'), { status: response.status });
    if (response.status === 204) return null;
    return response.json();
  }

  function checkSession() {
    if (sessionRequest) return sessionRequest;
    sessionRequest = (async () => {
      try {
        session = await api('session');
        if (typeof session?.configured !== 'boolean') throw new Error('Unexpected session');
        const next = session.user || null;
        const previous = user?.id;
        setUser(next);
        if (next) {
          if (page !== 'profile' || next.id !== previous) page = 'member';
        } else if (page !== 'code' || !session.emailConfigured) {
          page = 'guest';
        }
      } catch {
        session = {};
        setUser(null);
        page = 'error';
      } finally {
        sessionRequest = null;
        render();
      }
      return Boolean(user);
    })();
    return sessionRequest;
  }

  function show() {
    if (dialog.open) return;
    previousFocus = document.activeElement;
    dialog.showModal();
    find('#account-title').focus();
  }

  window.DVNAuth = {
    get user() { return user; },
    async requireLogin() {
      const signedIn = await checkSession();
      if (!signedIn) {
        cartIntent = true;
        render();
        show();
      }
      return signedIn;
    }
  };

  async function perform(nextAction, errorKey, task) {
    if (action) return;
    action = nextAction;
    feedback = error = '';
    render();
    try {
      await task();
    } catch (err) {
      if (err.status === 429) error = 'limit';
      else if (err.status === 400 && nextAction === 'verify') error = 'invalidCode';
      else if (err.status === 401 && nextAction === 'save') { await checkSession(); error = 'expired'; }
      else error = errorKey;
    } finally {
      action = '';
      render();
    }
  }

  async function sendCode(resending) {
    const target = resending ? email : mail.value.trim();
    await perform('send', 'sendError', async () => {
      await api('email/start', { email: target, language: language() });
      email = target;
      resendAt = Date.now() + 60000;
      clearInterval(timer);
      if (dialog.open) timer = setInterval(render, 1000);
      page = 'code';
      code.value = '';
      if (resending) feedback = 'resent';
    });
    if (page === 'code' && dialog.open) code.focus();
  }

  find('[data-account-email-form]').addEventListener('submit', e => { e.preventDefault(); sendCode(false); });
  find('[data-account-resend]').addEventListener('click', () => sendCode(true));
  find('[data-account-back]').addEventListener('click', () => { clearInterval(timer); page = 'guest'; feedback = error = ''; render(); mail.focus(); });
  find('[data-account-code-form]').addEventListener('submit', async e => {
    e.preventDefault();
    await perform('verify', 'verifyError', async () => {
      await api('email/verify', { code: code.value.trim() });
      clearInterval(timer);
      page = 'loading';
      code.value = '';
      await checkSession();
      if (!user) throw new Error('Unconfirmed session');
      cartIntent = false;
      mail.value = email = '';
      if (dialog.open) find('#account-title').focus();
    });
    if (page === 'code' && dialog.open) { code.focus(); code.select(); }
  });

  find('[data-account-edit]').addEventListener('click', () => {
    if (!user || !session.profileConfigured) return;
    feedback = error = '';
    draftAvatar = undefined;
    name.value = user.name || '';
    photo.value = '';
    page = 'profile';
    render();
    name.focus();
  });
  find('[data-account-cancel]').addEventListener('click', () => {
    page = 'member'; feedback = error = ''; render(); find('[data-account-edit]').focus();
  });
  name.addEventListener('input', () => { name.setCustomValidity(''); });
  find('[data-remove-photo]').addEventListener('click', () => { draftAvatar = ''; photo.value = ''; render(); });
  photo.addEventListener('change', async () => {
    const file = photo.files[0];
    if (!file) return;
    await perform('photo', 'photoError', async () => {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error('Unsupported photo');
      const bitmap = await createImageBitmap(file);
      try {
        const size = Math.min(bitmap.width, bitmap.height);
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 144;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#f4f3ef';
        ctx.fillRect(0, 0, 144, 144);
        ctx.drawImage(bitmap, (bitmap.width - size) / 2, (bitmap.height - size) / 2, size, size, 0, 0, 144, 144);
        const jpeg = canvas.toDataURL('image/jpeg', 0.72);
        if (jpeg.length > 22000) throw new Error('Photo too large');
        draftAvatar = jpeg;
      } finally { bitmap.close(); photo.value = ''; }
    });
  });
  find('[data-account-profile-form]').addEventListener('submit', async e => {
    e.preventDefault();
    if (!name.value.trim()) {
      name.setCustomValidity(words[language()].nameInvalid);
      name.reportValidity();
      return;
    }
    await perform('save', 'profileError', async () => {
      const payload = { name: name.value.trim() };
      if (draftAvatar !== undefined) payload.avatar = draftAvatar;
      await api('profile', payload);
      page = 'member';
      await checkSession();
      if (user) feedback = 'saved';
      if (dialog.open) find('#account-title').focus();
    });
  });
  find('[data-account-logout]').addEventListener('click', () => perform('logout', 'logoutError', async () => {
    await api('logout', {});
    setUser(null);
    page = 'guest';
    await checkSession();
    if (dialog.open) find('#account-title').focus();
  }));

  opener.addEventListener('click', () => {
    cartIntent = false;
    show();
    checkSession();
  });
  find('[data-account-retry]').addEventListener('click', () => { page = 'loading'; error = feedback = ''; render(); checkSession(); });
  find('[data-account-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    clearInterval(timer);
    feedback = error = '';
    cartIntent = false;
    if (page === 'profile' || page === 'code') page = user ? 'member' : 'guest';
    (previousFocus?.isConnected && previousFocus !== document.body ? previousFocus : opener).focus();
    render();
  });
  dialog.addEventListener('click', e => {
    if (e.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) dialog.close();
  });
  document.addEventListener('dvn:languagechange', render);
  window.addEventListener('pageshow', e => { if (e.persisted) checkSession(); });
  const url = new URL(location.href);
  const result = url.searchParams.get('login');
  if (result === 'complete' || result === 'failed') {
    url.searchParams.delete('login');
    history.replaceState(history.state, '', url);
    if (result === 'failed') error = 'denied';
    show();
  }
  render();
  checkSession();
})();
