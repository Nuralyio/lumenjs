/**
 * File Editor — file panel, file list, editor opening/saving, and close logic.
 */
import { highlightCode } from './syntax-highlighter.js';
import { readFile, writeFile } from './editor-api-client.js';
import { CodeJar } from 'codejar';

let filePanel: HTMLDivElement;
let isFilePanelOpen = false;
let currentEditorFile: string | null = null;
let jar: CodeJar | null = null;

/** Provide the toolbar element so closeFilePanel can access it. */
let toolbarEl: HTMLDivElement;
export function initFileEditorToolbar(tb: HTMLDivElement) {
  toolbarEl = tb;
}

export function getFilePanel(): HTMLDivElement {
  return filePanel;
}

export function getIsFilePanelOpen(): boolean {
  return isFilePanelOpen;
}

export function setIsFilePanelOpen(val: boolean) {
  isFilePanelOpen = val;
}

export function getCurrentEditorFile(): string | null {
  return currentEditorFile;
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
    <div class="nk-fe-editor" id="nk-fe-editor"></div>
  `;

  document.body.appendChild(editor);

  // Initialize CodeJar with syntax highlighting and auto-save
  let saveDebounce: ReturnType<typeof setTimeout> | null = null;
  const editorEl = editor.querySelector('#nk-fe-editor') as HTMLDivElement;
  jar = CodeJar(editorEl, highlightCode, { tab: '  ', spellcheck: false });
  jar.onUpdate((code) => {
    if (saveDebounce) clearTimeout(saveDebounce);
    saveDebounce = setTimeout(() => {
      if (currentEditorFile) {
        const saveBtn = document.getElementById('nk-fe-save') as HTMLButtonElement;
        saveBtn.textContent = 'Saving...';
        writeFile(currentEditorFile, code).then(() => {
          saveBtn.textContent = 'Saved!';
          saveBtn.style.background = '#22c55e';
          setTimeout(() => { saveBtn.textContent = 'Save'; saveBtn.style.background = ''; }, 1500);
        }).catch(() => {
          saveBtn.textContent = 'Error!';
          saveBtn.style.background = '#ef4444';
          setTimeout(() => { saveBtn.textContent = 'Save'; saveBtn.style.background = ''; }, 2000);
        });
      }
    }, 1000);
  });

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

  // On mobile, close the file list to make room for the editor
  if (window.innerWidth <= 640) {
    filePanel.classList.remove('open');
  }

  try {
    const data = await readFile(filePath);
    currentEditorFile = filePath;
    pathEl.textContent = filePath;
    jar!.updateCode(data.content);
    editorPanel.classList.add('open');
  } catch {
    pathEl.textContent = filePath;
    jar!.updateCode('// Error loading file');
    editorPanel.classList.add('open');
  }
}

export async function saveCurrentFile() {
  if (!currentEditorFile || !jar) return;
  const saveBtn = document.getElementById('nk-fe-save') as HTMLButtonElement;
  try {
    saveBtn.textContent = 'Saving...';
    await writeFile(currentEditorFile, jar.toString());
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

export function closeFilePanel() {
  isFilePanelOpen = false;
  filePanel.classList.remove('open');
  (toolbarEl.querySelector('.nk-tb-files') as HTMLElement).classList.remove('active');
  document.getElementById('nk-file-editor')?.classList.remove('open');
  currentEditorFile = null;
}
