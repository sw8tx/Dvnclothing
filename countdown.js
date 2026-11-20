(() => {
  'use strict';

  // The launch is midnight in Germany; this interval stays in CET throughout.
  const start = Date.parse('2026-11-20T00:00:00+01:00');
  const launch = Date.parse('2026-12-06T00:00:00+01:00');
  const dayMs = 24 * 60 * 60 * 1000;
  const daysElement = document.getElementById('days');
  const labelElement = document.getElementById('days-label');
  const flight = document.getElementById('flight');
  const timer = document.querySelector('.countdown');

  function update() {
    const now = Date.now();
    const days = Math.max(0, Math.ceil((launch - now) / dayMs));
    const progress = Math.min(1, Math.max(0, (now - start) / (launch - start)));
    const label = days === 0 ? 'Launch-Tag' : days === 1 ? 'Tag bis zum Launch' : 'Tage bis zum Launch';

    daysElement.textContent = String(days);
    labelElement.textContent = label;
    timer.setAttribute('aria-label', days === 0 ? 'Launch-Datum erreicht' : `${days} ${label}`);
    flight.style.setProperty('--progress', `${progress * 100}%`);
    flight.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
  }

  update();
  // A short interval also catches the date change in tabs left open overnight.
  setInterval(update, 1000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) update();
  });
})();
