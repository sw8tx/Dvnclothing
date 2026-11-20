const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

test('the retired discount email endpoint returns Gone without using D1 or sending email', async t => {
  const { onRequestPost } = await import('../functions/api/account/bonus-email.js');
  const send = t.mock.method(globalThis, 'fetch', () => assert.fail('unexpected network request'));
  const response = await onRequestPost({
    request: new Request('https://dvnclothing.com/api/account/bonus-email', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://dvnclothing.com' },
      body: JSON.stringify({ language: 'de' }),
    }),
    get env() { assert.fail('retired endpoint accessed service bindings'); },
  });
  assert.equal(response.status, 410);
  assert.match(response.headers.get('Cache-Control'), /no-store/);
  assert.equal(send.mock.callCount(), 0);
});

test('all storefront account dialogs keep email sign-in and discount code copying', () => {
  for (const file of ['index.html', 'impressum.html', 'terms.html', 'privacy.html']) {
    const html = readFileSync(require.resolve('../' + file), 'utf8');
    assert.match(html, /data-account-email-form/, file);
    assert.match(html, /data-account-bonus-copy/, file);
    assert.doesNotMatch(html, /data-account-bonus-email/, file);
  }
});
