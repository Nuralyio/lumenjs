/**
 * OpenCode AI client — wraps the OpenCode REST API for AI coding agent integration.
 * Connects to an OpenCode server (`opencode serve`) that handles LLM calls and file editing.
 */

import type { AiChatOptions, AiChatResult, AiStatusResult } from './types.js';
import { buildPrompt } from './types.js';

const OPENCODE_URL = process.env.OPENCODE_URL || 'http://localhost:4096';
const OPENCODE_PASSWORD = process.env.OPENCODE_SERVER_PASSWORD || '';

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (OPENCODE_PASSWORD) {
    headers['Authorization'] = `Bearer ${OPENCODE_PASSWORD}`;
  }
  return headers;
}

/**
 * Stream an AI chat message via OpenCode's REST API.
 * Creates a session, sends message, and parses the response.
 */
export function streamAiChat(projectDir: string, options: AiChatOptions): AiChatResult {
  const tokenCallbacks: ((text: string) => void)[] = [];
  const doneCallbacks: ((fullText: string) => void)[] = [];
  const errorCallbacks: ((err: Error) => void)[] = [];
  const controller = new AbortController();

  let sessionId = options.sessionId || '';
  const enrichedPrompt = buildPrompt(options);

  const run = async () => {
    try {
      // Create a new session if we don't have one
      if (!sessionId) {
        const createRes = await fetch(`${OPENCODE_URL}/session`, {
          method: 'POST',
          headers: buildHeaders(),
          body: JSON.stringify({ path: projectDir }),
          signal: controller.signal,
        });
        if (!createRes.ok) {
          throw new Error(`Failed to create OpenCode session: ${createRes.status}`);
        }
        const sessionData = await createRes.json() as any;
        sessionId = sessionData.id || sessionData.sessionId || '';
      }

      // Send message — OpenCode returns JSON with parts array
      const msgRes = await fetch(`${OPENCODE_URL}/session/${sessionId}/message`, {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify({ parts: [{ type: 'text', text: enrichedPrompt }] }),
        signal: controller.signal,
      });

      if (!msgRes.ok) {
        const errText = await msgRes.text().catch(() => '');
        throw new Error(`OpenCode message failed: ${msgRes.status} ${errText}`);
      }

      // OpenCode returns JSON response with parts array
      const data = await msgRes.json() as any;
      let fullText = '';

      // Extract text from response parts
      const parts = data.parts || [];
      for (const part of parts) {
        if (part.type === 'text' && part.text) {
          fullText += part.text;
          for (const cb of tokenCallbacks) cb(part.text);
        }
      }

      for (const cb of doneCallbacks) cb(fullText);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      for (const cb of errorCallbacks) cb(err instanceof Error ? err : new Error(String(err)));
    }
  };

  // Start the async flow
  run();

  return {
    get sessionId() { return sessionId; },
    onToken: (cb) => { tokenCallbacks.push(cb); },
    onDone: (cb) => { doneCallbacks.push(cb); },
    onError: (cb) => { errorCallbacks.push(cb); },
    abort: () => controller.abort(),
  };
}

/**
 * Check if OpenCode server is reachable.
 */
export async function checkAiStatus(): Promise<AiStatusResult> {
  try {
    const res = await fetch(`${OPENCODE_URL}/global/health`, {
      headers: buildHeaders(),
      signal: AbortSignal.timeout(3000),
    });
    return { configured: res.ok, backend: 'opencode' };
  } catch {
    return { configured: false, backend: 'opencode' };
  }
}
