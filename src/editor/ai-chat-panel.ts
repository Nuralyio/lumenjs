/**
 * AI Chat Bubble — floating chat popover that appears next to the selected element.
 * Streams responses from OpenCode AI coding agent via the editor API.
 */

import { streamAiChat, rollbackAiTurn, checkAiStatus } from './editor-api-client.js';
import { renderMarkdown } from './ai-markdown.js';

const BASE_QUICK_ACTIONS = [
  { label: 'Improve text', prompt: 'Improve the text to be more professional' },
  { label: 'Animation', prompt: 'Add a subtle CSS animation to this element' },
  { label: 'Responsive', prompt: 'Make this element responsive for mobile' },
  { label: 'Dark theme', prompt: 'Convert to a dark color scheme' },
  { label: 'Spacing', prompt: 'Improve spacing and padding' },
  { label: 'Simplify', prompt: 'Simplify and clean up this element' },
];

/** Returns context-aware quick actions based on the selected element(s). */
function getContextQuickActions(targets: HTMLElement[]): Array<{ label: string; prompt: string }> {
  const actions: Array<{ label: string; prompt: string }> = [];
  if (targets.length === 0) return actions;

  // Multi-element context actions
  if (targets.length > 1) {
    actions.push({ label: 'Make consistent', prompt: 'Make these elements visually consistent with each other' });
    actions.push({ label: 'Align', prompt: 'Align these elements properly in a row or column' });
    return actions;
  }

  const el = targets[0];
  const tag = el.tagName.toLowerCase();

  // Image elements
  if (tag === 'img' || tag === 'picture' || tag === 'svg') {
    actions.push({ label: 'Add alt text', prompt: 'Add descriptive alt text to this image for accessibility' });
    actions.push({ label: 'Lazy-load', prompt: 'Add lazy-loading to this image for better performance' });
  }

  // Text elements
  if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'label'].includes(tag)) {
    actions.push({ label: 'Improve copy', prompt: 'Improve the copy/text content to be more engaging' });
    actions.push({ label: 'Make i18n', prompt: 'Make this text translatable using i18n' });
  }

  // List elements
  if (['ul', 'ol', 'dl'].includes(tag)) {
    actions.push({ label: 'Add items', prompt: 'Add more list items following the same pattern' });
    actions.push({ label: 'Make sortable', prompt: 'Make this list sortable with drag and drop' });
  }

  // Form elements
  if (['form', 'input', 'textarea', 'select', 'button'].includes(tag)) {
    actions.push({ label: 'Add validation', prompt: 'Add proper form validation to this element' });
    actions.push({ label: 'Improve a11y', prompt: 'Improve accessibility: add labels, ARIA attributes, and keyboard support' });
  }

  return actions;
}

let panel: HTMLDivElement;
let messagesContainer: HTMLDivElement;
let inputEl: HTMLTextAreaElement;
let sendBtn: HTMLButtonElement;
let contextBadge: HTMLSpanElement;
let quickActionsContainer: HTMLDivElement;
let currentTargets: HTMLElement[] = [];
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
    <div class="nk-ai-quick-actions"></div>
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
    .nk-ai-msg.assistant p { margin: 0 0 4px 0; }
    .nk-ai-msg.assistant p:last-child { margin-bottom: 0; }
    .nk-ai-msg.assistant ul, .nk-ai-msg.assistant ol { margin: 4px 0; padding-left: 18px; }
    .nk-ai-msg.assistant li { margin: 1px 0; }
    .nk-ai-msg.assistant strong { font-weight: 600; }
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
  quickActionsContainer = panel.querySelector('.nk-ai-quick-actions') as HTMLDivElement;

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

  // Render initial quick action pills
  renderQuickActions([]);

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

/** Render quick action pills (base + context-aware) into the container. */
function renderQuickActions(targets: HTMLElement[]): void {
  const contextActions = getContextQuickActions(targets);
  const allActions = [...contextActions, ...BASE_QUICK_ACTIONS];

  quickActionsContainer.innerHTML = allActions
    .map(a => `<button class="nk-ai-pill" data-prompt="${a.prompt.replace(/"/g, '&quot;')}">${a.label}</button>`)
    .join('');

  quickActionsContainer.querySelectorAll('.nk-ai-pill').forEach((btn) => {
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
}

/** Position the bubble centered below the element (skips if user dragged) */
function positionBubble(el: HTMLElement): void {
  if (wasDragged) return;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    // Element not laid out (shadow DOM, disconnected, or hidden) — park offscreen
    panel.style.left = '-9999px';
    panel.style.top = '-9999px';
    return;
  }
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
  showAiChatForElements([el]);
}

export function showAiChatForElements(els: HTMLElement[]): void {
  if (els.length === 0) return;

  // Reset drag position when selection changes
  const primary = els[0];
  if (currentTargets.length !== els.length || currentTargets[0] !== primary) wasDragged = false;
  currentTargets = els;

  // Update context badge
  if (els.length === 1) {
    const tag = primary.tagName.toLowerCase();
    const source = primary.getAttribute('data-nk-source');
    let ctx = `<${tag}>`;
    if (source) {
      const parts = source.split(':');
      if (parts.length >= 2) ctx += ` ${parts[0]}:${parts[1]}`;
    }
    contextBadge.textContent = ctx;
  } else {
    contextBadge.textContent = `${els.length} elements selected`;
  }

  // Re-render quick actions based on current selection
  renderQuickActions(els);

  // Only show once we have a valid position — prevents flash at top-left
  const rect = primary.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    // Element not yet laid out — retry positioning over next few frames
    let retries = 0;
    const tryPosition = () => {
      if (currentTargets[0] !== primary || !primary.isConnected) return;
      const r = primary.getBoundingClientRect();
      if (r.width > 0 || r.height > 0) {
        positionBubble(primary);
        panel.classList.add('open');
      } else if (retries < 3) {
        retries++;
        requestAnimationFrame(tryPosition);
      }
    };
    requestAnimationFrame(tryPosition);
    return;
  }

  positionBubble(primary);
  panel.classList.add('open');
}

