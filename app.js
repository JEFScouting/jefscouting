(() => {
  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  const toggle = document.querySelector('.nav-toggle');
  const nav = document.getElementById('site-nav');
  let lastFocus = null;

  const isSpanish = document.documentElement.lang === 'es';
  const openLabel = isSpanish ? 'Abrir navegación' : 'Open navigation';
  const closeLabel = isSpanish ? 'Cerrar navegación' : 'Close navigation';
  const mobileNav = window.matchMedia('(max-width: 900px)');

  const setNav = (open, restoreFocus = true) => {
    if (!toggle || !nav) return;
    const nextOpen = mobileNav.matches && open;
    toggle.setAttribute('aria-expanded', String(nextOpen));
    toggle.setAttribute('aria-label', nextOpen ? closeLabel : openLabel);
    toggle.textContent = nextOpen ? (isSpanish ? 'Cerrar' : 'Close') : (isSpanish ? 'Menú' : 'Menu');
    nav.classList.toggle('is-open', nextOpen);
    if (!mobileNav.matches) {
      nav.setAttribute('aria-hidden', 'false');
      nav.removeAttribute('inert');
      document.body.classList.remove('nav-open');
      lastFocus = null;
      return;
    }
    nav.setAttribute('aria-hidden', String(!nextOpen));
    if (nextOpen) {
      lastFocus = document.activeElement;
      nav.removeAttribute('inert');
      document.body.classList.add('nav-open');
      const firstLink = nav.querySelector('a');
      if (firstLink) firstLink.focus({ preventScroll: true });
    } else {
      nav.setAttribute('inert', '');
      document.body.classList.remove('nav-open');
      if (restoreFocus && lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus({ preventScroll: true });
      lastFocus = null;
    }
  };

  if (toggle && nav) {
    setNav(false);
    toggle.addEventListener('click', () => setNav(toggle.getAttribute('aria-expanded') !== 'true'));
    nav.addEventListener('click', (event) => {
      if (event.target.closest('a')) setNav(false);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') setNav(false);
    });
    window.addEventListener('resize', () => {
      setNav(false, false);
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
