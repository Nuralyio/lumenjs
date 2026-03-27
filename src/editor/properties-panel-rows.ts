/**
 * Properties Panel — row builders, extracted from properties-panel.ts.
 */
import { PropertyInfo } from './property-registry.js';
import {
  CSS_ENUMS, COMMON_CSS_PROPS,
  isColorValue, normalizeToHex, notifyLayoutChange,
} from './css-rules.js';
import {
  persistAttribute, persistAttributeDebounced,
  persistStyle, persistStyleDebounced,
} from './properties-panel-persist.js';

export function createGroup(label: string): HTMLDivElement {
  const group = document.createElement('div');
  group.className = 'nk-pp-group';
  group.innerHTML = `<div class="nk-pp-group-header">${label}</div>`;
  return group;
}

export function parseInlineStyles(element: HTMLElement): [string, string][] {
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

export function createPropertyRow(prop: PropertyInfo, element: HTMLElement): HTMLDivElement {
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

export function createStyleRow(cssProp: string, cssVal: string, element: HTMLElement, group: HTMLDivElement): HTMLDivElement {
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

export function createAddAttributeRow(element: HTMLElement, group: HTMLDivElement): HTMLDivElement {
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
    confirmBtn.textContent = '\u2713';
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

export function createAddStyleRow(element: HTMLElement, group: HTMLDivElement): HTMLDivElement {
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
    confirmBtn.textContent = '\u2713';
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
