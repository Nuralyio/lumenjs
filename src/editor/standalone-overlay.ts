/**
 * Standalone Editor Overlay — provides a visual editing UI when editor mode
 * runs outside an iframe (direct browsing, not embedded in Studio).
 *
 * Features:
 * - Hover highlight box around annotated elements (mouse)
 * - Tap / click to select element (shows source info in toolbar)
 * - Double-tap / double-click text to inline edit (delegates to inline-text-edit.ts)
 * - Floating toolbar at top with selected element info
 * - File tree panel to browse/edit project files
 * - Full touch support for mobile/tablet
 */
import { findAnnotatedElement, parseSourceAttr, startAnnotator } from './element-annotator.js';
import { setupInlineTextEdit, triggerInlineEdit } from './inline-text-edit.js';
import { readFile, writeFile, applyAstModification, makeTranslatable } from './editor-api-client.js';
import { generateI18nKey } from './i18n-key-gen.js';
import { setPreviewMode } from './editor-bridge.js';
import { createPropertiesPanel, showPropertiesForElement, hidePropertiesPanel, isPropertiesPanelOpen } from './properties-panel.js';
import { createAiChatPanel, showAiChatForElement, hideAiChatPanel, isAiChatPanelOpen, updateAiChatPosition } from './ai-chat-panel.js';
import { createAiProjectPanel, showAiProjectPanel, hideAiProjectPanel, isAiProjectPanelOpen, sendProjectMessage } from './ai-project-panel.js';

let initialized = false;
let selectedElement: HTMLElement | null = null;
let hoverOverlay: HTMLDivElement;
let selectOverlay: HTMLDivElement;
let toolbar: HTMLDivElement;
let filePanel: HTMLDivElement;
let textToolbar: HTMLDivElement;
let propsPanel: HTMLDivElement;
let aiChatPanel: HTMLDivElement;
let aiProjectPanel: HTMLDivElement;
let isFilePanelOpen = false;
let isEditorMode = true;  // true = Edit, false = Preview
const isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
const TEXT_TAGS = new Set(['H1','H2','H3','H4','H5','H6','P','SPAN','A','LABEL','LI','BUTTON']);

/**
 * Recursively drill through shadow DOMs to find the deepest element at a point.
 * Temporarily forces pointer-events:auto so disabled/hidden elements are discoverable.
 */
function deepElementFromPoint(x: number, y: number): HTMLElement | null {
  // Inject a temporary style that forces pointer-events on everything
  const forceStyle = document.createElement('style');
  forceStyle.textContent = '* { pointer-events: auto !important; }';
  document.head.appendChild(forceStyle);

  // Also inject into all shadow roots we encounter
  const shadowStyles: { root: ShadowRoot; style: HTMLStyleElement }[] = [];

  let el = document.elementFromPoint(x, y) as HTMLElement | null;
  while (el?.shadowRoot) {
    const ss = document.createElement('style');
    ss.textContent = '* { pointer-events: auto !important; }';
    el.shadowRoot.appendChild(ss);
    shadowStyles.push({ root: el.shadowRoot, style: ss });
    const inner = el.shadowRoot.elementFromPoint(x, y) as HTMLElement | null;
    if (!inner || inner === el) break;
    el = inner;
  }

  // Clean up
  forceStyle.remove();
  for (const { style } of shadowStyles) style.remove();

  return el;
}

function createOverlay(color: string, style: 'solid' | 'dashed' = 'solid'): HTMLDivElement {
  const el = document.createElement('div');
  Object.assign(el.style, {
    position: 'fixed',
    pointerEvents: 'none',
    border: `2px ${style} ${color}`,
    borderRadius: '4px',
    zIndex: '99998',
    transition: 'all 0.1s ease',
    display: 'none',
  });
  document.body.appendChild(el);
  return el;
}

function positionOverlay(overlay: HTMLDivElement, el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  Object.assign(overlay.style, {
    display: 'block',
    top: `${rect.top - 2}px`,
    left: `${rect.left - 2}px`,
    width: `${rect.width + 4}px`,
    height: `${rect.height + 4}px`,
  });
}

function hideOverlay(overlay: HTMLDivElement) {
  overlay.style.display = 'none';
}

