/**
 * LumenJS Editor Bridge — injected in editor mode.
 *
 * Handles click/hover detection on elements and communicates with the
 * Studio host via postMessage. Follows the pattern from preview-iframe-bridge.ts.
 */
import { startAnnotator } from './element-annotator.js';
import { setupClickToSelect } from './click-select.js';
import { setupHoverDetection } from './hover-detect.js';
import { setupInlineTextEdit } from './inline-text-edit.js';

let previewMode = false;

export interface NkEditorMessage {
  type: 'NK_READY' | 'NK_ELEMENT_CLICKED' | 'NK_ELEMENT_HOVERED' |
        'NK_SELECT_ELEMENT' | 'NK_HIGHLIGHT_ELEMENT' | 'NK_TEXT_CHANGED' |
        'NK_TRANSLATION_CHANGED' | 'NK_SET_PREVIEW_MODE';
  payload?: any;
}

export function isPreviewMode(): boolean {
  return previewMode;
}

export function sendToHost(message: NkEditorMessage) {
  if (window.parent && window.parent !== window) {
    window.parent.postMessage(message, '*');
  }
}

export function getElementAttributes(el: HTMLElement): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) {
    if (!attr.name.startsWith('data-nk-')) {
      attrs[attr.name] = attr.value;
    }
  }
  return attrs;
}

export function getDynamicTexts(el: HTMLElement): Array<{ tag: string; expression: string }> {
  const results: Array<{ tag: string; expression: string }> = [];
  const roots = [el];
  if (el.shadowRoot) roots.push(el.shadowRoot as any);
  for (const root of roots) {
    root.querySelectorAll('[data-nk-dynamic]').forEach((child: Element) => {
      const raw = child.getAttribute('data-nk-dynamic') || '';
      if (raw) {
        const expression = raw.replace(/__NK_EXPR__/g, '${');
        results.push({ tag: child.tagName.toLowerCase(), expression });
      }
    });
  }
  return results;
}

export function serializeRect(rect: DOMRect) {
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

function handleHostMessage(event: MessageEvent) {
  const message = event.data as NkEditorMessage;
  if (!message || typeof message !== 'object' || !message.type) return;

  switch (message.type) {
    case 'NK_SELECT_ELEMENT': {
      const { sourceFile, line } = message.payload || {};
      const el = document.querySelector(`[data-nk-source="${sourceFile}:${line}"]`);
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.outline = '2px solid #3b82f6';
        setTimeout(() => { el.style.outline = ''; }, 2000);
      }
      break;
    }
    case 'NK_HIGHLIGHT_ELEMENT': {
      document.querySelectorAll('[data-nk-highlight]').forEach(el => {
        (el as HTMLElement).removeAttribute('data-nk-highlight');
        (el as HTMLElement).style.outline = '';
      });

      if (message.payload) {
        const { sourceFile, line } = message.payload;
        const el = document.querySelector(`[data-nk-source="${sourceFile}:${line}"]`);
        if (el instanceof HTMLElement) {
          el.setAttribute('data-nk-highlight', 'true');
          el.style.outline = '1px dashed #3b82f6';
        }
      }
      break;
    }
    case 'NK_SET_PREVIEW_MODE': {
      previewMode = !!message.payload;
      document.body.style.cursor = previewMode ? '' : 'default';
      break;
    }
  }
}

function initEditorBridge() {
  if (window.self === window.top) return; // Not in iframe

  startAnnotator();
  setupClickToSelect();
  setupHoverDetection();
  setupInlineTextEdit();
  window.addEventListener('message', handleHostMessage);
  sendToHost({ type: 'NK_READY' });
}

// Auto-init
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initEditorBridge);
} else {
  initEditorBridge();
}
