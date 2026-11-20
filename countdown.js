(() => {
  'use strict';

  const target = Date.parse('2026-12-06T00:00:00+01:00');
  const units = [
    { id: 'days', singular: 'Tag', plural: 'Tage' },
    { id: 'hours', singular: 'Stunde', plural: 'Stunden' },
    { id: 'minutes', singular: 'Minute', plural: 'Minuten' },
    { id: 'seconds', singular: 'Sekunde', plural: 'Sekunden' },
  ];
  const fields = units.map(({ id }) => document.getElementById(id));
  const timer = document.querySelector('.rv-countdown-clock');

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
    let remaining = Math.max(0, target - Date.now());
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
      const label = numericValue === 1 ? units[index].singular : units[index].plural;
      const description = `${numericValue} ${label}`;
      field.setAttribute('aria-label', description);
      descriptions.push(description);
    });
    timer.setAttribute('aria-label', `Countdown bis zum 6. Dezember 2026: ${descriptions.join(', ')}`);
  }

  update();
  // Read the actual clock each time; no drift after delayed or suspended ticks.
  setInterval(update, 250);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) update();
  });
})();
