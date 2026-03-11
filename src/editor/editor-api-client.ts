import { AstModification } from './ast-modification.js';

export async function applyAstModification(filePath: string, mod: AstModification): Promise<{ content: string }> {
  const res = await fetch(`/__nk_editor/ast/${encodeFilePath(filePath)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(mod),
  });
  if (!res.ok) throw new Error(`AST modification failed: ${res.status}`);
  return res.json();
}

export async function readFile(filePath: string): Promise<{ content: string }> {
  const res = await fetch(`/__nk_editor/files/${encodeFilePath(filePath)}`);
  if (!res.ok) throw new Error(`Read file failed: ${res.status}`);
  return res.json();
}

export async function writeFile(filePath: string, content: string, opts?: { fullHmr?: boolean }): Promise<void> {
  const query = opts?.fullHmr ? '?hmr=full' : '';
  const res = await fetch(`/__nk_editor/files/${encodeFilePath(filePath)}${query}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error(`Write file failed: ${res.status}`);
}

export async function updateTranslation(locale: string, key: string, value: string): Promise<void> {
  const res = await fetch(`/__nk_editor/i18n/${encodeURIComponent(locale)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  });
  if (!res.ok) throw new Error(`Translation update failed: ${res.status}`);
}

export async function makeTranslatable(params: {
  sourceFile: string; elementSelector: string; sourceLine: number;
  i18nKey: string; text: string; locales: string[];
}): Promise<void> {
  const res = await fetch('/__nk_editor/make-translatable', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`Make translatable failed: ${res.status}`);
}

function encodeFilePath(filePath: string): string {
  return filePath.split('/').map(encodeURIComponent).join('/');
}
