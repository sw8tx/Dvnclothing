import { renderMail } from '../../../_mail/template.js';

function messages(lifetimeSeconds) {
  if (!Number.isFinite(lifetimeSeconds) || lifetimeSeconds <= 0) throw new TypeError('Invalid code lifetime');
  const minutes = Math.ceil(lifetimeSeconds / 60);
  return {
    de: {
      subject: 'Dein DVN-Anmeldecode', title: 'Dein Anmeldecode',
      intro: `Gib den Code in dem Browser ein, in dem du dich anmeldest. Er gilt ${minutes} Minuten.`,
      note: 'Behalte den Code für dich. Falls du ihn nicht angefordert hast, kannst du diese E-Mail ignorieren.',
    },
    en: {
      subject: 'Your DVN sign-in code', title: 'Your sign-in code',
      intro: `Enter this code in the browser where you’re signing in. It expires in ${minutes} minutes.`,
      note: 'Keep your code private. If you didn’t request it, you can ignore this email.',
    },
  };
}

export function signInLanguageView(language, lifetimeSeconds = 600) {
  return messages(lifetimeSeconds)[language === 'en' ? 'en' : 'de'];
}

export function signInMessage(code, language, lifetimeSeconds) {
  if (!/^\d{6}$/.test(code)) throw new TypeError('Expected a six-digit code');
  return renderMail({ kind: 'login', code: 'DVN-' + code, language, copy: messages(lifetimeSeconds) });
}
