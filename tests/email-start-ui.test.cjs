const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { setImmediate: nextTurn } = require('node:timers/promises');
const vm = require('node:vm');

const script = readFileSync(require.resolve('../auth.js'), 'utf8');
const requestedAt = Date.UTC(2026, 0, 22, 13, 20, 15);
class FixedDate extends Date {
  static now() { return requestedAt; }
}

class Element extends EventTarget {
  dataset = {};
  elements = new Map();
  value = '';
  textContent = '';

  querySelector(selector) {
    if (!this.elements.has(selector)) this.elements.set(selector, new Element());
    return this.elements.get(selector);
  }

  querySelectorAll() { return []; }
  setAttribute() {}
  removeAttribute() {}
  toggleAttribute() {}
  focus() {}
  showModal() { this.open = true; }
}

async function submitEmail(startResponse) {
  const document = new Element();
  const dialog = new Element();
  document.documentElement = { lang: 'de' };
  document.getElementById = id => id === 'account-dialog' ? dialog : null;
  const find = selector => dialog.querySelector(selector);
  const requests = [];
  async function fetch(url, options) {
    if (url === '/api/auth/session') {
      return Response.json({ configured: false, emailConfigured: true, user: null });
    }
    requests.push({ url, method: options.method, payload: JSON.parse(options.body) });
    return startResponse();
  }

  vm.runInNewContext(script, {
    document, window: new EventTarget(), location: new URL('https://example.test/'),
    URL, CustomEvent, AbortController, AbortSignal, fetch, Date: FixedDate,
    setTimeout, clearTimeout, setInterval() {}, clearInterval() {},
  });
  document.querySelector('[data-google-auth]').dispatchEvent(new Event('click'));
  await nextTurn();
  assert.equal(dialog.open, true);
  assert.equal(find('#account-mail').disabled, false);
  find('#account-mail').value = 'kunde@example.test';
  find('[data-account-email-form]').dispatchEvent(new Event('submit', { cancelable: true }));
  await nextTurn();
  assert.deepEqual(requests, [{
    url: '/api/auth/email/start', method: 'POST', payload: { email: 'kunde@example.test', language: 'de' },
  }]);
  return find;
}

function visibleError(find) {
  assert.equal(find('[data-account-guest]').hidden, false);
  assert.equal(find('[data-account-code-form]').hidden, true);
  assert.equal(find('[data-account-error]').hidden, false);
  assert.ok(find('[data-account-error]').textContent.trim());
  return find('[data-account-error]').textContent;
}

test('an acknowledged email request opens the code entry step', async () => {
  const find = await submitEmail(() => Response.json({ sent: true }, { status: 202 }));
  assert.equal(find('[data-account-code-form]').hidden, false);
  assert.equal(find('[data-account-error]').hidden, true);
  assert.match(find('#account-summary').textContent, /kunde@example\.test/);
});

test('successful HTTP statuses without affirmative acknowledgment keep the email form open', async () => {
  for (const response of [
    Response.json({ sent: false }, { status: 202 }),
    Response.json({ sent: 'true' }, { status: 202 }),
    Response.json({ accepted: true }, { status: 200 }),
    new Response(null, { status: 204 }),
    new Response('invalid json', { status: 202 }),
  ]) {
    visibleError(await submitEmail(() => response));
  }
});

test('the email provider quota is identified in the German form', async () => {
  const find = await submitEmail(() => Response.json({ error: 'delivery_quota' }, { status: 503 }));
  assert.match(visibleError(find), /Versandlimit/i);
});

test('a busy provider shows the retry time from its response header', async () => {
  const find = await submitEmail(() => Response.json({ error: 'delivery_busy' }, {
    status: 503, headers: { 'Retry-After': '73' },
  }));
  const nextAttempt = new Intl.DateTimeFormat('de-DE', { timeStyle: 'medium' }).format(requestedAt + 73000);
  assert.ok(visibleError(find).includes(nextAttempt));
});

test('timeouts and network failures report uncertainty about delivery', async () => {
  for (const failure of [new DOMException('Request timed out', 'TimeoutError'), new TypeError('Network offline')]) {
    const find = await submitEmail(() => { throw failure; });
    const message = visibleError(find);
    assert.match(message, /nicht bestätig|unklar|unbestätigt/i);
    assert.doesNotMatch(message, /wir haben (?:dir )?(?:einen|den) (?:anmelde)?code (?:gesendet|versendet)/i);
  }
});
