/**
 * AI backend router — selects between Claude Code and OpenCode based on:
 *   1. AI_BACKEND env var ('claude-code' | 'opencode')
 *   2. Auto-detection: Claude Code CLI first, then OpenCode server
 */

import type { AiChatOptions, AiChatResult, AiStatusResult } from './types.js';
export type { AiChatOptions, AiChatResult, AiStatusResult } from './types.js';

type Backend = 'claude-code' | 'opencode';

let resolvedBackend: Backend | null = null;

async function detectBackend(): Promise<Backend> {
  if (resolvedBackend) return resolvedBackend;

  const explicit = process.env.AI_BACKEND as Backend | undefined;
  if (explicit === 'claude-code' || explicit === 'opencode') {
    resolvedBackend = explicit;
    console.log(`[LumenJS] AI backend: ${explicit} (from AI_BACKEND env)`);
    return resolvedBackend;
  }

  // Auto-detect: try Claude Code first (subscription-based, no server needed)
  try {
    const cc = await import('./claude-code-client.js');
    const status = await cc.checkAiStatus();
    if (status.configured) {
      resolvedBackend = 'claude-code';
      console.log('[LumenJS] AI backend: claude-code (auto-detected)');
      return resolvedBackend;
    }
  } catch {
    // SDK not installed or CLI not found
  }

  // Fall back to OpenCode
  resolvedBackend = 'opencode';
  console.log('[LumenJS] AI backend: opencode (fallback)');
  return resolvedBackend;
}

async function getClient() {
  const backend = await detectBackend();
  if (backend === 'claude-code') {
    return import('./claude-code-client.js');
  }
  return import('./opencode-client.js');
}

/**
 * Stream an AI chat message using the configured backend.
 */
export function streamAiChat(projectDir: string, options: AiChatOptions): AiChatResult {
  const tokenCallbacks: ((text: string) => void)[] = [];
  const doneCallbacks: ((fullText: string) => void)[] = [];
  const errorCallbacks: ((err: Error) => void)[] = [];
  let innerResult: AiChatResult | null = null;

  const run = async () => {
    try {
      const client = await getClient();
      innerResult = client.streamAiChat(projectDir, options);

      // Forward callbacks registered before the client loaded
      for (const cb of tokenCallbacks) innerResult.onToken(cb);
      for (const cb of doneCallbacks) innerResult.onDone(cb);
      for (const cb of errorCallbacks) innerResult.onError(cb);
    } catch (err: any) {
      const error = err instanceof Error ? err : new Error(String(err));
      for (const cb of errorCallbacks) cb(error);
    }
  };

  run();

  return {
    get sessionId() { return innerResult?.sessionId || options.sessionId || ''; },
    onToken: (cb) => { tokenCallbacks.push(cb); innerResult?.onToken(cb); },
    onDone: (cb) => { doneCallbacks.push(cb); innerResult?.onDone(cb); },
    onError: (cb) => { errorCallbacks.push(cb); innerResult?.onError(cb); },
    abort: () => innerResult?.abort(),
  };
}

/**
 * Check if any AI backend is available.
 */
export async function checkAiStatus(): Promise<AiStatusResult> {
  try {
    const client = await getClient();
    return client.checkAiStatus();
  } catch {
    return { configured: false, backend: 'opencode' };
  }
}
