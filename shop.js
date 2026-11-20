(() => {
  'use strict';

  const tones = { black: 'Ink Black', chalk: 'Chalk', slate: 'Slate' };
  const sizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
  const copy = {
    de: {
      preview: 'Kollektionsvorschau', collection: 'Die Studio Tees.', bag: 'Warenkorb',
      black: 'Schwarzer Rundhals mit weißem DVN-Emblem auf der Vorderseite. Das große Rückenmotiv greift unseren Schriftzug auf.',
      chalk: 'Helles Kreideweiß mit schwarzem DVN-Schriftzug auf der Vorderseite. Eine klare Grafik auf einem weit geschnittenen Tee.',
      slate: 'Ein schiefergraues T-Shirt mit kleinem weißen DVN-Schriftzug auf der linken Brust und locker fallenden Ärmeln.',
      color: 'Farbe', size: 'Größe', add: 'In den Warenkorb', close: 'Schließen',
      note: 'Shop-Vorschau. Preise folgen zum Launch.', empty: 'Dein Warenkorb ist leer.',
      saved: 'Deine Auswahl wird für dein Konto in diesem Browser gespeichert. Bestellungen sind zum Launch geplant.',
      temporary: 'Deine Auswahl bleibt bis zum Schließen dieser Seite erhalten.',
      remove: 'Entfernen', more: 'Menge erhöhen', less: 'Menge verringern', browse: 'Kollektion ansehen'
    },
    en: {
      preview: 'Collection preview', collection: 'The Studio Tees.', bag: 'Shopping bag',
      black: 'A black crewneck with a white DVN emblem on the front. The large back print features our signature wordmark.',
      chalk: 'Chalk white with a black DVN wordmark across the front. A clean graphic on a roomy tee.',
      slate: 'A slate-grey tee with a small white DVN wordmark on the left chest and relaxed sleeves.',
      color: 'Colour', size: 'Size', add: 'Add to bag', close: 'Close',
      note: 'Shop preview. Prices will be available at launch.', empty: 'Your bag is empty.',
      saved: 'Your selection is saved for your account in this browser. Ordering is planned for launch.',
      temporary: 'Your selection will last until you close this page.',
      remove: 'Remove', more: 'Increase quantity', less: 'Decrease quantity', browse: 'View collection'
    }
  };
  // Anonymous v1 bags have no owner and must never be assigned to an account.
  const bagPrefix = 'dvn-studio-bag-v2:';
  const detail = document.querySelector('#tee-detail');
  const bag = document.querySelector('#tee-bag');
  const form = document.querySelector('#tee-form');
  const bagLines = document.querySelector('#tee-bag-lines');
  let canSave = true;
  let selection = [];
  let owner = null;
  let identityVersion = 0;
  let verifying = false;

  function storageKey() {
    return owner ? bagPrefix + encodeURIComponent(owner) : null;
  }

  function switchAccount(user) {
    const id = typeof user?.id === 'string' && user.id ? user.id : null;
    if (id === owner) return;
    owner = id;
    identityVersion++;
    canSave = true;
    if (bag.open) bag.close();
    selection = owner ? readSelection() : [];
    updateBag();
  }

  async function allowBagAction() {
    if (verifying) return false;
    verifying = true;
    const previousOwner = owner;
    const previousVersion = identityVersion;
    try {
      if (!await window.DVNAuth?.requireLogin?.()) return false;
      // A verification started by one account must not mutate a newer account.
      return Boolean(owner) && (!previousOwner || previousVersion === identityVersion);
    } catch {
      return false;
    } finally {
      verifying = false;
    }
  }

  function words() {
    return copy[document.documentElement.lang] || copy.de;
  }

  function readSelection() {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey()) || '[]');
      if (!Array.isArray(stored)) return [];
      const unique = new Map();
      for (const line of stored) {
        if (!line || !Object.hasOwn(tones, line.tone) || !sizes.includes(line.size)) continue;
        if (!Number.isInteger(line.qty) || line.qty < 1) continue;
        const key = line.tone + '-' + line.size;
        unique.set(key, { tone: line.tone, size: line.size, qty: Math.min(99, line.qty) });
      }
      return Array.from(unique.values());
    } catch {
      return [];
    }
  }

  function save() {
    if (!owner) return;
    try {
      localStorage.setItem(storageKey(), JSON.stringify(selection));
    } catch {
      canSave = false;
    }
    updateBag();
  }

  function node(tag, className, value) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (value !== undefined) element.textContent = value;
    return element;
  }

  function radioGroup(container, name, choices, tonePicker = false) {
    for (const [key, labelText] of choices) {
      const label = node('label', tonePicker ? 'tee-color-option tone-' + key : 'tee-size-option');
      const radio = node('input');
      radio.type = 'radio';
      radio.name = name;
      radio.value = key;
      radio.required = true;
      const text = node('span', tonePicker ? 'tee-sr-only' : '', labelText);
      label.append(radio);
      if (tonePicker) label.append(node('i'));
      label.append(text);
      container.append(label);
    }
  }

  function changeTone() {
    const tone = form.elements.tone.value;
    const img = detail.querySelector('img');
    img.src = '/assets/shop/' + tone + '.webp';
    img.alt = 'DVN Studio Tee · ' + tones[tone];
    detail.querySelector('#tee-current-color').textContent = tones[tone];
    detail.querySelector('.tee-description').textContent = words()[tone];
  }

  function openProduct(tone) {
    form.reset();
    form.elements.tone.value = tone;
    changeTone();
    detail.showModal();
  }

  function setLanguage() {
    const text = words();
    document.querySelectorAll('[data-shop-copy]').forEach((el) => {
      el.textContent = text[el.dataset.shopCopy];
    });
    document.querySelectorAll('[data-shop-label]').forEach((el) => {
      el.setAttribute('aria-label', text[el.dataset.shopLabel]);
    });
    if (form.elements.tone.value) changeTone();
    updateBag();
  }

  function quantityButton(action, display, label) {
    const button = node('button', 'tee-quantity-action', display);
    button.type = 'button';
    button.dataset.bagAction = action;
    button.setAttribute('aria-label', label);
    return button;
  }

  function renderLine(line) {
    const text = words();
    const row = node('div', 'tee-bag-line');
    row.dataset.tone = line.tone;
    row.dataset.size = line.size;
    const photo = node('img');
    photo.src = '/assets/shop/' + line.tone + '.webp';
    photo.alt = '';
    const info = node('div', 'tee-line-info');
    const variant = tones[line.tone] + ' · ' + line.size;
    info.append(node('strong', '', 'Studio Tee'), node('p', '', variant));
    const controls = node('div', 'tee-line-controls');
    const minus = quantityButton('less', '−', text.less + ' · ' + variant);
    minus.disabled = line.qty <= 1;
    const plus = quantityButton('more', '+', text.more + ' · ' + variant);
    plus.disabled = line.qty >= 99;
    const qty = node('output', '', String(line.qty));
    const remove = quantityButton('remove', text.remove, text.remove + ' · ' + variant);
    controls.append(minus, qty, plus, remove);
    info.append(controls);
    row.append(photo, info);
    return row;
  }

  function updateBag() {
    const count = selection.reduce((sum, line) => sum + line.qty, 0);
    document.querySelectorAll('[data-bag-count]').forEach((el) => { el.textContent = String(count); });
    const rows = selection.map(renderLine);
    bagLines.replaceChildren(...(rows.length ? rows : [node('p', 'tee-empty', words().empty)]));
    bag.querySelector('[data-shop-copy="saved"]').textContent = canSave ? words().saved : words().temporary;
  }

  radioGroup(form.querySelector('#tee-colors'), 'tone', Object.entries(tones), true);
  radioGroup(form.querySelector('#tee-sizes'), 'size', sizes.map((size) => [size, size]));
  form.addEventListener('change', (event) => { if (event.target.name === 'tone') changeTone(); });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const tone = form.elements.tone.value;
    const size = form.elements.size.value;
    if (!Object.hasOwn(tones, tone) || !sizes.includes(size)) return;
    if (!await allowBagAction() || !detail.open) return;
    const line = selection.find((item) => item.tone === tone && item.size === size);
    if (line) line.qty = Math.min(99, line.qty + 1);
    else selection.push({ tone, size, qty: 1 });
    save();
    detail.close();
    bag.showModal();
  });

  document.querySelectorAll('[data-open-tee]').forEach((trigger) => {
    trigger.hidden = false;
    trigger.addEventListener('click', () => openProduct(trigger.dataset.openTee));
  });
  document.querySelectorAll('[data-open-bag]').forEach((trigger) => {
    trigger.hidden = false;
    trigger.addEventListener('click', async () => {
      if (await allowBagAction() && !bag.open) bag.showModal();
    });
  });
  document.querySelectorAll('.tee-dialog [data-dismiss]').forEach((button) => {
    button.addEventListener('click', () => button.closest('dialog').close());
  });
  bagLines.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-bag-action]');
    if (!button) return;
    const row = button.closest('.tee-bag-line');
    if (!await allowBagAction() || !bag.open) return;
    const item = selection.find((line) => line.tone === row.dataset.tone && line.size === row.dataset.size);
    if (!item) return;
    const action = button.dataset.bagAction;
    if (action === 'remove') selection = selection.filter((line) => line !== item);
    else item.qty = Math.max(1, Math.min(99, item.qty + (action === 'more' ? 1 : -1)));
    save();
    const newRow = [...bagLines.children].find((el) => el.dataset.tone === item.tone && el.dataset.size === item.size);
    const next = newRow?.querySelector('[data-bag-action="' + action + '"]:not(:disabled)') ||
      newRow?.querySelector('button:not(:disabled)') || bag.querySelector('[data-dismiss]');
    next.focus();
  });
  window.addEventListener('storage', (event) => {
    if (owner && (event.key === storageKey() || event.key === null)) {
      selection = readSelection();
      updateBag();
    }
  });
  document.addEventListener('dvn:authchange', (event) => switchAccount(event.detail?.user));
  switchAccount(window.DVNAuth?.user);
  document.addEventListener('dvn:languagechange', setLanguage);
  setLanguage();
})();
