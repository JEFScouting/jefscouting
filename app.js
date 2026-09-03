(() => {
  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  const toggle = document.querySelector('.nav-toggle');
  const nav = document.getElementById('site-nav');
  let lastFocus = null;

  const isSpanish = document.documentElement.lang === 'es';
  const openLabel = isSpanish ? 'Abrir navegación' : 'Open navigation';
  const closeLabel = isSpanish ? 'Cerrar navegación' : 'Close navigation';

  const setNav = (open) => {
    if (!toggle || !nav) return;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? closeLabel : openLabel);
    toggle.textContent = open ? (isSpanish ? 'Cerrar' : 'Close') : (isSpanish ? 'Menú' : 'Menu');
    nav.classList.toggle('is-open', open);
    nav.setAttribute('aria-hidden', String(!open));
    if (open) {
      lastFocus = document.activeElement;
      nav.removeAttribute('inert');
      document.body.classList.add('nav-open');
      const firstLink = nav.querySelector('a');
      if (firstLink) firstLink.focus({ preventScroll: true });
    } else {
      nav.setAttribute('inert', '');
      document.body.classList.remove('nav-open');
      if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus({ preventScroll: true });
    }
  };

  if (toggle && nav) {
    setNav(false);
    toggle.addEventListener('click', () => setNav(toggle.getAttribute('aria-expanded') !== 'true'));
    nav.addEventListener('click', (event) => {
      if (event.target.closest('a')) setNav(false);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') setNav(false);
    });
    window.addEventListener('resize', () => {
      if (window.matchMedia('(min-width: 901px)').matches) setNav(false);
    });
  }

  const revealTargets = document.querySelectorAll('.cards article,.process>div,.about>div');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (revealTargets.length && 'IntersectionObserver' in window && !reducedMotion) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('revealed');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    revealTargets.forEach((element) => {
      element.classList.add('reveal');
      observer.observe(element);
    });
  } else {
    revealTargets.forEach((element) => element.classList.add('revealed'));
  }
})();
