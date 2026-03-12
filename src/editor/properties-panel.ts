/**
 * Properties Panel — right-side panel for editing element properties and styles.
 */
import { discoverProperties, PropertyInfo } from './property-registry.js';
import { applyAstModification } from './editor-api-client.js';
import {
  CSS_ENUMS, COMMON_CSS_PROPS,
  isColorValue, normalizeToHex, notifyLayoutChange,
  loadCssRulesForElement,
} from './css-rules.js';

let panel: HTMLDivElement;
let currentElement: HTMLElement | null = null;
let debounceTimers: Record<string, ReturnType<typeof setTimeout>> = {};

export function createPropertiesPanel(): HTMLDivElement {
  panel = document.createElement('div');
  panel.id = 'nk-props-panel';
  panel.innerHTML = `
    <div class="nk-pp-header">
      <span class="nk-pp-tag"></span>
      <button class="nk-pp-close">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="nk-pp-ai-row">
      <button class="nk-pp-ai-btn" id="nk-pp-ai-btn">
        <span>✦</span> Ask AI about this element
      </button>
    </div>
    <div class="nk-pp-content"></div>
  `;

  const style = document.createElement('style');
  style.textContent = `
    #nk-props-panel {
      position: fixed; top: 44px; right: 0; width: 300px;
      height: calc(100vh - 44px); background: #1e1b2e;
      border-left: 1px solid #334155;
      z-index: 99999; display: none; flex-direction: column;
      font-family: system-ui, -apple-system, sans-serif; font-size: 12px;
      box-shadow: -4px 0 16px rgba(0,0,0,0.3); color: #e2e8f0;
    }
    #nk-props-panel.open { display: flex; }
    .nk-pp-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 12px; border-bottom: 1px solid #334155; flex-shrink: 0;
    }
    .nk-pp-tag {
      font-family: 'SF Mono', ui-monospace, monospace; font-size: 13px;
      color: #67e8f9; font-weight: 600;
    }
    .nk-pp-close {
      background: none; border: none; color: #94a3b8; cursor: pointer;
      padding: 4px; display: flex; align-items: center;
      -webkit-tap-highlight-color: transparent;
    }
    .nk-pp-close:hover { color: #e2e8f0; }
    .nk-pp-content {
      flex: 1; overflow-y: auto; padding: 0;
      -webkit-overflow-scrolling: touch;
    }
    .nk-pp-group {
      border-bottom: 1px solid #334155;
    }
    .nk-pp-group-header {
      padding: 8px 12px; font-size: 10px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.08em; color: #64748b;
      background: #161325;
    }
    .nk-pp-row {
      display: flex; align-items: center; gap: 8px; padding: 6px 12px;
      border-bottom: 1px solid #1a1730;
    }
    .nk-pp-row:last-child { border-bottom: none; }
    .nk-pp-label {
      width: 90px; flex-shrink: 0; font-size: 11px; color: #94a3b8;
      font-family: 'SF Mono', ui-monospace, monospace;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .nk-pp-control { flex: 1; min-width: 0; }
    .nk-pp-control input[type="text"],
    .nk-pp-control input[type="number"] {
      width: 100%; background: #0f0d1a; color: #e2e8f0;
      border: 1px solid #334155; border-radius: 4px; padding: 4px 8px;
      font-size: 11px; font-family: 'SF Mono', ui-monospace, monospace;
      outline: none; box-sizing: border-box;
    }
    .nk-pp-control input:focus { border-color: #7c3aed; }
    .nk-pp-control select {
      width: 100%; background: #0f0d1a; color: #e2e8f0;
      border: 1px solid #334155; border-radius: 4px; padding: 4px 6px;
      font-size: 11px; font-family: inherit; cursor: pointer; outline: none;
    }
    .nk-pp-control select:hover { border-color: #475569; }
    .nk-pp-control select:focus { border-color: #7c3aed; }
    .nk-pp-toggle {
      position: relative; width: 32px; height: 18px; background: #334155;
      border-radius: 9px; cursor: pointer; transition: background 0.2s;
      border: none; padding: 0;
    }
    .nk-pp-toggle.on { background: #7c3aed; }
    .nk-pp-toggle::after {
      content: ''; position: absolute; top: 2px; left: 2px;
      width: 14px; height: 14px; background: #e2e8f0; border-radius: 50%;
      transition: transform 0.2s;
    }
    .nk-pp-toggle.on::after { transform: translateX(14px); }
    .nk-pp-readonly {
      font-size: 10px; color: #64748b; font-family: 'SF Mono', ui-monospace, monospace;
      max-height: 60px; overflow: auto; word-break: break-all;
    }
    .nk-pp-add-row {
      padding: 6px 12px;
    }
    .nk-pp-add-btn {
      background: none; border: 1px dashed #334155; border-radius: 4px;
      color: #64748b; cursor: pointer; font-size: 11px; padding: 4px 10px;
      width: 100%; text-align: center; font-family: inherit;
      -webkit-tap-highlight-color: transparent;
    }
    .nk-pp-add-btn:hover { border-color: #7c3aed; color: #c084fc; }
    .nk-pp-add-form {
      display: flex; gap: 4px; align-items: center; padding: 6px 12px;
    }
    .nk-pp-add-form input {
      flex: 1; background: #0f0d1a; color: #e2e8f0; border: 1px solid #334155;
      border-radius: 4px; padding: 4px 6px; font-size: 11px;
      font-family: 'SF Mono', ui-monospace, monospace; outline: none;
      min-width: 0;
    }
    .nk-pp-add-form input:focus { border-color: #7c3aed; }
    .nk-pp-add-form button {
      background: #7c3aed; color: white; border: none; border-radius: 4px;
      padding: 4px 8px; cursor: pointer; font-size: 11px; flex-shrink: 0;
    }
    .nk-pp-add-form button:hover { background: #6d28d9; }
    .nk-pp-remove {
      background: none; border: none; color: #475569; cursor: pointer;
      padding: 2px; font-size: 14px; line-height: 1; flex-shrink: 0;
      -webkit-tap-highlight-color: transparent;
    }
    .nk-pp-remove:hover { color: #f87171; }
    .nk-pp-color-wrap {
      display: flex; align-items: center; gap: 4px; width: 100%;
    }
    .nk-pp-rule-header {
      padding: 6px 12px; font-size: 11px; color: #c084fc;
      font-family: 'SF Mono', ui-monospace, monospace; background: #1a1730;
      border-bottom: 1px solid #1a1730; cursor: pointer; display: flex;
      align-items: center; justify-content: space-between;
    }
    .nk-pp-rule-header:hover { background: #201d33; }
    .nk-pp-rule-header .nk-pp-toggle-arrow {
      font-size: 10px; color: #64748b; transition: transform 0.15s;
    }
    .nk-pp-rule-header .nk-pp-toggle-arrow.open { transform: rotate(90deg); }
    .nk-pp-rule-body { display: none; }
    .nk-pp-rule-body.open { display: block; }
    .nk-pp-color-wrap input[type="color"] {
      width: 28px; height: 24px; border: 1px solid #334155; border-radius: 4px;
      background: #0f0d1a; cursor: pointer; padding: 0; flex-shrink: 0;
    }
    .nk-pp-color-wrap input[type="text"] { flex: 1; }
    .nk-pp-ai-row {
      display: none; padding: 8px 12px; border-bottom: 1px solid #334155;
    }
    .nk-pp-ai-btn {
      width: 100%; padding: 8px 12px; background: #7c3aed; color: #fff;
      border: none; border-radius: 6px; font-size: 12px; font-weight: 600;
      font-family: inherit; cursor: pointer; display: flex; align-items: center;
      justify-content: center; gap: 6px;
      -webkit-tap-highlight-color: transparent; touch-action: manipulation;
    }
    .nk-pp-ai-btn:hover { background: #6d28d9; }
    .nk-pp-ai-btn:active { background: #5b21b6; }

    /* Mobile responsive */
    @media (max-width: 640px) {
      #nk-props-panel {
        width: 100%; left: 0; right: 0; top: 0;
        height: 100vh; max-height: 100vh;
        border-left: none; border-bottom: none;
        touch-action: manipulation;
      }
      .nk-pp-ai-row { display: block; }
    }
  `;
  document.head.appendChild(style);

  // Close button
  panel.querySelector('.nk-pp-close')!.addEventListener('click', (e) => {
    e.stopPropagation();
    hidePropertiesPanel();
  });

  // AI button — prefills toolbar AI input with element context
  panel.querySelector('#nk-pp-ai-btn')!.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!currentElement) return;
    const tag = currentElement.tagName.toLowerCase();
    const aiInput = document.querySelector('.nk-tb-page-ai-input') as HTMLInputElement | null;
    if (aiInput) {
      hidePropertiesPanel();
      aiInput.value = `Change the <${tag}> element: `;
      aiInput.focus();
      const sendBtn = document.querySelector('.nk-tb-page-ai-send') as HTMLButtonElement | null;
      if (sendBtn) sendBtn.disabled = false;
    }
  });

  // Prevent clicks from propagating to element selection
  panel.addEventListener('click', (e) => e.stopPropagation());
  panel.addEventListener('mousedown', (e) => e.stopPropagation());
  panel.addEventListener('touchend', (e) => e.stopPropagation());

  document.body.appendChild(panel);
  return panel;
}