function createTextToolbar(): HTMLDivElement {
  const tb = document.createElement('div');
  tb.id = 'nk-text-toolbar';
  tb.innerHTML = `
    <div class="nk-tt-row">
      <select class="nk-tt-select nk-tt-font-size" title="Font size">
        <option value="">Size</option>
        <option value="12px">12</option>
        <option value="14px">14</option>
        <option value="16px">16</option>
        <option value="18px">18</option>
        <option value="20px">20</option>
        <option value="24px">24</option>
        <option value="28px">28</option>
        <option value="32px">32</option>
        <option value="36px">36</option>
        <option value="48px">48</option>
        <option value="64px">64</option>
      </select>
      <select class="nk-tt-select nk-tt-font-weight" title="Font weight">
        <option value="">Weight</option>
        <option value="300">Light</option>
        <option value="400">Normal</option>
        <option value="500">Medium</option>
        <option value="600">Semi</option>
        <option value="700">Bold</option>
        <option value="800">Extra</option>
      </select>
      <span class="nk-tt-sep"></span>
      <button class="nk-tt-btn" data-style="fontStyle:italic" title="Italic"><em>I</em></button>
      <button class="nk-tt-btn" data-style="textDecoration:underline" title="Underline"><u>U</u></button>
      <span class="nk-tt-sep"></span>
      <button class="nk-tt-btn" data-style="textAlign:left" title="Align left">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></svg>
      </button>
      <button class="nk-tt-btn" data-style="textAlign:center" title="Align center">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>
      </button>
      <button class="nk-tt-btn" data-style="textAlign:right" title="Align right">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="6" y1="18" x2="21" y2="18"/></svg>
      </button>
      <span class="nk-tt-sep"></span>
      <label class="nk-tt-color-wrap" title="Text color">
        <span class="nk-tt-color-label">A</span>
        <input type="color" class="nk-tt-color" value="#000000">
      </label>
      <span class="nk-tt-sep nk-tt-i18n-sep" style="display:none"></span>
      <button class="nk-tt-btn nk-tt-translate" title="Make translatable" style="display:none">
        <span style="font-size:11px;font-family:system-ui">T<sub>i</sub></span>
      </button>
    </div>
  `;

  const style = document.createElement('style');
  style.textContent = `
    #nk-text-toolbar {
      position: fixed; z-index: 100000; display: none;
      background: #1e1b2e; border: 1px solid #334155; border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.4); padding: 6px 8px;
      font-family: system-ui, -apple-system, sans-serif; font-size: 12px;
      user-select: none; -webkit-user-select: none;
    }
    #nk-text-toolbar::after {
      content: ''; position: absolute; bottom: -6px; left: 50%; transform: translateX(-50%);
      border-left: 6px solid transparent; border-right: 6px solid transparent;
      border-top: 6px solid #1e1b2e;
    }
    .nk-tt-row { display: flex; align-items: center; gap: 4px; }
    .nk-tt-select {
      background: #0f0d1a; color: #e2e8f0; border: 1px solid #334155; border-radius: 4px;
      padding: 4px 6px; font-size: 11px; font-family: inherit; cursor: pointer; outline: none;
    }
    .nk-tt-select:hover { border-color: #475569; }
    .nk-tt-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; background: transparent; border: 1px solid transparent;
      border-radius: 4px; color: #e2e8f0; cursor: pointer; font-size: 13px;
      font-family: Georgia, serif; transition: all 0.1s;
      -webkit-tap-highlight-color: transparent; touch-action: manipulation;
    }
    .nk-tt-btn:hover { background: #334155; border-color: #475569; }
    .nk-tt-btn.active { background: #7c3aed; border-color: #7c3aed; }
    .nk-tt-sep { width: 1px; height: 20px; background: #334155; margin: 0 2px; }
    .nk-tt-translate { font-family: system-ui !important; }
    .nk-tt-color-wrap {
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; cursor: pointer; position: relative;
      border: 1px solid transparent; border-radius: 4px;
    }
    .nk-tt-color-wrap:hover { background: #334155; border-color: #475569; }
    .nk-tt-color-label {
      font-size: 14px; font-weight: 700; color: #e2e8f0; pointer-events: none;
      font-family: Georgia, serif;
    }
    .nk-tt-color {
      position: absolute; bottom: 0; left: 2px; width: 24px; height: 4px;
      border: none; padding: 0; cursor: pointer; opacity: 0;
    }
    .nk-tt-color-bar {
      position: absolute; bottom: 2px; left: 4px; right: 4px; height: 3px;
      background: #e2e8f0; border-radius: 1px; pointer-events: none;
    }
    @media (max-width: 640px) {
      #nk-text-toolbar { padding: 4px 6px; }
      .nk-tt-select { padding: 3px 4px; font-size: 10px; }
      .nk-tt-btn { width: 26px; height: 26px; font-size: 12px; }
    }
  `;
  document.head.appendChild(style);

  // Add color bar indicator under the "A" label
  const colorWrap = tb.querySelector('.nk-tt-color-wrap')!;
  const colorBar = document.createElement('span');
  colorBar.className = 'nk-tt-color-bar';
  colorWrap.appendChild(colorBar);

  document.body.appendChild(tb);
  return tb;
}

function positionTextToolbar(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  const tbRect = textToolbar.getBoundingClientRect();
  const tbWidth = tbRect.width || 360;
  const tbHeight = tbRect.height || 40;

  let left = rect.left + rect.width / 2 - tbWidth / 2;
  let top = rect.top - tbHeight - 10;

  // Keep within viewport
  if (left < 8) left = 8;
  if (left + tbWidth > window.innerWidth - 8) left = window.innerWidth - 8 - tbWidth;
  if (top < 52) {
    // Show below element instead (44px toolbar + 8px gap)
    top = rect.bottom + 10;
  }

  Object.assign(textToolbar.style, {
    display: 'block',
    left: `${left}px`,
    top: `${top}px`,
  });
}

function hideTextToolbar() {
  textToolbar.style.display = 'none';
}

function readCurrentStyles(el: HTMLElement) {
  const cs = window.getComputedStyle(el);

  // Font size select
  const sizeSelect = textToolbar.querySelector('.nk-tt-font-size') as HTMLSelectElement;
  sizeSelect.value = '';
  const currentSize = cs.fontSize;
  for (const opt of Array.from(sizeSelect.options)) {
    if (opt.value === currentSize) { sizeSelect.value = currentSize; break; }
  }

  // Font weight select
  const weightSelect = textToolbar.querySelector('.nk-tt-font-weight') as HTMLSelectElement;
  weightSelect.value = '';
  const currentWeight = cs.fontWeight;
  for (const opt of Array.from(weightSelect.options)) {
    if (opt.value === currentWeight) { weightSelect.value = currentWeight; break; }
  }

  // Toggle buttons
  textToolbar.querySelectorAll('.nk-tt-btn[data-style]').forEach(btn => {
    const [prop, val] = (btn as HTMLElement).dataset.style!.split(':');
    const camelProp = prop as keyof CSSStyleDeclaration;
    btn.classList.toggle('active', (cs[camelProp] as string) === val);
  });

  // Color
  const colorInput = textToolbar.querySelector('.nk-tt-color') as HTMLInputElement;
  const colorBar = textToolbar.querySelector('.nk-tt-color-bar') as HTMLElement;
  const rgb = cs.color;
  const hex = rgbToHex(rgb);
  colorInput.value = hex;
  colorBar.style.background = hex;
}

function rgbToHex(rgb: string): string {
  const m = rgb.match(/(\d+)/g);
  if (!m || m.length < 3) return '#000000';
  return '#' + [m[0], m[1], m[2]].map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
}

function applyStyleToSelected(prop: string, value: string) {
  if (!selectedElement) return;

  // Apply visually immediately
  (selectedElement.style as any)[prop] = value;

  // Persist via AST modification
  const sourceAttr = selectedElement.getAttribute('data-nk-source');
  if (!sourceAttr) return;

  const lastColon = sourceAttr.lastIndexOf(':');
  const sourceFile = sourceAttr.substring(0, lastColon);
  const line = parseInt(sourceAttr.substring(lastColon + 1), 10);

  // Build full inline style string from the element
  const styleStr = selectedElement.getAttribute('style') || '';
  // Clean up internal editor styles before saving
  const cleanStyle = styleStr
    .split(';')
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('outline') && !s.startsWith('outline-offset') && !s.startsWith('border-radius') && !s.startsWith('min-width'))
    .join('; ');

  applyAstModification(sourceFile, {
    type: 'setAttribute',
    elementSelector: selectedElement.tagName.toLowerCase(),
    sourceLine: line,
    attributeName: 'style',
    attributeValue: cleanStyle || undefined,
  }).catch(() => {
    // Silent fail — visual change still applied
  });
}

