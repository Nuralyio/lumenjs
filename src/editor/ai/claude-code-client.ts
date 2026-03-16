/**
 * Claude Code AI client — uses the Claude Agent SDK (@anthropic-ai/claude-agent-sdk).
 * Spawns the `claude` CLI as a subprocess. Requires Claude Code CLI installed and logged in.
 * Works with Pro/Max subscription — no API key needed.
 */

import type { AiChatOptions, AiChatResult, AiStatusResult } from './types.js';
import { SYSTEM_PROMPT, buildPrompt } from './types.js';
import { execSync } from 'child_process';

/**
 * Stream an AI chat message via Claude Code Agent SDK.
 */
export function streamAiChat(projectDir: string, options: AiChatOptions): AiChatResult {
  const tokenCallbacks: ((text: string) => void)[] = [];
  const doneCallbacks: ((fullText: string) => void)[] = [];
  const errorCallbacks: ((err: Error) => void)[] = [];

  let aborted = false;
  let sessionId = options.sessionId || '';
  const enrichedPrompt = buildPrompt(options);

  const run = async () => {
    try {
      // Dynamic import — the SDK is an optional dependency
      const sdk = await import('@anthropic-ai/claude-agent-sdk');
      const query = sdk.query || sdk.default?.query;
      if (!query) {
        throw new Error('Claude Agent SDK loaded but query() not found');
      }

      let fullText = '';

      const queryOptions: Record<string, any> = {
        cwd: projectDir,
        systemPrompt: SYSTEM_PROMPT,
        allowedTools: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash'],
        maxTurns: 20,
      };

      // Resume existing session for conversation continuity
      if (sessionId) {
        queryOptions.resume = sessionId;
      }

      const stream = query({
        prompt: enrichedPrompt,
        options: queryOptions,
      });

      for await (const msg of stream) {
        if (aborted) break;

        // Capture session ID from any message
        if (msg.session_id && !sessionId) {
          sessionId = msg.session_id;
        }

        if (msg.type === 'assistant' && msg.message?.content) {
          for (const block of msg.message.content) {
            if (block.type === 'text' && block.text) {
              fullText += block.text;
              for (const cb of tokenCallbacks) cb(block.text);
            }
          }
        }
      }

      if (!aborted) {
        for (const cb of doneCallbacks) cb(fullText);
      }
    } catch (err: any) {
      if (aborted) return;
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
    abort: () => { aborted = true; },
  };
}

/**
 * Check if Claude Code CLI is installed and logged in.
 */
export async function checkAiStatus(): Promise<AiStatusResult> {
  try {
    execSync('claude --version', { timeout: 5000, stdio: 'pipe' });
    return { configured: true, backend: 'claude-code' };
  } catch {
    return { configured: false, backend: 'claude-code' };
  }
}
