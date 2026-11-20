const site = 'https://dvnclothing.com';
const legal = {
  de: ['Impressum', 'Datenschutz'],
  en: ['Legal notice', 'Privacy'],
};
const captions = { de: 'Sprache', en: 'Language' };

const linkStyle = 'color:#666660;text-decoration:underline;text-underline-offset:3px';
const subtleLink = (url, label, attributes = '') => `<a href="${url}" ${attributes} style="${linkStyle}">${label}</a>`;

// The enhanced selectors require real radio inputs to survive the client's
// sanitizer. When the inputs or the styles are stripped, the normal links stay.
const enhancement = ['de', 'en'].map(locale => {
  const host = '.dvn-wrap:has(input#dvn-lang-de):has(input#dvn-lang-en)';
  const radio = host + ' > #dvn-lang-' + locale;
  const selected = radio + ':checked';
  return `
    ${selected} ~ .web-languages, ${selected} ~ .alternate-hint { display:none !important; }
    ${selected} ~ .mail-languages { display:block !important; }
    ${selected} ~ .copy-de, ${selected} ~ .copy-en { display:none !important; }
    ${selected} ~ .copy-${locale} { display:block !important; }
    ${selected} ~ .mail-languages .caption { display:none !important; }
    ${selected} ~ .mail-languages .caption-${locale} { display:inline !important; }
    ${selected} ~ .mail-languages label[for="dvn-lang-${locale}"] { font-weight:bold;text-decoration:underline; }
    ${radio}:focus-visible ~ .mail-languages label[for="dvn-lang-${locale}"] { outline:2px solid currentColor; }`;
}).join('\n');

export function renderMail({ kind, code, language, copy }) {
  const lang = language === 'en' ? 'en' : 'de';
  const other = lang === 'en' ? 'de' : 'en';
  const languages = [lang, other];
  const fallback = locale => site + '/mail/' + kind + '/' + locale;
  const translated = (render) => languages.map(locale => {
    const style = locale === lang ? '' : ' style="display:none;mso-hide:all"';
    return `<div lang="${locale}" class="copy-${locale}"${style}>${render(copy[locale], locale)}</div>`;
  }).join('\n');
  const text = [
    'DVN CLOTHING', copy[lang].title, copy[lang].intro, code, copy[lang].note,
    copy[other].title, copy[other].intro, copy[other].note,
    'Deutsch: ' + fallback('de'), 'English: ' + fallback('en'),
    'service@dvnclothing.com', 'Impressum / Legal notice: ' + site + '/impressum.html',
    'Datenschutz / Privacy: ' + site + '/privacy.html',
  ].join('\n\n');
  const html = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${copy[lang].subject}</title>
<style>
@supports selector(:has(input:checked)) {
  .dvn-wrap:has(#dvn-lang-de):has(#dvn-lang-en) .lang-input {
    display:block !important;position:absolute;width:1px;height:1px;overflow:hidden;
    padding:0;border:0;clip:rect(0,0,0,0);clip-path:inset(50%);
  }
  ${enhancement}
}
@media (prefers-color-scheme:dark) {
  .dvn-wrap { color:#f1f1ec !important; }
  .dvn-wrap a,.mail-languages { color:#bcbcb7 !important; }
  .dvn-wordmark { filter:invert(1); }
}
</style></head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 18px;">
<!--[if mso]><table role="presentation" width="480"><tr><td><![endif]-->
<div class="dvn-wrap" style="max-width:480px;margin:0 auto;text-align:left;color:#20201e;">
<img class="dvn-wordmark" src="${site}/assets/brand/dvn-mail-wordmark.png" width="132" alt="DVN CLOTHING" style="display:block;width:132px;max-width:100%;height:auto;margin:0 auto 28px;border:0;">
<!--[if !mso]><!-->
<input class="lang-input" type="radio" id="dvn-lang-de" name="dvn-language" style="display:none" ${lang === 'de' ? 'checked' : ''} aria-label="Deutsch">
<input class="lang-input" type="radio" id="dvn-lang-en" name="dvn-language" style="display:none" ${lang === 'en' ? 'checked' : ''} aria-label="English">
<div class="mail-languages" style="display:none;mso-hide:all;text-align:center;font-size:13px;line-height:24px;color:#666660;">
${languages.map(locale => `<span class="caption caption-${locale}" lang="${locale}" style="${locale !== lang ? 'display:none;' : ''}margin-right:8px;">${captions[locale]}</span>`).join('')}
<label for="dvn-lang-de" lang="de" title="Deutsch" style="cursor:pointer;padding:4px;">DE</label> / <label for="dvn-lang-en" lang="en" title="English" style="cursor:pointer;padding:4px;">EN</label>
</div>
<!--<![endif]-->
<div class="web-languages" style="text-align:center;font-size:13px;line-height:24px;">
<span style="margin-right:8px;">${captions[lang]}</span> ${subtleLink(fallback('de'), 'DE', 'lang="de" hreflang="de" aria-label="Deutsch"')} &nbsp;/&nbsp; ${subtleLink(fallback('en'), 'EN', 'lang="en" hreflang="en" aria-label="English"')}
</div>
${translated(item => `<h1 style="margin:32px 0 12px;font:500 28px/1.15 Arial,Helvetica,sans-serif;letter-spacing:-0.035em;">${item.title}</h1><p style="margin:0;font-size:15px;line-height:1.55;">${item.intro}</p>`)}
<p dir="ltr" style="margin:24px 0;font:600 ${kind === 'login' ? 30 : 17}px/1.4 Arial,Helvetica,sans-serif;font-variant-numeric:tabular-nums;letter-spacing:0.04em;overflow-wrap:anywhere;">${code}</p>
${translated(item => `<p style="margin:0;font-size:14px;line-height:1.65;">${item.note}</p>`)}
<p class="alternate-hint" lang="${other}" style="margin:16px 0 0;font-size:13px;line-height:1.6;">${copy[other].intro}</p>
<p style="margin:28px 0 0;font-size:12px;line-height:1.8;">${subtleLink('mailto:service@dvnclothing.com', 'service@dvnclothing.com')}</p>
${translated((item, locale) => `<p style="margin:4px 0;font-size:12px;line-height:1.8;">${subtleLink(site + '/impressum.html?lang=' + locale, legal[locale][0])} &nbsp;·&nbsp; ${subtleLink(site + '/privacy.html?lang=' + locale, legal[locale][1])}</p>`)}
</div>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;
  return { subject: copy[lang].subject, text, html };
}