/** Update target reference after HMR and reanchor the panel to the new element */
export function updateAiChatTarget(el: HTMLElement): void {
  currentTargets = [el];
  const tag = el.tagName.toLowerCase();
  const source = el.getAttribute('data-nk-source');
  let ctx = `<${tag}>`;
  if (source) {
    const parts = source.split(':');
    if (parts.length >= 2) ctx += ` ${parts[0]}:${parts[1]}`;
  }
  contextBadge.textContent = ctx;
  renderQuickActions(currentTargets);
  // Reposition to the new element (unless user has manually dragged)
  positionBubble(el);
}

export function hideAiChatPanel(): void {
  panel.classList.remove('open');
  currentTargets = [];
}

export function isAiChatPanelOpen(): boolean {
  return panel.classList.contains('open');
}

/** Reposition on scroll/resize if open (skips if element was disconnected by HMR) */
export function updateAiChatPosition(): void {
  const primary = currentTargets[0];
  if (primary && primary.isConnected && isAiChatPanelOpen()) {
    positionBubble(primary);
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

/** Gather rich context for a single element: tag, source, attrs, parents, siblings, styles. */
function gatherElementContext(el: HTMLElement): Record<string, any> {
  const ctx: Record<string, any> = {};
  ctx.elementTag = el.tagName.toLowerCase();

  const source = el.getAttribute('data-nk-source');
  if (source) {
    const parts = source.split(':');
    ctx.sourceFile = parts[0];
    if (parts[1]) ctx.sourceLine = parseInt(parts[1], 10);
  }

  // Relevant attributes
  const attrs: Record<string, string> = {};
  for (const attr of el.attributes) {
    if (!attr.name.startsWith('data-nk-') && attr.name !== 'class' && attr.name !== 'style') {
      attrs[attr.name] = attr.value;
    }
  }
  if (Object.keys(attrs).length > 0) ctx.elementAttributes = attrs;

  // Parent chain (up to 5 ancestors) for layout context
  const parents: string[] = [];
  let p = el.parentElement;
  while (p && p !== document.body && parents.length < 5) {
    const tag = p.tagName.toLowerCase();
    const src = p.getAttribute('data-nk-source');
    parents.push(src ? `<${tag}> (${src})` : `<${tag}>`);
    p = p.parentElement;
  }
  if (parents.length > 0) ctx.parentChain = parents;

  // Immediate siblings (up to 10) for structural context
  const siblings: string[] = [];
  for (const sib of el.parentElement?.children || []) {
    if (sib !== el && siblings.length < 10) {
      siblings.push(`<${sib.tagName.toLowerCase()}>`);
    }
  }
  if (siblings.length > 0) ctx.siblings = siblings;

  // Key computed styles for visual context
  try {
    const cs = window.getComputedStyle(el);
    ctx.computedStyles = {
      display: cs.display,
      position: cs.position,
      fontSize: cs.fontSize,
      color: cs.color,
      backgroundColor: cs.backgroundColor,
      padding: cs.padding,
      margin: cs.margin,
    };
  } catch { /* non-fatal */ }

  return ctx;
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

  // Gather context from the selected element(s)
  const context: Record<string, any> = {};
  if (currentTargets.length > 0) {
    const elements = currentTargets.map(gatherElementContext);
    if (elements.length === 1) {
      // Single element — flatten into context for backward compatibility
      Object.assign(context, elements[0]);
    } else {
      // Multi-element — send as array
      context.elements = elements;
      // Also set the primary element's source for file snapshotting
      if (elements[0].sourceFile) {
        context.sourceFile = elements[0].sourceFile;
        context.sourceLine = elements[0].sourceLine;
      }
      // Collect all unique source files for multi-file enrichment
      const sourceFiles = [...new Set(elements.map(e => e.sourceFile).filter(Boolean))];
      if (sourceFiles.length > 0) context.sourceFiles = sourceFiles;
    }
  }

  const streamMsg = createStreamingMessage();
  const textEl = streamMsg.querySelector('.nk-ai-msg-text') as HTMLElement;
  let rawText = '';

  const modelForRequest = nextModel;
  nextModel = 'default';

  activeController = streamAiChat('element', text, context, sessionId, {
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
  }, modelForRequest);
}