function isMobile(): boolean { return window.innerWidth <= 640; }
function toggleToolbarForPanel(show: boolean): void {
  const toolbar = document.getElementById('nk-editor-toolbar');
  if (toolbar && isMobile()) toolbar.style.display = show ? '' : 'none';
}

export function showPropertiesForElement(element: HTMLElement): void {
  currentElement = element;
  debounceTimers = {};

  const tag = element.tagName.toLowerCase();
  panel.querySelector('.nk-pp-tag')!.textContent = `<${tag}>`;
  toggleToolbarForPanel(false);

  const content = panel.querySelector('.nk-pp-content')!;
  content.innerHTML = '';

  // Attributes group
  const props = discoverProperties(element);
  const attrGroup = createGroup('Attributes');
  for (const prop of props) {
    attrGroup.appendChild(createPropertyRow(prop, element));
  }
  attrGroup.appendChild(createAddAttributeRow(element, attrGroup));
  content.appendChild(attrGroup);

  // Inline Styles group
  const styleGroup = createGroup('Inline Styles');
  const inlineStyles = parseInlineStyles(element);
  for (const [cssProp, cssVal] of inlineStyles) {
    styleGroup.appendChild(createStyleRow(cssProp, cssVal, element, styleGroup));
  }
  styleGroup.appendChild(createAddStyleRow(element, styleGroup));
  content.appendChild(styleGroup);

  // CSS Rules group
  const cssGroup = createGroup('CSS Rules');
  const cssLoading = document.createElement('div');
  cssLoading.className = 'nk-pp-row';
  cssLoading.innerHTML = '<span class="nk-pp-label" style="width:auto;color:#4a4662">Loading...</span>';
  cssGroup.appendChild(cssLoading);
  content.appendChild(cssGroup);
  const currentElementRef = { get current() { return currentElement; } };
  loadCssRulesForElement(element, cssGroup, currentElementRef, debounceTimers);

  panel.classList.add('open');
}

