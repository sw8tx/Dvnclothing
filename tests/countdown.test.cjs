const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

const source = readFileSync(require.resolve('../countdown.js'), 'utf8');
const html = readFileSync(require.resolve('../index.html'), 'utf8');
const dateTime = html.match(/<time datetime="([^"]+)">/)[1];
const target = Date.parse(dateTime);

function mount(now, date = dateTime) {
  function element() {
    const node = {
      children: [], attributes: {}, textContent: '', hidden: true,
      appendChild(child) { child.parent = this; this.children.push(child); },
      setAttribute(key, value) { this.attributes[key] = value; },
      replaceWith(child) {
        const index = this.parent.children.indexOf(this);
        child.parent = this.parent;
        this.parent.children[index] = child;
      },
      remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); },
      get lastElementChild() { return this.children.at(-1); },
    };
    return node;
  }
  const fields = Object.fromEntries(['days', 'hours', 'minutes', 'seconds'].map((id) => [id, element()]));
  const timer = element();
  const status = element();
  const state = { now, interval: null, cleared: false };
  const document = {
    hidden: false,
    getElementById: (id) => id === 'launch-status' ? status : fields[id],
    createElement: element,
    querySelector: (selector) => selector.includes(' time')
      ? { dateTime: date, textContent: 'Sonntag, 6. Dezember 2026' } : timer,
    addEventListener: (_, callback) => { state.visibility = callback; },
  };
  vm.runInNewContext(source, {
    document,
    Date: { parse: Date.parse, now: () => state.now },
    setInterval: (callback) => { state.interval = callback; return 1; },
    clearInterval: () => { state.cleared = true; },
  });
  return {
    fields, timer, status, state, document,
    values: () => Object.values(fields).map((field) => field.children.map((span) => span.textContent).join('')),
  };
}

test('uses Berlin launch midnight regardless of the visitor time zone', () => {
  assert.equal(new Date(target).toISOString(), '2026-12-05T23:00:00.000Z');
  const page = mount(target - (2 * 86400 + 3 * 3600 + 4 * 60 + 5) * 1000);
  assert.deepEqual(page.values(), ['2', '03', '04', '05']);
  assert.equal(page.status.hidden, true);
});

test('does not show zero or announce completion before the launch instant', () => {
  const page = mount(target - 1);
  assert.deepEqual(page.values(), ['0', '00', '00', '01']);
  assert.equal(page.status.hidden, true);
  page.state.now = target;
  page.state.interval();
  assert.deepEqual(page.values(), ['0', '00', '00', '00']);
  assert.equal(page.status.hidden, false);
  assert.equal(page.state.cleared, true);
});

test('opening after launch shows completion without starting an interval', () => {
  const page = mount(target + 60000);
  assert.deepEqual(page.values(), ['0', '00', '00', '00']);
  assert.equal(page.status.hidden, false);
  assert.equal(page.state.interval, null);
  assert.equal(page.timer.attributes['aria-label'], 'Launch-Zeitpunkt erreicht');
});

test('refreshes from the real clock after a suspended tab resumes', () => {
  const page = mount(target - 2 * 86400000);
  page.state.now = target - 65000;
  page.state.visibility();
  assert.deepEqual(page.values(), ['0', '00', '01', '05']);
});

test('leaves unchanged digits in place so they do not animate every tick', () => {
  const page = mount(target - 15000);
  const unchanged = page.fields.seconds.children[0];
  const changed = page.fields.seconds.children[1];
  page.state.now += 1000;
  page.state.interval();
  assert.equal(page.fields.seconds.children[0], unchanged);
  assert.notEqual(page.fields.seconds.children[1], changed);
});

test('an invalid date does not render NaN or start an interval', () => {
  const page = mount(target, 'invalid-date');
  assert.equal(page.state.interval, null);
  assert.equal(page.status.hidden, true);
});
