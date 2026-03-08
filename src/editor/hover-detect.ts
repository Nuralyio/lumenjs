import { findAnnotatedElement } from './element-annotator.js';
import { sendToHost, serializeRect, isPreviewMode } from './editor-bridge.js';

export function setupHoverDetection() {
  let lastHovered: string | null = null;

  document.addEventListener('mouseover', (event) => {
    if (isPreviewMode()) return;
    const result = findAnnotatedElement(event);
    if (!result) return;

    const nkId = result.element.getAttribute('data-nk-id');
    if (nkId === lastHovered) return;
    lastHovered = nkId;

    sendToHost({
      type: 'NK_ELEMENT_HOVERED',
      payload: {
        tag: result.source.tag,
        nkId,
        rect: serializeRect(result.element.getBoundingClientRect()),
      }
    });
  }, true);

  document.addEventListener('mouseout', (event: MouseEvent) => {
    if (isPreviewMode()) return;
    const related = event.relatedTarget as HTMLElement | null;
    if (related) {
      const result = findAnnotatedElement(event);
      if (result) return; // Still hovering over an annotated element
    }
    lastHovered = null;
    sendToHost({ type: 'NK_ELEMENT_HOVERED', payload: null });
  }, true);
}
