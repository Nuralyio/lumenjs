/**
 * Overlay Events — mouse, touch, toolbar, keyboard, and scroll/resize
 * event handlers for the standalone editor overlay.
 */
import { findAnnotatedElement, parseSourceAttr } from './element-annotator.js';
import { triggerInlineEdit } from './inline-text-edit.js';
import { deepElementFromPoint, positionOverlay, hideOverlay } from './overlay-utils.js';
import { positionTextToolbar, hideTextToolbar } from './text-toolbar.js';
import { showPropertiesForElement, hidePropertiesPanel, isPropertiesPanelOpen } from './properties-panel.js';
import { hideAiChatPanel, isAiChatPanelOpen, updateAiChatPosition } from './ai-chat-panel.js';
import { showAiProjectPanel, hideAiProjectPanel, isAiProjectPanelOpen } from './ai-project-panel.js';
import { showTextToolbarForElement } from './text-toolbar.js';
import { showAiChatForElement } from './ai-chat-panel.js';
import {
  updateSelectionInfo, setMode, closeFilePanel, loadFileList,
  saveCurrentFile, getIsEditorMode, getCurrentEditorFile,
  getIsFilePanelOpen, setIsFilePanelOpen,
} from './editor-toolbar.js';
import {
  getSelectedElement, setSelectedElement,
  getHoverOverlay, getSelectOverlay,
  getMultiSelectedElements, getMultiSelectOverlays,
  deselect, selectSingle, toggleMultiSelect,
  touchToElement, sendPageAiPrompt,
} from './overlay-selection.js';

const isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

// ── Mouse events (desktop) ──

