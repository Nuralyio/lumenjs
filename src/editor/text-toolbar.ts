/**
 * Text Toolbar — floating toolbar for text formatting (font size, weight, color, alignment, i18n).
 */
import { applyAstModification, makeTranslatable } from './editor-api-client.js';
import { generateI18nKey } from './i18n-key-gen.js';

const TEXT_TAGS = new Set(['H1','H2','H3','H4','H5','H6','P','SPAN','A','LABEL','LI','BUTTON']);

let textToolbar: HTMLDivElement;
let selectedElementRef: { current: HTMLElement | null } = { current: null };

export function setTextToolbarSelectedElement(ref: { current: HTMLElement | null }) {
  selectedElementRef = ref;
}

export function getTextToolbar(): HTMLDivElement {
  return textToolbar;
}

export { TEXT_TAGS };

export function createTextToolbar(): HTMLDivElement {
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
  textToolbar = tb;
  return tb;
}

export function positionTextToolbar(el: HTMLElement) {
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

export function hideTextToolbar() {
  textToolbar.style.display = 'none';
}

function rgbToHex(rgb: string): string {
  const m = rgb.match(/(\d+)/g);
  if (!m || m.length < 3) return '#000000';
  return '#' + [m[0], m[1], m[2]].map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
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

function applyStyleToSelected(prop: string, value: string) {
  const selectedElement = selectedElementRef.current;
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

export function setupTextToolbarHandlers() {
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
      const cs = selectedElementRef.current ? window.getComputedStyle(selectedElementRef.current) : null;
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
    const selectedElement = selectedElementRef.current;
    if (!selectedElement) return;
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
        translateBtnEl.classList.add('active');
      })
      .catch((err) => console.error('[editor] Make translatable failed:', err));
  });

  // Prevent toolbar clicks from deselecting
  textToolbar.addEventListener('click', (e) => e.stopPropagation());
  textToolbar.addEventListener('mousedown', (e) => e.stopPropagation());
}

export function showTextToolbarForElement(el: HTMLElement) {
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
