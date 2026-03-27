/**
 * Properties Panel — right-side panel for editing element properties and styles.
 */
import { discoverProperties } from './property-registry.js';
import { loadCssRulesForElement } from './css-rules.js';
import { injectPropertiesPanelStyles } from './properties-panel-styles.js';
import { state as persistState, resetDebounceTimers } from './properties-panel-persist.js';
import {
  createGroup, parseInlineStyles,
  createPropertyRow, createStyleRow,
  createAddAttributeRow, createAddStyleRow,
} from './properties-panel-rows.js';

let panel: HTMLDivElement;
let currentElement: HTMLElement | null = null;

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

  injectPropertiesPanelStyles();

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

  // Floating action button for mobile
  const fab = document.createElement('button');
  fab.id = 'nk-pp-fab';
  fab.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
  fab.title = 'Edit properties';
  fab.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!currentElement) return;
    fab.classList.remove('visible');
    openPanelFull(currentElement);
  });
  fab.addEventListener('touchend', (e) => e.stopPropagation());
  document.body.appendChild(fab);

  return panel;
}

function isMobile(): boolean { return window.innerWidth <= 640; }
function toggleToolbarForPanel(show: boolean): void {
  const toolbar = document.getElementById('nk-editor-toolbar');
  if (toolbar && isMobile()) toolbar.style.display = show ? '' : 'none';
}

function openPanelFull(element: HTMLElement): void {
  const tag = element.tagName.toLowerCase();
  panel.querySelector('.nk-pp-tag')!.textContent = `<${tag}>`;
  toggleToolbarForPanel(false);
  // Hide AI chat on mobile when fullscreen panel opens
  const aiChat = document.getElementById('nk-ai-chat');
  if (aiChat) aiChat.classList.remove('open');
  buildPanelContent(element);
  panel.classList.add('open');
}

export function showPropertiesForElement(element: HTMLElement): void {
  currentElement = element;
  resetDebounceTimers();

  if (isMobile()) {
    // On mobile: close any existing open panel, restore toolbar, show FAB
    if (panel.classList.contains('open')) {
      panel.classList.remove('open');
      toggleToolbarForPanel(true);
    }
    const fab = document.getElementById('nk-pp-fab');
    if (fab) fab.classList.add('visible');
    return;
  }

  const tag = element.tagName.toLowerCase();
  panel.querySelector('.nk-pp-tag')!.textContent = `<${tag}>`;
  buildPanelContent(element);
  panel.classList.add('open');
}

function buildPanelContent(element: HTMLElement): void {
  resetDebounceTimers();
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
  loadCssRulesForElement(element, cssGroup, currentElementRef, persistState.debounceTimers);
}

export function hidePropertiesPanel(): void {
  panel.classList.remove('open');
  toggleToolbarForPanel(true);
  const fab = document.getElementById('nk-pp-fab');
  if (fab) fab.classList.remove('visible');
  currentElement = null;
  resetDebounceTimers();
}

export function isPropertiesPanelOpen(): boolean {
  return panel.classList.contains('open');
}