export function hidePropertiesPanel(): void {
  panel.classList.remove('open');
  toggleToolbarForPanel(true);
  currentElement = null;
  debounceTimers = {};
}

export function isPropertiesPanelOpen(): boolean {
  return panel.classList.contains('open');
}

function createGroup(label: string): HTMLDivElement {
  const group = document.createElement('div');
  group.className = 'nk-pp-group';
  group.innerHTML = `<div class="nk-pp-group-header">${label}</div>`;
  return group;
}

function createPropertyRow(prop: PropertyInfo, element: HTMLElement): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'nk-pp-row';

  const label = document.createElement('div');
  label.className = 'nk-pp-label';
  label.textContent = prop.name;
  label.title = prop.name;
  row.appendChild(label);

  const control = document.createElement('div');
  control.className = 'nk-pp-control';

  if (prop.type === 'Boolean') {
    const toggle = document.createElement('button');
    toggle.className = 'nk-pp-toggle' + (prop.value ? ' on' : '');
    toggle.addEventListener('click', () => {
      const newVal = !toggle.classList.contains('on');
      toggle.classList.toggle('on', newVal);
      (element as any)[prop.name] = newVal;
      if (newVal) {
        element.setAttribute(prop.attrName, '');
      } else {
        element.removeAttribute(prop.attrName);
      }
      persistAttribute(element, prop.attrName, newVal ? '' : undefined);
    });
    control.appendChild(toggle);
  } else if (prop.type === 'Array' || prop.type === 'Object') {
    const ro = document.createElement('div');
    ro.className = 'nk-pp-readonly';
    try { ro.textContent = JSON.stringify(prop.value); } catch { ro.textContent = String(prop.value); }
    control.appendChild(ro);
  } else if (prop.enumValues && prop.enumValues.length > 0) {
    const select = document.createElement('select');
    const emptyOpt = document.createElement('option');
    emptyOpt.value = '';
    emptyOpt.textContent = '—';
    select.appendChild(emptyOpt);
    for (const val of prop.enumValues) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = val;
      select.appendChild(opt);
    }
    select.value = prop.value != null ? String(prop.value) : '';
    select.addEventListener('change', () => {
      const v = select.value;
      (element as any)[prop.name] = v;
      if (v) {
        element.setAttribute(prop.attrName, v);
      } else {
        element.removeAttribute(prop.attrName);
      }
      persistAttribute(element, prop.attrName, v || undefined);
    });
    control.appendChild(select);
  } else if (isColorValue(prop.name, String(prop.value ?? ''))) {
    const wrap = document.createElement('div');
    wrap.className = 'nk-pp-color-wrap';
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = normalizeToHex(String(prop.value ?? '#000000'));
    const textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.value = String(prop.value ?? '');
    const sync = (val: string) => {
      (element as any)[prop.name] = val;
      element.setAttribute(prop.attrName, val);
      persistAttributeDebounced(element, prop.attrName, val, prop.name);
    };
    colorInput.addEventListener('input', () => {
      textInput.value = colorInput.value;
      sync(colorInput.value);
    });
    textInput.addEventListener('input', () => {
      sync(textInput.value);
    });
    wrap.appendChild(colorInput);
    wrap.appendChild(textInput);
    control.appendChild(wrap);
  } else if (prop.type === 'Number') {
    const input = document.createElement('input');
    input.type = 'number';
    input.value = prop.value != null ? String(prop.value) : '';
    input.addEventListener('input', () => {
      const v = input.value;
      (element as any)[prop.name] = v ? Number(v) : undefined;
      if (v) {
        element.setAttribute(prop.attrName, v);
      } else {
        element.removeAttribute(prop.attrName);
      }
      persistAttributeDebounced(element, prop.attrName, v || undefined, prop.name);
    });
    control.appendChild(input);
  } else {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = prop.value != null ? String(prop.value) : '';
    input.addEventListener('input', () => {
      const v = input.value;
      (element as any)[prop.name] = v;
      if (v) {
        element.setAttribute(prop.attrName, v);
      } else {
        element.removeAttribute(prop.attrName);
      }
      persistAttributeDebounced(element, prop.attrName, v || undefined, prop.name);
    });
    control.appendChild(input);
  }

  row.appendChild(control);
  return row;
}

