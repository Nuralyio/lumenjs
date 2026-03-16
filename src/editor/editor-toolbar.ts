/**
 * Editor Toolbar — main top bar with file browser, edit/preview toggle, and file editor.
 */
import { parseSourceAttr } from './element-annotator.js';
import { readFile, writeFile } from './editor-api-client.js';
import { setPreviewMode } from './editor-bridge.js';
import { hidePropertiesPanel } from './properties-panel.js';
import { hideAiChatPanel } from './ai-chat-panel.js';
import { hideOverlay } from './overlay-utils.js';
import { hideTextToolbar } from './text-toolbar.js';

const isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

let toolbar: HTMLDivElement;
let filePanel: HTMLDivElement;
let isFilePanelOpen = false;
let isEditorMode = true;
let currentEditorFile: string | null = null;

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

export function getFilePanel(): HTMLDivElement {
  return filePanel;
}

export function getIsEditorMode(): boolean {
  return isEditorMode;
}

export function getCurrentEditorFile(): string | null {
  return currentEditorFile;
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
  const style = document.createElement('style');
  style.textContent = `
    #nk-editor-toolbar {
      position: fixed; top: 0; left: 0; right: 0; height: 44px;
      background: #1e1b2e; color: #e2e8f0; font-family: system-ui, -apple-system, sans-serif;
      font-size: 12px; z-index: 99999; box-shadow: 0 2px 12px rgba(0,0,0,0.3);
      user-select: none; -webkit-user-select: none; touch-action: manipulation;
    }
    .nk-toolbar-inner {
      display: flex; align-items: center; height: 44px; padding: 0 12px; gap: 8px;
    }
    .nk-toolbar-left, .nk-toolbar-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
    .nk-toolbar-center { flex: 1; text-align: center; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .nk-tb-hint { color: #64748b; }
    .nk-tb-mode { color: #7c3aed; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
    .nk-tb-divider { width: 1px; height: 16px; background: #334155; }
    .nk-tb-btn {
      display: inline-flex; align-items: center; gap: 4px; padding: 6px 10px;
      background: transparent; border: 1px solid #334155; border-radius: 6px;
      color: #e2e8f0; cursor: pointer; font-size: 11px; font-family: inherit;
      transition: all 0.15s; -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
    }
    .nk-tb-btn:hover { background: #334155; border-color: #475569; }
    .nk-tb-btn:active { background: #475569; }
    .nk-tb-btn.active { background: #7c3aed; border-color: #7c3aed; }
    .nk-tb-project-ai-label { font-size: 11px; font-weight: 600; }
    .nk-tb-page-ai {
      display: flex; align-items: center; gap: 0;
      background: #0f0d1a; border: 1px solid #334155; border-radius: 8px;
      padding: 0 2px 0 8px; height: 30px; transition: border-color 0.15s;
    }
    .nk-tb-page-ai:focus-within { border-color: #7c3aed; }
    .nk-tb-page-ai-icon { color: #7c3aed; font-size: 12px; flex-shrink: 0; margin-right: 4px; }
    .nk-tb-page-ai-input {
      background: transparent; border: none; color: #e2e8f0; font-size: 12px;
      font-family: inherit; outline: none; width: 180px; padding: 0;
    }
    .nk-tb-page-ai-input::placeholder { color: #64748b; }
    .nk-tb-page-ai-send {
      background: #7c3aed; border: none; color: #fff; width: 24px; height: 24px;
      border-radius: 6px; cursor: pointer; font-size: 10px; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center; transition: opacity 0.15s;
    }
    .nk-tb-page-ai-send:disabled { opacity: 0.3; cursor: default; }
    .nk-tb-page-ai-send:not(:disabled):hover { background: #6d28d9; }
    @media (max-width: 640px) {
      .nk-tb-project-ai-label { display: none; }
      .nk-tb-page-ai-input { width: 100px; }
    }
    .nk-tb-toggle {
      display: inline-flex; align-items: center; padding: 2px; gap: 0;
      background: #0f0d1a; border: 1px solid #334155; border-radius: 6px;
      cursor: pointer; font-family: inherit;
      -webkit-tap-highlight-color: transparent; touch-action: manipulation;
    }
    .nk-tb-toggle span {
      padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: 600;
      color: #64748b; transition: all 0.15s; letter-spacing: 0.03em;
    }
    .nk-tb-toggle span.active { background: #7c3aed; color: #fff; }
    .nk-tb-tag { color: #67e8f9; font-family: 'SF Mono', ui-monospace, monospace; }
    .nk-tb-source { color: #86efac; font-family: 'SF Mono', ui-monospace, monospace; font-size: 11px; }
    .nk-tb-attrs { color: #94a3b8; font-size: 11px; }

    /* File panel — sidebar on desktop, full-width sheet on mobile */
    #nk-file-panel {
      position: fixed; top: 44px; left: 0; width: 320px; max-height: calc(100vh - 44px);
      background: #1e1b2e; border-right: 1px solid #334155; border-bottom: 1px solid #334155;
      z-index: 99999; display: none; flex-direction: column; font-family: system-ui, -apple-system, sans-serif;
      box-shadow: 4px 0 16px rgba(0,0,0,0.3);
      padding-bottom: env(safe-area-inset-bottom, 0); touch-action: manipulation;
    }
    #nk-file-panel.open { display: flex; }
    .nk-fp-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 12px; border-bottom: 1px solid #334155; color: #e2e8f0; font-size: 13px; font-weight: 600;
    }
    .nk-fp-close-btn {
      display: none; background: none; border: none; color: #94a3b8; cursor: pointer;
      padding: 4px; -webkit-tap-highlight-color: transparent;
    }
    .nk-fp-list {
      flex: 1; overflow-y: auto; padding: 4px 0;
      -webkit-overflow-scrolling: touch;
    }
    .nk-fp-item {
      display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer;
      color: #94a3b8; font-size: 12px; font-family: 'SF Mono', ui-monospace, monospace;
      transition: background 0.1s; -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
    }
    .nk-fp-item:hover { background: #262338; color: #e2e8f0; }
    .nk-fp-item:active { background: #334155; }
    .nk-fp-item.active { background: #7c3aed22; color: #c084fc; }
    .nk-fp-icon { width: 14px; text-align: center; flex-shrink: 0; }

    /* Tabs in file panel header */
    .nk-fp-tabs {
      display: flex; gap: 2px; background: #0f0d1a; border-radius: 6px; padding: 2px;
    }
    .nk-fp-tab {
      padding: 4px 12px; border: none; border-radius: 4px; font-size: 11px; font-weight: 600;
      font-family: inherit; color: #64748b; background: transparent; cursor: pointer;
      transition: all 0.15s; -webkit-tap-highlight-color: transparent; touch-action: manipulation;
    }
    .nk-fp-tab:hover { color: #e2e8f0; }
    .nk-fp-tab.active { background: #7c3aed; color: #fff; }

    /* Pages view */
    .nk-fp-pages {
      flex: 1; overflow-y: auto; padding: 4px 0; -webkit-overflow-scrolling: touch;
    }
    .nk-fp-layout-group { margin-bottom: 4px; }
    .nk-fp-layout-label {
      padding: 8px 12px 4px; font-size: 10px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.05em; color: #7c3aed; font-family: system-ui, sans-serif;
    }
    .nk-fp-route {
      display: flex; align-items: center; gap: 8px; padding: 6px 12px 6px 24px; cursor: pointer;
      color: #94a3b8; font-size: 12px; font-family: 'SF Mono', ui-monospace, monospace;
      transition: background 0.1s; -webkit-tap-highlight-color: transparent; touch-action: manipulation;
    }
    .nk-fp-route:hover { background: #262338; color: #e2e8f0; }
    .nk-fp-route:active { background: #334155; }
    .nk-fp-route.active { background: #7c3aed22; color: #c084fc; }

    /* File editor — right of sidebar on desktop, full-width on mobile */
    #nk-file-editor {
      position: fixed; top: 44px; left: 320px; right: 0; max-height: calc(100vh - 44px);
      background: #0f0d1a; border-bottom: 1px solid #334155; z-index: 99999;
      display: none; flex-direction: column;
      padding-bottom: env(safe-area-inset-bottom, 0);
    }
    #nk-file-editor.open { display: flex; }
    .nk-fe-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 12px; border-bottom: 1px solid #334155; color: #e2e8f0; font-size: 12px;
      gap: 8px; flex-wrap: wrap;
    }
    .nk-fe-header .nk-fe-path {
      font-family: 'SF Mono', ui-monospace, monospace; font-size: 11px; color: #86efac;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1;
    }
    .nk-fe-btns { display: flex; gap: 6px; flex-shrink: 0; }
    .nk-fe-textarea {
      flex: 1; width: 100%; background: #0f0d1a; color: #e2e8f0; border: none; padding: 12px;
      font-family: 'SF Mono', ui-monospace, monospace; font-size: 13px; line-height: 1.6;
      resize: none; outline: none; tab-size: 2; min-height: 250px;
      -webkit-overflow-scrolling: touch;
    }
    .nk-fe-save {
      padding: 6px 14px; background: #7c3aed; color: white; border: none; border-radius: 6px;
      cursor: pointer; font-size: 12px; font-family: inherit; font-weight: 500;
      -webkit-tap-highlight-color: transparent; touch-action: manipulation;
    }
    .nk-fe-save:hover { background: #6d28d9; }
    .nk-fe-save:active { background: #5b21b6; }
    .nk-fe-cancel {
      padding: 6px 14px; background: transparent; color: #94a3b8; border: 1px solid #334155;
      border-radius: 6px; cursor: pointer; font-size: 12px; font-family: inherit;
      -webkit-tap-highlight-color: transparent; touch-action: manipulation;
    }
    .nk-fe-cancel:hover { background: #334155; color: #e2e8f0; }

    /* Mobile responsive (<640px) */
    @media (max-width: 640px) {
      .nk-tb-files-label { display: none; }
      .nk-tb-source { display: none; }
      .nk-tb-attrs { display: none; }
      .nk-tb-hint { font-size: 11px; }

      #nk-file-panel {
        width: 100%; right: 0; border-right: none;
        max-height: 50vh;
      }
      .nk-fp-close-btn { display: block; }
      .nk-fp-item { padding: 10px 12px; font-size: 13px; }

      #nk-file-editor {
        left: 0; max-height: 60vh;
      }
      .nk-fe-textarea { font-size: 14px; min-height: 200px; }
    }

    /* Push page content down so toolbar doesn't cover it */
    body { padding-top: 44px !important; }
  `;
  document.head.appendChild(style);
  document.body.appendChild(bar);
  toolbar = bar;
  return bar;
}

