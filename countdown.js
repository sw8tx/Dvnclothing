(() => {
  'use strict';

  const start = Date.parse('2026-11-20T00:00:00+01:00');
  const launch = Date.parse('2026-12-06T00:00:00+01:00');
  const fields = ['days', 'hours', 'minutes', 'seconds'].map((id) => document.getElementById(id));
  const timer = document.querySelector('.countdown');
  const flight = document.getElementById('flight');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const animations = new Map();
  let initialRender = true;

  function update() {
    const now = Date.now();
    const totalSeconds = Math.max(0, Math.ceil((launch - now) / 1000));
    const values = [
      Math.floor(totalSeconds / 86400),
      Math.floor(totalSeconds / 3600) % 24,
      Math.floor(totalSeconds / 60) % 60,
      totalSeconds % 60,
    ];

    fields.forEach((field, index) => {
      const value = String(values[index]).padStart(2, '0');
      if (field.textContent === value) return;
      field.textContent = value;
      animations.get(field)?.cancel();
      animations.delete(field);
      if (!initialRender && !reducedMotion.matches && typeof field.animate === 'function') {
        animations.set(field, field.animate(
          [{ opacity: 0.15, transform: 'translateY(7px)' }, { opacity: 1, transform: 'translateY(0)' }],
          { duration: 280, easing: 'ease-out' },
        ));
      }
    });

    const progress = Math.min(1, Math.max(0, (now - start) / (launch - start)));
    flight.style.setProperty('--progress', `${progress * 100}%`);
    flight.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
    timer.setAttribute('aria-label', totalSeconds === 0
      ? 'Launch-Datum erreicht'
      : `${values[0]} Tage, ${values[1]} Stunden, ${values[2]} Minuten und ${values[3]} Sekunden bis zum Launch`);
    initialRender = false;
  }

  update();
  // Recalculate from the clock so suspended tabs and delayed ticks never accumulate drift.
  setInterval(update, 250);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) update();
  });
})();