function createStyleRow(cssProp: string, cssVal: string, element: HTMLElement, group: HTMLDivElement): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'nk-pp-row';

  const label = document.createElement('div');
  label.className = 'nk-pp-label';
  label.textContent = cssProp;
  label.title = cssProp;
  row.appendChild(label);

  const control = document.createElement('div');
  control.className = 'nk-pp-control';

  const enumVals = CSS_ENUMS[cssProp];
  if (isColorValue(cssProp, cssVal)) {
    const wrap = document.createElement('div');
    wrap.className = 'nk-pp-color-wrap';
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = normalizeToHex(cssVal);
    const textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.value = cssVal;
    const sync = (val: string) => {
      element.style.setProperty(cssProp, val);
      notifyLayoutChange();
      persistStyleDebounced(element);
    };
    colorInput.addEventListener('input', () => {
      textInput.value = colorInput.value;
      sync(colorInput.value);
    });
    textInput.addEventListener('input', () => {
      sync(textInput.value);
    });
    wrap.appendChild(colorInput);
    wrap.appendChild(textInput);
    control.appendChild(wrap);
  } else if (enumVals) {
    const select = document.createElement('select');
    const emptyOpt = document.createElement('option');
    emptyOpt.value = '';
    emptyOpt.textContent = '—';
    select.appendChild(emptyOpt);
    for (const v of enumVals) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      select.appendChild(opt);
    }
    select.value = cssVal;
    select.addEventListener('change', () => {
      element.style.setProperty(cssProp, select.value);
      notifyLayoutChange();
      persistStyleDebounced(element);
    });
    control.appendChild(select);
  } else {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = cssVal;
    input.addEventListener('input', () => {
      element.style.setProperty(cssProp, input.value);
      notifyLayoutChange();
      persistStyleDebounced(element);
    });
    control.appendChild(input);
  }
  row.appendChild(control);

  // Remove button
  const removeBtn = document.createElement('button');
  removeBtn.className = 'nk-pp-remove';
  removeBtn.innerHTML = '&times;';
  removeBtn.title = 'Remove style';
  removeBtn.addEventListener('click', () => {
    element.style.removeProperty(cssProp);
    row.remove();
    notifyLayoutChange();
    persistStyle(element);
  });
  row.appendChild(removeBtn);

  return row;
}