function setupTextToolbarHandlers() {
  // Font size
  textToolbar.querySelector('.nk-tt-font-size')!.addEventListener('change', (e) => {
    const val = (e.target as HTMLSelectElement).value;
    if (val) applyStyleToSelected('fontSize', val);
  });

  // Font weight
  textToolbar.querySelector('.nk-tt-font-weight')!.addEventListener('change', (e) => {
    const val = (e.target as HTMLSelectElement).value;
    if (val) applyStyleToSelected('fontWeight', val);
  });

  // Toggle buttons (italic, underline, alignment)
  textToolbar.querySelectorAll('.nk-tt-btn[data-style]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const [prop, val] = ((btn as HTMLElement).dataset.style!).split(':');
      const cs = selectedElement ? window.getComputedStyle(selectedElement) : null;
      const camelProp = prop as keyof CSSStyleDeclaration;
      const current = cs ? cs[camelProp] as string : '';

      // For italic/underline: toggle. For alignment: always set.
      if (prop === 'fontStyle' || prop === 'textDecoration') {
        const newVal = current === val ? 'normal' : val;
        applyStyleToSelected(prop, newVal);
        btn.classList.toggle('active', newVal === val);
      } else {
        // Alignment — deactivate siblings, activate this one
        textToolbar.querySelectorAll('.nk-tt-btn[data-style^="textAlign"]').forEach(b => b.classList.remove('active'));
        applyStyleToSelected(prop, val);
        btn.classList.add('active');
      }
    });
  });

  // Color picker
  const colorInput = textToolbar.querySelector('.nk-tt-color') as HTMLInputElement;
  const colorBar = textToolbar.querySelector('.nk-tt-color-bar') as HTMLElement;
  const colorLabel = textToolbar.querySelector('.nk-tt-color-label') as HTMLElement;
  colorInput.addEventListener('input', () => {
    const val = colorInput.value;
    colorBar.style.background = val;
    colorLabel.style.color = val;
    applyStyleToSelected('color', val);
  });

  // Make translatable button
  textToolbar.querySelector('.nk-tt-translate')!.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!selectedElement) return;
    // Skip if already translatable (button is in active/indicator state)
    const isAlready = !!selectedElement.getAttribute('data-nk-i18n-key') || !!selectedElement.closest('[data-nk-i18n-key]') || selectedElement.hasAttribute('data-nk-dynamic');
    if (isAlready) return;
    const sourceAttr = selectedElement.getAttribute('data-nk-source');
    if (!sourceAttr) return;
    const text = selectedElement.textContent || '';
    if (!text.trim()) return;
    const lastColon = sourceAttr.lastIndexOf(':');
    const sourceFile = sourceAttr.substring(0, lastColon);
    const line = parseInt(sourceAttr.substring(lastColon + 1), 10);
    const tag = selectedElement.tagName.toLowerCase();
    const i18nKey = generateI18nKey(sourceFile, tag, text);
    const config = (window as any).__nk_i18n_config__;
    const locales: string[] = config?.locales || ['en'];
    const translateBtnEl = textToolbar.querySelector('.nk-tt-translate') as HTMLElement;
    makeTranslatable({ sourceFile, elementSelector: tag, sourceLine: line, i18nKey, text, locales })
      .then(() => {
        // Immediately mark button as active so user sees feedback without reload
        translateBtnEl.classList.add('active');
      })
      .catch((err) => console.error('[editor] Make translatable failed:', err));
  });

  // Prevent toolbar clicks from deselecting
  textToolbar.addEventListener('click', (e) => e.stopPropagation());
  textToolbar.addEventListener('mousedown', (e) => e.stopPropagation());
}

function showTextToolbarForElement(el: HTMLElement) {
  if (TEXT_TAGS.has(el.tagName)) {
    readCurrentStyles(el);

    // Show/hide translate button based on i18n availability
    const translateBtn = textToolbar.querySelector('.nk-tt-translate') as HTMLElement;
    const translateSep = textToolbar.querySelector('.nk-tt-i18n-sep') as HTMLElement;
    const hasI18nConfig = !!(window as any).__nk_i18n_config__;
    const isI18n = !!el.getAttribute('data-nk-i18n-key') || !!el.closest('[data-nk-i18n-key]');
    const isDynamic = el.hasAttribute('data-nk-dynamic');
    const alreadyTranslatable = isI18n || isDynamic;
    translateBtn.style.display = hasI18nConfig ? '' : 'none';
    translateSep.style.display = hasI18nConfig ? '' : 'none';
    translateBtn.classList.toggle('active', alreadyTranslatable);

    positionTextToolbar(el);
  } else {
    hideTextToolbar();
  }
}

