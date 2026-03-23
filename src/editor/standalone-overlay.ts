/**
 * Standalone Editor Overlay — provides a visual editing UI when editor mode
 * runs outside an iframe (direct browsing, not embedded in Studio).
 *
 * Features:
 * - Hover highlight box around annotated elements (mouse)
 * - Tap / click to select element (shows source info in toolbar)
 * - Double-tap / double-click text to inline edit (delegates to inline-text-edit.ts)
 * - Floating toolbar at top with selected element info
 * - File tree panel to browse/edit project files
 * - Full touch support for mobile/tablet
 */
import { findAnnotatedElement, parseSourceAttr, startAnnotator } from './element-annotator.js';
import { setupInlineTextEdit, triggerInlineEdit } from './inline-text-edit.js';
import { createPropertiesPanel, showPropertiesForElement, hidePropertiesPanel, isPropertiesPanelOpen } from './properties-panel.js';
import { createAiChatPanel, showAiChatForElement, showAiChatForElements, hideAiChatPanel, isAiChatPanelOpen, updateAiChatPosition, updateAiChatTarget } from './ai-chat-panel.js';
import { createAiProjectPanel, showAiProjectPanel, hideAiProjectPanel, isAiProjectPanelOpen, sendProjectMessage } from './ai-project-panel.js';
import { deepElementFromPoint, createOverlay, positionOverlay, hideOverlay } from './overlay-utils.js';
import {
  createTextToolbar, setupTextToolbarHandlers, showTextToolbarForElement,
  hideTextToolbar, positionTextToolbar, setTextToolbarSelectedElement,
} from './text-toolbar.js';
import {
  createToolbar, createFilePanel, updateSelectionInfo, setMode, closeFilePanel,
  loadFileList, saveCurrentFile, getToolbar, getFilePanel, getIsEditorMode,
  getCurrentEditorFile, initToolbarRefs, getIsFilePanelOpen, setIsFilePanelOpen,
} from './editor-toolbar.js';

let initialized = false;
let selectedElement: HTMLElement | null = null;
let hoverOverlay: HTMLDivElement;
let selectOverlay: HTMLDivElement;
let propsPanel: HTMLDivElement;
let aiChatPanel: HTMLDivElement;
let aiProjectPanel: HTMLDivElement;
const isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

// Multi-selection state
let multiSelectedElements: HTMLElement[] = [];
let multiSelectOverlays: HTMLDivElement[] = [];

// Shared ref for text-toolbar to access selectedElement
const selectedElementRef = {
  get current() { return selectedElement; },
  set current(val: HTMLElement | null) { selectedElement = val; },
};

function clearMultiSelection() {
  for (const ov of multiSelectOverlays) {
    hideOverlay(ov);
    ov.remove();
  }
  multiSelectOverlays = [];
  multiSelectedElements = [];
}

function deselect() {
  if (selectedElement || multiSelectedElements.length > 0) {
    selectedElement = null;
    clearMultiSelection();
    hideOverlay(selectOverlay);
    hideTextToolbar();
    hidePropertiesPanel();
    hideAiChatPanel();
    updateSelectionInfo(null);
  }
}

/** Select a single element (clearing multi-selection). */
function selectSingle(el: HTMLElement) {
  clearMultiSelection();
  selectedElement = el;
  positionOverlay(selectOverlay, el);
  hideOverlay(hoverOverlay);
  updateSelectionInfo(el);
  showTextToolbarForElement(el);
  showPropertiesForElement(el);
  showAiChatForElement(el);
}

/** Toggle an element in/out of multi-selection (Shift+click). */
function toggleMultiSelect(el: HTMLElement) {
  hideTextToolbar();

  // If this is the first shift-click and we already have a single selection,
  // move that single selection into the multi-select array
  if (multiSelectedElements.length === 0 && selectedElement) {
    multiSelectedElements.push(selectedElement);
    const ov = createOverlay('#3b82f6', 'solid');
    positionOverlay(ov, selectedElement);
    multiSelectOverlays.push(ov);
  }

  const idx = multiSelectedElements.indexOf(el);
  if (idx >= 0) {
    // Remove from multi-selection
    multiSelectedElements.splice(idx, 1);
    const ov = multiSelectOverlays.splice(idx, 1)[0];
    if (ov) { hideOverlay(ov); ov.remove(); }
  } else {
    // Add to multi-selection
    multiSelectedElements.push(el);
    const ov = createOverlay('#3b82f6', 'solid');
    positionOverlay(ov, el);
    multiSelectOverlays.push(ov);
  }

  // Update primary selected element to the first in the list
  if (multiSelectedElements.length > 0) {
    selectedElement = multiSelectedElements[0];
    // Hide the single-select overlay; multi-select overlays handle it
    hideOverlay(selectOverlay);
    hideOverlay(hoverOverlay);
    updateSelectionInfo(selectedElement);
    showAiChatForElements(multiSelectedElements);
  } else {
    deselect();
  }
}

/**
 * Creates a synthetic lookup at the touch point to find an annotated element.
 */
