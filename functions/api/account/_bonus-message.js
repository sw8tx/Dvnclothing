export function bonusMessage(code, percent, lang) {
  if (!/^DVN-(?:[A-Z2-9]{4}-){4}[A-Z2-9]{4}$/.test(code) || !Number.isInteger(percent) || percent <= 0 || percent > 100) {
    throw Error('Invalid bonus');
  }
  const en = lang === 'en';
  const title = en ? 'Your welcome bonus' : 'Dein Willkommensbonus';
  const intro = en
    ? `You asked us to send your code for ${percent}% off your first order.`
    : `Hier ist dein angeforderter Code für ${percent} % Rabatt auf deine erste Bestellung.`;
  const note = en ? 'You can also find the code in your DVN account.' : 'Du findest den Code auch in deinem DVN-Konto.';
  const site = 'https://dvnclothing.com';
  const imprint = en ? 'Legal notice' : 'Impressum';
  const privacy = en ? 'Privacy' : 'Datenschutz';
  const legal = site + '/impressum.html';
  const policy = site + '/privacy.html';
  const text = ['DVN CLOTHING', title, intro, code, note, site, 'service@dvnclothing.com',
    imprint + ' — ' + legal, privacy + ' — ' + policy].join('\n\n');
  const html = `<!doctype html><html lang="${en ? 'en' : 'de'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;background:#eeede9;color:#171715;font:15px/1.6 Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#eeede9"><tr><td align="center" style="padding:24px 10px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#ffffff" style="max-width:520px;">
<tr><td align="center" bgcolor="#111110" style="padding:22px;color:white;"><img src="${site}/assets/brand/dvn-mail-avatar.png" width="70" height="70" alt="DVN CLOTHING" style="display:block;border:0;"><strong style="font-size:12px;letter-spacing:2px;">DVN CLOTHING</strong></td></tr>
<tr><td style="padding:28px 20px;"><h1 style="margin:0;font:normal 32px/1.2 Georgia,serif;">${title}</h1><p>${intro}</p><p style="padding:18px 8px;text-align:center;background:#f2f1ed;font:bold 16px/1.5 'Courier New',monospace;overflow-wrap:anywhere;">${code}</p><p>${note}</p><a style="color:#171715;" href="${site}/">${en ? 'Visit DVN Clothing' : 'Zu DVN Clothing'}</a></td></tr>
<tr><td style="border-top:1px solid #deded9;padding:18px 20px;font-size:12px;color:#62625c;"><a style="color:#62625c;" href="mailto:service@dvnclothing.com">service@dvnclothing.com</a><br><a style="color:#62625c;" href="${legal}">${imprint}</a> &nbsp;·&nbsp; <a style="color:#62625c;" href="${policy}">${privacy}</a></td></tr>
</table></td></tr></table></body></html>`;
  return { subject: title + ' · DVN CLOTHING', text, html };
}
