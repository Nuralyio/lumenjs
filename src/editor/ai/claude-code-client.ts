/**
 * Claude Code AI client — uses the Claude Agent SDK (@anthropic-ai/claude-agent-sdk).
 * Spawns the `claude` CLI as a subprocess. Requires Claude Code CLI installed and logged in.
 * Works with Pro/Max subscription — no API key needed.
 */

import type { AiChatOptions, AiChatResult, AiStatusResult } from './types.js';
import { SYSTEM_PROMPT, buildPrompt } from './types.js';
import { execSync } from 'child_process';

// ── SDK Cache & Session Warm-up ──────────────────────────────────

let _sdkCache: { query: (...args: any[]) => any } | null = null;
let _warmSessionId: string | null = null;

async function getSdk(): Promise<{ query: (...args: any[]) => any }> {
  if (_sdkCache) return _sdkCache;
  const sdk = await import('@anthropic-ai/claude-agent-sdk');
  const query = sdk.query || sdk.default?.query;
  if (!query) throw new Error('Claude Agent SDK loaded but query() not found');
  _sdkCache = { query };
  return _sdkCache;
}

/**
 * Warm up by pre-spawning a Claude Code session. The first real request
 * will resume this session, skipping CLI cold-start entirely.
 */
export async function warmUpSession(projectDir: string): Promise<void> {
  try {
    const { query } = await getSdk();
    const stream = query({
      prompt: 'Ready.',
      options: {
        cwd: projectDir,
        systemPrompt: SYSTEM_PROMPT,
        allowedTools: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash'],
        maxTurns: 1,
        model: 'sonnet',
        effort: 'low',
        persistSession: true,
      },
    });
    for await (const msg of stream) {
      if (msg.session_id) {
        _warmSessionId = msg.session_id;
        break;
      }
    }
  } catch {
    // Non-fatal — first request will just be slower
  }
}

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
      const { query } = await getSdk();

      let fullText = '';

      const queryOptions: Record<string, any> = {
        cwd: projectDir,
        systemPrompt: SYSTEM_PROMPT,
        allowedTools: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash'],
        maxTurns: 10,
        persistSession: true,
        model: 'sonnet',
      };

      // Use Sonnet + low effort for fast mode (quick actions like text improvement, spacing)
      if (options.model === 'fast') {
        queryOptions.model = 'sonnet';
        queryOptions.effort = 'low';
        queryOptions.maxTurns = 5;
      }

      // Resume existing session, or use pre-warmed session for instant first request
      if (sessionId) {
        queryOptions.resume = sessionId;
      } else if (_warmSessionId) {
        queryOptions.resume = _warmSessionId;
        sessionId = _warmSessionId;
        _warmSessionId = null;
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
 * Check if Claude Code CLI is installed and the Agent SDK is importable.
 * Both are required — the CLI alone isn't enough.
 */
export async function checkAiStatus(): Promise<AiStatusResult> {
  try {
    execSync('claude --version', { timeout: 5000, stdio: 'pipe' });
    // Verify the SDK is actually importable (it's an optional dependency)
    await import('@anthropic-ai/claude-agent-sdk');
    return { configured: true, backend: 'claude-code' };
  } catch {
    return { configured: false, backend: 'claude-code' };
  }
}
