const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

const translations = readFileSync(require.resolve('../translations.js'), 'utf8');
const source = readFileSync(require.resolve('../i18n.js'), 'utf8');

function mount(storage = new Map()) {
  const text = { dataset: { i18n: 'footer.imprint' } };
  const title = { dataset: { i18n: 'page.imprint' } };
  const meta = { dataset: { i18nContent: 'meta.description' }, setAttribute(key, value) { this[key] = value; } };
  const label = { dataset: { i18nAria: 'nav.language' }, setAttribute(key, value) { this[key] = value; } };
  const date = { dateTime: '2026-12-06T00:00:00+01:00' };
  const flags = ['de', 'en'].map((language) => ({ dataset: { languageCurrent: language } }));
  const buttons = ['de', 'en'].map((language) => ({
    dataset: { language },
    setAttribute(key, value) { this[key] = value; },
    addEventListener(_, action) { this.click = action; },
  }));
  const state = { focused: false, listeners: {}, events: [] };
  const menu = { hidden: true, open: true, contains: () => false, querySelector: () => ({ focus() { state.focused = true; } }) };
  const selectors = {
    '[data-i18n]': [text, title], '[data-i18n-aria]': [label], '[data-i18n-content]': [meta],
    '[data-language-current]': flags, '[data-language]': buttons, '[data-launch-date]': [date],
  };
  const document = {
    documentElement: {},
    querySelector: () => menu,
    querySelectorAll: (selector) => selectors[selector] || [],
    dispatchEvent: (event) => state.events.push(event),
    addEventListener: (name, action) => { state.listeners[name] = action; },
  };
  const context = {
    document,
    localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    CustomEvent: function (type, options) { this.type = type; this.detail = options.detail; },
  };
  vm.runInNewContext(translations, context);
  vm.runInNewContext(source, context);
  return { document, context, text, title, meta, label, date, flags, buttons, state, menu };
}

test('the flag picker translates content, metadata, date and accessibility labels', () => {
  const page = mount();
  assert.equal(page.menu.hidden, false);
  assert.equal(page.document.documentElement.lang, 'de');
  page.buttons[1].click();
  assert.equal(page.document.documentElement.lang, 'en');
  assert.equal(page.text.textContent, 'Legal notice');
  assert.equal(page.title.textContent, 'Legal notice – DVN CLOTHING');
  assert.equal(page.label['aria-label'], 'Choose language');
  assert.equal(page.meta.content, page.context.DVN_TRANSLATIONS.en['meta.description']);
  assert.notEqual(page.meta.content, page.context.DVN_TRANSLATIONS.de['meta.description']);
  assert.match(page.date.textContent, /Sunday, 6 December 2026/);
  assert.equal(page.flags[1].hidden, false);
  assert.equal(page.flags[0].hidden, true);
  assert.equal(page.buttons[1]['aria-pressed'], 'true');
  assert.equal(page.menu.open, false);
  assert.equal(page.state.focused, true);
  assert.equal(page.state.events.at(-1).type, 'dvn:languagechange');
});

test('the saved language survives navigation and can be switched back', () => {
  const storage = new Map();
  mount(storage).buttons[1].click();
  const nextPage = mount(storage);
  assert.equal(nextPage.document.documentElement.lang, 'en');
  nextPage.buttons[0].click();
  assert.equal(nextPage.text.textContent, 'Impressum');
  assert.equal(storage.get('dvn-language'), 'de');
});

test('blocked browser storage does not prevent language switching', () => {
  const storage = { get() { throw Error('blocked'); }, set() { throw Error('blocked'); } };
  const page = mount(storage);
  page.buttons[1].click();
  assert.equal(page.document.documentElement.lang, 'en');
});

test('invalid saved choices use German and Escape closes the picker', () => {
  const page = mount(new Map([['dvn-language', 'fr']]));
  assert.equal(page.document.documentElement.lang, 'de');
  page.context.DVNLocale.setLanguage('invalid');
  assert.equal(page.document.documentElement.lang, 'de');
  page.menu.open = true;
  page.state.listeners.keydown({ key: 'Escape' });
  assert.equal(page.menu.open, false);
  assert.equal(page.state.focused, true);
});

test('all translation hooks on all three pages have both languages', () => {
  const context = {};
  vm.runInNewContext(translations, context);
  const copy = context.DVN_TRANSLATIONS;
  assert.deepEqual(Object.keys(copy.de).sort(), Object.keys(copy.en).sort());
  for (const file of ['index.html', 'impressum.html', 'terms.html']) {
    const html = readFileSync(require.resolve('../' + file), 'utf8');
    for (const [, key] of html.matchAll(/data-i18n(?:-aria|-content)?="([^"]+)"/g)) {
      assert.ok(copy.de[key], `Missing German translation ${file}: ${key}`);
      assert.ok(copy.en[key], `Missing English translation ${file}: ${key}`);
    }
  }
});
