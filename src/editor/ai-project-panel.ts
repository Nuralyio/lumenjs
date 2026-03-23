/**
 * AI Project Panel — right-side sliding chat panel for project-wide conversations.
 * For things like "add a new page", "set up auth", "change the color scheme everywhere".
 * Streams responses from OpenCode AI coding agent via the editor API.
 */

import { streamAiChat, rollbackAiTurn, checkAiStatus } from './editor-api-client.js';
import { renderMarkdown } from './ai-markdown.js';

const PROJECT_SUGGESTIONS = [
  { label: 'Add a page', prompt: 'Add a new page to the project' },
  { label: 'Add API route', prompt: 'Add a new API route' },
  { label: 'Dark theme', prompt: 'Add a dark theme to the entire project' },
  { label: 'Add auth', prompt: 'Set up authentication for the project' },
  { label: 'Add i18n', prompt: 'Add internationalization support' },
  { label: 'Improve SEO', prompt: 'Improve SEO across all pages' },
];

let panel: HTMLDivElement;
let messagesContainer: HTMLDivElement;
let inputEl: HTMLTextAreaElement;
let sendBtn: HTMLButtonElement;
let sessionId: string | undefined;
let activeController: AbortController | null = null;
let aiConfigured = false;

export function createAiProjectPanel(): HTMLDivElement {
  panel = document.createElement('div');
  panel.id = 'nk-ai-project';
  panel.innerHTML = `
    <div class="nk-aip-header">
      <span class="nk-aip-title">✦ Project AI</span>
      <div style="flex:1"></div>
      <button class="nk-aip-close" title="Close">✕</button>
    </div>
    <div class="nk-aip-messages"></div>
    <div class="nk-aip-suggestions">
      ${PROJECT_SUGGESTIONS.map(s => `<button class="nk-aip-chip" data-prompt="${s.prompt.replace(/"/g, '&quot;')}">${s.label}</button>`).join('')}
    </div>
    <div class="nk-aip-input-row">
      <textarea class="nk-aip-input" placeholder="Ask about your project..." rows="1"></textarea>
      <button class="nk-aip-send" disabled title="Send">▶</button>
    </div>
  `;

  const style = document.createElement('style');
  style.textContent = `
    #nk-ai-project {
      position: fixed; top: 44px; right: 0; bottom: 0; width: 380px;
      display: none; flex-direction: column;
      background: #1e1b2e; color: #e2e8f0; font-family: system-ui, -apple-system, sans-serif;
      font-size: 13px; z-index: 99999;
      border-left: 1px solid #334155;
      box-shadow: -4px 0 20px rgba(0,0,0,0.4);
      transition: transform 0.2s ease;
    }
    #nk-ai-project.open { display: flex; }
    .nk-aip-header {
      display: flex; align-items: center; gap: 8px;
      padding: 0 14px; height: 42px; min-height: 42px;
      border-bottom: 1px solid #334155;
    }
    .nk-aip-title { font-weight: 700; font-size: 13px; color: #7c3aed; }
    .nk-aip-close {
      background: transparent; border: none; color: #94a3b8; cursor: pointer;
      font-size: 16px; padding: 4px 8px; border-radius: 4px;
      font-family: inherit; line-height: 1;
    }
    .nk-aip-close:hover { background: #334155; color: #e2e8f0; }
    .nk-aip-messages {
      flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px;
    }
    .nk-aip-messages:empty::after {
      content: 'Ask me anything about your project — add pages, set up features, change styles across the whole app.';
      color: #64748b; font-size: 12px; line-height: 1.6; text-align: center;
      padding: 40px 20px;
    }
    .nk-aip-msg {
      max-width: 88%; padding: 8px 12px; border-radius: 12px; font-size: 13px;
      line-height: 1.5; word-wrap: break-word;
    }
    .nk-aip-msg.user {
      align-self: flex-end; background: #7c3aed; color: #fff; border-bottom-right-radius: 4px;
    }
    .nk-aip-msg.assistant {
      align-self: flex-start; background: #2d2a3e; color: #e2e8f0; border-bottom-left-radius: 4px;
    }
    .nk-aip-msg.assistant p { margin: 0 0 6px 0; }
    .nk-aip-msg.assistant p:last-child { margin-bottom: 0; }
    .nk-aip-msg.assistant ul, .nk-aip-msg.assistant ol { margin: 4px 0; padding-left: 18px; }
    .nk-aip-msg.assistant li { margin: 2px 0; }
    .nk-aip-msg.assistant strong { font-weight: 600; }
    .nk-ai-code {
      background: #1a1a2e; padding: 1px 4px; border-radius: 3px;
      font-family: 'SF Mono', ui-monospace, monospace; font-size: 11px;
    }
    .nk-ai-pre {
      background: #1a1a2e; padding: 8px; border-radius: 6px;
      overflow-x: auto; margin: 4px 0; position: relative;
    }
    .nk-ai-pre code {
      font-family: 'SF Mono', ui-monospace, monospace; font-size: 11px;
      background: none; padding: 0; white-space: pre;
    }
    .nk-ai-code-lang {
      position: absolute; top: 4px; right: 6px;
      font-size: 9px; color: #64748b; font-family: system-ui, sans-serif;
    }
    .nk-aip-typing {
      align-self: flex-start; padding: 8px 16px; background: #2d2a3e; border-radius: 12px;
      border-bottom-left-radius: 4px;
    }
    .nk-aip-typing span {
      display: inline-block; width: 6px; height: 6px; background: #94a3b8;
      border-radius: 50%; margin: 0 2px; animation: nk-aip-dot 1.2s infinite;
    }
    .nk-aip-typing span:nth-child(2) { animation-delay: 0.2s; }
    .nk-aip-typing span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes nk-aip-dot {
      0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
      40% { opacity: 1; transform: scale(1); }
    }
    .nk-aip-suggestions {
      display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 14px;
      border-top: 1px solid #334155;
    }
    .nk-aip-chip {
      background: transparent; border: 1px solid #334155; border-radius: 14px;
      padding: 5px 12px; color: #94a3b8; cursor: pointer; font-size: 11px;
      white-space: nowrap; font-family: inherit; transition: all 0.15s;
    }
    .nk-aip-chip:hover { border-color: #7c3aed; color: #e2e8f0; }
    .nk-aip-input-row {
      display: flex; gap: 8px; padding: 10px 14px;
      border-top: 1px solid #334155; align-items: flex-end;
    }
    .nk-aip-input {
      flex: 1; background: #2d2a3e; border: 1px solid #334155; border-radius: 8px;
      color: #e2e8f0; font-size: 13px; padding: 8px 12px;
      font-family: inherit; resize: none; max-height: 80px; overflow-y: auto;
      line-height: 1.4; outline: none;
    }
    .nk-aip-input::placeholder { color: #64748b; }
    .nk-aip-input:focus { border-color: #7c3aed; }
    .nk-aip-send {
      background: #7c3aed; border: none; color: #fff; width: 34px; height: 34px;
      border-radius: 8px; cursor: pointer; font-size: 13px;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0; transition: opacity 0.15s;
    }
    .nk-aip-send:disabled { opacity: 0.4; cursor: default; }
    .nk-aip-send:not(:disabled):hover { background: #6d28d9; }
    .nk-aip-msg-actions {
      display: flex; align-items: center; gap: 6px; margin-top: 6px; font-size: 11px;
    }
    .nk-aip-badge {
      background: #334155; color: #94a3b8; padding: 2px 8px; border-radius: 8px;
    }
    .nk-aip-rollback {
      background: transparent; border: none; color: #f59e0b; cursor: pointer;
      font-size: 11px; padding: 2px 4px; font-family: inherit;
    }
    .nk-aip-rollback:hover { text-decoration: underline; }
    @media (max-width: 640px) {
      #nk-ai-project { width: 100%; }
    }
  `;
  panel.appendChild(style);
  document.body.appendChild(panel);

  messagesContainer = panel.querySelector('.nk-aip-messages') as HTMLDivElement;
  inputEl = panel.querySelector('.nk-aip-input') as HTMLTextAreaElement;
  sendBtn = panel.querySelector('.nk-aip-send') as HTMLButtonElement;

  // Close
  panel.querySelector('.nk-aip-close')!.addEventListener('click', () => hideAiProjectPanel());

  // Send
  sendBtn.addEventListener('click', () => sendMessage());

  // Input auto-resize + enable/disable
  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 80) + 'px';
    sendBtn.disabled = !inputEl.value.trim();
  });

  // Enter to send
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (inputEl.value.trim()) sendMessage();
    }
  });

  // Suggestion chips
  panel.querySelectorAll('.nk-aip-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const prompt = (btn as HTMLElement).dataset.prompt || '';
      inputEl.value = prompt;
      sendBtn.disabled = false;
      sendMessage();
    });
  });

  // Check AI status on creation
  checkAiStatus().then(status => {
    aiConfigured = status.configured;
  }).catch(() => {
    aiConfigured = false;
  });

  return panel;
}

export function showAiProjectPanel(): void {
  panel.classList.add('open');
  inputEl.focus();
}

export function hideAiProjectPanel(): void {
  panel.classList.remove('open');
}

export function isAiProjectPanelOpen(): boolean {
  return panel.classList.contains('open');
}

/** Send a message programmatically (e.g. from the toolbar page AI input) */
export function sendProjectMessage(text: string): void {
  inputEl.value = text;
  sendMessage();
}

function addUserMessage(text: string): void {
  const msg = document.createElement('div');
  msg.className = 'nk-aip-msg user';
  msg.textContent = text;
  messagesContainer.appendChild(msg);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function createStreamingMessage(): HTMLDivElement {
  const msg = document.createElement('div');
  msg.className = 'nk-aip-msg assistant';

  const textEl = document.createElement('div');
  textEl.className = 'nk-aip-msg-text';
  msg.appendChild(textEl);

  messagesContainer.appendChild(msg);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
  return msg;
}

function finalizeAssistantMessage(msg: HTMLDivElement, turnId?: string): void {
  if (turnId) {
    // Remove rollback from previous messages
    messagesContainer.querySelectorAll('.nk-aip-msg.assistant .nk-aip-rollback').forEach((btn) => {
      if (!msg.contains(btn)) (btn as HTMLElement).style.display = 'none';
    });

    const actions = document.createElement('div');
    actions.className = 'nk-aip-msg-actions';
    actions.innerHTML = `
      <span class="nk-aip-badge">Changes applied</span>
      <button class="nk-aip-rollback">↩ Rollback</button>
    `;
    actions.querySelector('.nk-aip-rollback')!.addEventListener('click', async () => {
      try {
        await rollbackAiTurn(turnId);
        const badge = actions.querySelector('.nk-aip-badge') as HTMLElement;
        if (badge) { badge.textContent = 'Rolled back'; badge.style.color = '#f59e0b'; }
        const btn = actions.querySelector('.nk-aip-rollback') as HTMLElement;
        if (btn) btn.style.display = 'none';
      } catch (err: any) {
        console.error('[ai-project] Rollback failed:', err);
      }
    });
    msg.appendChild(actions);
  }

  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function addAssistantError(message: string): void {
  const msg = document.createElement('div');
  msg.className = 'nk-aip-msg assistant';
  msg.style.borderColor = '#ef4444';

  const textEl = document.createElement('div');
  textEl.className = 'nk-aip-msg-text';
  textEl.textContent = message;
  textEl.style.color = '#fca5a5';
  msg.appendChild(textEl);

  messagesContainer.appendChild(msg);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function sendMessage(): void {
  const text = inputEl.value.trim();
  if (!text) return;

  if (!aiConfigured) {
    addUserMessage(text);
    inputEl.value = '';
    inputEl.style.height = 'auto';
    sendBtn.disabled = true;
    addAssistantError('AI not available — start OpenCode server to enable AI coding.');
    return;
  }

  // Abort any active request
  if (activeController) {
    activeController.abort();
    activeController = null;
  }

  addUserMessage(text);
  inputEl.value = '';
  inputEl.style.height = 'auto';
  sendBtn.disabled = true;

  // Typing indicator
  const typing = document.createElement('div');
  typing.className = 'nk-aip-typing';
  typing.innerHTML = '<span></span><span></span><span></span>';
  messagesContainer.appendChild(typing);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;

  const streamMsg = createStreamingMessage();
  const textEl = streamMsg.querySelector('.nk-aip-msg-text') as HTMLElement;
  let rawText = '';

  activeController = streamAiChat('project', text, {}, sessionId, {
    onToken: (token) => {
      typing.remove();
      rawText += token;
      textEl.innerHTML = renderMarkdown(rawText);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    },
    onDone: (result) => {
      typing.remove();
      sessionId = result.sessionId;
      const finalText = rawText || result.fullText || 'Done.';
      textEl.innerHTML = renderMarkdown(finalText);
      finalizeAssistantMessage(streamMsg, result.turnId);
      activeController = null;
    },
    onError: (message) => {
      typing.remove();
      streamMsg.remove();
      addAssistantError(message);
      activeController = null;
    },
  });
}