function createToolbar(): HTMLDivElement {
  const bar = document.createElement('div');
  bar.id = 'nk-editor-toolbar';
  bar.innerHTML = `
    <div class="nk-toolbar-inner">
      <div class="nk-toolbar-left">
        <button class="nk-tb-btn nk-tb-files" title="Browse Files">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>
          <span class="nk-tb-files-label">Files</span>
        </button>
        <span class="nk-tb-divider"></span>
        <button class="nk-tb-toggle" id="nk-tb-toggle" title="Toggle Edit / Preview">
          <span class="nk-tb-toggle-edit active">Edit</span>
          <span class="nk-tb-toggle-preview">Preview</span>
        </button>
      </div>
      <div class="nk-toolbar-center" id="nk-tb-selection">
        <span class="nk-tb-hint">${isTouchDevice ? 'Tap to select. Double-tap text to edit.' : 'Click to select. Double-click text to edit.'}</span>
      </div>
      <div class="nk-toolbar-right">
        <div class="nk-tb-page-ai">
          <span class="nk-tb-page-ai-icon">✦</span>
          <input class="nk-tb-page-ai-input" type="text" placeholder="Ask AI about this page..." />
          <button class="nk-tb-page-ai-send" disabled title="Send">▶</button>
        </div>
        <button class="nk-tb-btn nk-tb-project-ai" title="Project AI Chat" style="display:flex;align-items:center;gap:4px">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
          <span class="nk-tb-project-ai-label">Chat</span>
        </button>
        <button class="nk-tb-btn nk-tb-deselect" style="display:none" title="Deselect">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
    </div>
  `;
  const style = document.createElement('style');
  style.textContent = `
    #nk-editor-toolbar {
      position: fixed; top: 0; left: 0; right: 0; height: 44px;
      background: #1e1b2e; color: #e2e8f0; font-family: system-ui, -apple-system, sans-serif;
      font-size: 12px; z-index: 99999; box-shadow: 0 2px 12px rgba(0,0,0,0.3);
      user-select: none; -webkit-user-select: none;
    }
    .nk-toolbar-inner {
      display: flex; align-items: center; height: 44px; padding: 0 12px; gap: 8px;
    }
    .nk-toolbar-left, .nk-toolbar-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
    .nk-toolbar-center { flex: 1; text-align: center; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .nk-tb-hint { color: #64748b; }
    .nk-tb-mode { color: #7c3aed; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
    .nk-tb-divider { width: 1px; height: 16px; background: #334155; }
    .nk-tb-btn {
      display: inline-flex; align-items: center; gap: 4px; padding: 6px 10px;
      background: transparent; border: 1px solid #334155; border-radius: 6px;
      color: #e2e8f0; cursor: pointer; font-size: 11px; font-family: inherit;
      transition: all 0.15s; -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
    }
    .nk-tb-btn:hover { background: #334155; border-color: #475569; }
    .nk-tb-btn:active { background: #475569; }
    .nk-tb-btn.active { background: #7c3aed; border-color: #7c3aed; }
    .nk-tb-project-ai-label { font-size: 11px; font-weight: 600; }
    .nk-tb-page-ai {
      display: flex; align-items: center; gap: 0;
      background: #0f0d1a; border: 1px solid #334155; border-radius: 8px;
      padding: 0 2px 0 8px; height: 30px; transition: border-color 0.15s;
    }
    .nk-tb-page-ai:focus-within { border-color: #7c3aed; }
    .nk-tb-page-ai-icon { color: #7c3aed; font-size: 12px; flex-shrink: 0; margin-right: 4px; }
    .nk-tb-page-ai-input {
      background: transparent; border: none; color: #e2e8f0; font-size: 12px;
      font-family: inherit; outline: none; width: 180px; padding: 0;
    }
    .nk-tb-page-ai-input::placeholder { color: #64748b; }
    .nk-tb-page-ai-send {
      background: #7c3aed; border: none; color: #fff; width: 24px; height: 24px;
      border-radius: 6px; cursor: pointer; font-size: 10px; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center; transition: opacity 0.15s;
    }
    .nk-tb-page-ai-send:disabled { opacity: 0.3; cursor: default; }
    .nk-tb-page-ai-send:not(:disabled):hover { background: #6d28d9; }
    @media (max-width: 640px) {
      .nk-tb-project-ai-label { display: none; }
      .nk-tb-page-ai-input { width: 100px; }
    }
    .nk-tb-toggle {
      display: inline-flex; align-items: center; padding: 2px; gap: 0;
      background: #0f0d1a; border: 1px solid #334155; border-radius: 6px;
      cursor: pointer; font-family: inherit;
      -webkit-tap-highlight-color: transparent; touch-action: manipulation;
    }
    .nk-tb-toggle span {
      padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: 600;
      color: #64748b; transition: all 0.15s; letter-spacing: 0.03em;
    }
    .nk-tb-toggle span.active { background: #7c3aed; color: #fff; }
    .nk-tb-tag { color: #67e8f9; font-family: 'SF Mono', ui-monospace, monospace; }
    .nk-tb-source { color: #86efac; font-family: 'SF Mono', ui-monospace, monospace; font-size: 11px; }
    .nk-tb-attrs { color: #94a3b8; font-size: 11px; }

    /* File panel — sidebar on desktop, full-width sheet on mobile */
    #nk-file-panel {
      position: fixed; top: 44px; left: 0; width: 320px; max-height: calc(100vh - 44px);
      background: #1e1b2e; border-right: 1px solid #334155; border-bottom: 1px solid #334155;
      z-index: 99999; display: none; flex-direction: column; font-family: system-ui, -apple-system, sans-serif;
      box-shadow: 4px 0 16px rgba(0,0,0,0.3);
      padding-bottom: env(safe-area-inset-bottom, 0);
    }
    #nk-file-panel.open { display: flex; }
    .nk-fp-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 12px; border-bottom: 1px solid #334155; color: #e2e8f0; font-size: 13px; font-weight: 600;
    }
    .nk-fp-close-btn {
      display: none; background: none; border: none; color: #94a3b8; cursor: pointer;
      padding: 4px; -webkit-tap-highlight-color: transparent;
    }
    .nk-fp-list {
      flex: 1; overflow-y: auto; padding: 4px 0;
      -webkit-overflow-scrolling: touch;
    }
    .nk-fp-item {
      display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer;
      color: #94a3b8; font-size: 12px; font-family: 'SF Mono', ui-monospace, monospace;
      transition: background 0.1s; -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
    }
    .nk-fp-item:hover { background: #262338; color: #e2e8f0; }
    .nk-fp-item:active { background: #334155; }
    .nk-fp-item.active { background: #7c3aed22; color: #c084fc; }
    .nk-fp-icon { width: 14px; text-align: center; flex-shrink: 0; }

    /* File editor — right of sidebar on desktop, full-width on mobile */
    #nk-file-editor {
      position: fixed; top: 44px; left: 320px; right: 0; max-height: calc(100vh - 44px);
      background: #0f0d1a; border-bottom: 1px solid #334155; z-index: 99999;
      display: none; flex-direction: column;
      padding-bottom: env(safe-area-inset-bottom, 0);
    }
    #nk-file-editor.open { display: flex; }
    .nk-fe-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 12px; border-bottom: 1px solid #334155; color: #e2e8f0; font-size: 12px;
      gap: 8px; flex-wrap: wrap;
    }
    .nk-fe-header .nk-fe-path {
      font-family: 'SF Mono', ui-monospace, monospace; font-size: 11px; color: #86efac;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1;
    }
    .nk-fe-btns { display: flex; gap: 6px; flex-shrink: 0; }
    .nk-fe-textarea {
      flex: 1; width: 100%; background: #0f0d1a; color: #e2e8f0; border: none; padding: 12px;
      font-family: 'SF Mono', ui-monospace, monospace; font-size: 13px; line-height: 1.6;
      resize: none; outline: none; tab-size: 2; min-height: 250px;
      -webkit-overflow-scrolling: touch;
    }
    .nk-fe-save {
      padding: 6px 14px; background: #7c3aed; color: white; border: none; border-radius: 6px;
      cursor: pointer; font-size: 12px; font-family: inherit; font-weight: 500;
      -webkit-tap-highlight-color: transparent; touch-action: manipulation;
    }
    .nk-fe-save:hover { background: #6d28d9; }
    .nk-fe-save:active { background: #5b21b6; }
    .nk-fe-cancel {
      padding: 6px 14px; background: transparent; color: #94a3b8; border: 1px solid #334155;
      border-radius: 6px; cursor: pointer; font-size: 12px; font-family: inherit;
      -webkit-tap-highlight-color: transparent; touch-action: manipulation;
    }
    .nk-fe-cancel:hover { background: #334155; color: #e2e8f0; }

    /* Mobile responsive (<640px) */
    @media (max-width: 640px) {
      .nk-tb-files-label { display: none; }
      .nk-tb-source { display: none; }
      .nk-tb-attrs { display: none; }
      .nk-tb-hint { font-size: 11px; }

      #nk-file-panel {
        width: 100%; right: 0; border-right: none;
        max-height: 50vh;
      }
      .nk-fp-close-btn { display: block; }
      .nk-fp-item { padding: 10px 12px; font-size: 13px; }

      #nk-file-editor {
        left: 0; max-height: 60vh;
      }
      .nk-fe-textarea { font-size: 14px; min-height: 200px; }
    }

    /* Push page content down so toolbar doesn't cover it */
    body { padding-top: 44px !important; }
  `;
  document.head.appendChild(style);
  document.body.appendChild(bar);
  return bar;
}

