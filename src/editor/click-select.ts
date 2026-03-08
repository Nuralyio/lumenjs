import { findAnnotatedElement } from './element-annotator.js';
import { sendToHost, getElementAttributes, getDynamicTexts, serializeRect, isPreviewMode } from './editor-bridge.js';

export function setupClickToSelect() {
  let clickTimer: ReturnType<typeof setTimeout> | null = null;
  let lastClickResult: { element: HTMLElement; source: any } | null = null;

  document.addEventListener('click', (event) => {
    if (isPreviewMode()) return;
    const result = findAnnotatedElement(event);
    if (!result) return;

    event.preventDefault();
    event.stopPropagation();

    // Delay dispatch to distinguish single-click from double-click
    lastClickResult = result;
    if (clickTimer) clearTimeout(clickTimer);
    clickTimer = setTimeout(() => {
      if (!lastClickResult) return;
      sendToHost({
        type: 'NK_ELEMENT_CLICKED',
        payload: {
          sourceFile: lastClickResult.source.file,
          line: lastClickResult.source.line,
          tag: lastClickResult.source.tag,
          attributes: getElementAttributes(lastClickResult.element),
          nkId: lastClickResult.element.getAttribute('data-nk-id'),
          rect: serializeRect(lastClickResult.element.getBoundingClientRect()),
          dynamicTexts: getDynamicTexts(lastClickResult.element),
        }
      });
      lastClickResult = null;
    }, 250);
  }, true);

  document.addEventListener('dblclick', (event) => {
    if (isPreviewMode()) return;
    // Cancel the pending single-click
    if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
    lastClickResult = null;
  }, true);
}
