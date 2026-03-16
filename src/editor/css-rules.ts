/**
 * CSS Rules — parsing, matching, rendering, and persistence of CSS rules
 * from component source files (static styles = css`...`).
 */
import { readFile, writeFile } from './editor-api-client.js';

/** CSS style properties with known enum values */
export const CSS_ENUMS: Record<string, string[]> = {
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
export const COMMON_CSS_PROPS = [
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

export interface CssRule {
  selector: string;
  properties: [string, string][];
  /** Character offset of this rule's opening brace in the css`` content */
  startOffset: number;
  /** Character offset of this rule's closing brace in the css`` content */
  endOffset: number;
}

export interface ExtractedCss {
  cssContent: string;
  cssStart: number;
  rules: CssRule[];
}

/**
 * Find the source file for the host custom element (the one with static styles).
 * Walks up from the selected element through shadow DOM to find the host.
 */
export function findHostSourceFile(element: HTMLElement): string | null {
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
 */
export function extractCssFromSource(source: string): ExtractedCss | null {
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
export function parseCssRules(css: string): CssRule[] {
  const rules: CssRule[] = [];
  let i = 0;

  while (i < css.length) {
    // Skip whitespace
    while (i < css.length && /\s/.test(css[i])) i++;
    if (i >= css.length) break;

    // Check for @media or @keyframes — skip the outer block, parse inner rules
    if (css[i] === '@') {
      const atStart = i;
      const braceIdx = css.indexOf('{', i);
      if (braceIdx === -1) break;
      const mediaSelector = css.substring(atStart, braceIdx).trim();
      i = braceIdx + 1;
      let depth = 1;
      const innerStart = i;
      while (i < css.length && depth > 0) {
        if (css[i] === '{') depth++;
        else if (css[i] === '}') depth--;
        i++;
      }
      const innerCss = css.substring(innerStart, i - 1);
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
 */
export function selectorMatchesElement(selector: string, element: HTMLElement): boolean {
  const tag = element.tagName.toLowerCase();
  const classes = Array.from(element.classList);
  const sel = selector.trim();

  if (sel === ':host') return false;
  if (sel === tag) return true;

  if (sel.startsWith('.')) {
    const selClasses = sel.split('.').filter(Boolean);
    return selClasses.every(c => classes.includes(c));
  }

  if (sel.includes('.')) {
    const dotIdx = sel.indexOf('.');
    const selTag = sel.substring(0, dotIdx);
    const selClasses = sel.substring(dotIdx).split('.').filter(Boolean);
    if (selTag && selTag !== tag) return false;
    return selClasses.every(c => classes.includes(c));
  }

  return false;
}

export function isColorValue(name: string, value: string): boolean {
  if (/color/i.test(name)) return true;
  if (typeof value === 'string' && (/^#[0-9a-f]{3,8}$/i.test(value) || /^rgb/i.test(value))) return true;
  return false;
}

export function normalizeToHex(value: string): string {
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

/** Notify the overlay system that element layout may have changed */
export function notifyLayoutChange(): void {
  window.dispatchEvent(new Event('resize'));
}

/**
 * Render a CSS rule as a collapsible section in the panel.
 */
export function renderCssRule(
  rule: CssRule,
  extracted: ExtractedCss,
  fullSource: string,
  sourceFile: string,
  container: HTMLDivElement,
  startOpen: boolean,
  currentElementRef: { current: HTMLElement | null },
  debounceTimers: Record<string, ReturnType<typeof setTimeout>>,
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
        persistCssPropertyDebounced(sourceFile, fullSource, extracted, rule, prop, newVal, currentElementRef, debounceTimers);
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
        persistCssPropertyDebounced(sourceFile, fullSource, extracted, rule, prop, select.value, currentElementRef, debounceTimers);
      });
      control.appendChild(select);
    } else {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = val;
      input.addEventListener('input', () => {
        persistCssPropertyDebounced(sourceFile, fullSource, extracted, rule, prop, input.value, currentElementRef, debounceTimers);
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

export function renderAllRules(
  rules: CssRule[],
  extracted: ExtractedCss,
  fullSource: string,
  sourceFile: string,
  container: HTMLDivElement,
  currentElementRef: { current: HTMLElement | null },
  debounceTimers: Record<string, ReturnType<typeof setTimeout>>,
): void {
  const sep = document.createElement('div');
  sep.className = 'nk-pp-group-header';
  sep.textContent = 'ALL RULES';
  sep.style.marginTop = '4px';
  container.appendChild(sep);

  for (const rule of rules) {
    renderCssRule(rule, extracted, fullSource, sourceFile, container, false, currentElementRef, debounceTimers);
  }
}

/**
 * Load CSS rules from the component source file and render matching rules in the panel.
 */
export async function loadCssRulesForElement(
  element: HTMLElement,
  cssGroup: HTMLDivElement,
  currentElementRef: { current: HTMLElement | null },
  debounceTimers: Record<string, ReturnType<typeof setTimeout>>,
): Promise<void> {
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

    if (loadingRow) loadingRow.remove();

    const matchingRules = extracted.rules.filter(r => {
      const innerSel = r.selector.includes('{') ? r.selector.substring(r.selector.lastIndexOf('{') + 1).trim().replace('}', '').trim() : r.selector;
      return selectorMatchesElement(innerSel, element);
    });

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

      renderAllRules(extracted.rules, extracted, data.content, sourceFile, cssGroup, currentElementRef, debounceTimers);
      return;
    }

    for (const rule of matchingRules) {
      renderCssRule(rule, extracted, data.content, sourceFile, cssGroup, true, currentElementRef, debounceTimers);
    }

    const otherRules = extracted.rules.filter(r => !matchingRules.includes(r));
    if (otherRules.length > 0) {
      renderAllRules(otherRules, extracted, data.content, sourceFile, cssGroup, currentElementRef, debounceTimers);
    }
  } catch {
    if (loadingRow) loadingRow.innerHTML = '<span class="nk-pp-label" style="width:auto;color:#4a4662">Failed to load</span>';
  }
}

/**
 * Persist a CSS property change back to the source file.
 */
function persistCssPropertyDebounced(
  sourceFile: string,
  fullSource: string,
  extracted: ExtractedCss,
  rule: CssRule,
  prop: string,
  newVal: string,
  currentElementRef: { current: HTMLElement | null },
  debounceTimers: Record<string, ReturnType<typeof setTimeout>>,
): void {
  const key = `__css_${rule.selector}_${prop}`;
  if (debounceTimers[key]) clearTimeout(debounceTimers[key]);
  debounceTimers[key] = setTimeout(async () => {
    try {
      const latest = await readFile(sourceFile);
      const latestExtracted = extractCssFromSource(latest.content);
      if (!latestExtracted) return;

      const latestRule = latestExtracted.rules.find(r => r.selector === rule.selector);
      if (!latestRule) return;

      const newProps = latestRule.properties.map(([p, v]) =>
        p === prop ? `${p}: ${newVal}` : `${p}: ${v}`
      );
      const newBody = ' ' + newProps.join('; ') + '; ';

      const cssContent = latestExtracted.cssContent;
      const openBrace = latestRule.startOffset;
      const closeBrace = latestRule.endOffset - 1;
      const newCss = cssContent.substring(0, openBrace + 1) + newBody + cssContent.substring(closeBrace);

      const newSource = latest.content.substring(0, latestExtracted.cssStart) +
        newCss +
        latest.content.substring(latestExtracted.cssStart + cssContent.length);

      if (currentElementRef.current) {
        applyCssToShadowRoot(currentElementRef.current, rule.selector, prop, newVal);
        notifyLayoutChange();
      }

      await writeFile(sourceFile, newSource);
    } catch { /* silent fail */ }
  }, 300);
}

/**
 * Apply a CSS property change directly to the shadow DOM stylesheet.
 */
function applyCssToShadowRoot(element: HTMLElement, ruleSelector: string, prop: string, value: string): void {
  const root = element.getRootNode();
  if (!(root instanceof ShadowRoot)) return;

  const sheets: CSSStyleSheet[] = [];
  if (root.adoptedStyleSheets?.length) {
    sheets.push(...root.adoptedStyleSheets);
  }
  for (const s of Array.from(root.styleSheets || [])) {
    sheets.push(s as CSSStyleSheet);
  }

  const mediaMatch = ruleSelector.match(/^(@media\s+[^{]+)\{\s*(.+?)\s*\}$/);

  try {
    for (const sheet of sheets) {
      if (mediaMatch) {
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
