/**
 * LumenJS Editor Bridge — injected in editor mode.
 *
 * Handles click/hover detection on elements and communicates with the
 * Studio host via postMessage. Follows the pattern from preview-iframe-bridge.ts.
 */
import { findAnnotatedElement } from './element-annotator.js';
import { startAnnotator } from './element-annotator.js';

let previewMode = false;

export interface NkEditorMessage {
  type: 'NK_READY' | 'NK_ELEMENT_CLICKED' | 'NK_ELEMENT_HOVERED' |
        'NK_SELECT_ELEMENT' | 'NK_HIGHLIGHT_ELEMENT' | 'NK_TEXT_CHANGED' |
        'NK_SET_PREVIEW_MODE';
  payload?: any;
}

function sendToHost(message: NkEditorMessage) {
  if (window.parent && window.parent !== window) {
    window.parent.postMessage(message, '*');
  }
}

function getElementAttributes(el: HTMLElement): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) {
    if (!attr.name.startsWith('data-nk-')) {
      attrs[attr.name] = attr.value;
    }
  }
  return attrs;
}

function getDynamicTexts(el: HTMLElement): Array<{ tag: string; expression: string }> {
  const results: Array<{ tag: string; expression: string }> = [];
  // Check both light DOM (slotted children) and shadow DOM
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

function serializeRect(rect: DOMRect) {
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

function setupClickToSelect() {
  let clickTimer: ReturnType<typeof setTimeout> | null = null;
  let lastClickResult: { element: HTMLElement; source: any } | null = null;

  document.addEventListener('click', (event) => {
    if (previewMode) return;
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
    if (previewMode) return;
    // Cancel the pending single-click
    if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
    lastClickResult = null;
  }, true);
}

function setupHoverDetection() {
  let lastHovered: string | null = null;

  document.addEventListener('mouseover', (event) => {
    if (previewMode) return;
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
    if (previewMode) return;
    const related = event.relatedTarget as HTMLElement | null;
    if (related) {
      const result = findAnnotatedElement(event);
      if (result) return; // Still hovering over an annotated element
    }
    lastHovered = null;
    sendToHost({ type: 'NK_ELEMENT_HOVERED', payload: null });
  }, true);
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
      // Remove existing highlights
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

function setupInlineTextEdit() {
  let editingEl: HTMLElement | null = null;

  document.addEventListener('dblclick', (event) => {
    if (previewMode) return;
    // Walk the composed path to find a text-bearing element
    const editableTags = ['H1','H2','H3','H4','H5','H6','P','SPAN','A','LABEL','LI'];
    const composedPath = event.composedPath();
    let textEl: HTMLElement | null = null;
    let annotatedParent: HTMLElement | null = null;

    for (const node of composedPath) {
      if (!(node instanceof HTMLElement)) continue;
      if (!textEl && editableTags.includes(node.tagName)) {
        textEl = node;
      }
      if (!annotatedParent && node.getAttribute('data-nk-source')) {
        annotatedParent = node;
      }
      if (textEl && annotatedParent) break;
    }

    // If no direct text element, check if target itself has only text content
    if (!textEl) {
      const target = event.target as HTMLElement;
      if (target && target.childNodes.length > 0) {
        const hasOnlyText = Array.from(target.childNodes).every(n => n.nodeType === Node.TEXT_NODE);
        if (hasOnlyText && target.textContent?.trim()) {
          textEl = target;
        }
      }
    }

    if (!textEl || !annotatedParent || editingEl) return;

    // Block inline editing for elements bound to dynamic expressions
    if (textEl.hasAttribute('data-nk-dynamic') || textEl.closest('[data-nk-dynamic]')) {
      event.preventDefault();
      event.stopPropagation();

      textEl.style.outline = '2px dashed #f59e0b';
      textEl.style.outlineOffset = '2px';
      const indicator = document.createElement('div');
      Object.assign(indicator.style, {
        position: 'fixed',
        background: '#f59e0b',
        color: '#000',
        padding: '4px 8px',
        borderRadius: '4px',
        fontSize: '11px',
        fontFamily: 'system-ui',
        zIndex: '10000',
        pointerEvents: 'none',
      });
      indicator.textContent = '\u26A1 Bound to variable \u2014 edit in code';
      const rect = textEl.getBoundingClientRect();
      indicator.style.left = `${rect.left}px`;
      indicator.style.top = `${rect.top - 28}px`;
      document.body.appendChild(indicator);

      setTimeout(() => {
        textEl!.style.outline = '';
        textEl!.style.outlineOffset = '';
        indicator.remove();
      }, 2000);
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    editingEl = textEl;
    const originalText = textEl.textContent || '';
    textEl.setAttribute('contenteditable', 'true');
    textEl.focus();
    textEl.style.outline = '2px solid #3b82f6';
    textEl.style.outlineOffset = '2px';
    textEl.style.borderRadius = '2px';
    textEl.style.minWidth = '20px';

    const range = document.createRange();
    range.selectNodeContents(textEl);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    const sourceAttr = annotatedParent.getAttribute('data-nk-source')!;
    const lastColon = sourceAttr.lastIndexOf(':');
    const sourceFile = sourceAttr.substring(0, lastColon);
    const line = parseInt(sourceAttr.substring(lastColon + 1), 10);

    const commitEdit = () => {
      if (!editingEl) return;
      const newText = editingEl.textContent || '';
      editingEl.removeAttribute('contenteditable');
      editingEl.style.outline = '';
      editingEl.style.outlineOffset = '';
      editingEl.style.borderRadius = '';
      editingEl.style.minWidth = '';
      editingEl = null;

      if (newText !== originalText) {
        sendToHost({
          type: 'NK_TEXT_CHANGED',
          payload: { sourceFile, line, originalText, newText }
        });
      }
    };

    textEl.addEventListener('blur', commitEdit, { once: true });
    textEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        textEl!.blur();
      }
      if (e.key === 'Escape') {
        textEl!.textContent = originalText;
        textEl!.blur();
      }
    });
  });
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