function createAddAttributeRow(element: HTMLElement, group: HTMLDivElement): HTMLDivElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'nk-pp-add-row';

  const addBtn = document.createElement('button');
  addBtn.className = 'nk-pp-add-btn';
  addBtn.textContent = '+ Add Attribute';
  wrapper.appendChild(addBtn);

  addBtn.addEventListener('click', () => {
    addBtn.style.display = 'none';
    const form = document.createElement('div');
    form.className = 'nk-pp-add-form';
    const nameInput = document.createElement('input');
    nameInput.placeholder = 'name';
    const valInput = document.createElement('input');
    valInput.placeholder = 'value';
    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = '✓';
    form.appendChild(nameInput);
    form.appendChild(valInput);
    form.appendChild(confirmBtn);
    wrapper.appendChild(form);
    nameInput.focus();

    const commit = () => {
      const name = nameInput.value.trim();
      const val = valInput.value;
      if (!name) { addBtn.style.display = ''; form.remove(); return; }
      if (element.hasAttribute(name)) { nameInput.style.borderColor = '#f87171'; return; }
      element.setAttribute(name, val);
      persistAttribute(element, name, val);
      const prop: PropertyInfo = { name, attrName: name, type: 'String', value: val };
      group.insertBefore(createPropertyRow(prop, element), wrapper);
      addBtn.style.display = '';
      form.remove();
    };
    confirmBtn.addEventListener('click', commit);
    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { addBtn.style.display = ''; form.remove(); } });
    valInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { addBtn.style.display = ''; form.remove(); } });
  });

  return wrapper;
}

