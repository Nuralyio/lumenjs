/**
 * Overlay HMR — re-select elements after hot module replacement updates
 * and listen for HMR events via WebSocket.
 */
import { positionOverlay } from './overlay-utils.js';
import { showPropertiesForElement } from './properties-panel.js';
import { isAiChatPanelOpen, updateAiChatTarget } from './ai-chat-panel.js';
import { updateSelectionInfo } from './editor-toolbar.js';
import {
  getSelectedElement, setSelectedElement, getSelectOverlay,
} from './overlay-selection.js';

export function reselectAfterHmr() {
  const selectedElement = getSelectedElement();
  if (!selectedElement) return;
  const source = selectedElement.getAttribute('data-nk-source');
  const elTag = selectedElement.tagName.toLowerCase();
  const elClass = selectedElement.className;

  requestAnimationFrame(() => {
    setTimeout(() => {
      let newEl: HTMLElement | null = null;

      if (source) {
        newEl = document.querySelector(`[data-nk-source="${source}"]`);
        if (newEl && newEl.shadowRoot && newEl.tagName.toLowerCase() !== elTag) {
          const inner = newEl.shadowRoot.querySelector(elTag) as HTMLElement
            || (elClass ? newEl.shadowRoot.querySelector(`.${elClass.split(' ')[0]}`) as HTMLElement : null);
          if (inner) newEl = inner;
        }
      }

      if (!newEl && elClass) {
        const hosts = document.querySelectorAll('[data-nk-source]');
        for (const host of hosts) {
          if (host.shadowRoot) {
            const match = host.shadowRoot.querySelector(`${elTag}.${elClass.split(' ')[0]}`) as HTMLElement;
            if (match) { newEl = match; break; }
          }
        }
      }

      const selectOverlay = getSelectOverlay();
      if (newEl) {
        setSelectedElement(newEl);
        positionOverlay(selectOverlay, newEl);
        updateSelectionInfo(newEl);
        showPropertiesForElement(newEl);
        if (isAiChatPanelOpen()) updateAiChatTarget(newEl);
      } else {
        const current = getSelectedElement();
        if (current?.isConnected) {
          showPropertiesForElement(current);
          if (isAiChatPanelOpen()) updateAiChatTarget(current);
        }
      }
    }, 150);
  });
}

export function setupHmrListener() {
  try {
    const base = ((import.meta as any).env?.BASE_URL || '/').replace(/\/$/, '');
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${base}`, 'vite-hmr');
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
