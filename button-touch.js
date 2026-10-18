// Auf Touchscreens bleibt die Füllung kurz nach dem Tippen sichtbar.
(() => {
  const selector = [
    '.button-gold',
    '.text-link',
    '.review-motion-toggle',
    '.language-trigger',
    '.menu-toggle',
    '.metal-prices-button',
    '.google-reviews-link',
    '.location-actions a:first-child',
    '.location-actions a:last-child',
    '.purchase-demo-button',
    '.scan-action',
    '.purchase-primary',
    '.purchase-secondary',
    '.archive-card-actions button',
    '.back-to-top'
  ].join(', ');
  const pressed = new Set();
  const timers = new WeakMap();

  document.addEventListener('touchstart', event => {
    const button = event.target.closest?.(selector);
    if (!button || button.matches(':disabled') || button.querySelector('input:disabled')) return;
    clearTimeout(timers.get(button));
    button.classList.add('is-pressed');
    pressed.add(button);
  }, { passive: true });

  document.addEventListener('touchend', () => {
    for (const button of pressed) {
      timers.set(button, setTimeout(() => button.classList.remove('is-pressed'), 220));
    }
    pressed.clear();
  }, { passive: true });

  document.addEventListener('touchcancel', () => {
    for (const button of pressed) button.classList.remove('is-pressed');
    pressed.clear();
  }, { passive: true });
})();
