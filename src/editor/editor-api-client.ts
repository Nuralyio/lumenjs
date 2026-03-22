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

export async function writeFile(filePath: string, content: string): Promise<void> {
  const res = await fetch(`/__nk_editor/files/${encodeFilePath(filePath)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error(`Write file failed: ${res.status}`);
}

export async function listFiles(): Promise<{ files: string[] }> {
  const res = await fetch('/__nk_editor/files');
  if (!res.ok) throw new Error(`List files failed: ${res.status}`);
  return res.json();
}

/**
 * Update a translation value for a given locale and i18n key.
 */
export async function updateTranslation(locale: string, key: string, value: string): Promise<void> {
  const filePath = `locales/${locale}.json`;
  try {
    const { content } = await readFile(filePath);
    const translations = JSON.parse(content);
    translations[key] = value;
    await writeFile(filePath, JSON.stringify(translations, null, 2));
  } catch {
    // If file doesn't exist, create it
    await writeFile(filePath, JSON.stringify({ [key]: value }, null, 2));
  }
}

/**
 * Make a text element translatable by extracting text to i18n key.
 */
export async function makeTranslatable(options: {
  sourceFile: string;
  elementSelector: string;
  sourceLine: number;
  i18nKey: string;
  text: string;
  locales: string[];
}): Promise<void> {
  const { sourceFile, elementSelector, sourceLine, i18nKey, text, locales } = options;

  // Add translation to all locale files
  for (const locale of locales) {
    await updateTranslation(locale, i18nKey, text);
  }

  // Replace the text content with the i18n expression in the source file
  await applyAstModification(sourceFile, {
    type: 'setTextContent',
    elementSelector,
    sourceLine,
    value: `\${t('${i18nKey}')}`,
  } as any);
}

function encodeFilePath(filePath: string): string {
  return filePath.split('/').map(encodeURIComponent).join('/');
}

/**
 * Stream an AI chat message. Returns an AbortController to cancel the request.
 */
export function streamAiChat(
  mode: 'element' | 'project',
  prompt: string,
  context: Record<string, any>,
  sessionId: string | undefined,
  callbacks: {
    onToken: (text: string) => void;
    onDone: (result: { sessionId: string; turnId: string; fullText: string }) => void;
    onError: (message: string) => void;
  },
  model?: 'fast' | 'default',
): AbortController {
  const controller = new AbortController();

  fetch('/__nk_editor/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, prompt, context, sessionId, model }),
    signal: controller.signal,
  }).then(async (res) => {
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      callbacks.onError(err.error || `Request failed: ${res.status}`);
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      callbacks.onError('No response body');
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';

      for (const part of parts) {
        const lines = part.split('\n');
        let eventType = '';
        let data = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) eventType = line.slice(7);
          else if (line.startsWith('data: ')) data = line.slice(6);
        }
        if (!data) continue;

        try {
          const parsed = JSON.parse(data);
          if (eventType === 'token') {
            callbacks.onToken(parsed.text || '');
          } else if (eventType === 'done') {
            callbacks.onDone(parsed);
          } else if (eventType === 'error') {
            callbacks.onError(parsed.message || 'Unknown error');
          }
        } catch {
          // Skip malformed events
        }
      }
    }
  }).catch((err) => {
    if (err?.name === 'AbortError') return;
    callbacks.onError(err?.message || 'Network error');
  });

  return controller;
}

/**
 * Rollback an AI turn by restoring file snapshots.
 */
export async function rollbackAiTurn(turnId: string): Promise<{ restored: boolean; files: string[] }> {
  const res = await fetch('/__nk_editor/ai/rollback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ turnId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Rollback failed' }));
    throw new Error(err.error || `Rollback failed: ${res.status}`);
  }
  return res.json();
}

/**
 * Check if the AI backend (OpenCode) is configured and reachable.
 */
export async function checkAiStatus(): Promise<{ configured: boolean }> {
  try {
    const res = await fetch('/__nk_editor/ai/status');
    if (!res.ok) return { configured: false };
    return res.json();
  } catch {
    return { configured: false };
  }
}
