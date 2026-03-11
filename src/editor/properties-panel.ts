/**
 * Properties Panel — right-side panel for editing element properties and styles.
 */
import { discoverProperties, PropertyInfo } from './property-registry.js';
import { applyAstModification, readFile, writeFile } from './editor-api-client.js';

let panel: HTMLDivElement;
let currentElement: HTMLElement | null = null;
let debounceTimers: Record<string, ReturnType<typeof setTimeout>> = {};

/** CSS style properties with known enum values */
const CSS_ENUMS: Record<string, string[]> = {
  display: ['block', 'flex', 'grid', 'inline', 'inline-block', 'inline-flex', 'none'],
  position: ['static', 'relative', 'absolute', 'fixed', 'sticky'],
  overflow: ['visible', 'hidden', 'scroll', 'auto'],
  'overflow-x': ['visible', 'hidden', 'scroll', 'auto'],
  'overflow-y': ['visible', 'hidden', 'scroll', 'auto'],
  'text-align': ['left', 'center', 'right', 'justify'],
  'flex-direction': ['row', 'column', 'row-reverse', 'column-reverse'],
  'flex-wrap': ['nowrap', 'wrap', 'wrap-reverse'],
  'justify-content': ['flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'space-evenly'],
  'align-items': ['flex-start', 'flex-end', 'center', 'baseline', 'stretch'],
  'align-self': ['auto', 'flex-start', 'flex-end', 'center', 'baseline', 'stretch'],
  'font-weight': ['100', '200', '300', '400', '500', '600', '700', '800', '900'],
  'font-style': ['normal', 'italic', 'oblique'],
  'text-decoration': ['none', 'underline', 'overline', 'line-through'],
  'text-transform': ['none', 'uppercase', 'lowercase', 'capitalize'],
  'white-space': ['normal', 'nowrap', 'pre', 'pre-wrap', 'pre-line'],
  'word-break': ['normal', 'break-all', 'keep-all', 'break-word'],
  visibility: ['visible', 'hidden', 'collapse'],
  'box-sizing': ['content-box', 'border-box'],
  cursor: ['auto', 'default', 'pointer', 'wait', 'text', 'move', 'not-allowed', 'grab', 'grabbing'],
  'pointer-events': ['auto', 'none'],
  float: ['none', 'left', 'right'],
  clear: ['none', 'left', 'right', 'both'],
};

/** Common CSS properties for the "add style" autocomplete */
const COMMON_CSS_PROPS = [
  'display', 'position', 'top', 'right', 'bottom', 'left',
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border', 'border-radius', 'border-color', 'border-width', 'border-style',
  'background', 'background-color', 'background-image',
  'color', 'font-size', 'font-weight', 'font-family', 'font-style',
  'text-align', 'text-decoration', 'text-transform', 'line-height', 'letter-spacing',
  'flex', 'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-self', 'gap',
  'grid-template-columns', 'grid-template-rows', 'grid-gap',
  'overflow', 'overflow-x', 'overflow-y',
  'opacity', 'z-index', 'cursor', 'pointer-events',
  'box-shadow', 'transition', 'transform',
  'white-space', 'word-break', 'visibility',
];

/** Notify the overlay system that element layout may have changed */
function notifyLayoutChange(): void {
  window.dispatchEvent(new Event('resize'));
}

function isColorValue(name: string, value: string): boolean {
  if (/color/i.test(name)) return true;
  if (typeof value === 'string' && (/^#[0-9a-f]{3,8}$/i.test(value) || /^rgb/i.test(value))) return true;
  return false;
}

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

    /* Mobile responsive */
    @media (max-width: 640px) {
      #nk-props-panel {
        width: 100%; left: 0; right: 0; top: 44px;
        height: auto; max-height: 50vh;
        border-left: none; border-bottom: 1px solid #334155;
      }
    }
  `;
  document.head.appendChild(style);

  // Close button
  panel.querySelector('.nk-pp-close')!.addEventListener('click', (e) => {
    e.stopPropagation();
    hidePropertiesPanel();
  });

  // Prevent clicks from propagating to element selection
  panel.addEventListener('click', (e) => e.stopPropagation());
  panel.addEventListener('mousedown', (e) => e.stopPropagation());
  panel.addEventListener('touchend', (e) => e.stopPropagation());

  document.body.appendChild(panel);
  return panel;
}

export function showPropertiesForElement(element: HTMLElement): void {
  currentElement = element;
  debounceTimers = {};

  const tag = element.tagName.toLowerCase();
  panel.querySelector('.nk-pp-tag')!.textContent = `<${tag}>`;

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

  // CSS Rules group — loaded from source file's static styles
  const cssGroup = createGroup('CSS Rules');
  const cssLoading = document.createElement('div');
  cssLoading.className = 'nk-pp-row';
  cssLoading.innerHTML = '<span class="nk-pp-label" style="width:auto;color:#4a4662">Loading...</span>';
  cssGroup.appendChild(cssLoading);
  content.appendChild(cssGroup);
  loadCssRulesForElement(element, cssGroup);

  panel.classList.add('open');
}

export function hidePropertiesPanel(): void {
  panel.classList.remove('open');
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
    // Add empty option
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
    // String text input
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
      persistStyleDebounced(element, cssProp);
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
    // Also allow typing custom value
    select.addEventListener('change', () => {
      element.style.setProperty(cssProp, select.value);
      notifyLayoutChange();
      persistStyleDebounced(element, cssProp);
    });
    control.appendChild(select);
  } else {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = cssVal;
    input.addEventListener('input', () => {
      element.style.setProperty(cssProp, input.value);
      notifyLayoutChange();
      persistStyleDebounced(element, cssProp);
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
      // Check duplicate
      if (element.hasAttribute(name)) { nameInput.style.borderColor = '#f87171'; return; }
      element.setAttribute(name, val);
      persistAttribute(element, name, val);
      // Add row to the group (before the add button wrapper)
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

function persistStyleDebounced(element: HTMLElement, _cssProp: string): void {
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
    // Skip editor-injected styles
    if (prop === 'outline' || prop === 'outline-offset') continue;
    const val = style.getPropertyValue(prop);
    if (val) result.push([prop, val]);
  }
  return result;
}

function normalizeToHex(value: string): string {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  if (/^#[0-9a-f]{3}$/i.test(value)) {
    return '#' + value[1] + value[1] + value[2] + value[2] + value[3] + value[3];
  }
  const m = value.match(/(\d+)/g);
  if (m && m.length >= 3) {
    return '#' + [m[0], m[1], m[2]].map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
  }
  return '#000000';
}

// --- CSS Rules from source file ---

interface CssRule {
  selector: string;
  properties: [string, string][];
  /** Character offset of this rule's opening brace in the css`` content */
  startOffset: number;
  /** Character offset of this rule's closing brace in the css`` content */
  endOffset: number;
}

/**
 * Find the source file for the host custom element (the one with static styles).
 * Walks up from the selected element through shadow DOM to find the host.
 */
function findHostSourceFile(element: HTMLElement): string | null {
  // If the element itself has a source, check its host
  const root = element.getRootNode();
  if (root instanceof ShadowRoot) {
    const host = root.host as HTMLElement;
    const src = host.getAttribute('data-nk-source');
    if (src) {
      const lastColon = src.lastIndexOf(':');
      return lastColon !== -1 ? src.substring(0, lastColon) : null;
    }
  }
  // Fallback: check the element itself
  const src = element.getAttribute('data-nk-source');
  if (src) {
    const lastColon = src.lastIndexOf(':');
    return lastColon !== -1 ? src.substring(0, lastColon) : null;
  }
  return null;
}

/**
 * Extract CSS rules from a `static styles = css\`...\`` block in the source.
 * Returns the raw css content and parsed rules.
 */
function extractCssFromSource(source: string): { cssContent: string; cssStart: number; rules: CssRule[] } | null {
  // Find css`...` tagged template
  const cssTagRegex = /css\s*`([\s\S]*?)`/;
  const match = cssTagRegex.exec(source);
  if (!match) return null;

  const cssContent = match[1];
  const cssStart = match.index + match[0].indexOf('`') + 1;

  const rules = parseCssRules(cssContent);
  return { cssContent, cssStart, rules };
}

/**
 * Simple CSS rule parser — extracts selector + properties from a CSS string.
 * Handles nested @media by flattening rules inside.
 */
function parseCssRules(css: string): CssRule[] {
  const rules: CssRule[] = [];
  let i = 0;

  while (i < css.length) {
    // Skip whitespace
    while (i < css.length && /\s/.test(css[i])) i++;
    if (i >= css.length) break;

    // Check for @media or @keyframes — skip the outer block, parse inner rules
    if (css[i] === '@') {
      const atStart = i;
      // Find the opening brace
      const braceIdx = css.indexOf('{', i);
      if (braceIdx === -1) break;
      const mediaSelector = css.substring(atStart, braceIdx).trim();
      i = braceIdx + 1;
      // Find matching closing brace
      let depth = 1;
      const innerStart = i;
      while (i < css.length && depth > 0) {
        if (css[i] === '{') depth++;
        else if (css[i] === '}') depth--;
        i++;
      }
      const innerCss = css.substring(innerStart, i - 1);
      // Parse inner rules and prefix their selectors with the @media
      const innerRules = parseCssRules(innerCss);
      for (const r of innerRules) {
        rules.push({
          ...r,
          selector: `${mediaSelector} { ${r.selector} }`,
          startOffset: innerStart + r.startOffset,
          endOffset: innerStart + r.endOffset,
        });
      }
      continue;
    }

    // Regular rule: selector { ... }
    const braceIdx = css.indexOf('{', i);
    if (braceIdx === -1) break;
    const selector = css.substring(i, braceIdx).trim();
    i = braceIdx + 1;
    const startOffset = braceIdx;

    // Find closing brace (no nesting for regular rules)
    const closeIdx = css.indexOf('}', i);
    if (closeIdx === -1) break;
    const body = css.substring(i, closeIdx).trim();
    const endOffset = closeIdx + 1;
    i = closeIdx + 1;

    const properties: [string, string][] = [];
    for (const decl of body.split(';')) {
      const colonIdx = decl.indexOf(':');
      if (colonIdx === -1) continue;
      const prop = decl.substring(0, colonIdx).trim();
      const val = decl.substring(colonIdx + 1).trim();
      if (prop && val) properties.push([prop, val]);
    }

    if (selector) {
      rules.push({ selector, properties, startOffset, endOffset });
    }
  }

  return rules;
}

/**
 * Check if a CSS selector matches the selected element.
 * Supports: tag, .class, :host, tag.class, .class1.class2
 */
function selectorMatchesElement(selector: string, element: HTMLElement): boolean {
  const tag = element.tagName.toLowerCase();
  const classes = Array.from(element.classList);
  const sel = selector.trim();

  if (sel === ':host') return false; // :host applies to the host, not inner elements
  if (sel === tag) return true;

  // .class or .class1.class2
  if (sel.startsWith('.')) {
    const selClasses = sel.split('.').filter(Boolean);
    return selClasses.every(c => classes.includes(c));
  }

  // tag.class
  if (sel.includes('.')) {
    const dotIdx = sel.indexOf('.');
    const selTag = sel.substring(0, dotIdx);
    const selClasses = sel.substring(dotIdx).split('.').filter(Boolean);
    if (selTag && selTag !== tag) return false;
    return selClasses.every(c => classes.includes(c));
  }

  return false;
}

/**
 * Load CSS rules from the component source file and render matching rules in the panel.
 */
async function loadCssRulesForElement(element: HTMLElement, cssGroup: HTMLDivElement): Promise<void> {
  // Remove loading indicator
  const loadingRow = cssGroup.querySelector('.nk-pp-row');

  const sourceFile = findHostSourceFile(element);
  if (!sourceFile) {
    if (loadingRow) loadingRow.innerHTML = '<span class="nk-pp-label" style="width:auto;color:#4a4662">No source file</span>';
    return;
  }

  try {
    const data = await readFile(sourceFile);
    const extracted = extractCssFromSource(data.content);
    if (!extracted || extracted.rules.length === 0) {
      if (loadingRow) loadingRow.innerHTML = '<span class="nk-pp-label" style="width:auto;color:#4a4662">No static styles</span>';
      return;
    }

    // Remove loading
    if (loadingRow) loadingRow.remove();

    // Find matching rules for this element
    const matchingRules = extracted.rules.filter(r => {
      // Strip @media wrapper for matching
      const innerSel = r.selector.includes('{') ? r.selector.substring(r.selector.lastIndexOf('{') + 1).trim().replace('}', '').trim() : r.selector;
      return selectorMatchesElement(innerSel, element);
    });

    // Also show :host if the element IS the host
    const root = element.getRootNode();
    const isHost = !(root instanceof ShadowRoot);
    if (isHost) {
      const hostRules = extracted.rules.filter(r => r.selector.trim() === ':host');
      matchingRules.unshift(...hostRules);
    }

    if (matchingRules.length === 0) {
      const noMatch = document.createElement('div');
      noMatch.className = 'nk-pp-row';
      noMatch.innerHTML = '<span class="nk-pp-label" style="width:auto;color:#4a4662">No matching rules</span>';
      cssGroup.appendChild(noMatch);

      // Still show all rules collapsed
      renderAllRules(extracted.rules, extracted, data.content, sourceFile, cssGroup);
      return;
    }

    // Render matching rules
    for (const rule of matchingRules) {
      renderCssRule(rule, extracted, data.content, sourceFile, cssGroup, true);
    }

    // Show other rules collapsed
    const otherRules = extracted.rules.filter(r => !matchingRules.includes(r));
    if (otherRules.length > 0) {
      renderAllRules(otherRules, extracted, data.content, sourceFile, cssGroup);
    }
  } catch {
    if (loadingRow) loadingRow.innerHTML = '<span class="nk-pp-label" style="width:auto;color:#4a4662">Failed to load</span>';
  }
}

function renderCssRule(
  rule: CssRule,
  extracted: { cssContent: string; cssStart: number; rules: CssRule[] },
  fullSource: string,
  sourceFile: string,
  container: HTMLDivElement,
  startOpen: boolean,
): void {
  const header = document.createElement('div');
  header.className = 'nk-pp-rule-header';
  const arrow = document.createElement('span');
  arrow.className = 'nk-pp-toggle-arrow' + (startOpen ? ' open' : '');
  arrow.textContent = '▶';
  const selectorSpan = document.createElement('span');
  selectorSpan.textContent = rule.selector;
  header.appendChild(selectorSpan);
  header.appendChild(arrow);

  const body = document.createElement('div');
  body.className = 'nk-pp-rule-body' + (startOpen ? ' open' : '');

  for (const [prop, val] of rule.properties) {
    const row = document.createElement('div');
    row.className = 'nk-pp-row';

    const label = document.createElement('div');
    label.className = 'nk-pp-label';
    label.textContent = prop;
    label.title = prop;
    row.appendChild(label);

    const control = document.createElement('div');
    control.className = 'nk-pp-control';

    const enumVals = CSS_ENUMS[prop];
    if (isColorValue(prop, val)) {
      const wrap = document.createElement('div');
      wrap.className = 'nk-pp-color-wrap';
      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.value = normalizeToHex(val);
      const textInput = document.createElement('input');
      textInput.type = 'text';
      textInput.value = val;
      const sync = (newVal: string) => {
        persistCssPropertyDebounced(sourceFile, fullSource, extracted, rule, prop, newVal);
      };
      colorInput.addEventListener('input', () => { textInput.value = colorInput.value; sync(colorInput.value); });
      textInput.addEventListener('input', () => { sync(textInput.value); });
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
      select.value = val;
      select.addEventListener('change', () => {
        persistCssPropertyDebounced(sourceFile, fullSource, extracted, rule, prop, select.value);
      });
      control.appendChild(select);
    } else {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = val;
      input.addEventListener('input', () => {
        persistCssPropertyDebounced(sourceFile, fullSource, extracted, rule, prop, input.value);
      });
      control.appendChild(input);
    }

    row.appendChild(control);
    body.appendChild(row);
  }

  header.addEventListener('click', () => {
    arrow.classList.toggle('open');
    body.classList.toggle('open');
  });

  container.appendChild(header);
  container.appendChild(body);
}

function renderAllRules(
  rules: CssRule[],
  extracted: { cssContent: string; cssStart: number; rules: CssRule[] },
  fullSource: string,
  sourceFile: string,
  container: HTMLDivElement,
): void {
  const sep = document.createElement('div');
  sep.className = 'nk-pp-group-header';
  sep.textContent = 'ALL RULES';
  sep.style.marginTop = '4px';
  container.appendChild(sep);

  for (const rule of rules) {
    renderCssRule(rule, extracted, fullSource, sourceFile, container, false);
  }
}

/**
 * Persist a CSS property change back to the source file.
 * Rewrites the property value within the rule in the css`` template.
 */
function persistCssPropertyDebounced(
  sourceFile: string,
  fullSource: string,
  extracted: { cssContent: string; cssStart: number; rules: CssRule[] },
  rule: CssRule,
  prop: string,
  newVal: string,
): void {
  const key = `__css_${rule.selector}_${prop}`;
  if (debounceTimers[key]) clearTimeout(debounceTimers[key]);
  debounceTimers[key] = setTimeout(async () => {
    try {
      // Re-read the file to get the latest content
      const latest = await readFile(sourceFile);
      const latestExtracted = extractCssFromSource(latest.content);
      if (!latestExtracted) return;

      // Find the matching rule in the latest source
      const latestRule = latestExtracted.rules.find(r => r.selector === rule.selector);
      if (!latestRule) return;

      // Rebuild the rule body with the updated property
      const newProps = latestRule.properties.map(([p, v]) =>
        p === prop ? `${p}: ${newVal}` : `${p}: ${v}`
      );
      const newBody = ' ' + newProps.join('; ') + '; ';

      // Replace the rule body in the css content
      const cssContent = latestExtracted.cssContent;
      const openBrace = latestRule.startOffset;
      const closeBrace = latestRule.endOffset - 1; // endOffset is after }
      const newCss = cssContent.substring(0, openBrace + 1) + newBody + cssContent.substring(closeBrace);

      // Reconstruct the full source
      const newSource = latest.content.substring(0, latestExtracted.cssStart) +
        newCss +
        latest.content.substring(latestExtracted.cssStart + cssContent.length);

      // Apply visually to the shadow DOM stylesheet immediately (no page reload)
      if (currentElement) {
        applyCssToShadowRoot(currentElement, rule.selector, prop, newVal);
        notifyLayoutChange();
      }

      // Write file with HMR suppressed — visual change already applied above
      await writeFile(sourceFile, newSource);
    } catch { /* silent fail */ }
  }, 300);
}

/**
 * Apply a CSS property change directly to the shadow DOM stylesheet.
 * Handles both regular rules (e.g. "h1") and @media-wrapped rules.
 */
function applyCssToShadowRoot(element: HTMLElement, ruleSelector: string, prop: string, value: string): void {
  const root = element.getRootNode();
  if (!(root instanceof ShadowRoot)) return;

  // Collect all stylesheets from the shadow root
  const sheets: CSSStyleSheet[] = [];
  if (root.adoptedStyleSheets?.length) {
    sheets.push(...root.adoptedStyleSheets);
  }
  for (const s of Array.from(root.styleSheets || [])) {
    sheets.push(s as CSSStyleSheet);
  }

  // Check if the selector is wrapped in @media
  const mediaMatch = ruleSelector.match(/^(@media\s+[^{]+)\{\s*(.+?)\s*\}$/);

  try {
    for (const sheet of sheets) {
      if (mediaMatch) {
        // Find the matching @media rule, then the inner rule
        const mediaCondition = mediaMatch[1].trim();
        const innerSelector = mediaMatch[2].trim();
        for (const cssRule of Array.from(sheet.cssRules)) {
          if (cssRule instanceof CSSMediaRule && mediaCondition.includes(cssRule.conditionText)) {
            for (const inner of Array.from(cssRule.cssRules)) {
              if (inner instanceof CSSStyleRule && inner.selectorText === innerSelector) {
                inner.style.setProperty(prop, value);
                return;
              }
            }
          }
        }
      } else {
        // Regular rule
        for (const cssRule of Array.from(sheet.cssRules)) {
          if (cssRule instanceof CSSStyleRule && cssRule.selectorText === ruleSelector.trim()) {
            cssRule.style.setProperty(prop, value);
            return;
          }
        }
      }
    }
  } catch { /* cross-origin or security restriction */ }
}
