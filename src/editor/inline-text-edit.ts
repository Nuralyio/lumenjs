import { sendToHost, isPreviewMode } from './editor-bridge.js';
import { applyAstModification } from './editor-api-client.js';

const EDITABLE_TAGS = ['H1','H2','H3','H4','H5','H6','P','SPAN','A','LABEL','LI'];
let editingEl: HTMLElement | null = null;

/**
 * Find the text element and annotated parent from a target element,
 * walking up the DOM tree. Works for both real events and direct calls.
 */
function findEditTarget(startEl: HTMLElement): { textEl: HTMLElement; annotatedParent: HTMLElement } | null {
  let textEl: HTMLElement | null = null;
  let annotatedParent: HTMLElement | null = null;
  let el: HTMLElement | null = startEl;

  while (el) {
    if (!textEl && EDITABLE_TAGS.includes(el.tagName)) {
      textEl = el;
    }
    if (!annotatedParent && el.getAttribute('data-nk-source')) {
      annotatedParent = el;
    }
    if (textEl && annotatedParent) break;
    el = el.parentElement;
  }

  // If no direct text element, check if start element has only text content
  if (!textEl) {
    if (startEl.childNodes.length > 0) {
      const hasOnlyText = Array.from(startEl.childNodes).every(n => n.nodeType === Node.TEXT_NODE);
      if (hasOnlyText && startEl.textContent?.trim()) {
        textEl = startEl;
      }
    }
  }

  if (!textEl || !annotatedParent) return null;
  return { textEl, annotatedParent };
}

function showDynamicWarning(textEl: HTMLElement): void {
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
    textEl.style.outline = '';
    textEl.style.outlineOffset = '';
    indicator.remove();
  }, 2000);
}

function startEditing(textEl: HTMLElement, annotatedParent: HTMLElement): void {
  if (editingEl) return;
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
      const i18nKey = textEl.getAttribute('data-nk-i18n-key');
      if (i18nKey) {
        const locale = document.documentElement.lang || 'en';
        sendToHost({
          type: 'NK_TRANSLATION_CHANGED',
          payload: { key: i18nKey, locale, originalText, newText }
        });
      } else {
        applyAstModification(sourceFile, {
          type: 'setTextContent',
          elementSelector: textEl.tagName.toLowerCase(),
          sourceLine: line,
          html: newText,
        }).then(() => {
          sendToHost({
            type: 'NK_TEXT_CHANGED',
            payload: { sourceFile, line, originalText, newText, appliedLocally: true }
          });
        }).catch(() => {
          sendToHost({
            type: 'NK_TEXT_CHANGED',
            payload: { sourceFile, line, originalText, newText }
          });
        });
      }
    }
  };

  textEl.addEventListener('blur', commitEdit, { once: true });
  textEl.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      textEl.blur();
    }
    if (e.key === 'Escape') {
      textEl.textContent = originalText;
      textEl.blur();
    }
  });
}

/**
 * Trigger inline text editing on an element directly.
 * Called from standalone-overlay.ts on double-tap (mobile).
 */
export function triggerInlineEdit(target: HTMLElement): boolean {
  if (isPreviewMode() || editingEl) return false;
  const result = findEditTarget(target);
  if (!result) return false;
  const { textEl, annotatedParent } = result;
  if (textEl.hasAttribute('data-nk-dynamic') || textEl.closest('[data-nk-dynamic]')) {
    showDynamicWarning(textEl);
    return true;
  }
  startEditing(textEl, annotatedParent);
  return true;
}

export function setupInlineTextEdit() {
  document.addEventListener('dblclick', (event) => {
    if (isPreviewMode()) return;

    // Try composedPath first (works in shadow DOM with real events)
    const composedPath = event.composedPath();
    let textEl: HTMLElement | null = null;
    let annotatedParent: HTMLElement | null = null;

    for (const node of composedPath) {
      if (!(node instanceof HTMLElement)) continue;
      if (!textEl && EDITABLE_TAGS.includes(node.tagName)) {
        textEl = node;
      }
      if (!annotatedParent && node.getAttribute('data-nk-source')) {
        annotatedParent = node;
      }
      if (textEl && annotatedParent) break;
    }

    // Fallback: walk from event.target
    if (!textEl || !annotatedParent) {
      const target = event.target as HTMLElement;
      if (target) {
        const result = findEditTarget(target);
        if (result) {
          textEl = result.textEl;
          annotatedParent = result.annotatedParent;
        }
      }
    }

    if (!textEl || !annotatedParent || editingEl) return;

    if (textEl.hasAttribute('data-nk-dynamic') || textEl.closest('[data-nk-dynamic]')) {
      event.preventDefault();
      event.stopPropagation();
      showDynamicWarning(textEl);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    startEditing(textEl, annotatedParent);
  });
}
