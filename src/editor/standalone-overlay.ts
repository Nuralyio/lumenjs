/**
 * Standalone Editor Overlay — visual editing UI when running outside Studio iframe.
 * Hover/click selection, toolbar, touch support, file panel orchestration.
 */
import { findAnnotatedElement, parseSourceAttr, startAnnotator } from './element-annotator.js';
import { setupInlineTextEdit, triggerInlineEdit } from './inline-text-edit.js';
import { createOverlay, positionOverlay, hideOverlay } from './standalone-overlay-dom.js';
import { EDITOR_STYLES } from './standalone-overlay-styles.js';
import {
  initFilePanel, closeFilePanel, openFilePanel, closeEditorOnly,
  saveCurrentFile, isFilePanelCurrentlyOpen, getCurrentEditorFile,
} from './standalone-file-panel.js';

let selectedElement: HTMLElement | null = null;
let hoverOverlay: HTMLDivElement;
let selectOverlay: HTMLDivElement;
let toolbar: HTMLDivElement;

const isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

function createToolbar(): HTMLDivElement {
  const bar = document.createElement('div');
  bar.id = 'nk-editor-toolbar';
  bar.innerHTML = `
    <div class="nk-toolbar-inner">
      <div class="nk-toolbar-left">
        <button class="nk-tb-btn nk-tb-files" title="Browse Files">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>
          <span class="nk-tb-files-label">Files</span>
        </button>
        <span class="nk-tb-divider"></span>
        <span class="nk-tb-mode">Editor</span>
      </div>
      <div class="nk-toolbar-center" id="nk-tb-selection">
        <span class="nk-tb-hint">${isTouchDevice ? 'Tap to select. Double-tap text to edit.' : 'Click to select. Double-click text to edit.'}</span>
      </div>
      <div class="nk-toolbar-right">
        <button class="nk-tb-btn nk-tb-deselect" style="display:none" title="Deselect">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>
  `;
  const style = document.createElement('style');
  style.textContent = EDITOR_STYLES;
  document.head.appendChild(style);
  document.body.appendChild(bar);
  return bar;
}

function updateSelectionInfo(el: HTMLElement | null): void {
  const center = document.getElementById('nk-tb-selection')!;
  const deselectBtn = toolbar.querySelector('.nk-tb-deselect') as HTMLElement;
  if (!el) {
    center.innerHTML = `<span class="nk-tb-hint">${isTouchDevice ? 'Tap to select. Double-tap text to edit.' : 'Click to select. Double-click text to edit.'}</span>`;
    deselectBtn.style.display = 'none';
    return;
  }
  const sourceAttr = el.getAttribute('data-nk-source');
  const source = sourceAttr ? parseSourceAttr(sourceAttr) : null;
  const tag = el.tagName.toLowerCase();
  const attrs = Array.from(el.attributes)
    .filter(a => !a.name.startsWith('data-nk-'))
    .map(a => a.value ? `${a.name}="${a.value}"` : a.name)
    .slice(0, 3);
  const attrStr = attrs.length ? ` <span class="nk-tb-attrs">${attrs.join(' ')}</span>` : '';
  const sourceStr = source ? ` <span class="nk-tb-source">${source.file}:${source.line}</span>` : '';
  center.innerHTML = `<span class="nk-tb-tag">&lt;${tag}&gt;</span>${attrStr}${sourceStr}`;
  deselectBtn.style.display = 'inline-flex';
}

function deselect(): void {
  if (selectedElement) {
    selectedElement = null;
    hideOverlay(selectOverlay);
    updateSelectionInfo(null);
  }
}

function touchToElement(touch: Touch): { element: HTMLElement; source: { file: string; line: number; tag: string } } | null {
  const target = document.elementFromPoint(touch.clientX, touch.clientY);
  if (!target || !(target instanceof HTMLElement)) return null;
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
    el = el.parentElement;
  }
  return null;
}

function selectElement(el: HTMLElement): void {
  selectedElement = el;
  positionOverlay(selectOverlay, el);
  hideOverlay(hoverOverlay);
  updateSelectionInfo(el);
}

export function initStandaloneEditor(): void {
  hoverOverlay = createOverlay('#7c3aed', 'dashed');
  selectOverlay = createOverlay('#3b82f6', 'solid');
  toolbar = createToolbar();
  initFilePanel();
  startAnnotator();
  setupInlineTextEdit();

  // Mouse hover
  document.addEventListener('mouseover', (e) => {
    const r = findAnnotatedElement(e);
    r && r.element !== selectedElement ? positionOverlay(hoverOverlay, r.element) : hideOverlay(hoverOverlay);
  }, true);
  document.addEventListener('mouseout', () => hideOverlay(hoverOverlay), true);

  // Click to select (desktop)
  let clickTimer: ReturnType<typeof setTimeout> | null = null;
  document.addEventListener('click', (e) => {
    if (isTouchDevice) return;
    const r = findAnnotatedElement(e);
    if (!r) return;
    e.preventDefault();
    e.stopPropagation();
    if (clickTimer) clearTimeout(clickTimer);
    clickTimer = setTimeout(() => selectElement(r.element), 200);
  }, true);
  document.addEventListener('dblclick', () => {
    if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
  }, true);

  // Touch events (mobile/tablet)
  let lastTapTime = 0;
  let lastTapTarget: HTMLElement | null = null;
  let tapTimer: ReturnType<typeof setTimeout> | null = null;
  document.addEventListener('touchend', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('#nk-editor-toolbar') || t.closest('#nk-file-panel') || t.closest('#nk-file-editor')) return;
    const touch = e.changedTouches[0];
    if (!touch) return;
    const r = touchToElement(touch);
    if (!r) return;
    const now = Date.now();
    const isDoubleTap = (now - lastTapTime < 350) && lastTapTarget === r.element;
    lastTapTime = now;
    lastTapTarget = r.element;
    if (isDoubleTap) {
      if (tapTimer) { clearTimeout(tapTimer); tapTimer = null; }
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      if (el instanceof HTMLElement) triggerInlineEdit(el);
    } else {
      if (tapTimer) clearTimeout(tapTimer);
      tapTimer = setTimeout(() => selectElement(r.element), 300);
    }
    e.preventDefault();
  }, { passive: false, capture: true });

  // Toolbar buttons
  toolbar.querySelector('.nk-tb-deselect')!.addEventListener('click', (e) => { e.stopPropagation(); deselect(); });
  toolbar.querySelector('.nk-tb-files')!.addEventListener('click', (e) => {
    e.stopPropagation();
    isFilePanelCurrentlyOpen() ? closeFilePanel(toolbar) : openFilePanel(toolbar);
  });
  document.getElementById('nk-fp-close')!.addEventListener('click', (e) => { e.stopPropagation(); closeFilePanel(toolbar); });
  document.getElementById('nk-fe-save')!.addEventListener('click', saveCurrentFile);
  document.getElementById('nk-fe-close')!.addEventListener('click', closeEditorOnly);

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's' && getCurrentEditorFile()) { e.preventDefault(); saveCurrentFile(); }
    if (e.key === 'Escape') {
      if (getCurrentEditorFile()) closeEditorOnly();
      else if (isFilePanelCurrentlyOpen()) closeFilePanel(toolbar);
      else if (selectedElement) deselect();
    }
  });

  // Update overlays on scroll/resize
  const update = () => { if (selectedElement) positionOverlay(selectOverlay, selectedElement); };
  window.addEventListener('scroll', update, true);
  window.addEventListener('resize', update);
}