function createFilePanel(): HTMLDivElement {
  const panel = document.createElement('div');
  panel.id = 'nk-file-panel';
  panel.innerHTML = `
    <div class="nk-fp-header">
      <span>Project Files</span>
      <button class="nk-fp-close-btn" id="nk-fp-close">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="nk-fp-list" id="nk-fp-list"></div>
  `;
  document.body.appendChild(panel);

  // File editor panel
  const editor = document.createElement('div');
  editor.id = 'nk-file-editor';
  editor.innerHTML = `
    <div class="nk-fe-header">
      <span class="nk-fe-path" id="nk-fe-path"></span>
      <div class="nk-fe-btns">
        <button class="nk-fe-save" id="nk-fe-save">Save</button>
        <button class="nk-fe-cancel" id="nk-fe-close">Close</button>
      </div>
    </div>
    <textarea class="nk-fe-textarea" id="nk-fe-textarea" spellcheck="false" autocapitalize="off" autocorrect="off"></textarea>
  `;
  document.body.appendChild(editor);

  return panel;
}

function getFileIcon(name: string): string {
  if (name.endsWith('.ts')) return '<span style="color:#3178c6">TS</span>';
  if (name.endsWith('.js')) return '<span style="color:#f7df1e">JS</span>';
  if (name.endsWith('.json')) return '<span style="color:#94a3b8">{}</span>';
  if (name.endsWith('.css')) return '<span style="color:#38bdf8">#</span>';
  return '<span style="color:#64748b">~</span>';
}

async function loadFileList() {
  const listEl = document.getElementById('nk-fp-list');
  if (!listEl) return;
  try {
    const res = await fetch('/__nk_editor/files');
    const data = await res.json();
    const files: string[] = data.files || [];
    listEl.innerHTML = files.map(f =>
      `<div class="nk-fp-item" data-file="${f}">
        <span class="nk-fp-icon">${getFileIcon(f)}</span>
        <span>${f}</span>
      </div>`
    ).join('');

    listEl.addEventListener('click', (e) => {
      const item = (e.target as HTMLElement).closest('.nk-fp-item') as HTMLElement;
      if (!item) return;
      const file = item.dataset.file!;
      openFileEditor(file);
      listEl.querySelectorAll('.nk-fp-item').forEach(el => el.classList.remove('active'));
      item.classList.add('active');
    });
  } catch {
    listEl.innerHTML = '<div style="padding:12px;color:#f87171;font-size:11px">Failed to load files</div>';
  }
}

let currentEditorFile: string | null = null;

async function openFileEditor(filePath: string) {
  const editorPanel = document.getElementById('nk-file-editor')!;
  const pathEl = document.getElementById('nk-fe-path')!;
  const textarea = document.getElementById('nk-fe-textarea') as HTMLTextAreaElement;

  // On mobile, close the file list to make room for the editor
  if (window.innerWidth <= 640) {
    filePanel.classList.remove('open');
  }

  try {
    const data = await readFile(filePath);
    currentEditorFile = filePath;
    pathEl.textContent = filePath;
    textarea.value = data.content;
    editorPanel.classList.add('open');
  } catch {
    pathEl.textContent = filePath;
    textarea.value = '// Error loading file';
    editorPanel.classList.add('open');
  }
}

async function saveCurrentFile() {
  if (!currentEditorFile) return;
  const textarea = document.getElementById('nk-fe-textarea') as HTMLTextAreaElement;
  const saveBtn = document.getElementById('nk-fe-save') as HTMLButtonElement;
  try {
    saveBtn.textContent = 'Saving...';
    await writeFile(currentEditorFile, textarea.value);
    saveBtn.textContent = 'Saved!';
    saveBtn.style.background = '#22c55e';
    setTimeout(() => {
      saveBtn.textContent = 'Save';
      saveBtn.style.background = '';
    }, 1500);
  } catch {
    saveBtn.textContent = 'Error!';
    saveBtn.style.background = '#ef4444';
    setTimeout(() => {
      saveBtn.textContent = 'Save';
      saveBtn.style.background = '';
    }, 2000);
  }
}

function updateSelectionInfo(el: HTMLElement | null) {
  const center = document.getElementById('nk-tb-selection')!;
  const deselectBtn = toolbar.querySelector('.nk-tb-deselect') as HTMLElement;

  if (!el) {
    center.innerHTML = `<span class="nk-tb-hint">${isTouchDevice ? 'Tap to select. Double-tap text to edit.' : 'Click to select. Double-click text to edit.'}</span>`;
    deselectBtn.style.display = 'none';
    return;
  }

  const sourceAttr = el.getAttribute('data-nk-source');
  const source = sourceAttr ? parseSourceAttr(sourceAttr) : null;
  const tag = el.tagName.toLowerCase();

  const attrs = Array.from(el.attributes)
    .filter(a => !a.name.startsWith('data-nk-'))
    .map(a => a.value ? `${a.name}="${a.value}"` : a.name)
    .slice(0, 3);

  const attrStr = attrs.length ? ` <span class="nk-tb-attrs">${attrs.join(' ')}</span>` : '';
  const sourceStr = source ? ` <span class="nk-tb-source">${source.file}:${source.line}</span>` : '';

  center.innerHTML = `<span class="nk-tb-tag">&lt;${tag}&gt;</span>${attrStr}${sourceStr}`;
  deselectBtn.style.display = 'inline-flex';
}

function deselect() {
  if (selectedElement) {
    selectedElement = null;
    hideOverlay(selectOverlay);
    hideTextToolbar();
    hidePropertiesPanel();
    hideAiChatPanel();
    updateSelectionInfo(null);
  }
}

