/**
 * Properties Panel — persistence helpers, extracted from properties-panel.ts.
 */
import { applyAstModification } from './editor-api-client.js';

/** Shared mutable state for debounce timers across panel modules. */
export const state = { debounceTimers: {} as Record<string, ReturnType<typeof setTimeout>> };

export function resetDebounceTimers(): void {
  state.debounceTimers = {};
}

export function getSourceInfo(element: HTMLElement): { sourceFile: string; line: number } | null {
  const sourceAttr = element.getAttribute('data-nk-source');
  if (!sourceAttr) return null;
  const lastColon = sourceAttr.lastIndexOf(':');
  if (lastColon === -1) return null;
  const sourceFile = sourceAttr.substring(0, lastColon);
  const line = parseInt(sourceAttr.substring(lastColon + 1), 10);
  if (isNaN(line)) return null;
  return { sourceFile, line };
}

export function persistAttribute(element: HTMLElement, attrName: string, value: string | undefined): void {
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

export function persistAttributeDebounced(element: HTMLElement, attrName: string, value: string | undefined, key: string): void {
  if (state.debounceTimers[key]) clearTimeout(state.debounceTimers[key]);
  state.debounceTimers[key] = setTimeout(() => {
    persistAttribute(element, attrName, value);
  }, 300);
}

export function persistStyle(element: HTMLElement): void {
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

export function persistStyleDebounced(element: HTMLElement): void {
  const key = '__style__';
  if (state.debounceTimers[key]) clearTimeout(state.debounceTimers[key]);
  state.debounceTimers[key] = setTimeout(() => {
    persistStyle(element);
  }, 300);
}

export function cleanStyleString(element: HTMLElement): string {
  const styleStr = element.getAttribute('style') || '';
  return styleStr
    .split(';')
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('outline') && !s.startsWith('outline-offset'))
    .join('; ');
}
