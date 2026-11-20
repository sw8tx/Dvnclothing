const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { setImmediate: nextTurn } = require('node:timers/promises');
const vm = require('node:vm');

const script = readFileSync(require.resolve('../auth.js'), 'utf8');
const requestedAt = Date.UTC(2026, 0, 22, 13, 20, 15);
// Advance browser timers deterministically, including the account's scheduled refresh.
function browserClock() {
  let now = requestedAt;
  let serial = 0;
  const active = new Map();
  function schedule(fn, delay, repeat) {
    const id = ++serial;
    active.set(id, { fn, at: now + delay, repeat });
    return id;
  }
  return {
    globals: {
      Date: class extends Date { static now() { return now; } },
      setTimeout: (fn, ms) => schedule(fn, ms, 0),
      setInterval: (fn, ms) => schedule(fn, ms, ms),
      clearTimeout: id => active.delete(id),
      clearInterval: id => active.delete(id),
    },
    async advance(ms) {
      const until = now + ms;
      while (true) {
        const next = [...active.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > until) break;
        const [id, timer] = next;
        now = timer.at;
        if (timer.repeat) timer.at += timer.repeat;
        else active.delete(id);
        timer.fn();
        await nextTurn();
      }
      now = until;
      await nextTurn();
    },
  };
}

class Element extends EventTarget {
  dataset = {};
  elements = new Map();
  classList = { toggle() {} };
  value = '';
  textContent = '';

  querySelector(selector) {
    if (!this.elements.has(selector)) this.elements.set(selector, new Element());
    return this.elements.get(selector);
  }

  querySelectorAll(selector) {
    if (selector !== '[data-account-copy]') return [];
    const title = this.querySelector('#account-bonus-title');
    title.dataset.accountCopy = 'bonusTitle';
    return [title];
  }
  replaceChildren() {}
  setAttribute() {}
  removeAttribute() {}
  toggleAttribute() {}
  focus() {}
  showModal() { this.open = true; }
}

async function mount({ lang = 'de', configured = false, user = null, handle } = {}) {
  const document = new Element();
  const dialog = new Element();
  const window = new EventTarget();
  const clock = browserClock();
  const session = { configured, emailConfigured: true, profileConfigured: true, user };
  document.documentElement = { lang };
  document.getElementById = id => id === 'account-dialog' ? dialog : null;
  const find = selector => dialog.querySelector(selector);
  const requests = [];
  async function fetch(url, options) {
    if (url === '/api/auth/session') return Response.json(session);
    const request = { url, method: options.method };
    if (options.body) request.payload = JSON.parse(options.body);
    requests.push(request);
    return handle(request);
  }
  vm.runInNewContext(script, {
    document, window, location: new URL('https://example.test/'),
    URL, CustomEvent, AbortController, AbortSignal, fetch, ...clock.globals,
  });
  document.querySelector('[data-google-auth]').dispatchEvent(new Event('click'));
  await nextTurn();
  assert.equal(dialog.open, true);
  return { find, requests, clock, dialog, window, session };
}