export function setupMouseEvents() {
  const hoverOverlay = getHoverOverlay();

  let lastHoverEl: HTMLElement | null = null;
  let hoverRaf = 0;
  document.addEventListener('mousemove', (event) => {
    if (!getIsEditorMode()) return;
    if (hoverRaf) return;
    hoverRaf = requestAnimationFrame(() => {
      hoverRaf = 0;
      const selectedElement = getSelectedElement();
      let hoverEl = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      while (hoverEl?.shadowRoot) {
        const inner = hoverEl.shadowRoot.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
        if (!inner || inner === hoverEl) break;
        hoverEl = inner;
      }
      if (hoverEl && hoverEl !== selectedElement && hoverEl !== document.body && hoverEl !== document.documentElement && !hoverEl.closest('#nk-editor-toolbar') && !hoverEl.closest('#nk-props-panel') && !hoverEl.closest('#nk-file-panel') && !hoverEl.closest('#nk-ai-chat') && !hoverEl.closest('#nk-ai-project') && !hoverEl.closest('#nk-pp-fab')) {
        if (hoverEl !== lastHoverEl) {
          lastHoverEl = hoverEl;
          positionOverlay(hoverOverlay, hoverEl);
        }
      } else {
        lastHoverEl = null;
        hideOverlay(hoverOverlay);
      }
    });
  }, true);

  document.addEventListener('mouseleave', () => {
    lastHoverEl = null;
    hideOverlay(hoverOverlay);
  });

  // Pointerdown handler to select disabled/pointer-events:none elements.
  document.addEventListener('pointerdown', (event) => {
    if (isTouchDevice) return;
    if (!getIsEditorMode()) return;
    const t = event.target as HTMLElement;
    if (t.closest('#nk-editor-toolbar') || t.closest('#nk-file-panel') || t.closest('#nk-file-editor') || t.closest('#nk-text-toolbar') || t.closest('#nk-props-panel') || t.closest('#nk-ai-chat') || t.closest('#nk-ai-project') || t.closest('#nk-pp-fab')) return;

    const deepEl = deepElementFromPoint(event.clientX, event.clientY);
    if (!deepEl) return;

    const deepRoot = deepEl.getRootNode();
    const hostEl = deepRoot instanceof ShadowRoot ? deepRoot.host as HTMLElement : null;
    const isHostUnclickable = hostEl && (
      hostEl.hasAttribute('disabled') ||
      hostEl.getAttribute('aria-disabled') === 'true' ||
      window.getComputedStyle(hostEl).pointerEvents === 'none'
    );
    const isDeepUnclickable = (deepEl as any).disabled ||
      window.getComputedStyle(deepEl).pointerEvents === 'none';

    if (!isHostUnclickable && !isDeepUnclickable) return;

    let selectEl: HTMLElement = hostEl && hostEl.getAttribute('data-nk-source') ? hostEl : deepEl;
    if (!selectEl.getAttribute('data-nk-source')) {
      let el: HTMLElement | null = selectEl;
      while (el) {
        if (el.getAttribute('data-nk-source')) { selectEl = el; break; }
        const r = el.getRootNode();
        if (r instanceof ShadowRoot) { el = r.host as HTMLElement; continue; }
        el = el.parentElement;
      }
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.shiftKey) {
      toggleMultiSelect(selectEl);
    } else {
      selectSingle(selectEl);
    }
  }, true);

  // Click to select (desktop) — supports Shift+click for multi-select
  let clickTimer: ReturnType<typeof setTimeout> | null = null;

  document.addEventListener('click', (event) => {
    if (isTouchDevice) return;
    if (!getIsEditorMode()) return;
    const t = event.target as HTMLElement;
    if (t.closest('#nk-editor-toolbar') || t.closest('#nk-file-panel') || t.closest('#nk-file-editor') || t.closest('#nk-text-toolbar') || t.closest('#nk-props-panel') || t.closest('#nk-ai-chat') || t.closest('#nk-ai-project') || t.closest('#nk-pp-fab')) return;

    let result = findAnnotatedElement(event);
    if (result?.element) {
      const root = result.element.getRootNode();
      if (root instanceof ShadowRoot) {
        const host = root.host as HTMLElement;
        const hostSrc = host.getAttribute('data-nk-source');
        if (hostSrc) {
          const parsed = parseSourceAttr(hostSrc);
          if (parsed) result = { element: host, source: parsed };
        }
      }
    }
    if (!result && t) {
      let el: HTMLElement | null = t;
      const root = t.getRootNode();
      if (root instanceof ShadowRoot) {
        const host = root.host as HTMLElement;
        const hostSrc = host.getAttribute('data-nk-source');
        if (hostSrc) {
          const parsed = parseSourceAttr(hostSrc);
          if (parsed) result = { element: host, source: parsed };
        }
      }
      if (!result) {
        while (el) {
          const src = el.getAttribute('data-nk-source');
          if (src) {
            const parsed = parseSourceAttr(src);
            if (parsed) { result = { element: el, source: parsed }; break; }
          }
          el = el.parentElement;
        }
      }
    }
    let targetEl: HTMLElement | null = result?.element ?? t;
    if (!targetEl || targetEl === document.body || targetEl === document.documentElement) {
      deselect();
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (clickTimer) clearTimeout(clickTimer);
    const selectEl = targetEl;
    const isShift = event.shiftKey;
    clickTimer = setTimeout(() => {
      if (isShift) {
        toggleMultiSelect(selectEl);
      } else {
        selectSingle(selectEl);
      }
    }, 200);
  }, true);

  document.addEventListener('dblclick', () => {
    if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
  }, true);
}

// ── Touch events (mobile/tablet) ──

export function setupTouchEvents() {
  const hoverOverlay = getHoverOverlay();
  const selectOverlay = getSelectOverlay();

  let lastTapTime = 0;
  let lastTapTarget: HTMLElement | null = null;
  let tapTimer: ReturnType<typeof setTimeout> | null = null;

  document.addEventListener('touchend', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('#nk-editor-toolbar') || target.closest('#nk-file-panel') || target.closest('#nk-file-editor') || target.closest('#nk-text-toolbar') || target.closest('#nk-props-panel') || target.closest('#nk-ai-chat') || target.closest('#nk-ai-project') || target.closest('#nk-pp-fab')) {
      return;
    }
    if (!getIsEditorMode()) return;

    const touch = event.changedTouches[0];
    if (!touch) return;

    const result = touchToElement(touch);
    let touchTargetEl: HTMLElement | null = result?.element ?? (document.elementFromPoint(touch.clientX, touch.clientY) as HTMLElement | null);
    if (!touchTargetEl || touchTargetEl === document.body || touchTargetEl === document.documentElement) return;

    const now = Date.now();
    const resultSource = touchTargetEl.getAttribute('data-nk-source') || '';
    const lastSource = lastTapTarget?.getAttribute('data-nk-source') || '';
    const isDoubleTap = (now - lastTapTime < 350) && (resultSource !== '' ? resultSource === lastSource : touchTargetEl === lastTapTarget);
    lastTapTime = now;
    lastTapTarget = touchTargetEl;

    if (isDoubleTap) {
      if (tapTimer) { clearTimeout(tapTimer); tapTimer = null; }
      hideTextToolbar();

      let touchTarget: HTMLElement | null = document.elementFromPoint(touch.clientX, touch.clientY) as HTMLElement | null;
      if (touchTarget?.shadowRoot) {
        const inner = touchTarget.shadowRoot.elementFromPoint(touch.clientX, touch.clientY);
        if (inner instanceof HTMLElement) touchTarget = inner;
      }
      if (touchTarget) {
        triggerInlineEdit(touchTarget);
      }
      event.preventDefault();
    } else {
      if (tapTimer) clearTimeout(tapTimer);
      const tapEl = touchTargetEl;
      tapTimer = setTimeout(() => {
        setSelectedElement(tapEl);
        positionOverlay(selectOverlay, tapEl);
        hideOverlay(hoverOverlay);
        updateSelectionInfo(tapEl);
        showTextToolbarForElement(tapEl);
        showPropertiesForElement(tapEl);
        showAiChatForElement(tapEl);
      }, 300);
      event.preventDefault();
    }
  }, { passive: false, capture: true } as any);
}

