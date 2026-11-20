const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

const shop = readFileSync(require.resolve('../shop.js'), 'utf8');
function element() {
  const listeners = {};
  const parts = new Map();
  return {
    children: [], dataset: {}, open: false,
    addEventListener(name, listener) { listeners[name] = listener; },
    fire(name, event = {}) { return listeners[name]?.(event); },
    querySelector(key) {
      if (!parts.has(key)) parts.set(key, element());
      return parts.get(key);
    },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    setAttribute() {},
    showModal() { this.open = true; }, close() { this.open = false; },
  };
}

function mount() {
  const document = element();
  const opener = element();
  const count = element();
  const window = element();
  document.documentElement = { lang: 'en' };
  document.createElement = element;
  document.querySelectorAll = (key) => ({
    '[data-open-bag]': [opener], '[data-bag-count]': [count]
  }[key] || []);
  const form = document.querySelector('#tee-form');
  form.elements = { size: { value: 'M' }, tone: { value: 'black' } };
  const storage = new Map();
  const localStorage = {
    getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value),
  };
  vm.runInNewContext(shop, { document, window, localStorage });
  const bag = document.querySelector('#tee-bag');
  const detail = document.querySelector('#tee-detail');
  async function submit() { detail.showModal(); await form.fire('submit', { preventDefault() {} }); }
  function account(id) { document.fire('dvn:authchange', { detail: { user: id ? { id } : null } }); }
  return { document, window, storage, bag, detail, submit, opener, count, account };
}

test('opening and adding fail closed with unavailable or unverified sessions', async () => {
  const view = mount();
  await view.opener.fire('click');
  assert.equal(view.bag.open, false);
  view.account('alice');
  let verified = 0;
  view.window.DVNAuth = { requireLogin: async () => { verified++; return false; } };
  await view.submit();
  await view.opener.fire('click');
  assert.equal(verified, 2);
  assert.equal(view.bag.open, false);
  assert.equal(view.storage.size, 0);
});

test('authenticated bags persist per account and disappear on sign-out', async () => {
  const view = mount();
  view.storage.set('dvn-studio-bag-v1', '[{"tone":"slate","size":"XL","qty":1}]');
  view.window.DVNAuth = { requireLogin: async () => true };
  view.account('alice');
  assert.equal(view.count.textContent, '0');
  await view.submit();
  assert.equal(view.count.textContent, '1');
  assert.equal(view.bag.open, true);
  view.account(null);
  assert.equal(view.count.textContent, '0');
  assert.equal(view.bag.open, false);
  view.account('bob');
  assert.equal(view.count.textContent, '0');
  await view.submit();
  await view.submit();
  assert.equal(view.count.textContent, '2');
  view.account('alice');
  assert.equal(view.count.textContent, '1');
});

test('an in-flight verification cannot add a previous user’s item to a different bag', async () => {
  const view = mount();
  let resolve;
  view.window.DVNAuth = { requireLogin: () => new Promise((done) => { resolve = done; }) };
  view.account('alice');
  const adding = view.submit();
  view.account('bob');
  resolve(true);
  await adding;
  assert.equal(view.count.textContent, '0');
  assert.equal(view.storage.size, 0);
});
