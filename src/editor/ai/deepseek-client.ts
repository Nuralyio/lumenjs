/**
 * DeepSeek AI client — uses the OpenAI-compatible chat completions API with SSE streaming.
 * Configure via DEEPSEEK_API_KEY env var. Optionally set DEEPSEEK_BASE_URL and DEEPSEEK_MODEL.
 */

import type { AiChatOptions, AiChatResult, AiStatusResult } from './types.js';
import { SYSTEM_PROMPT, buildPrompt } from './types.js';

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// Simple per-session message history
const sessions = new Map<string, ChatMessage[]>();

export function streamAiChat(projectDir: string, options: AiChatOptions): AiChatResult {
  const tokenCallbacks: ((text: string) => void)[] = [];
  const doneCallbacks: ((fullText: string) => void)[] = [];
  const errorCallbacks: ((err: Error) => void)[] = [];
  const controller = new AbortController();

  let sessionId = options.sessionId || `ds-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const enrichedPrompt = buildPrompt(options);

  const run = async () => {
    try {
      // Build message history
      if (!sessions.has(sessionId)) {
        sessions.set(sessionId, [{ role: 'system', content: SYSTEM_PROMPT }]);
      }
      const messages = sessions.get(sessionId)!;
      messages.push({ role: 'user', content: enrichedPrompt });

      const res = await fetch(`${DEEPSEEK_BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model: DEEPSEEK_MODEL,
          messages,
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`DeepSeek API error: ${res.status} ${errText}`);
      }

      // Parse SSE stream
      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

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
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              fullText += delta;
              for (const cb of tokenCallbacks) cb(delta);
            }
          } catch {
            // Skip malformed SSE lines
          }
        }
      }

      // Save assistant response to history
      messages.push({ role: 'assistant', content: fullText });

      for (const cb of doneCallbacks) cb(fullText);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      for (const cb of errorCallbacks) cb(err instanceof Error ? err : new Error(String(err)));
    }
  };

  run();

  return {
    get sessionId() { return sessionId; },
    onToken: (cb) => { tokenCallbacks.push(cb); },
    onDone: (cb) => { doneCallbacks.push(cb); },
    onError: (cb) => { errorCallbacks.push(cb); },
    abort: () => controller.abort(),
  };
}

export async function checkAiStatus(): Promise<AiStatusResult> {
  if (!DEEPSEEK_API_KEY) {
    return { configured: false, backend: 'opencode' };
  }
  try {
    const res = await fetch(`${DEEPSEEK_BASE_URL}/v1/models`, {
      headers: { 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` },
      signal: AbortSignal.timeout(5000),
    });
    return { configured: res.ok, backend: 'opencode' };
  } catch {
    return { configured: false, backend: 'opencode' };
  }
}
