/**
 * OpenCode AI client — wraps the OpenCode REST API for AI coding agent integration.
 * Connects to an OpenCode server (`opencode serve`) that handles LLM calls and file editing.
 */

import type { AiChatOptions, AiChatResult, AiStatusResult } from './types.js';
import { SYSTEM_PROMPT, buildPrompt } from './types.js';

const OPENCODE_URL = process.env.OPENCODE_URL || 'http://localhost:3500';
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
 * Uses the /api/session and /api/message endpoints.
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
        const createRes = await fetch(`${OPENCODE_URL}/api/session`, {
          method: 'POST',
          headers: buildHeaders(),
          body: JSON.stringify({ path: projectDir, system: SYSTEM_PROMPT }),
          signal: controller.signal,
        });
        if (!createRes.ok) {
          throw new Error(`Failed to create OpenCode session: ${createRes.status}`);
        }
        const sessionData = await createRes.json() as any;
        sessionId = sessionData.id || sessionData.sessionId || '';
      }

      // Send message and stream response
      const msgRes = await fetch(`${OPENCODE_URL}/api/session/${sessionId}/message`, {
        method: 'POST',
        headers: { ...buildHeaders(), 'Accept': 'text/event-stream' },
        body: JSON.stringify({ content: enrichedPrompt }),
        signal: controller.signal,
      });

      if (!msgRes.ok) {
        throw new Error(`OpenCode message failed: ${msgRes.status}`);
      }

      const reader = msgRes.body?.getReader();
      if (!reader) throw new Error('No response body from OpenCode');

      const decoder = new TextDecoder();
      let fullText = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              // Handle different event formats from OpenCode
              const text = parsed.content || parsed.text || parsed.delta || '';
              if (text) {
                fullText += text;
                for (const cb of tokenCallbacks) cb(text);
              }
            } catch {
              // Non-JSON data line, treat as raw text
              if (data) {
                fullText += data;
                for (const cb of tokenCallbacks) cb(data);
              }
            }
          }
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
    const res = await fetch(`${OPENCODE_URL}/api/status`, {
      headers: buildHeaders(),
      signal: AbortSignal.timeout(3000),
    });
    return { configured: res.ok, backend: 'opencode' };
  } catch {
    return { configured: false, backend: 'opencode' };
  }
}
