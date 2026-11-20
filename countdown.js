(() => {
  'use strict';

  const launchDate = document.querySelector('.rv-countdown-date time');
  const target = Date.parse(launchDate?.dateTime);
  const units = [
    { id: 'days', singular: 'Tag', plural: 'Tage' },
    { id: 'hours', singular: 'Stunde', plural: 'Stunden' },
    { id: 'minutes', singular: 'Minute', plural: 'Minuten' },
    { id: 'seconds', singular: 'Sekunde', plural: 'Sekunden' },
  ];
  const fields = units.map(({ id }) => document.getElementById(id));
  const timer = document.querySelector('.rv-countdown-clock');
  const status = document.getElementById('launch-status');
  if (!Number.isFinite(target) || !timer || fields.some((field) => !field)) return;

  let interval;

  function renderDigits(field, value) {
    // Preserve unchanged spans so only changed digits replay the CSS flip.
    if (!field.children.length) field.textContent = '';
    for (let index = 0; index < value.length; index += 1) {
      const digit = value[index];
      const current = field.children[index];
      if (current && current.textContent === digit) continue;
      const span = document.createElement('span');
      span.className = 'rv-countdown-digit';
      span.textContent = digit;
      if (current) current.replaceWith(span);
      else field.appendChild(span);
    }
    while (field.children.length > value.length) field.lastElementChild.remove();
  }

  function update() {
    // Round up so zero is shown only once the launch time has actually arrived.
    const difference = target - Date.now();
    let remaining = Math.ceil(Math.max(0, difference) / 1000) * 1000;
    const days = Math.floor(remaining / 86400000);
    remaining %= 86400000;
    const hours = Math.floor(remaining / 3600000);
    remaining %= 3600000;
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    const values = [days, hours, minutes, seconds];
    const descriptions = [];

    fields.forEach((field, index) => {
      const numericValue = values[index];
      const value = index === 0 ? String(numericValue) : String(numericValue).padStart(2, '0');
      renderDigits(field, value);
      const key = numericValue === 1
        ? ['day', 'hour', 'minute', 'second'][index]
        : units[index].id;
      const label = globalThis.DVNLocale
        ? globalThis.DVNLocale.t(`unit.${key}`)
        : (numericValue === 1 ? units[index].singular : units[index].plural);
      const description = `${numericValue} ${label}`;
      field.setAttribute('aria-label', description);
      descriptions.push(description);
    });
    const launchLabel = launchDate.textContent.trim();
    const label = globalThis.DVNLocale
      ? globalThis.DVNLocale.t(difference > 0 ? 'timer.prefix' : 'timer.complete', {
        date: launchLabel, remaining: descriptions.join(', '),
      })
      : (difference > 0
        ? `Countdown bis ${launchLabel}: ${descriptions.join(', ')}`
        : 'Launch-Zeitpunkt erreicht');
    timer.setAttribute('aria-label', label);
    if (difference <= 0) {
      if (status) status.hidden = false;
      if (interval !== undefined) clearInterval(interval);
      return false;
    }
    if (status) status.hidden = true;
    return true;
  }

  // Read the actual clock each time; no drift after delayed or suspended ticks.
  if (update()) interval = setInterval(update, 250);
  document.addEventListener('dvn:languagechange', update);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) update();
  });
})();
