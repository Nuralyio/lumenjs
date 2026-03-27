/**
 * Overlay Selection State & Logic — owns selection state and exposes
 * getters/setters so other overlay modules can share it.
 */
import { createOverlay, positionOverlay, hideOverlay } from './overlay-utils.js';
import {
  showTextToolbarForElement, hideTextToolbar,
} from './text-toolbar.js';
import { showPropertiesForElement, hidePropertiesPanel } from './properties-panel.js';
import { showAiChatForElement, showAiChatForElements, hideAiChatPanel } from './ai-chat-panel.js';
import { showAiProjectPanel, isAiProjectPanelOpen, sendProjectMessage } from './ai-project-panel.js';
import { updateSelectionInfo, getToolbar } from './editor-toolbar.js';

// ── Module state ──

let selectedElement: HTMLElement | null = null;
let hoverOverlay: HTMLDivElement;
let selectOverlay: HTMLDivElement;
let multiSelectedElements: HTMLElement[] = [];
let multiSelectOverlays: HTMLDivElement[] = [];

/**
 * Shared ref for text-toolbar (and other modules) to access selectedElement.
 * Backed by the module-level variable — reads/writes go through the proxy.
 */
export const selectedElementRef = {
  get current() { return selectedElement; },
  set current(val: HTMLElement | null) { selectedElement = val; },
};

// ── Getters / setters for shared overlay references ──

export function getSelectedElement(): HTMLElement | null { return selectedElement; }
export function setSelectedElement(el: HTMLElement | null) { selectedElement = el; }

export function getHoverOverlay(): HTMLDivElement { return hoverOverlay; }
export function setHoverOverlay(ov: HTMLDivElement) { hoverOverlay = ov; }

export function getSelectOverlay(): HTMLDivElement { return selectOverlay; }
export function setSelectOverlay(ov: HTMLDivElement) { selectOverlay = ov; }

export function getMultiSelectedElements(): HTMLElement[] { return multiSelectedElements; }
export function getMultiSelectOverlays(): HTMLDivElement[] { return multiSelectOverlays; }

// ── Selection logic ──

export function clearMultiSelection() {
  for (const ov of multiSelectOverlays) {
    hideOverlay(ov);
    ov.remove();
  }
  multiSelectOverlays = [];
  multiSelectedElements = [];
}

export function deselect() {
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
export function selectSingle(el: HTMLElement) {
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
export function toggleMultiSelect(el: HTMLElement) {
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

// ── Touch helpers ──

/**
 * Creates a synthetic lookup at the touch point to find an annotated element.
 */
export function touchToElement(touch: Touch): { element: HTMLElement; source: any } | null {
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

export function sendPageAiPrompt(prompt: string) {
  if (!isAiProjectPanelOpen()) {
    showAiProjectPanel();
    (getToolbar()?.querySelector('.nk-tb-project-ai') as HTMLElement)?.classList.add('active');
  }
  sendProjectMessage(prompt);
}