async function submitEmail(startResponse, options = {}) {
  const { find, requests } = await mount({ ...options, handle: startResponse });
  assert.equal(find('#account-mail').disabled, false);
  find('#account-mail').value = 'kunde@example.test';
  find('[data-account-email-form]').dispatchEvent(new Event('submit', { cancelable: true }));
  await nextTurn();
  assert.deepEqual(requests, [{
    url: '/api/auth/email/start', method: 'POST', payload: { email: 'kunde@example.test', language: options.lang || 'de' },
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

function serviceNotice(find) {
  assert.equal(find('[data-account-error]').hidden, true);
  const status = find('[data-account-mail-service]');
  assert.equal(status.hidden, false);
  assert.ok(status.textContent.trim());
  assert.doesNotMatch(status.textContent, /Tageslimit|Versandlimit|Kontingent|Quota|daily limit|sending limit/i);
  return status.textContent;
}

function temporary(error, at, retry) {
  return Response.json({ error }, {
    status: 503, headers: { Date: new Date(at).toUTCString(), 'Retry-After': String(retry) },
  });
}

function assertCalendar(message, language, when) {
  const locale = language === 'en' ? 'en-GB' : 'de-DE';
  const date = new Date(when);
  const day = new Intl.DateTimeFormat(locale, { day: 'numeric' }).format(date);
  const month = new Intl.DateTimeFormat(locale, { month: 'short' }).format(date).slice(0, 3);
  const numericMonth = String(date.getMonth() + 1);
  assert.match(message, new RegExp('\\b0?' + day + '\\b'));
  assert.match(message, new RegExp(month + '|[./]0?' + numericMonth + '(?:[./]|\\s)', 'i'));
  const clock = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date);
  assert.ok(message.includes(clock), 'expected ' + clock + ' in ' + message);
  assert.doesNotMatch(message, /\b\d{1,2}:\d{2}:\d{2}\b/);
}

for (const lang of ['de', 'en']) {
  test(lang + ' guest sees a dated service notice using the server clock; Google is conditional', async () => {
    const serverAt = requestedAt + (3 * 24 + 8) * 3600000;
    for (const configured of [false, true]) {
      const find = await submitEmail(() => temporary('store_daily_limit', serverAt, 18001), { lang, configured });
      const message = serviceNotice(find);
      assert.match(message, lang === 'de' ? /Anmeldecode/i : /sign-in code/i);
      assertCalendar(message, lang, serverAt + 18001000);
      assert.equal(/Google/i.test(message), configured);
      assert.equal(find('[data-account-guest]').hidden, false);
      assert.equal(find('[data-account-code-form]').hidden, true);
    }
  });
}

test('email provider quota uses a neutral service notice', async () => {
  const find = await submitEmail(() => Response.json({ error: 'delivery_quota' }, { status: 503 }));
  assert.match(serviceNotice(find), /später|erneut/i);
});

test('a busy provider shows a dated, minute-precision retry time inline', async () => {
  const serverAt = requestedAt + 37 * 3600000;
  const find = await submitEmail(() => temporary('delivery_busy', serverAt, 73));
  assertCalendar(serviceNotice(find), 'de', serverAt + 73000);
});

test('timeouts and network failures report uncertainty about delivery', async () => {
  for (const failure of [new DOMException('Request timed out', 'TimeoutError'), new TypeError('Network offline')]) {
    const find = await submitEmail(() => { throw failure; });
    const message = visibleError(find);
    assert.match(message, /nicht bestätig|unklar|unbestätigt/i);
    assert.doesNotMatch(message, /wir haben (?:dir )?(?:einen|den) (?:anmelde)?code (?:gesendet|versendet)/i);
  }
});

const member = { id: 'member-one', provider: 'google', name: 'Alex', email: 'alex@example.test' };
const issued = { code: 'DVN-BCDE-FGHJ-KLMN-PQRS-TUVW', percentOff: 15, firstOrderOnly: true };

function memberState(find, lang, pending) {
  assert.equal(find('[data-account-member]').hidden, false);
  assert.equal(find('[data-account-bonus]').hidden, false);
  assert.equal(find('#account-title').textContent, lang === 'de' ? 'Mein Konto' : 'My account');
  assert.match(find('#account-bonus-title').textContent, /15\s*%/);
  if (pending) {
    assert.equal(find('[data-account-bonus-row]').hidden, true);
    assert.equal(find('[data-account-bonus-code]').textContent, '');
    assert.equal(find('[data-account-bonus-email]').hidden, true);
  }
  assert.equal(find('[data-account-error]').hidden, true);
}

for (const lang of ['de', 'en']) {
  test(lang + ' signed-in customer keeps the bonus card while its code is pending until the stated reset', async () => {
    let available = false;
    const { find, requests, clock } = await mount({
      lang, configured: true, user: member,
      handle: () => available ? Response.json({ bonus: issued }) : temporary('bonus_quota', requestedAt, 120),
    });
    const methods = () => requests.map(({ url, method }) => [url, method]);
    assert.deepEqual(methods(), [['/api/account/bonus', 'GET']]);
    memberState(find, lang, true);
    const message = find('[data-account-bonus-description]').textContent;
    assert.match(message, lang === 'de' ? /Konto/ : /account/i);
    assert.doesNotMatch(message, /quota|Tageslimit|Google/i);
    assertCalendar(message, lang, requestedAt + 120000);
    assert.equal(find('[data-account-bonus-claim]').hidden, true);
    await clock.advance(119999);
    assert.equal(requests.length, 1);
    available = true;
    await clock.advance(1001);
    assert.deepEqual(methods(), [['/api/account/bonus', 'GET'], ['/api/account/bonus', 'GET']]);
    memberState(find, lang, false);
    assert.equal(find('[data-account-bonus-row]').hidden, false);
    assert.equal(find('[data-account-bonus-code]').textContent, issued.code);
  });
}

test('a transient error issuing a code keeps the account open and permits a deliberate retry', async () => {
  let available = false;
  const { find, requests } = await mount({
    user: member, handle: ({ method }) => {
      if (method === 'GET') return Response.json({ bonus: available ? issued : null });
      return Response.json({ error: 'bonus_unavailable' }, { status: 503 });
    },
  });
  memberState(find, 'de', true);
  assert.match(find('[data-account-bonus-description]').textContent, /erneut|später|noch einmal|wieder/i);
  assert.equal(find('[data-account-bonus-claim]').hidden, false);
  assert.deepEqual(requests.map(req => req.method), ['GET', 'POST']);
  available = true;
  find('[data-account-bonus-claim]').dispatchEvent(new Event('click'));
  await nextTurn();
  assert.deepEqual(requests.map(req => req.method), ['GET', 'POST', 'GET']);
  assert.equal(find('[data-account-bonus-code]').textContent, issued.code);
});

test('a restored browser page invalidates the previous member’s pending retry on account change', async () => {
  let otherAccount = false;
  const mounted = await mount({
    user: member,
    handle: () => otherAccount ? Response.json({ bonus: issued }) : temporary('bonus_quota', requestedAt, 120),
  });
  otherAccount = true;
  mounted.session.user = { ...member, id: 'member-two', email: 'two@example.test' };
  mounted.window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
  await nextTurn();
  assert.deepEqual(mounted.requests.map(req => req.method), ['GET', 'GET']);
  assert.equal(mounted.find('[data-account-bonus-code]').textContent, issued.code);
  await mounted.clock.advance(121000);
  assert.equal(mounted.requests.length, 2);
});