function createAddStyleRow(element: HTMLElement, group: HTMLDivElement): HTMLDivElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'nk-pp-add-row';

  const addBtn = document.createElement('button');
  addBtn.className = 'nk-pp-add-btn';
  addBtn.textContent = '+ Add Style';
  wrapper.appendChild(addBtn);

  addBtn.addEventListener('click', () => {
    addBtn.style.display = 'none';
    const form = document.createElement('div');
    form.className = 'nk-pp-add-form';
    const nameInput = document.createElement('input');
    nameInput.placeholder = 'property';
    nameInput.setAttribute('list', 'nk-pp-css-list');
    const valInput = document.createElement('input');
    valInput.placeholder = 'value';
    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = '✓';
    form.appendChild(nameInput);
    form.appendChild(valInput);
    form.appendChild(confirmBtn);
    wrapper.appendChild(form);

    // Datalist for autocomplete
    if (!document.getElementById('nk-pp-css-list')) {
      const dl = document.createElement('datalist');
      dl.id = 'nk-pp-css-list';
      for (const p of COMMON_CSS_PROPS) {
        const opt = document.createElement('option');
        opt.value = p;
        dl.appendChild(opt);
      }
      document.body.appendChild(dl);
    }
    nameInput.focus();

    const commit = () => {
      const prop = nameInput.value.trim();
      const val = valInput.value.trim();
      if (!prop || !val) { addBtn.style.display = ''; form.remove(); return; }
      element.style.setProperty(prop, val);
      notifyLayoutChange();
      persistStyle(element);
      group.insertBefore(createStyleRow(prop, val, element, group), wrapper);
      addBtn.style.display = '';
      form.remove();
    };
    confirmBtn.addEventListener('click', commit);
    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { valInput.focus(); e.preventDefault(); } if (e.key === 'Escape') { addBtn.style.display = ''; form.remove(); } });
    valInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { addBtn.style.display = ''; form.remove(); } });
  });

  return wrapper;
}

// --- Persistence helpers ---

function getSourceInfo(element: HTMLElement): { sourceFile: string; line: number } | null {
  const sourceAttr = element.getAttribute('data-nk-source');
  if (!sourceAttr) return null;
  const lastColon = sourceAttr.lastIndexOf(':');
  if (lastColon === -1) return null;
  const sourceFile = sourceAttr.substring(0, lastColon);
  const line = parseInt(sourceAttr.substring(lastColon + 1), 10);
  if (isNaN(line)) return null;
  return { sourceFile, line };
}

function persistAttribute(element: HTMLElement, attrName: string, value: string | undefined): void {
  const info = getSourceInfo(element);
  if (!info) return;
  applyAstModification(info.sourceFile, {
    type: value !== undefined ? 'setAttribute' : 'removeAttribute',
    elementSelector: element.tagName.toLowerCase(),
    sourceLine: info.line,
    attributeName: attrName,
    attributeValue: value,
  }).catch(() => {});
}

function persistAttributeDebounced(element: HTMLElement, attrName: string, value: string | undefined, key: string): void {
  if (debounceTimers[key]) clearTimeout(debounceTimers[key]);
  debounceTimers[key] = setTimeout(() => {
    persistAttribute(element, attrName, value);
  }, 300);
}

function persistStyle(element: HTMLElement): void {
  const info = getSourceInfo(element);
  if (!info) return;
  const styleStr = cleanStyleString(element);
  applyAstModification(info.sourceFile, {
    type: 'setAttribute',
    elementSelector: element.tagName.toLowerCase(),
    sourceLine: info.line,
    attributeName: 'style',
    attributeValue: styleStr || undefined,
  }).catch(() => {});
}

function persistStyleDebounced(element: HTMLElement): void {
  const key = '__style__';
  if (debounceTimers[key]) clearTimeout(debounceTimers[key]);
  debounceTimers[key] = setTimeout(() => {
    persistStyle(element);
  }, 300);
}

function cleanStyleString(element: HTMLElement): string {
  const styleStr = element.getAttribute('style') || '';
  return styleStr
    .split(';')
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('outline') && !s.startsWith('outline-offset'))
    .join('; ');
}

function parseInlineStyles(element: HTMLElement): [string, string][] {
  const result: [string, string][] = [];
  const style = element.style;
  for (let i = 0; i < style.length; i++) {
    const prop = style[i];
    if (prop === 'outline' || prop === 'outline-offset') continue;
    const val = style.getPropertyValue(prop);
    if (val) result.push([prop, val]);
  }
  return result;
}
