/**
 * AI Chat Bubble — floating chat popover that appears next to the selected element.
 * Streams responses from OpenCode AI coding agent via the editor API.
 */

import { streamAiChat, rollbackAiTurn, checkAiStatus } from './editor-api-client.js';

const QUICK_ACTIONS = [
  { label: 'Improve text', prompt: 'Improve the text to be more professional' },
  { label: 'Animation', prompt: 'Add a subtle CSS animation to this element' },
  { label: 'Responsive', prompt: 'Make this element responsive for mobile' },
  { label: 'Dark theme', prompt: 'Convert to a dark color scheme' },
  { label: 'Spacing', prompt: 'Improve spacing and padding' },
  { label: 'Simplify', prompt: 'Simplify and clean up this element' },
];

let panel: HTMLDivElement;
let messagesContainer: HTMLDivElement;
let inputEl: HTMLTextAreaElement;
let sendBtn: HTMLButtonElement;
let contextBadge: HTMLSpanElement;
let currentTarget: HTMLElement | null = null;
let wasDragged = false;
let sessionId: string | undefined;
let activeController: AbortController | null = null;
let aiConfigured = false;
let nextModel: 'fast' | 'default' = 'default';

export function createAiChatPanel(): HTMLDivElement {
  panel = document.createElement('div');
  panel.id = 'nk-ai-chat';
  panel.innerHTML = `
    <div class="nk-ai-header">
      <span class="nk-ai-title">✦ AI</span>
      <span class="nk-ai-context"></span>
      <div style="flex:1"></div>
      <button class="nk-ai-close" title="Close">✕</button>
    </div>
    <div class="nk-ai-messages"></div>
    <div class="nk-ai-quick-actions">
      ${QUICK_ACTIONS.map(a => `<button class="nk-ai-pill" data-prompt="${a.prompt.replace(/"/g, '&quot;')}">${a.label}</button>`).join('')}
    </div>
    <div class="nk-ai-input-row">
      <textarea class="nk-ai-input" placeholder="Ask AI..." rows="1"></textarea>
      <button class="nk-ai-send" disabled title="Send">▶</button>
    </div>
  `;

  const style = document.createElement('style');
  style.textContent = `
    #nk-ai-chat {
      position: fixed;
      left: -9999px; top: -9999px;
      width: 340px; max-height: 420px;
      flex-direction: column;
      background: #1e1b2e; color: #e2e8f0; font-family: system-ui, -apple-system, sans-serif;
      font-size: 13px; z-index: 99999;
      border: 1px solid #334155; border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      overflow: hidden;
      display: flex;
      visibility: hidden;
    }
    #nk-ai-chat.open { visibility: visible; }
    .nk-ai-header {
      display: flex; align-items: center; gap: 6px;
      padding: 8px 10px; min-height: 34px;
      border-bottom: 1px solid #334155; cursor: grab;
    }
    .nk-ai-title { font-weight: 700; font-size: 12px; color: #7c3aed; white-space: nowrap; }
    .nk-ai-context {
      font-size: 10px; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      font-family: 'SF Mono', ui-monospace, monospace;
    }
    .nk-ai-close {
      background: transparent; border: none; color: #94a3b8; cursor: pointer;
      font-size: 14px; padding: 2px 6px; border-radius: 4px;
      font-family: inherit; line-height: 1; flex-shrink: 0;
    }
    .nk-ai-close:hover { background: #334155; color: #e2e8f0; }
    .nk-ai-messages {
      flex: 1; overflow-y: auto; padding: 8px 10px; display: flex; flex-direction: column; gap: 6px;
      min-height: 0;
    }
    .nk-ai-messages:empty { display: none; }
    .nk-ai-msg {
      max-width: 90%; padding: 6px 10px; border-radius: 10px; font-size: 12px;
      line-height: 1.45; word-wrap: break-word;
    }
    .nk-ai-msg.user {
      align-self: flex-end; background: #7c3aed; color: #fff; border-bottom-right-radius: 4px;
    }
    .nk-ai-msg.assistant {
      align-self: flex-start; background: #2d2a3e; color: #e2e8f0; border-bottom-left-radius: 4px;
    }
    .nk-ai-msg-actions {
      display: flex; align-items: center; gap: 6px; margin-top: 4px; font-size: 10px;
    }
    .nk-ai-badge {
      background: #334155; color: #94a3b8; padding: 1px 6px; border-radius: 8px;
    }
    .nk-ai-rollback {
      background: transparent; border: none; color: #f59e0b; cursor: pointer;
      font-size: 10px; padding: 1px 4px; font-family: inherit;
    }
    .nk-ai-rollback:hover { text-decoration: underline; }
    .nk-ai-typing {
      align-self: flex-start; padding: 6px 14px; background: #2d2a3e; border-radius: 10px;
      border-bottom-left-radius: 4px;
    }
    .nk-ai-typing span {
      display: inline-block; width: 5px; height: 5px; background: #94a3b8;
      border-radius: 50%; margin: 0 1.5px; animation: nk-ai-dot 1.2s infinite;
    }
    .nk-ai-typing span:nth-child(2) { animation-delay: 0.2s; }
    .nk-ai-typing span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes nk-ai-dot {
      0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
      40% { opacity: 1; transform: scale(1); }
    }
    .nk-ai-quick-actions {
      display: flex; gap: 4px; padding: 6px 10px; overflow-x: auto; flex-wrap: wrap;
      border-top: 1px solid #334155;
    }
    .nk-ai-pill {
      background: transparent; border: 1px solid #334155; border-radius: 12px;
      padding: 3px 10px; color: #94a3b8; cursor: pointer; font-size: 10px;
      white-space: nowrap; font-family: inherit; transition: all 0.15s;
    }
    .nk-ai-pill:hover { border-color: #7c3aed; color: #e2e8f0; }
    .nk-ai-input-row {
      display: flex; gap: 6px; padding: 8px 10px;
      border-top: 1px solid #334155; align-items: flex-end;
    }
    .nk-ai-input {
      flex: 1; background: #2d2a3e; border: 1px solid #334155; border-radius: 8px;
      color: #e2e8f0; font-size: 16px; padding: 6px 10px;
      font-family: inherit; resize: none; max-height: 60px; overflow-y: auto;
      line-height: 1.4; outline: none;
    }
    .nk-ai-input::placeholder { color: #64748b; }
    .nk-ai-input:focus { border-color: #7c3aed; }
    .nk-ai-send {
      background: #7c3aed; border: none; color: #fff; width: 30px; height: 30px;
      border-radius: 8px; cursor: pointer; font-size: 12px;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0; transition: opacity 0.15s;
    }
    .nk-ai-send:disabled { opacity: 0.4; cursor: default; }
    .nk-ai-send:not(:disabled):hover { background: #6d28d9; }
    @media (max-width: 640px) {
      #nk-ai-chat { width: 300px; max-height: 360px; }
    }
  `;
  panel.appendChild(style);
  document.body.appendChild(panel);

  // Cache references
  messagesContainer = panel.querySelector('.nk-ai-messages') as HTMLDivElement;
  inputEl = panel.querySelector('.nk-ai-input') as HTMLTextAreaElement;
  sendBtn = panel.querySelector('.nk-ai-send') as HTMLButtonElement;
  contextBadge = panel.querySelector('.nk-ai-context') as HTMLSpanElement;

  // Close
  panel.querySelector('.nk-ai-close')!.addEventListener('click', () => hideAiChatPanel());

  // Send button
  sendBtn.addEventListener('click', () => sendMessage());

  // Input: auto-resize + enable/disable send
  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 60) + 'px';
    sendBtn.disabled = !inputEl.value.trim();
  });

  // Enter to send (Shift+Enter for newline)
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (inputEl.value.trim()) sendMessage();
    }
  });

  // Quick action pills
  panel.querySelectorAll('.nk-ai-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      const prompt = (btn as HTMLElement).dataset.prompt || '';
      inputEl.value = prompt;
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 60) + 'px';
      sendBtn.disabled = false;
      nextModel = 'fast';
      sendMessage();
    });
  });

  // Drag via header
  const header = panel.querySelector('.nk-ai-header') as HTMLElement;
  let dragOffsetX = 0, dragOffsetY = 0, isDragging = false;

  function onDragMove(ex: number, ey: number) {
    if (!isDragging) return;
    let nx = ex - dragOffsetX;
    let ny = ey - dragOffsetY;
    // Clamp inside viewport
    nx = Math.max(0, Math.min(nx, window.innerWidth - panel.offsetWidth));
    ny = Math.max(44, Math.min(ny, window.innerHeight - panel.offsetHeight));
    panel.style.left = `${nx}px`;
    panel.style.top = `${ny}px`;
    wasDragged = true;
  }

  header.addEventListener('mousedown', (e) => {
    if ((e.target as HTMLElement).closest('.nk-ai-close')) return;
    isDragging = true;
    dragOffsetX = e.clientX - panel.getBoundingClientRect().left;
    dragOffsetY = e.clientY - panel.getBoundingClientRect().top;
    header.style.cursor = 'grabbing';
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => onDragMove(e.clientX, e.clientY));
  document.addEventListener('mouseup', () => { isDragging = false; header.style.cursor = 'grab'; });

  // Touch drag
  header.addEventListener('touchstart', (e) => {
    if ((e.target as HTMLElement).closest('.nk-ai-close')) return;
    const t = e.touches[0];
    isDragging = true;
    dragOffsetX = t.clientX - panel.getBoundingClientRect().left;
    dragOffsetY = t.clientY - panel.getBoundingClientRect().top;
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    onDragMove(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  document.addEventListener('touchend', () => { isDragging = false; });

  // Check AI status on creation
  checkAiStatus().then(status => {
    aiConfigured = status.configured;
  }).catch(() => {
    aiConfigured = false;
  });

  return panel;
}

/** Position the bubble centered below the element (skips if user dragged) */
function positionBubble(el: HTMLElement): void {
  if (wasDragged) return;
  const rect = el.getBoundingClientRect();
  const pw = 340; // panel width
  const ph = panel.offsetHeight || 420;
  const gap = 6;

  // Center horizontally under element
  let left = rect.left + (rect.width - pw) / 2;
  let top = rect.bottom + gap;

  // Clamp horizontal: keep within viewport
  if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
  if (left < 8) left = 8;

  // If overflows bottom, place above element instead
  if (top + ph > window.innerHeight - 8) {
    top = rect.top - ph - gap;
  }
  // If still above toolbar, clamp below toolbar
  if (top < 52) top = 52; // 44px toolbar + 8px margin

  panel.style.left = `${Math.round(left)}px`;
  panel.style.top = `${Math.round(top)}px`;
}

export function showAiChatForElement(el: HTMLElement): void {
  // Reset drag position when selecting a different element
  if (currentTarget !== el) wasDragged = false;
  currentTarget = el;
  const tag = el.tagName.toLowerCase();
  const source = el.getAttribute('data-nk-source');
  let ctx = `<${tag}>`;
  if (source) {
    const parts = source.split(':');
    if (parts.length >= 2) {
      ctx += ` ${parts[0]}:${parts[1]}`;
    }
  }
  contextBadge.textContent = ctx;

  // Position first, then make visible — prevents flash at default position
  positionBubble(el);
  panel.classList.add('open');
}

/** Update target reference after HMR and reanchor the panel to the new element */
export function updateAiChatTarget(el: HTMLElement): void {
  currentTarget = el;
  const tag = el.tagName.toLowerCase();
  const source = el.getAttribute('data-nk-source');
  let ctx = `<${tag}>`;
  if (source) {
    const parts = source.split(':');
    if (parts.length >= 2) ctx += ` ${parts[0]}:${parts[1]}`;
  }
  contextBadge.textContent = ctx;
  // Reposition to the new element (unless user has manually dragged)
  positionBubble(el);
}

export function hideAiChatPanel(): void {
  panel.classList.remove('open');
  currentTarget = null;
}

export function isAiChatPanelOpen(): boolean {
  return panel.classList.contains('open');
}

/** Reposition on scroll/resize if open (skips if element was disconnected by HMR) */
export function updateAiChatPosition(): void {
  if (currentTarget && currentTarget.isConnected && isAiChatPanelOpen()) {
    positionBubble(currentTarget);
  }
}

function addUserMessage(text: string): void {
  const msg = document.createElement('div');
  msg.className = 'nk-ai-msg user';
  msg.textContent = text;
  messagesContainer.appendChild(msg);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function createStreamingMessage(): HTMLDivElement {
  const msg = document.createElement('div');
  msg.className = 'nk-ai-msg assistant';

  const textEl = document.createElement('div');
  textEl.className = 'nk-ai-msg-text';
  msg.appendChild(textEl);

  messagesContainer.appendChild(msg);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
  return msg;
}

function finalizeAssistantMessage(msg: HTMLDivElement, turnId?: string): void {
  if (turnId) {
    // Remove rollback from previous assistant messages
    messagesContainer.querySelectorAll('.nk-ai-msg.assistant .nk-ai-rollback').forEach((btn) => {
      if (!msg.contains(btn)) (btn as HTMLElement).style.display = 'none';
    });

    const actions = document.createElement('div');
    actions.className = 'nk-ai-msg-actions';
    actions.innerHTML = `
      <span class="nk-ai-badge">Changes applied</span>
      <button class="nk-ai-rollback">↩ Rollback</button>
    `;
    actions.querySelector('.nk-ai-rollback')!.addEventListener('click', async () => {
      try {
        await rollbackAiTurn(turnId);
        const badge = actions.querySelector('.nk-ai-badge') as HTMLElement;
        if (badge) { badge.textContent = 'Rolled back'; badge.style.color = '#f59e0b'; }
        const btn = actions.querySelector('.nk-ai-rollback') as HTMLElement;
        if (btn) btn.style.display = 'none';
      } catch (err: any) {
        console.error('[ai-chat] Rollback failed:', err);
      }
    });
    msg.appendChild(actions);
  }

  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function addAssistantError(message: string): void {
  const msg = document.createElement('div');
  msg.className = 'nk-ai-msg assistant';
  msg.style.borderColor = '#ef4444';

  const textEl = document.createElement('div');
  textEl.className = 'nk-ai-msg-text';
  textEl.textContent = message;
  textEl.style.color = '#fca5a5';
  msg.appendChild(textEl);

  messagesContainer.appendChild(msg);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function showTypingIndicator(): HTMLDivElement {
  const indicator = document.createElement('div');
  indicator.className = 'nk-ai-typing';
  indicator.innerHTML = '<span></span><span></span><span></span>';
  messagesContainer.appendChild(indicator);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
  return indicator;
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

  const typing = showTypingIndicator();

  // Gather context from the selected element
  const context: Record<string, any> = {};
  if (currentTarget) {
    context.elementTag = currentTarget.tagName.toLowerCase();
    const source = currentTarget.getAttribute('data-nk-source');
    if (source) {
      const parts = source.split(':');
      context.sourceFile = parts[0];
      if (parts[1]) context.sourceLine = parseInt(parts[1], 10);
    }
    // Gather relevant attributes
    const attrs: Record<string, string> = {};
    for (const attr of currentTarget.attributes) {
      if (!attr.name.startsWith('data-nk-') && attr.name !== 'class' && attr.name !== 'style') {
        attrs[attr.name] = attr.value;
      }
    }
    if (Object.keys(attrs).length > 0) context.elementAttributes = attrs;
  }

  const streamMsg = createStreamingMessage();
  const textEl = streamMsg.querySelector('.nk-ai-msg-text') as HTMLElement;

  const modelForRequest = nextModel;
  nextModel = 'default';

  activeController = streamAiChat('element', text, context, sessionId, {
    onToken: (token) => {
      typing.remove();
      textEl.textContent += token;
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    },
    onDone: (result) => {
      typing.remove();
      sessionId = result.sessionId;
      if (!textEl.textContent) {
        textEl.textContent = result.fullText || 'Done.';
      }
      finalizeAssistantMessage(streamMsg, result.turnId);
      activeController = null;
    },
    onError: (message) => {
      typing.remove();
      streamMsg.remove();
      addAssistantError(message);
      activeController = null;
    },
  }, modelForRequest);
}
