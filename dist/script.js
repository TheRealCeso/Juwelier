const toggle = document.querySelector('.menu-toggle');
const mobileNav = document.querySelector('.mobile-nav');

function updateMenuLabel() {
  if (!toggle) return;
  const source = toggle.getAttribute('aria-expanded') === 'true' ? 'Menü schließen' : 'Menü öffnen';
  toggle.setAttribute('aria-label', window.translateUiText?.(source) ?? source);
}
window.updateMenuLabel = updateMenuLabel;

function closeMenu() {
  if (!toggle || !mobileNav) return;
  toggle.setAttribute('aria-expanded', 'false');
  updateMenuLabel();
  mobileNav.hidden = true;
  document.body.classList.remove('menu-open');
}

toggle?.addEventListener('click', () => {
  const open = toggle.getAttribute('aria-expanded') !== 'true';
  toggle.setAttribute('aria-expanded', String(open));
  updateMenuLabel();
  mobileNav.hidden = !open;
  document.body.classList.toggle('menu-open', open);
});

mobileNav?.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });
window.addEventListener('resize', () => { if (window.innerWidth > 1024) closeMenu(); });

const year = document.getElementById('year');
if (year) year.textContent = String(new Date().getFullYear());

const reviewCarousel = document.querySelector('.review-carousel');
const reviewTrack = reviewCarousel?.querySelector('.review-track');
const reviewSet = reviewTrack?.querySelector('.review-set');
const reviewViewport = reviewCarousel?.querySelector('.review-viewport');
const reviewMotionToggle = document.querySelector('.review-motion-toggle');

if (reviewCarousel && reviewTrack && reviewSet && reviewViewport && reviewMotionToggle) {
  const repeat = reviewSet.cloneNode(true);
  repeat.setAttribute('aria-hidden', 'true');
  repeat.inert = true;
  reviewTrack.append(repeat);
  reviewCarousel.classList.add('is-ready');
  reviewMotionToggle.hidden = false;

  let paused = false;
  function updateReviewMotion() {
    reviewCarousel.classList.toggle('is-paused', paused);
    reviewMotionToggle.classList.toggle('is-paused', paused);
    const visibleLabel = paused ? 'Fortsetzen' : 'Pausieren';
    const accessibleLabel = paused ? 'Bewegung fortsetzen' : 'Bewegung pausieren';
    reviewMotionToggle.querySelector('.review-motion-label').firstChild.nodeValue = window.translateUiText?.(visibleLabel) ?? visibleLabel;
    reviewMotionToggle.setAttribute('aria-label', window.translateUiText?.(accessibleLabel) ?? accessibleLabel);
  }

  reviewMotionToggle.addEventListener('click', () => { paused = !paused; updateReviewMotion(); });
  reviewViewport.addEventListener('pointerdown', event => {
    if (event.pointerType === 'touch' || event.pointerType === 'pen') reviewCarousel.classList.add('is-touching');
  });
  window.addEventListener('pointerup', () => reviewCarousel.classList.remove('is-touching'));
  window.addEventListener('pointercancel', () => reviewCarousel.classList.remove('is-touching'));
  document.addEventListener('juwelier-language-change', updateReviewMotion);
  updateReviewMotion();
}

function initScrollReveals() {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (reducedMotion.matches || !('IntersectionObserver' in window)) return;

  const items = [...document.querySelectorAll('[data-reveal]')];
  if (!items.length) return;

  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      requestAnimationFrame(() => entry.target.classList.add('is-revealed'));
    }
  }, { rootMargin: '0px 0px -24px 0px', threshold: 0.08 });

  for (const item of items) {
    const bounds = item.getBoundingClientRect();
    if (bounds.top < window.innerHeight - 24 && bounds.bottom > 0) continue;
    item.classList.add('reveal-pending');
    observer.observe(item);
  }

  document.addEventListener('focusin', event => {
    const item = event.target.closest?.('[data-reveal].reveal-pending');
    if (!item) return;
    observer.unobserve(item);
    item.classList.add('is-revealed');
  });

  reducedMotion.addEventListener?.('change', event => {
    if (!event.matches) return;
    observer.disconnect();
    items.forEach(item => item.classList.remove('reveal-pending', 'is-revealed'));
  });
}

initScrollReveals();

