/**
 * Overlay utilities — create, position, and hide highlight overlays.
 * Also provides deepElementFromPoint for drilling through shadow DOMs.
 */

/**
 * Recursively drill through shadow DOMs to find the deepest element at a point.
 * Temporarily forces pointer-events:auto so disabled/hidden elements are discoverable.
 */
export function deepElementFromPoint(x: number, y: number): HTMLElement | null {
  // Inject a temporary style that forces pointer-events on everything
  const forceStyle = document.createElement('style');
  forceStyle.textContent = '* { pointer-events: auto !important; }';
  document.head.appendChild(forceStyle);

  // Also inject into all shadow roots we encounter
  const shadowStyles: { root: ShadowRoot; style: HTMLStyleElement }[] = [];

  let el = document.elementFromPoint(x, y) as HTMLElement | null;
  while (el?.shadowRoot) {
    const ss = document.createElement('style');
    ss.textContent = '* { pointer-events: auto !important; }';
    el.shadowRoot.appendChild(ss);
    shadowStyles.push({ root: el.shadowRoot, style: ss });
    const inner = el.shadowRoot.elementFromPoint(x, y) as HTMLElement | null;
    if (!inner || inner === el) break;
    el = inner;
  }

  // Clean up
  forceStyle.remove();
  for (const { style } of shadowStyles) style.remove();

  return el;
}

export function createOverlay(color: string, style: 'solid' | 'dashed' = 'solid'): HTMLDivElement {
  const el = document.createElement('div');
  Object.assign(el.style, {
    position: 'fixed',
    pointerEvents: 'none',
    border: `2px ${style} ${color}`,
    borderRadius: '4px',
    zIndex: '99998',
    transition: 'all 0.1s ease',
    display: 'none',
  });
  document.body.appendChild(el);
  return el;
}

export function positionOverlay(overlay: HTMLDivElement, el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  Object.assign(overlay.style, {
    display: 'block',
    top: `${rect.top - 2}px`,
    left: `${rect.left - 2}px`,
    width: `${rect.width + 4}px`,
    height: `${rect.height + 4}px`,
  });
}

export function hideOverlay(overlay: HTMLDivElement) {
  overlay.style.display = 'none';
}