function touchToElement(touch: Touch): { element: HTMLElement; source: any } | null {
  let target: HTMLElement | null = document.elementFromPoint(touch.clientX, touch.clientY) as HTMLElement | null;
  if (!target) return null;

  if (target.shadowRoot) {
    const inner = target.shadowRoot.elementFromPoint(touch.clientX, touch.clientY);
    if (inner && inner instanceof HTMLElement) target = inner;
  }

  let el: HTMLElement | null = target;
  while (el) {
    const sourceAttr = el.getAttribute('data-nk-source');
    if (sourceAttr) {
      const lastColon = sourceAttr.lastIndexOf(':');
      if (lastColon !== -1) {
        const file = sourceAttr.substring(0, lastColon);
        const line = parseInt(sourceAttr.substring(lastColon + 1), 10);
        if (!isNaN(line)) {
          return { element: el, source: { file, line, tag: el.tagName.toLowerCase() } };
        }
      }
    }
    if (!el.parentElement && el.getRootNode() !== document) {
      const root = el.getRootNode() as ShadowRoot;
      el = root.host as HTMLElement;
    } else {
      el = el.parentElement;
    }
  }
  return null;
}

function sendPageAiPrompt(prompt: string) {
  if (!isAiProjectPanelOpen()) {
    showAiProjectPanel();
    (getToolbar()?.querySelector('.nk-tb-project-ai') as HTMLElement)?.classList.add('active');
  }
  sendProjectMessage(prompt);
}

export function initStandaloneEditor() {
  if (initialized) return;
  initialized = true;

  // Clean up any stale elements from HMR
  document.getElementById('nk-editor-toolbar')?.remove();
  document.getElementById('nk-file-panel')?.remove();
  document.getElementById('nk-file-editor')?.remove();
  document.getElementById('nk-text-toolbar')?.remove();
  document.getElementById('nk-props-panel')?.remove();
  document.getElementById('nk-ai-chat')?.remove();
  document.getElementById('nk-ai-project')?.remove();

  // Create UI elements
  hoverOverlay = createOverlay('#7c3aed', 'dashed');
  selectOverlay = createOverlay('#3b82f6', 'solid');

  // Initialize toolbar refs before creating toolbar
  initToolbarRefs({ selectOverlay, selectedElement: selectedElementRef, deselect });
  setTextToolbarSelectedElement(selectedElementRef);

  const toolbar = createToolbar();
  const filePanel = createFilePanel();
  createTextToolbar();
  setupTextToolbarHandlers();
  propsPanel = createPropertiesPanel();
  aiChatPanel = createAiChatPanel();
  aiProjectPanel = createAiProjectPanel();

  // Restore saved editor mode
  try {
    const saved = localStorage.getItem('nk-editor-mode');
    if (saved === 'preview') setMode(false);
  } catch {}

  // Start annotator (assigns data-nk-id to custom elements)
  startAnnotator();

  // Setup inline text editing (double-click + double-tap handled inside)
  setupInlineTextEdit();

  // --- Mouse events (desktop) ---

  let lastHoverEl: HTMLElement | null = null;
  let hoverRaf = 0;
  document.addEventListener('mousemove', (event) => {
    if (!getIsEditorMode()) return;
    if (hoverRaf) return;
    hoverRaf = requestAnimationFrame(() => {
      hoverRaf = 0;
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

  // --- Touch events (mobile/tablet) ---

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
        selectedElement = tapEl;
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

  // --- Toolbar button handlers ---

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

  // Ctrl+S / Cmd+S to save in file editor
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
      } else if (selectedElement) {
        deselect();
      }
    }
  });

  // Update overlay positions on scroll/resize
  const updateOverlays = () => {
    if (selectedElement) {
      positionOverlay(selectOverlay, selectedElement);
      const textTb = document.getElementById('nk-text-toolbar');
      if (textTb && textTb.style.display !== 'none') positionTextToolbar(selectedElement);
    }
    // Reposition multi-select overlays
    for (let i = 0; i < multiSelectedElements.length; i++) {
      if (multiSelectedElements[i].isConnected && multiSelectOverlays[i]) {
        positionOverlay(multiSelectOverlays[i], multiSelectedElements[i]);
      }
    }
    updateAiChatPosition();
  };
  window.addEventListener('scroll', updateOverlays, true);
  window.addEventListener('resize', updateOverlays);

  // Re-select element after HMR update
  try {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`, 'vite-hmr');
    ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'custom' && msg.event === 'nk-editor-update') {
          reselectAfterHmr();
        }
      } catch {}
    });
  } catch {}
}

function reselectAfterHmr() {
  if (!selectedElement) return;
  const source = selectedElement.getAttribute('data-nk-source');
  const elTag = selectedElement.tagName.toLowerCase();
  const elClass = selectedElement.className;

  requestAnimationFrame(() => {
    setTimeout(() => {
      let newEl: HTMLElement | null = null;

      if (source) {
        newEl = document.querySelector(`[data-nk-source="${source}"]`);
        if (newEl && newEl.shadowRoot && newEl.tagName.toLowerCase() !== elTag) {
          const inner = newEl.shadowRoot.querySelector(elTag) as HTMLElement
            || (elClass ? newEl.shadowRoot.querySelector(`.${elClass.split(' ')[0]}`) as HTMLElement : null);
          if (inner) newEl = inner;
        }
      }

      if (!newEl && elClass) {
        const hosts = document.querySelectorAll('[data-nk-source]');
        for (const host of hosts) {
          if (host.shadowRoot) {
            const match = host.shadowRoot.querySelector(`${elTag}.${elClass.split(' ')[0]}`) as HTMLElement;
            if (match) { newEl = match; break; }
          }
        }
      }

      if (newEl) {
        selectedElement = newEl;
        positionOverlay(selectOverlay, newEl);
        updateSelectionInfo(newEl);
        showPropertiesForElement(newEl);
        if (isAiChatPanelOpen()) updateAiChatTarget(newEl);
      } else if (selectedElement?.isConnected) {
        showPropertiesForElement(selectedElement);
        if (isAiChatPanelOpen()) updateAiChatTarget(selectedElement);
      }
    }, 150);
  });
}
