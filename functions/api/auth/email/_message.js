const site = 'https://dvnclothing.com';
const brand = 'DVN CLOTHING';
const content = {
  de: {
    subject: 'Dein DVN-Anmeldecode',
    title: 'Dein Anmeldecode',
    intro: 'Gib die sechs Ziffern in dem Browser ein, in dem du die Anmeldung angefordert hast.',
    validity: minutes => `Einmal verwendbar · ${minutes} Minuten gültig`,
    caution: 'Teile diesen Code mit niemandem. Falls du dich nicht anmelden wolltest, kannst du diese E-Mail ignorieren.',
    contact: 'Fragen zur Anmeldung?',
    imprint: 'Impressum',
    privacy: 'Datenschutz',
  },
  en: {
    subject: 'Your DVN sign-in code',
    title: 'Your sign-in code',
    intro: 'Enter the six digits in the browser where you requested your sign-in code.',
    validity: minutes => `Single use · Valid for ${minutes} minutes`,
    caution: 'Keep this code to yourself. If you didn’t request it, you can ignore this email.',
    contact: 'Questions about signing in?',
    imprint: 'Legal notice',
    privacy: 'Privacy',
  },
};

export function signInMessage(code, language, lifetimeSeconds) {
  if (!/^\d{6}$/.test(code)) throw new TypeError('Expected a six-digit code');
  const lang = language === 'en' ? 'en' : 'de';
  const copy = content[lang];
  const validity = copy.validity(Math.ceil(lifetimeSeconds / 60));
  const displayCode = 'DVN-' + code;
  const text = [
    brand, copy.title, displayCode, copy.intro, validity, copy.caution,
    copy.contact + ' service@dvnclothing.com',
    copy.imprint + ' — ' + site + '/impressum.html',
    copy.privacy + ' — ' + site + '/privacy.html',
  ].join('\n\n');
  const linkStyle = 'color:#63635e;text-decoration:underline;';
  const html = `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${copy.subject}</title>
</head>
<body style="margin:0;background:#eeede9;color:#171715;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${copy.title} · ${validity}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#eeede9">
    <tr><td align="center" style="padding:28px 12px;">
      <!--[if mso]><table role="presentation" width="520"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#ffffff" style="max-width:520px;margin:auto;">
        <tr><td align="center" bgcolor="#111110" style="padding:24px;">
          <img src="${site}/assets/brand/dvn-mail-avatar.png" alt="${brand}" width="72" height="72" style="display:block;border:0;color:#ffffff;">
          <div style="margin-top:8px;color:#fff;font-size:12px;font-weight:bold;letter-spacing:2px;">${brand}</div>
        </td></tr>
        <tr><td style="padding:32px 24px 20px;">
          <h1 style="margin:0 0 14px;color:#171715;font-family:Georgia,serif;font-size:34px;line-height:1.18;font-weight:normal;">${copy.title}</h1>
          <p style="margin:0 0 22px;font-size:15px;line-height:1.6;">${copy.intro}</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#f2f1ed">
            <tr><td align="center" style="padding:20px 6px 8px;font-family:'Courier New',monospace;font-size:28px;font-weight:bold;color:#101010;white-space:nowrap;">${displayCode}</td></tr>
            <tr><td align="center" style="padding:0 8px 19px;font-size:12px;color:#54544e;">${validity}</td></tr>
          </table>
          <p style="margin:22px 0 0;font-size:13px;line-height:1.6;color:#56564e;">${copy.caution}</p>
        </td></tr>
        <tr><td style="border-top:1px solid #e4e3de;padding:18px 24px 22px;font-size:12px;color:#63635e;line-height:1.8;">
          ${copy.contact} <a href="mailto:service@dvnclothing.com" style="${linkStyle}">service@dvnclothing.com</a><br>
          <a href="${site}/impressum.html" style="${linkStyle}">${copy.imprint}</a> &nbsp;·&nbsp;
          <a href="${site}/privacy.html" style="${linkStyle}">${copy.privacy}</a>
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
</body>
</html>`;
  return { subject: copy.subject, text, html };
}
