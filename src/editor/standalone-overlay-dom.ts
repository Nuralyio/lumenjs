/**
 * Standalone Overlay DOM helpers — pure DOM utility functions for creating
 * and positioning overlay highlight boxes.
 */

export function createOverlay(color: string, style = 'solid'): HTMLDivElement {
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

export function positionOverlay(overlay: HTMLDivElement, el: HTMLElement): void {
  const rect = el.getBoundingClientRect();
  Object.assign(overlay.style, {
    display: 'block',
    top: `${rect.top - 2}px`,
    left: `${rect.left - 2}px`,
    width: `${rect.width + 4}px`,
    height: `${rect.height + 4}px`,
  });
}

export function hideOverlay(overlay: HTMLDivElement): void {
  overlay.style.display = 'none';
}