function closeFilePanel() {
  isFilePanelOpen = false;
  filePanel.classList.remove('open');
  (toolbar.querySelector('.nk-tb-files') as HTMLElement).classList.remove('active');
  document.getElementById('nk-file-editor')?.classList.remove('open');
  currentEditorFile = null;
}

function setMode(editMode: boolean) {
  isEditorMode = editMode;
  try { localStorage.setItem('nk-editor-mode', editMode ? 'edit' : 'preview'); } catch {}
  const toggle = document.getElementById('nk-tb-toggle')!;
  const editSpan = toggle.querySelector('.nk-tb-toggle-edit')!;
  const previewSpan = toggle.querySelector('.nk-tb-toggle-preview')!;
  const center = document.getElementById('nk-tb-selection')!;

  setPreviewMode(!editMode);

  if (editMode) {
    editSpan.classList.add('active');
    previewSpan.classList.remove('active');
    center.innerHTML = `<span class="nk-tb-hint">${isTouchDevice ? 'Tap to select. Double-tap text to edit.' : 'Click to select. Double-click text to edit.'}</span>`;
  } else {
    previewSpan.classList.add('active');
    editSpan.classList.remove('active');
    center.innerHTML = '<span class="nk-tb-hint">Preview mode — interact normally</span>';
    // Deselect and close panels
    deselect();
    if (isFilePanelOpen) closeFilePanel();
  }
}

/**
 * Creates a synthetic MouseEvent at the touch point so existing
 * findAnnotatedElement (which uses event.composedPath()) works with touch.
 */
function touchToElement(touch: Touch): { element: HTMLElement; source: any } | null {
  let target: HTMLElement | null = document.elementFromPoint(touch.clientX, touch.clientY) as HTMLElement | null;
  if (!target) return null;

  // Drill into shadow root if the element has one
  if (target.shadowRoot) {
    const inner = target.shadowRoot.elementFromPoint(touch.clientX, touch.clientY);
    if (inner && inner instanceof HTMLElement) target = inner;
  }

  // Walk up from the touch target to find an annotated element
  let el: HTMLElement | null = target;
  while (el) {
    const sourceAttr = el.getAttribute('data-nk-source');
    if (sourceAttr) {
      const lastColon = sourceAttr.lastIndexOf(':');
      if (lastColon !== -1) {
        const file = sourceAttr.substring(0, lastColon);
        const line = parseInt(sourceAttr.substring(lastColon + 1), 10);
        if (!isNaN(line)) {
          return { element: el, source: { file, line, tag: el.tagName.toLowerCase() } };
        }
      }
    }
    // Cross shadow boundary: if parentElement is null, check host
    if (!el.parentElement && el.getRootNode() !== document) {
      const root = el.getRootNode() as ShadowRoot;
      el = root.host as HTMLElement;
    } else {
      el = el.parentElement;
    }
  }
  return null;
}

function sendPageAiPrompt(prompt: string) {
  if (!isAiProjectPanelOpen()) {
    showAiProjectPanel();
    (toolbar?.querySelector('.nk-tb-project-ai') as HTMLElement)?.classList.add('active');
  }
  sendProjectMessage(prompt);
}