export function createFilePanel(): HTMLDivElement {
  const panel = document.createElement('div');
  panel.id = 'nk-file-panel';
  panel.innerHTML = `
    <div class="nk-fp-header">
      <div class="nk-fp-tabs">
        <button class="nk-fp-tab active" data-tab="files">Files</button>
        <button class="nk-fp-tab" data-tab="pages">Pages</button>
      </div>
      <button class="nk-fp-close-btn" id="nk-fp-close">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="nk-fp-list" id="nk-fp-list"></div>
    <div class="nk-fp-pages" id="nk-fp-pages" style="display:none"></div>
  `;
  document.body.appendChild(panel);

  // File editor panel
  const editor = document.createElement('div');
  editor.id = 'nk-file-editor';
  editor.innerHTML = `
    <div class="nk-fe-header">
      <span class="nk-fe-path" id="nk-fe-path"></span>
      <div class="nk-fe-btns">
        <button class="nk-fe-save" id="nk-fe-save">Save</button>
        <button class="nk-fe-cancel" id="nk-fe-close">Close</button>
      </div>
    </div>
    <textarea class="nk-fe-textarea" id="nk-fe-textarea" spellcheck="false" autocapitalize="off" autocorrect="off"></textarea>
  `;
  document.body.appendChild(editor);

  // Tab switching
  let pagesLoaded = false;
  panel.addEventListener('click', (e) => {
    const tab = (e.target as HTMLElement).closest('.nk-fp-tab') as HTMLElement;
    if (!tab) return;
    const tabName = tab.dataset.tab;
    panel.querySelectorAll('.nk-fp-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const filesList = panel.querySelector('#nk-fp-list') as HTMLElement;
    const pagesList = panel.querySelector('#nk-fp-pages') as HTMLElement;
    if (tabName === 'files') {
      filesList.style.display = '';
      pagesList.style.display = 'none';
    } else {
      filesList.style.display = 'none';
      pagesList.style.display = '';
      if (!pagesLoaded) {
        pagesLoaded = true;
        loadPagesList();
      }
    }
  });

  filePanel = panel;
  return panel;
}

async function loadPagesList() {
  const container = document.getElementById('nk-fp-pages');
  if (!container) return;
  try {
    const res = await fetch('/__nk_editor/routes');
    const data = await res.json();
    const routes: Array<{ path: string; tagName: string; file: string; layouts?: Array<{ tagName: string; dir: string }> }> = data.routes || [];

    // Group by deepest layout
    const groups = new Map<string, typeof routes>();
    for (const r of routes) {
      const layoutLabel = r.layouts?.length ? r.layouts[r.layouts.length - 1].tagName : 'no-layout';
      if (!groups.has(layoutLabel)) groups.set(layoutLabel, []);
      groups.get(layoutLabel)!.push(r);
    }

    let html = '';
    for (const [layout, groupRoutes] of groups) {
      html += `<div class="nk-fp-layout-group">`;
      html += `<div class="nk-fp-layout-label">${layout}</div>`;
      for (const r of groupRoutes) {
        const currentPath = window.location.pathname;
        // Match current page (handle dynamic segments)
        const routeRegex = r.path.replace(/:[^/]+/g, '[^/]+');
        const isActive = new RegExp(`^${routeRegex}$`).test(currentPath);
        html += `<div class="nk-fp-route${isActive ? ' active' : ''}" data-route="${r.path}">${r.path}</div>`;
      }
      html += `</div>`;
    }
    container.innerHTML = html;
    container.addEventListener('click', (e) => {
      const route = (e.target as HTMLElement).closest('.nk-fp-route') as HTMLElement;
      if (!route) return;
      window.location.href = route.dataset.route!;
    });
  } catch {
    container.innerHTML = '<div style="padding:12px;color:#f87171;font-size:11px">Failed to load pages</div>';
  }
}

function getFileIcon(name: string): string {
  if (name.endsWith('.ts')) return '<span style="color:#3178c6">TS</span>';
  if (name.endsWith('.js')) return '<span style="color:#f7df1e">JS</span>';
  if (name.endsWith('.json')) return '<span style="color:#94a3b8">{}</span>';
  if (name.endsWith('.css')) return '<span style="color:#38bdf8">#</span>';
  return '<span style="color:#64748b">~</span>';
}

export async function loadFileList() {
  const listEl = document.getElementById('nk-fp-list');
  if (!listEl) return;
  try {
    const res = await fetch('/__nk_editor/files');
    const data = await res.json();
    const files: string[] = data.files || [];
    listEl.innerHTML = files.map(f =>
      `<div class="nk-fp-item" data-file="${f}">
        <span class="nk-fp-icon">${getFileIcon(f)}</span>
        <span>${f}</span>
      </div>`
    ).join('');

    listEl.addEventListener('click', (e) => {
      const item = (e.target as HTMLElement).closest('.nk-fp-item') as HTMLElement;
      if (!item) return;
      const file = item.dataset.file!;
      openFileEditor(file);
      listEl.querySelectorAll('.nk-fp-item').forEach(el => el.classList.remove('active'));
      item.classList.add('active');
    });
  } catch {
    listEl.innerHTML = '<div style="padding:12px;color:#f87171;font-size:11px">Failed to load files</div>';
  }
}

async function openFileEditor(filePath: string) {
  const editorPanel = document.getElementById('nk-file-editor')!;
  const pathEl = document.getElementById('nk-fe-path')!;
  const textarea = document.getElementById('nk-fe-textarea') as HTMLTextAreaElement;

  // On mobile, close the file list to make room for the editor
  if (window.innerWidth <= 640) {
    filePanel.classList.remove('open');
  }

  try {
    const data = await readFile(filePath);
    currentEditorFile = filePath;
    pathEl.textContent = filePath;
    textarea.value = data.content;
    editorPanel.classList.add('open');
  } catch {
    pathEl.textContent = filePath;
    textarea.value = '// Error loading file';
    editorPanel.classList.add('open');
  }
}

export async function saveCurrentFile() {
  if (!currentEditorFile) return;
  const textarea = document.getElementById('nk-fe-textarea') as HTMLTextAreaElement;
  const saveBtn = document.getElementById('nk-fe-save') as HTMLButtonElement;
  try {
    saveBtn.textContent = 'Saving...';
    await writeFile(currentEditorFile, textarea.value);
    saveBtn.textContent = 'Saved!';
    saveBtn.style.background = '#22c55e';
    setTimeout(() => {
      saveBtn.textContent = 'Save';
      saveBtn.style.background = '';
    }, 1500);
  } catch {
    saveBtn.textContent = 'Error!';
    saveBtn.style.background = '#ef4444';
    setTimeout(() => {
      saveBtn.textContent = 'Save';
      saveBtn.style.background = '';
    }, 2000);
  }
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

export function closeFilePanel() {
  isFilePanelOpen = false;
  filePanel.classList.remove('open');
  (toolbar.querySelector('.nk-tb-files') as HTMLElement).classList.remove('active');
  document.getElementById('nk-file-editor')?.classList.remove('open');
  currentEditorFile = null;
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
    if (isFilePanelOpen) closeFilePanel();
  }
}

export function getIsFilePanelOpen(): boolean {
  return isFilePanelOpen;
}

export function setIsFilePanelOpen(val: boolean) {
  isFilePanelOpen = val;
}
