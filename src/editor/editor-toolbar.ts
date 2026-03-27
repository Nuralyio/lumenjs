/**
 * Editor Toolbar — main top bar with file browser, edit/preview toggle, and file editor.
 */
import { parseSourceAttr } from './element-annotator.js';
import { setPreviewMode } from './editor-bridge.js';
import { injectToolbarStyles } from './toolbar-styles.js';
import {
  createFilePanel, loadFileList, saveCurrentFile, closeFilePanel,
  getFilePanel, getIsFilePanelOpen, setIsFilePanelOpen, getCurrentEditorFile,
  initFileEditorToolbar,
} from './file-editor.js';

// Re-export file-editor exports for backwards compatibility
export {
  createFilePanel, loadFileList, saveCurrentFile, closeFilePanel,
  getFilePanel, getIsFilePanelOpen, setIsFilePanelOpen, getCurrentEditorFile,
};

const isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

let toolbar: HTMLDivElement;
let isEditorMode = true;

// These are set by standalone-overlay during init
let selectOverlayRef: HTMLDivElement;
let selectedElementRef: { current: HTMLElement | null };
let deselectFn: () => void;

export function initToolbarRefs(refs: {
  selectOverlay: HTMLDivElement;
  selectedElement: { current: HTMLElement | null };
  deselect: () => void;
}) {
  selectOverlayRef = refs.selectOverlay;
  selectedElementRef = refs.selectedElement;
  deselectFn = refs.deselect;
}

export function getToolbar(): HTMLDivElement {
  return toolbar;
}

export function getIsEditorMode(): boolean {
  return isEditorMode;
}

export function createToolbar(): HTMLDivElement {
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
        <button class="nk-tb-toggle" id="nk-tb-toggle" title="Toggle Edit / Preview">
          <span class="nk-tb-toggle-edit active">Edit</span>
          <span class="nk-tb-toggle-preview">Preview</span>
        </button>
      </div>
      <div class="nk-toolbar-center" id="nk-tb-selection">
        <span class="nk-tb-hint">${isTouchDevice ? 'Tap to select. Double-tap text to edit.' : 'Click to select. Double-click text to edit.'}</span>
      </div>
      <div class="nk-toolbar-right">
        <div class="nk-tb-page-ai">
          <span class="nk-tb-page-ai-icon">✦</span>
          <input class="nk-tb-page-ai-input" type="text" placeholder="Ask AI about this page..." />
          <button class="nk-tb-page-ai-send" disabled title="Send">▶</button>
        </div>
        <button class="nk-tb-btn nk-tb-project-ai" title="Project AI Chat" style="display:flex;align-items:center;gap:4px">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
          <span class="nk-tb-project-ai-label">Chat</span>
        </button>
        <button class="nk-tb-btn nk-tb-deselect" style="display:none" title="Deselect">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>
  `;
  injectToolbarStyles();
  document.body.appendChild(bar);
  toolbar = bar;

  // Wire up the toolbar reference for the file editor module
  initFileEditorToolbar(bar);

  return bar;
}

export function updateSelectionInfo(el: HTMLElement | null) {
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

export function setMode(editMode: boolean) {
  isEditorMode = editMode;
  try { localStorage.setItem('nk-editor-mode', editMode ? 'edit' : 'preview'); } catch {}
  const toggle = document.getElementById('nk-tb-toggle')!;
  const editSpan = toggle.querySelector('.nk-tb-toggle-edit')!;
  const previewSpan = toggle.querySelector('.nk-tb-toggle-preview')!;
  const center = document.getElementById('nk-tb-selection')!;

  setPreviewMode(!editMode);

  if (editMode) {
    editSpan.classList.add('active');
    previewSpan.classList.remove('active');
    center.innerHTML = `<span class="nk-tb-hint">${isTouchDevice ? 'Tap to select. Double-tap text to edit.' : 'Click to select. Double-click text to edit.'}</span>`;
  } else {
    previewSpan.classList.add('active');
    editSpan.classList.remove('active');
    center.innerHTML = '<span class="nk-tb-hint">Preview mode — interact normally</span>';
    // Deselect and close panels
    deselectFn();
    if (getIsFilePanelOpen()) closeFilePanel();
  }
}