export function initStandaloneEditor() {
  if (initialized) return;
  initialized = true;

  // Clean up any stale elements from HMR
  document.getElementById('nk-editor-toolbar')?.remove();
  document.getElementById('nk-file-panel')?.remove();
  document.getElementById('nk-file-editor')?.remove();
  document.getElementById('nk-text-toolbar')?.remove();
  document.getElementById('nk-props-panel')?.remove();
  document.getElementById('nk-ai-chat')?.remove();
  document.getElementById('nk-ai-project')?.remove();

  // Create UI elements
  hoverOverlay = createOverlay('#7c3aed', 'dashed');
  selectOverlay = createOverlay('#3b82f6', 'solid');
  toolbar = createToolbar();
  filePanel = createFilePanel();
  textToolbar = createTextToolbar();
  setupTextToolbarHandlers();
  propsPanel = createPropertiesPanel();
  aiChatPanel = createAiChatPanel();
  aiProjectPanel = createAiProjectPanel();

  // Restore saved editor mode
  try {
    const saved = localStorage.getItem('nk-editor-mode');
    if (saved === 'preview') setMode(false);
  } catch {}

  // Start annotator (assigns data-nk-id to custom elements)
  startAnnotator();

  // Setup inline text editing (double-click + double-tap handled inside)
  setupInlineTextEdit();

  // --- Mouse events (desktop) ---

  document.addEventListener('mouseover', (event) => {
    if (!isEditorMode) return;
    const result = findAnnotatedElement(event);
    const hoverEl = result?.element ?? (event.target instanceof HTMLElement ? event.target : null);
    if (hoverEl && hoverEl !== selectedElement && hoverEl !== document.body && hoverEl !== document.documentElement && !hoverEl.closest('#nk-editor-toolbar') && !hoverEl.closest('#nk-props-panel') && !hoverEl.closest('#nk-file-panel') && !hoverEl.closest('#nk-ai-chat') && !hoverEl.closest('#nk-ai-project')) {
      positionOverlay(hoverOverlay, hoverEl);
    } else {
      hideOverlay(hoverOverlay);
    }
  }, true);

  document.addEventListener('mouseout', () => {
    hideOverlay(hoverOverlay);
  }, true);

  // Pointerdown handler to select disabled/pointer-events:none elements.
  // The click handler won't fire on these, so we select them here instead.
  document.addEventListener('pointerdown', (event) => {
    if (isTouchDevice) return;
    if (!isEditorMode) return;
    const t = event.target as HTMLElement;
    if (t.closest('#nk-editor-toolbar') || t.closest('#nk-file-panel') || t.closest('#nk-file-editor') || t.closest('#nk-text-toolbar') || t.closest('#nk-props-panel') || t.closest('#nk-ai-chat') || t.closest('#nk-ai-project')) return;

    // Drill through shadow DOMs (with forced pointer-events) to find the real element
    const deepEl = deepElementFromPoint(event.clientX, event.clientY);
    if (!deepEl) return;

    // Check if the deep element or its host is normally unclickable
    const deepRoot = deepEl.getRootNode();
    const hostEl = deepRoot instanceof ShadowRoot ? deepRoot.host as HTMLElement : null;
    const isHostUnclickable = hostEl && (
      hostEl.hasAttribute('disabled') ||
      hostEl.getAttribute('aria-disabled') === 'true' ||
      window.getComputedStyle(hostEl).pointerEvents === 'none'
    );
    const isDeepUnclickable = (deepEl as any).disabled ||
      window.getComputedStyle(deepEl).pointerEvents === 'none';

    if (!isHostUnclickable && !isDeepUnclickable) return; // click handler will handle it

    // Find the best selectable element (prefer annotated host)
    let selectEl: HTMLElement = hostEl && hostEl.getAttribute('data-nk-source') ? hostEl : deepEl;
    if (!selectEl.getAttribute('data-nk-source')) {
      let el: HTMLElement | null = selectEl;
      while (el) {
        if (el.getAttribute('data-nk-source')) { selectEl = el; break; }
        const r = el.getRootNode();
        if (r instanceof ShadowRoot) { el = r.host as HTMLElement; continue; }
        el = el.parentElement;
      }
    }

    event.preventDefault();
    event.stopPropagation();
    selectedElement = selectEl;
    positionOverlay(selectOverlay, selectEl);
    hideOverlay(hoverOverlay);
    updateSelectionInfo(selectEl);
    showTextToolbarForElement(selectEl);
    showPropertiesForElement(selectEl);
    aiChatPanel.classList.add('open');
    showAiChatForElement(selectEl);
  }, true);

  // Click to select (desktop)
  let clickTimer: ReturnType<typeof setTimeout> | null = null;

  document.addEventListener('click', (event) => {
    // Skip if touch device — handled by touchend
    if (isTouchDevice) return;
    if (!isEditorMode) return;
    // Skip clicks on editor UI
    const t = event.target as HTMLElement;
    if (t.closest('#nk-editor-toolbar') || t.closest('#nk-file-panel') || t.closest('#nk-file-editor') || t.closest('#nk-text-toolbar') || t.closest('#nk-props-panel') || t.closest('#nk-ai-chat') || t.closest('#nk-ai-project')) return;

    let result = findAnnotatedElement(event);
    // If the found element is inside a shadow DOM, prefer the custom element host
    // that has data-nk-source (e.g. <nr-button> instead of its inner <button>)
    if (result?.element) {
      const root = result.element.getRootNode();
      if (root instanceof ShadowRoot) {
        const host = root.host as HTMLElement;
        const hostSrc = host.getAttribute('data-nk-source');
        if (hostSrc) {
          const parsed = parseSourceAttr(hostSrc);
          if (parsed) result = { element: host, source: parsed };
        }
      }
    }
    // Fallback: walk from event.target up to find annotated element
    if (!result && t) {
      let el: HTMLElement | null = t;
      // First check if we're inside a shadow root — try the host
      const root = t.getRootNode();
      if (root instanceof ShadowRoot) {
        const host = root.host as HTMLElement;
        const hostSrc = host.getAttribute('data-nk-source');
        if (hostSrc) {
          const parsed = parseSourceAttr(hostSrc);
          if (parsed) result = { element: host, source: parsed };
        }
      }
      if (!result) {
        while (el) {
          const src = el.getAttribute('data-nk-source');
          if (src) {
            const parsed = parseSourceAttr(src);
            if (parsed) { result = { element: el, source: parsed }; break; }
          }
          el = el.parentElement;
        }
      }
    }
    // Final fallback: select the clicked element even without source annotation
    // (allows property panel to work on any element)
    let targetEl: HTMLElement | null = result?.element ?? t;
    if (!targetEl || targetEl === document.body || targetEl === document.documentElement) {
      deselect();
      return;
    }

    // In edit mode, block all default behavior (navigation, form submission, etc.)
    event.preventDefault();
    event.stopPropagation();

    if (clickTimer) clearTimeout(clickTimer);
    const selectEl = targetEl;
    clickTimer = setTimeout(() => {
      selectedElement = selectEl;
      positionOverlay(selectOverlay, selectEl);
      hideOverlay(hoverOverlay);
      updateSelectionInfo(selectEl);
      showTextToolbarForElement(selectEl);
      showPropertiesForElement(selectEl);
      aiChatPanel.classList.add('open');
    showAiChatForElement(selectEl);
    }, 200);
  }, true);

  document.addEventListener('dblclick', () => {
    if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
  }, true);

  // --- Touch events (mobile/tablet) ---

  let lastTapTime = 0;
  let lastTapTarget: HTMLElement | null = null;
  let tapTimer: ReturnType<typeof setTimeout> | null = null;

  document.addEventListener('touchend', (event) => {
    // Don't interfere with toolbar/panel touches
    const target = event.target as HTMLElement;
    if (target.closest('#nk-editor-toolbar') || target.closest('#nk-file-panel') || target.closest('#nk-file-editor') || target.closest('#nk-text-toolbar') || target.closest('#nk-props-panel') || target.closest('#nk-ai-chat') || target.closest('#nk-ai-project')) {
      return;
    }
    if (!isEditorMode) return;

    const touch = event.changedTouches[0];
    if (!touch) return;

    const result = touchToElement(touch);
    // Fallback: use the touch target directly if no annotated element found
    let touchTargetEl: HTMLElement | null = result?.element ?? (document.elementFromPoint(touch.clientX, touch.clientY) as HTMLElement | null);
    if (!touchTargetEl || touchTargetEl === document.body || touchTargetEl === document.documentElement) return;

    const now = Date.now();
    // Compare by data-nk-source to handle shadow DOM identity differences
    const resultSource = touchTargetEl.getAttribute('data-nk-source') || '';
    const lastSource = lastTapTarget?.getAttribute('data-nk-source') || '';
    const isDoubleTap = (now - lastTapTime < 350) && (resultSource !== '' ? resultSource === lastSource : touchTargetEl === lastTapTarget);
    lastTapTime = now;
    lastTapTarget = touchTargetEl;

    if (isDoubleTap) {
      // Double-tap: trigger inline text edit directly
      if (tapTimer) { clearTimeout(tapTimer); tapTimer = null; }
      hideTextToolbar();

      // Drill into shadow root to find the actual text element
      let touchTarget: HTMLElement | null = document.elementFromPoint(touch.clientX, touch.clientY) as HTMLElement | null;
      if (touchTarget?.shadowRoot) {
        const inner = touchTarget.shadowRoot.elementFromPoint(touch.clientX, touch.clientY);
        if (inner instanceof HTMLElement) touchTarget = inner;
      }
      if (touchTarget) {
        triggerInlineEdit(touchTarget);
      }
      event.preventDefault();
    } else {
      // Single tap: select after short delay (to distinguish from double-tap)
      if (tapTimer) clearTimeout(tapTimer);
      const tapEl = touchTargetEl;
      tapTimer = setTimeout(() => {
        selectedElement = tapEl;
        positionOverlay(selectOverlay, tapEl);
        hideOverlay(hoverOverlay);
        updateSelectionInfo(tapEl);
        showTextToolbarForElement(tapEl);
        showPropertiesForElement(tapEl);
        aiChatPanel.classList.add('open');
        showAiChatForElement(tapEl);
      }, 300);
      // In edit mode, block all default behavior (navigation, etc.)
      event.preventDefault();
    }
  }, { passive: false, capture: true } as any);

  // --- Toolbar button handlers ---

  // Page-level AI input
  const pageAiInput = toolbar.querySelector('.nk-tb-page-ai-input') as HTMLInputElement;
  const pageAiSend = toolbar.querySelector('.nk-tb-page-ai-send') as HTMLButtonElement;
  pageAiInput.addEventListener('input', () => {
    pageAiSend.disabled = !pageAiInput.value.trim();
  });
  pageAiInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && pageAiInput.value.trim()) {
      e.preventDefault();
      sendPageAiPrompt(pageAiInput.value.trim());
      pageAiInput.value = '';
      pageAiSend.disabled = true;
    }
    e.stopPropagation(); // prevent editor shortcuts while typing
  });
  pageAiSend.addEventListener('click', (e) => {
    e.stopPropagation();
    if (pageAiInput.value.trim()) {
      sendPageAiPrompt(pageAiInput.value.trim());
      pageAiInput.value = '';
      pageAiSend.disabled = true;
    }
  });

  // Edit / Preview toggle
  document.getElementById('nk-tb-toggle')!.addEventListener('click', (e) => {
    e.stopPropagation();
    setMode(!isEditorMode);
  });

  // Deselect button
  toolbar.querySelector('.nk-tb-deselect')!.addEventListener('click', (e) => {
    e.stopPropagation();
    deselect();
  });

  // Project AI panel toggle
  toolbar.querySelector('.nk-tb-project-ai')!.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isAiProjectPanelOpen()) {
      hideAiProjectPanel();
      (toolbar.querySelector('.nk-tb-project-ai') as HTMLElement).classList.remove('active');
    } else {
      showAiProjectPanel();
      (toolbar.querySelector('.nk-tb-project-ai') as HTMLElement).classList.add('active');
    }
  });

  // File panel toggle
  toolbar.querySelector('.nk-tb-files')!.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isFilePanelOpen) {
      closeFilePanel();
    } else {
      isFilePanelOpen = true;
      filePanel.classList.add('open');
      (toolbar.querySelector('.nk-tb-files') as HTMLElement).classList.add('active');
      loadFileList();
    }
  });

  // Mobile close button in file panel header
  document.getElementById('nk-fp-close')!.addEventListener('click', (e) => {
    e.stopPropagation();
    closeFilePanel();
  });

  // File editor save / close
  document.getElementById('nk-fe-save')!.addEventListener('click', saveCurrentFile);
  document.getElementById('nk-fe-close')!.addEventListener('click', () => {
    document.getElementById('nk-file-editor')!.classList.remove('open');
    currentEditorFile = null;
    // On mobile, re-show the file list
    if (window.innerWidth <= 640 && isFilePanelOpen) {
      filePanel.classList.add('open');
    }
  });

  // Ctrl+S / Cmd+S to save in file editor
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's' && currentEditorFile) {
      e.preventDefault();
      saveCurrentFile();
    }
    if (e.key === 'Escape') {
      if (currentEditorFile) {
        document.getElementById('nk-file-editor')!.classList.remove('open');
        currentEditorFile = null;
      } else if (isAiProjectPanelOpen()) {
        hideAiProjectPanel();
        (toolbar.querySelector('.nk-tb-project-ai') as HTMLElement)?.classList.remove('active');
      } else if (isAiChatPanelOpen()) {
        hideAiChatPanel();
      } else if (isPropertiesPanelOpen()) {
        hidePropertiesPanel();
      } else if (isFilePanelOpen) {
        closeFilePanel();
      } else if (selectedElement) {
        deselect();
      }
    }
  });

  // Update overlay positions on scroll/resize
  const updateOverlays = () => {
    if (selectedElement) {
      positionOverlay(selectOverlay, selectedElement);
      if (textToolbar.style.display !== 'none') positionTextToolbar(selectedElement);
    }
    updateAiChatPosition();
  };
  window.addEventListener('scroll', updateOverlays, true);
  window.addEventListener('resize', updateOverlays);

  // Re-select element after HMR update (editor writes suppress full reload but
  // Lit may re-render, making the old selectedElement reference stale).
  // Virtual modules don't have import.meta.hot, so listen on Vite's WebSocket directly.
  try {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`, 'vite-hmr');
    ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'custom' && msg.event === 'nk-editor-update') {
          reselectAfterHmr();
        }
      } catch {}
    });
  } catch {}
}

function reselectAfterHmr() {
  if (!selectedElement) return;
  const source = selectedElement.getAttribute('data-nk-source');
  const elTag = selectedElement.tagName.toLowerCase();
  const elClass = selectedElement.className;

  // Wait for Lit re-render
  requestAnimationFrame(() => {
    setTimeout(() => {
      let newEl: HTMLElement | null = null;

      // Strategy 1: find by data-nk-source
      if (source) {
        newEl = document.querySelector(`[data-nk-source="${source}"]`);
        // If the source points to a host, drill into shadow DOM
        if (newEl && newEl.shadowRoot && newEl.tagName.toLowerCase() !== elTag) {
          const inner = newEl.shadowRoot.querySelector(elTag) as HTMLElement
            || (elClass ? newEl.shadowRoot.querySelector(`.${elClass.split(' ')[0]}`) as HTMLElement : null);
          if (inner) newEl = inner;
        }
      }

      // Strategy 2: walk all shadow roots looking for same tag+class
      if (!newEl && elClass) {
        const hosts = document.querySelectorAll('[data-nk-source]');
        for (const host of hosts) {
          if (host.shadowRoot) {
            const match = host.shadowRoot.querySelector(`${elTag}.${elClass.split(' ')[0]}`) as HTMLElement;
            if (match) { newEl = match; break; }
          }
        }
      }

      if (newEl) {
        selectedElement = newEl;
        positionOverlay(selectOverlay, newEl);
        updateSelectionInfo(newEl);
        showPropertiesForElement(newEl);
        if (isAiChatPanelOpen()) showAiChatForElement(newEl);
      } else if (selectedElement?.isConnected) {
        // Element still in DOM, just refresh panel
        showPropertiesForElement(selectedElement);
        if (isAiChatPanelOpen()) showAiChatForElement(selectedElement);
      }
    }, 150);
  });
}
