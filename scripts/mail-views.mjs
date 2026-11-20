import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { bonusLanguageView } from '../functions/api/account/_bonus-message.js';
import { signInLanguageView } from '../functions/api/auth/email/_message.js';
import { lifetime } from '../functions/api/auth/email/_shared.js';

const labels = {
  de: { language: 'Sprache', code: 'Dein persönlicher Code steht in der ursprünglichen E-Mail.', shop: 'Zum Shop', imprint: 'Impressum', privacy: 'Datenschutz' },
  en: { language: 'Language', code: 'Your personal code is in the original email.', shop: 'Visit the shop', imprint: 'Legal notice', privacy: 'Privacy' },
};

// These public pages contain the same instructions as the message. Recipient
// data, sign-in challenges and discount codes never enter a language URL.
export async function writeMailViews(output) {
  for (const kind of ['login', 'bonus']) {
    const directory = path.join(output, 'mail', kind);
    await mkdir(directory, { recursive: true });
    for (const lang of ['de', 'en']) {
      const text = kind === 'login' ? signInLanguageView(lang, lifetime) : bonusLanguageView(lang, 15);
      const ui = labels[lang];
      const navigation = ['de', 'en'].map(value =>
        `<a href="/mail/${kind}/${value}" lang="${value}" hreflang="${value}" aria-label="${value === 'de' ? 'Deutsch' : 'English'}"${value === lang ? ' aria-current="page"' : ''}>${value.toUpperCase()}</a>`
      ).join('<span aria-hidden="true">/</span>');
      const page = `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,follow">
  <meta name="color-scheme" content="light dark">
  <title>${text.title} · DVN Clothing</title>
  <link rel="stylesheet" href="/assets/brand/mail-view.css">
</head>
<body>
  <header><a href="/?lang=${lang}"><img src="/assets/brand/dvn-mail-wordmark.png" width="132" alt="DVN Clothing"></a></header>
  <main>
    <nav aria-label="${ui.language}"><span>${ui.language}</span> ${navigation}</nav>
    <h1>${text.title}</h1>
    <p>${text.intro}</p>
    <p class="original">${ui.code}</p>
    <p>${text.note}</p>
    <a class="shop" href="/?lang=${lang}">${ui.shop} <span aria-hidden="true">↗</span></a>
  </main>
  <footer><a href="mailto:service@dvnclothing.com">service@dvnclothing.com</a>
    <div><a href="/impressum.html?lang=${lang}">${ui.imprint}</a><a href="/privacy.html?lang=${lang}">${ui.privacy}</a></div>
  </footer>
</body></html>`;
      await writeFile(path.join(directory, lang + '.html'), page);
    }
  }
}
