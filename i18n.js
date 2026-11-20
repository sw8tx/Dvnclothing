(() => {
  'use strict';
  const translations = globalThis.DVN_TRANSLATIONS;
  const supported = (value) => value === 'de' || value === 'en';
  const menu = document.querySelector('.language-menu');
  if (menu) menu.hidden = false;
  const footerGroups = document.querySelectorAll('.footer-directory details');
  if (footerGroups.length) {
    const wide = matchMedia('(min-width: 800px)');
    const updateGroups = () => footerGroups.forEach(group => { group.open = wide.matches; });
    updateGroups();
    wide.addEventListener('change', updateGroups);
  }
  let language = 'de';

  function t(key, variables = {}) {
    const value = translations[language][key] ?? translations.de[key] ?? key;
    return value.replace(/\{(\w+)\}/g, (match, name) => variables[name] ?? match);
  }

  function setLanguage(value, persist = true) {
    if (!supported(value)) return;
    language = value;
    document.documentElement.lang = language;
    document.querySelectorAll('[data-i18n]').forEach((element) => {
      element.textContent = t(element.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-aria]').forEach((element) => {
      element.setAttribute('aria-label', t(element.dataset.i18nAria));
    });
    document.querySelectorAll('[data-i18n-content]').forEach((element) => {
      element.setAttribute('content', t(element.dataset.i18nContent));
    });
    document.querySelectorAll('[data-language-current]').forEach((element) => {
      element.hidden = element.dataset.languageCurrent !== language;
    });
    document.querySelectorAll('[data-language]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.language === language));
    });
    document.querySelectorAll('[data-launch-date]').forEach((element) => {
      element.textContent = new Intl.DateTimeFormat(language === 'de' ? 'de-DE' : 'en-GB', {
        dateStyle: 'full', timeZone: 'Europe/Berlin',
      }).format(new Date(element.dateTime));
    });
    if (persist) {
      try { localStorage.setItem('dvn-language', language); } catch { /* Choice still works without storage. */ }
    }
    if (menu) menu.open = false;
    document.dispatchEvent(new CustomEvent('dvn:languagechange', { detail: { language } }));
  }

  globalThis.DVNLocale = { t, setLanguage, get language() { return language; } };
  let saved;
  try { saved = localStorage.getItem('dvn-language'); } catch { /* Use German as the default. */ }
  setLanguage(supported(saved) ? saved : 'de', false);

  document.querySelectorAll('[data-language]').forEach((button) => {
    button.addEventListener('click', () => {
      setLanguage(button.dataset.language);
      if (!button.closest?.('.footer-languages')) menu?.querySelector('summary')?.focus();
    });
  });
  document.addEventListener('click', (event) => {
    if (menu && !menu.contains(event.target)) menu.open = false;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menu?.open) {
      menu.open = false;
      menu.querySelector('summary')?.focus();
    }
  });
})();
