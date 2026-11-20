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
      sending: 'Code wird gesendet …', codeTitle: 'Prüfe dein Postfach', code: 'Wir haben einen Anmeldecode an {email} gesendet.',
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
      codeHint: 'Die sechs Ziffern eingeben oder den ganzen Code einfügen.', clock: 'Code gültig für {time}', timeout: 'Code abgelaufen. Bitte fordere einen neuen an.',
      verifiedTitle: 'Code bestätigt', verified: 'Dein Code wurde bestätigt. Lade deine Kontodaten erneut, um fortzufahren.', load: 'Kontodaten erneut laden', restart: 'Zur Anmeldung',
      connected: 'Du bist jetzt angemeldet.', emailMethod: 'Mit E-Mail verbunden', googleMethod: 'Mit Google verbunden', googleWithEmail: 'Mit Google angemeldet · E-Mail verknüpft', emailWithGoogle: 'Mit E-Mail angemeldet · Google verknüpft',
      profileOffline: 'Dein gespeichertes Profil ist gerade nicht verfügbar. Bitte versuche es noch einmal.', profileRetry: 'Profil erneut laden',
      bonusTitle: '15 % auf deine erste Bestellung', congrats: 'Glückwunsch und willkommen bei DVN!',
      bonusLink: 'Verknüpfe deine Anmeldemethoden, um deinen vorhandenen Code zu sehen.',
      sendBonus: 'Code per E-Mail erhalten', sendingBonus: 'Wird gesendet …', bonusSent: 'Dein Code wurde an {email} versendet.',
      bonusMailError: 'Dein Code konnte nicht per E-Mail gesendet werden. Bitte versuche es erneut.',
      bonusIssued: 'Dein persönlicher Willkommenscode', bonusLoading: 'Dein Willkommenscode wird geladen …',
      bonusOffline: 'Dein Willkommenscode ist gerade nicht verfügbar.', copyCode: 'Code kopieren', copied: 'Code kopiert', manualCopy: 'Wähle den Code aus und kopiere ihn.',
      linkGoogle: 'Google-Konto verbinden', linkEmail: 'E-Mail-Anmeldung verbinden', linked: 'Deine Anmeldemethoden sind verbunden.',
      linkConflict: 'Diese Anmeldemethode ist bereits mit einem anderen Konto verbunden.', linkFailed: 'Die Verbindung konnte nicht abgeschlossen werden.',
      linkAddress: 'Zur Bestätigung deiner E-Mail-Adresse haben wir einen Code an {email} gesendet.', backAccount: 'Zurück zum Konto',
      linkSelect: 'Bestätige die E-Mail-Adresse deines Google-Kontos.',
      linkSelectGmail: 'Nutze die Schreibweise deiner bisherigen DVN-Anmeldung, einschließlich der Groß- und Kleinbuchstaben.',
      linkMismatch: 'Gib dieselbe E-Mail-Adresse wie in deinem Google-Konto ein.',
      linkSend: 'Bestätigungscode senden',
      nameInvalid: 'Gib einen Anzeigenamen ein.'
    },
    en: {
      label: 'Sign in', eyebrow: 'DVN Account', close: 'Close', loading: 'Checking your sign-in status.',
      guestTitle: 'Welcome back', guest: 'Sign in to manage your bag and profile.',
      cart: 'Sign in to use your bag. You can then add your selection.',
      google: 'Continue with Google', googlePending: 'Google sign-in is being set up.', or: 'or',
      emailLabel: 'Email address', placeholder: 'you@example.com', send: 'Continue with email',
      mailHint: 'We’ll email you a one-time sign-in code.', mailPending: 'Email sign-in is being set up.',
      sending: 'Sending code …', codeTitle: 'Check your inbox', code: 'We sent a sign-in code to {email}.',
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
      codeHint: 'Enter the six digits or paste the full code.', clock: 'Code valid for {time}', timeout: 'Code expired. Request a new one.',
      verifiedTitle: 'Code verified', verified: 'Your code has been verified. Reload your account details to continue.', load: 'Reload account details', restart: 'Back to sign in',
      connected: 'You’re now signed in.', emailMethod: 'Connected with email', googleMethod: 'Connected with Google', googleWithEmail: 'Signed in with Google · Email linked', emailWithGoogle: 'Signed in with email · Google linked',
      profileOffline: 'Your saved profile is temporarily unavailable. Please try again.', profileRetry: 'Reload profile',
      bonusTitle: '15% off your first order', congrats: 'Congratulations and welcome to DVN!',
      bonusLink: 'Connect your sign-in methods to see your existing code.',
      sendBonus: 'Email me my code', sendingBonus: 'Sending …', bonusSent: 'Your code was sent to {email}.',
      bonusMailError: 'We couldn’t email your code. Please try again.',
      bonusIssued: 'Your personal welcome code', bonusLoading: 'Loading your welcome code …',
      bonusOffline: 'Your welcome code is temporarily unavailable.', copyCode: 'Copy code', copied: 'Code copied', manualCopy: 'Select the code and copy it.',
      linkGoogle: 'Connect Google account', linkEmail: 'Connect email sign-in', linked: 'Your sign-in methods are connected.',
      linkConflict: 'This sign-in method is already connected to another account.', linkFailed: 'We couldn’t connect your sign-in methods.',
      linkAddress: 'We sent a code to {email} to verify your email address.', backAccount: 'Back to account',
      linkSelect: 'Confirm the email address on your Google account.',
      linkSelectGmail: 'Enter the email address exactly as you used it to sign in to DVN, including capital letters.',
      linkMismatch: 'Use the same email address as your Google account.',
      linkSend: 'Send verification code',
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
  let expiresAt = 0;
  let linkFlow = false;
  let confirmed = false;
  let afterLogin = '';
  let bonusOwner = '';
  let bonusState = 'idle';
  let bonusCode = '';
  let bonusNotice = '';
  let bonusEmail = 'idle';
  let newBonus = false;
  let bonusRevision = 0;
  let draftAvatar;
  let previousFocus;
  const language = () => document.documentElement.lang === 'en' ? 'en' : 'de';
  const mail = find('#account-mail');
  const code = find('#account-code');
  const linkEmail = find('#account-link-email');
  const name = find('#account-display-name');
  const photo = find('#account-photo');

  function setUser(next) {
    const changed = !sessionKnown || JSON.stringify(user) !== JSON.stringify(next);
    if ((next?.id || '') !== bonusOwner || next?.linkedProviders?.join(',') !== user?.linkedProviders?.join(',')) {
      bonusRevision++;
      bonusOwner = next?.id || '';
      bonusCode = bonusNotice = '';
      bonusState = bonusEmail = 'idle';
      newBonus = false;
    }
    user = next;
    sessionKnown = true;
    if (changed) document.dispatchEvent(new CustomEvent('dvn:authchange', { detail: { user } }));
  }

  function avatar(target, picture) {
    if (target.dataset.picture === picture) return;
    target.dataset.picture = picture;
    target.replaceChildren();
    let safe = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/i.test(picture);
    if (!safe && picture) {
      try {
        const url = new URL(picture);
        safe = url.protocol === 'https:' && url.hostname.endsWith('.googleusercontent.com');
      } catch { /* The local DVN emblem remains visible. */ }
    }
    if (!safe) return;
    const img = new Image();
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => img.remove(), { once: true });
    img.src = picture;
    target.append(img);
  }

  function renderClock() {
    const t = words[language()];
    const seconds = Math.max(0, Math.ceil((resendAt - Date.now()) / 1000));
    const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
    const time = Math.floor(remaining / 60) + ':' + String(remaining % 60).padStart(2, '0');
    find('[data-account-clock]').textContent = remaining ? t.clock.replace('{time}', time) : t.timeout;
    const resend = find('[data-account-resend]');
    resend.textContent = seconds ? t.wait.replace('{s}', seconds) : t.resend;
    resend.disabled = Boolean(action) || seconds > 0;
    find('[data-account-verify]').disabled = Boolean(action) || !remaining;
    if (!remaining && !seconds) clearInterval(timer);
  }

  function renderBonus() {
    const t = words[language()];
    const visible = page === 'member' && Boolean(user?.id);
    find('[data-account-bonus]').hidden = !visible;
    if (!visible) return;
    const issued = bonusState === 'issued';
    const failed = bonusState === 'failed';
    const claim = find('[data-account-bonus-claim]');
    find('[data-account-bonus-congrats]').hidden = !issued || !newBonus;
    find('[data-account-bonus-description]').textContent = issued ? t.bonusIssued : failed ? t.bonusOffline : bonusState === 'linkNeeded' ? t.bonusLink : t.bonusLoading;
    find('[data-account-bonus-row]').hidden = !issued;
    find('[data-account-bonus-code]').textContent = bonusCode;
    claim.hidden = !failed;
    claim.textContent = t.retry;
    const emailButton = find('[data-account-bonus-email]');
    emailButton.hidden = !issued;
    emailButton.disabled = bonusEmail === 'sending' || bonusEmail === 'sent';
    emailButton.textContent = bonusEmail === 'sending' ? t.sendingBonus : t.sendBonus;
    const status = find('[data-account-bonus-email-status]');
    status.hidden = !issued || !['sent', 'failed'].includes(bonusEmail);
    status.textContent = bonusEmail === 'sent' ? t.bonusSent.replace('{email}', user.email) : bonusEmail === 'failed' ? t.bonusMailError : '';
    find('[data-account-bonus-copy]').textContent = bonusNotice === 'copied' ? t.copied : t.copyCode;
    find('[data-account-bonus-live]').textContent = t[bonusNotice] || '';
    find('[data-account-bonus-live]').classList.toggle('visually-hidden', bonusNotice !== 'manualCopy');
  }

  async function readBonus(method) {
    const response = await fetch('/api/account/bonus', { method, credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Bonus unavailable');
    return data.bonus;
  }

  async function fetchBonus() {
    const revision = bonusRevision;
    if (!bonusOwner || bonusState === 'loading') return;
    bonusState = 'loading';
    renderBonus();
    try {
      let bonus = await readBonus('GET');
      if (revision !== bonusRevision) return;
      if (bonus === null) {
        bonus = await readBonus('POST');
        if (revision !== bonusRevision) return;
        newBonus = true;
      }
      if (bonus?.percentOff !== 15 || bonus.firstOrderOnly !== true || typeof bonus.code !== 'string' || !bonus.code.length) throw new Error('Invalid bonus');
      bonusCode = bonus.code;
      bonusState = 'issued';
    } catch (err) {
      if (revision !== bonusRevision) return;
      bonusState = err.message === 'account_link_required' ? 'linkNeeded' : 'failed';
    }
    renderBonus();
  }

  function render() {
    const t = words[language()];
    dialog.querySelectorAll('[data-account-copy]').forEach(el => { el.textContent = t[el.dataset.accountCopy]; });
    dialog.dataset.view = page;
    const title = page === 'linkEmail' ? t.linkEmail : page === 'recover' ? t.verifiedTitle : page === 'member' ? t.memberTitle : page === 'profile' ? t.edit : page === 'code' ? t.codeTitle : t.guestTitle;
    find('#account-title').textContent = title;
    const summaries = { linkEmail: /@(?:gmail|googlemail)\.com$/i.test(user?.email) ? t.linkSelectGmail : t.linkSelect, loading: t.loading, error: t.sessionError, guest: cartIntent ? t.cart : t.guest, member: t.member, profile: t.profile, recover: t.verified, code: (linkFlow ? t.linkAddress : t.code).replace('{email}', email) };
    find('#account-summary').textContent = summaries[page];
    find('[data-account-close]').setAttribute('aria-label', t.close);
    opener.setAttribute('aria-label', user ? t.memberTitle + ' · ' + (user.name || user.email) : t.label);
    opener.querySelector('[data-account-label]').textContent = user?.name || t.label;
    opener.querySelector('svg').toggleAttribute('hidden', Boolean(user));
    const headerAvatar = opener.querySelector('[data-header-avatar]');
    headerAvatar.hidden = !user;
    if (user) avatar(headerAvatar, user.picture || '');
    find('[data-account-link-form]').hidden = page !== 'linkEmail';
    find('[data-account-link-submit]').textContent = action === 'send' ? t.sending : t.linkSend;
    find('[data-account-link-submit]').disabled = linkEmail.disabled = Boolean(action);
    find('[data-account-link-cancel]').disabled = Boolean(action);
    find('[data-account-guest]').hidden = page !== 'guest';
    find('[data-account-code-form]').hidden = page !== 'code';
    find('[data-account-profile-form]').hidden = page !== 'profile';
    find('[data-account-member]').hidden = page !== 'member';
    const retry = find('[data-account-retry]');
    retry.textContent = page === 'recover' ? t.load : t.retry;
    find('[data-account-restart]').hidden = page !== 'recover';
    retry.hidden = page !== 'recover' && page !== 'error' && !(page === 'guest' && !session.configured && !session.emailConfigured);
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
    renderClock();
    find('[data-account-back]').textContent = linkFlow ? t.backAccount : t.changeEmail;
    find('[data-account-back]').disabled = Boolean(action);
    find('[data-account-verify]').textContent = action === 'verify' ? t.checking : t.verify;
    code.disabled = Boolean(action);
    const alert = find('[data-account-error]');
    alert.hidden = !error;
    alert.textContent = t[error] || '';
    const confirmation = find('[data-account-feedback]');
    confirmation.hidden = !feedback;
    confirmation.textContent = t[feedback] || '';
    find('[data-account-profile-status]').hidden = Boolean(session.profileConfigured);
    find('[data-account-profile-retry]').hidden = Boolean(session.profileConfigured);
    find('[data-account-edit]').hidden = !session.profileConfigured;
    find('[data-account-logout]').textContent = action === 'logout' ? t.leaving : t.logout;
    dialog.querySelectorAll('[data-account-edit], [data-account-logout], [data-account-save], [data-account-cancel], #account-photo, #account-display-name, [data-remove-photo]').forEach(el => { el.disabled = Boolean(action); });
    find('[data-account-save]').textContent = action === 'save' ? t.saving : t.save;
    if (user) {
      const display = user.name || user.email;
      const methods = user.linkedProviders || [user.provider];
      const google = methods.includes('google');
      let connected = google ? t.googleMethod : t.emailMethod;
      if (google && methods.includes('email')) connected = user.provider === 'google' ? t.googleWithEmail : t.emailWithGoogle;
      find('[data-account-provider]').textContent = connected;
      find('[data-edit-provider]').textContent = connected;
      find('[data-edit-email]').textContent = user.email;
      const link = find('[data-account-link]');
      link.hidden = !session.profileConfigured || (google ? methods.includes('email') || !session.emailConfigured : !session.configured);
      link.disabled = Boolean(action);
      link.textContent = google ? t.linkEmail : t.linkGoogle;
      find('[data-account-name]').textContent = display;
      find('[data-account-email]').textContent = user.email;
      avatar(find('[data-dialog-avatar]'), user.picture || '');
      const editPicture = draftAvatar ?? user.picture ?? '';
      avatar(find('[data-edit-avatar]'), editPicture);
      find('[data-remove-photo]').hidden = !editPicture;
    }
    renderBonus();
  }

  async function api(path, body) {
    const options = { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) };
    if (body !== undefined) Object.assign(options, { method: 'POST', body: JSON.stringify(body) });
    if (body !== undefined) options.headers['Content-Type'] = 'application/json';
    const response = await fetch('/api/auth/' + path, options);
    if (!response.ok) {
      throw Object.assign(new Error('Account request failed'), { status: response.status });
    }
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
        if (linkFlow && !confirmed && next?.id !== previous) {
          linkFlow = false;
          code.value = '';
          email = '';
          clearInterval(timer);
          page = 'loading';
        }
        setUser(next);
        if (next) {
          if (next.id !== previous || (page !== 'profile' && !(['linkEmail', 'code'].includes(page) && linkFlow)) || confirmed) page = 'member';
          if (confirmed || afterLogin) feedback = afterLogin || 'connected';
          confirmed = false;
          afterLogin = '';
          if (page === 'member' && dialog.open && bonusState === 'idle') fetchBonus();
        } else if (confirmed) {
          page = 'recover';
        } else if (page !== 'code' || !session.emailConfigured || linkFlow) {
          page = 'guest';
        }
      } catch {
        session = {};
        setUser(null);
        page = confirmed ? 'recover' : 'error';
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
    if (page === 'code') { clearInterval(timer); timer = setInterval(renderClock, 1000); }
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
      if (err.status === 409 && page === 'linkEmail' && nextAction === 'send') {
        error = 'linkMismatch';
      } else if (err.status === 409) {
        error = 'linkConflict';
        if (linkFlow && user) {
          linkFlow = false;
          page = 'member';
          clearInterval(timer);
          code.value = '';
        }
      }
      else if (err.status === 503 && nextAction === 'save') error = 'profileOffline';
      else if (err.status === 429) error = 'limit';
      else if (err.status === 400 && nextAction === 'verify') error = 'invalidCode';
      else if (err.status === 401 && nextAction === 'save') { await checkSession(); error = 'expired'; }
      else error = errorKey;
    } finally {
      action = '';
      render();
    }
  }

  async function sendCode(resending) {
    const target = resending ? email : (linkFlow ? linkEmail : mail).value.trim();
    if (!target) return;
    await perform('send', 'sendError', async () => {
      const payload = { email: target, language: language() };
      if (linkFlow) payload.purpose = 'link';
      await api('email/start', payload);
      email = target;
      const now = Date.now();
      resendAt = now + 60000;
      expiresAt = now + 600000;
      clearInterval(timer);
      if (dialog.open) timer = setInterval(renderClock, 1000);
      page = 'code';
      code.value = '';
      if (resending) feedback = 'resent';
    });
    if (page === 'code' && dialog.open) code.focus();
    else if (page !== 'linkEmail') linkFlow = false;
  }

  function digits(value) {
    return value.trim().replace(/^DVN\s*[-–—]?\s*/i, '').replace(/[^0-9]/g, '').slice(0, 6);
  }
  code.addEventListener('input', () => { code.value = digits(code.value); });
  code.addEventListener('paste', event => {
    const text = event.clipboardData?.getData('text');
    if (!text || !/^\s*(?:DVN\s*[-–—]?\s*)?[0-9](?:[\s-]*[0-9]){5}\s*$/i.test(text)) return;
    event.preventDefault();
    code.value = digits(text);
  });
  find('[data-account-link-form]').addEventListener('submit', e => {
    e.preventDefault();
    if (linkFlow && user?.provider === 'google') sendCode(false);
  });
  find('[data-account-link-cancel]').addEventListener('click', () => {
    linkFlow = false;
    page = 'member';
    feedback = error = '';
    render();
    find('[data-account-link]').focus();
  });
  find('[data-account-email-form]').addEventListener('submit', e => { e.preventDefault(); sendCode(false); });
  find('[data-account-resend]').addEventListener('click', () => sendCode(true));
  find('[data-account-back]').addEventListener('click', () => { clearInterval(timer); page = linkFlow && user ? 'member' : 'guest'; linkFlow = false;
    feedback = error = ''; render(); (page === 'member' ? find('[data-account-link]') : mail).focus(); });
  find('[data-account-code-form]').addEventListener('submit', async e => {
    e.preventDefault();
    await perform('verify', 'verifyError', async () => {
      await api('email/verify', { code: digits(code.value) });
      confirmed = true;
      afterLogin = linkFlow ? 'linked' : 'connected';
      linkFlow = false;
      clearInterval(timer);
      page = 'loading';
      code.value = '';
      await checkSession();
      cartIntent = false;
      mail.value = email = '';
      if (dialog.open) find('#account-title').focus();
    });
    if (page === 'code' && dialog.open) { code.focus(); code.select(); }
  });

  find('[data-account-bonus-claim]').addEventListener('click', fetchBonus);
  find('[data-account-bonus-email]').addEventListener('click', async () => {
    if (!user || bonusState !== 'issued' || bonusEmail === 'sending' || bonusEmail === 'sent') return;
    const revision = bonusRevision;
    bonusEmail = 'sending';
    renderBonus();
    try {
      const response = await fetch('/api/account/bonus-email', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000),
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: language() })
      });
      if (!response.ok || (await response.json()).sent !== true) throw new Error('Bonus email unavailable');
      if (revision === bonusRevision) bonusEmail = 'sent';
    } catch {
      if (revision === bonusRevision) bonusEmail = 'failed';
    }
    renderBonus();
  });
  find('[data-account-bonus-copy]').addEventListener('click', async () => {
    if (!bonusCode || !user) return;
    const owner = bonusOwner;
    try {
      await navigator.clipboard.writeText(bonusCode);
      if (owner !== bonusOwner) return;
      bonusNotice = 'copied';
    } catch {
      if (owner !== bonusOwner) return;
      const range = document.createRange();
      range.selectNodeContents(find('[data-account-bonus-code]'));
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      bonusNotice = 'manualCopy';
    }
    renderBonus();
  });
  find('[data-account-link]').addEventListener('click', () => {
    if (!user) return;
    if (user.provider === 'google') {
      linkFlow = true;
      linkEmail.value = user.email;
      page = 'linkEmail';
      feedback = error = '';
      render();
      linkEmail.focus();
    } else {
      perform('link', 'linkFailed', async () => {
        const result = await api('start', { action: 'linkGoogle' });
        const destination = new URL(result.url);
        if (destination.origin !== 'https://accounts.google.com') throw new Error('Unexpected destination');
        location.assign(destination.href);
      });
    }
  });
  find('[data-account-profile-retry]').addEventListener('click', () => perform('refresh', 'profileOffline', checkSession));
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
    linkFlow = false;
    page = 'guest';
    await checkSession();
    if (dialog.open) find('#account-title').focus();
  }));

  opener.addEventListener('click', () => {
    cartIntent = false;
    show();
    checkSession();
  });
  find('[data-account-restart]').addEventListener('click', () => {
    confirmed = false; afterLogin = ''; feedback = error = ''; page = 'guest'; checkSession();
  });
  find('[data-account-retry]').addEventListener('click', () => { page = 'loading'; error = feedback = ''; render(); checkSession(); });
  find('[data-account-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    clearInterval(timer);
    feedback = error = '';
    cartIntent = false;
    if (page === 'profile') page = user ? 'member' : 'guest';
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
  if (['complete', 'failed', 'linked', 'link_failed', 'link_conflict'].includes(result)) {
    url.searchParams.delete('login');
    history.replaceState(history.state, '', url);
    error = ({ failed: 'denied', link_failed: 'linkFailed', link_conflict: 'linkConflict' })[result] || '';
    afterLogin = ({ complete: 'connected', linked: 'linked' })[result] || '';
    show();
  }
  render();
  checkSession();
})();