// ── Toolbar button handlers ──

export function setupToolbarHandlers(toolbar: HTMLDivElement, filePanel: HTMLDivElement) {
  // Page-level AI input
  const pageAiInput = toolbar.querySelector('.nk-tb-page-ai-input') as HTMLInputElement;
  const pageAiSend = toolbar.querySelector('.nk-tb-page-ai-send') as HTMLButtonElement;
  pageAiInput.addEventListener('input', () => {
    pageAiSend.disabled = !pageAiInput.value.trim();
  });
  pageAiInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && pageAiInput.value.trim()) {
      e.preventDefault();
      sendPageAiPrompt(pageAiInput.value.trim());
      pageAiInput.value = '';
      pageAiSend.disabled = true;
    }
    e.stopPropagation();
  });
  pageAiSend.addEventListener('click', (e) => {
    e.stopPropagation();
    if (pageAiInput.value.trim()) {
      sendPageAiPrompt(pageAiInput.value.trim());
      pageAiInput.value = '';
      pageAiSend.disabled = true;
    }
  });

  // Edit / Preview toggle
  document.getElementById('nk-tb-toggle')!.addEventListener('click', (e) => {
    e.stopPropagation();
    setMode(!getIsEditorMode());
  });

  // Deselect button
  toolbar.querySelector('.nk-tb-deselect')!.addEventListener('click', (e) => {
    e.stopPropagation();
    deselect();
  });

  // Project AI panel toggle
  toolbar.querySelector('.nk-tb-project-ai')!.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isAiProjectPanelOpen()) {
      hideAiProjectPanel();
      (toolbar.querySelector('.nk-tb-project-ai') as HTMLElement).classList.remove('active');
    } else {
      showAiProjectPanel();
      (toolbar.querySelector('.nk-tb-project-ai') as HTMLElement).classList.add('active');
    }
  });

  // File panel toggle
  toolbar.querySelector('.nk-tb-files')!.addEventListener('click', (e) => {
    e.stopPropagation();
    if (getIsFilePanelOpen()) {
      closeFilePanel();
    } else {
      setIsFilePanelOpen(true);
      filePanel.classList.add('open');
      (toolbar.querySelector('.nk-tb-files') as HTMLElement).classList.add('active');
      loadFileList();
    }
  });

  // Mobile close button in file panel header
  document.getElementById('nk-fp-close')!.addEventListener('click', (e) => {
    e.stopPropagation();
    closeFilePanel();
  });

  // File editor save / close
  document.getElementById('nk-fe-save')!.addEventListener('click', saveCurrentFile);
  document.getElementById('nk-fe-close')!.addEventListener('click', () => {
    document.getElementById('nk-file-editor')!.classList.remove('open');
    // On mobile, re-show the file list
    if (window.innerWidth <= 640 && getIsFilePanelOpen()) {
      filePanel.classList.add('open');
    }
  });
}

// ── Keyboard handlers ──

export function setupKeyboardHandlers(toolbar: HTMLDivElement) {
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's' && getCurrentEditorFile()) {
      e.preventDefault();
      saveCurrentFile();
    }
    if (e.key === 'Escape') {
      if (getCurrentEditorFile()) {
        document.getElementById('nk-file-editor')!.classList.remove('open');
      } else if (isAiProjectPanelOpen()) {
        hideAiProjectPanel();
        (toolbar.querySelector('.nk-tb-project-ai') as HTMLElement)?.classList.remove('active');
      } else if (isAiChatPanelOpen()) {
        hideAiChatPanel();
      } else if (isPropertiesPanelOpen()) {
        hidePropertiesPanel();
      } else if (getIsFilePanelOpen()) {
        closeFilePanel();
      } else if (getSelectedElement()) {
        deselect();
      }
    }
  });
}

// ── Scroll / resize overlay repositioning ──

export function setupScrollResize() {
  const selectOverlay = getSelectOverlay();

  const updateOverlays = () => {
    const selectedElement = getSelectedElement();
    if (selectedElement) {
      positionOverlay(selectOverlay, selectedElement);
      const textTb = document.getElementById('nk-text-toolbar');
      if (textTb && textTb.style.display !== 'none') positionTextToolbar(selectedElement);
    }
    // Reposition multi-select overlays
    const multiSelectedElements = getMultiSelectedElements();
    const multiSelectOverlays = getMultiSelectOverlays();
    for (let i = 0; i < multiSelectedElements.length; i++) {
      if (multiSelectedElements[i].isConnected && multiSelectOverlays[i]) {
        positionOverlay(multiSelectOverlays[i], multiSelectedElements[i]);
      }
    }
    updateAiChatPosition();
  };
  window.addEventListener('scroll', updateOverlays, true);
  window.addEventListener('resize', updateOverlays);
}
