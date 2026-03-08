import { sendToHost, isPreviewMode } from './editor-bridge.js';

export function setupInlineTextEdit() {
  let editingEl: HTMLElement | null = null;

  document.addEventListener('dblclick', (event) => {
    if (isPreviewMode()) return;
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
