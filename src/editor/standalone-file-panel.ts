/**
 * Standalone File Panel — file browser and code editor panel for the
 * standalone editor overlay.
 */
import { readFile, writeFile } from './editor-api-client.js';

let filePanel: HTMLDivElement;
let isFilePanelOpen = false;
let currentEditorFile: string | null = null;

export function isFilePanelCurrentlyOpen(): boolean {
  return isFilePanelOpen;
}

export function getCurrentEditorFile(): string | null {
  return currentEditorFile;
}

export function initFilePanel(): HTMLDivElement {
  const panel = document.createElement('div');
  panel.id = 'nk-file-panel';
  panel.innerHTML = `
    <div class="nk-fp-header">
      <span>Project Files</span>
      <button class="nk-fp-close-btn" id="nk-fp-close">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="nk-fp-list" id="nk-fp-list"></div>
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

  filePanel = panel;
  return panel;
}

function getFileIcon(name: string): string {
  if (name.endsWith('.ts')) return '<span style="color:#3178c6">TS</span>';
  if (name.endsWith('.js')) return '<span style="color:#f7df1e">JS</span>';
  if (name.endsWith('.json')) return '<span style="color:#94a3b8">{}</span>';
  if (name.endsWith('.css')) return '<span style="color:#38bdf8">#</span>';
  return '<span style="color:#64748b">~</span>';
}

export async function loadFileList(): Promise<void> {
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
      const item = (e.target as HTMLElement).closest('.nk-fp-item') as HTMLElement | null;
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

async function openFileEditor(filePath: string): Promise<void> {
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

export async function saveCurrentFile(): Promise<void> {
  if (!currentEditorFile) return;
  const textarea = document.getElementById('nk-fe-textarea') as HTMLTextAreaElement;
  const saveBtn = document.getElementById('nk-fe-save')!;

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

export function closeFilePanel(toolbar: HTMLElement): void {
  isFilePanelOpen = false;
  filePanel.classList.remove('open');
  toolbar.querySelector('.nk-tb-files')!.classList.remove('active');
  document.getElementById('nk-file-editor')?.classList.remove('open');
  currentEditorFile = null;
}

export function openFilePanel(toolbar: HTMLElement): void {
  isFilePanelOpen = true;
  filePanel.classList.add('open');
  toolbar.querySelector('.nk-tb-files')!.classList.add('active');
  loadFileList();
}

export function closeEditorOnly(): void {
  document.getElementById('nk-file-editor')!.classList.remove('open');
  currentEditorFile = null;
  // On mobile, re-show the file list
  if (window.innerWidth <= 640 && isFilePanelOpen) {
    filePanel.classList.add('open');
  }
}
