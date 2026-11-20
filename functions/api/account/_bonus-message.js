import { renderMail } from '../../_mail/template.js';

function messages(percent) {
  if (!Number.isInteger(percent) || percent <= 0 || percent > 100) throw new TypeError('Invalid bonus percentage');
  return {
    de: {
      subject: 'Dein Willkommensbonus · DVN CLOTHING', title: 'Dein Willkommensbonus',
      intro: `Hier ist dein Code für ${percent} % Rabatt auf deine erste Bestellung.`,
      note: 'Du findest deinen Code auch in deinem DVN-Konto.',
    },
    en: {
      subject: 'Your welcome bonus · DVN CLOTHING', title: 'Your welcome bonus',
      intro: `Here’s your code for ${percent}% off your first order.`,
      note: 'You can also find your code in your DVN account.',
    },
  };
}

export function bonusLanguageView(language, percent = 15) {
  return messages(percent)[language === 'en' ? 'en' : 'de'];
}

export function bonusMessage(code, percent, language) {
  if (!/^DVN-(?:[A-Z2-9]{4}-){4}[A-Z2-9]{4}$/.test(code)) throw new TypeError('Invalid bonus code');
  return renderMail({ kind: 'bonus', code: code, language, copy: messages(percent) });
}
