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
 *
 * This file is now a slim orchestrator that delegates to:
 * - overlay-selection.ts  — selection state & logic
 * - overlay-events.ts     — mouse, touch, toolbar, keyboard, scroll/resize handlers
 * - overlay-hmr.ts        — HMR re-selection & WebSocket listener
 */
import { startAnnotator } from './element-annotator.js';
import { setupInlineTextEdit } from './inline-text-edit.js';
import { createPropertiesPanel } from './properties-panel.js';
import { createAiChatPanel } from './ai-chat-panel.js';
import { createAiProjectPanel } from './ai-project-panel.js';
import { createOverlay } from './overlay-utils.js';
import {
  createTextToolbar, setupTextToolbarHandlers, setTextToolbarSelectedElement,
} from './text-toolbar.js';
import {
  createToolbar, createFilePanel, setMode, initToolbarRefs,
} from './editor-toolbar.js';
import {
  selectedElementRef, deselect,
  setHoverOverlay, setSelectOverlay,
} from './overlay-selection.js';
import {
  setupMouseEvents, setupTouchEvents,
  setupToolbarHandlers, setupKeyboardHandlers,
  setupScrollResize,
} from './overlay-events.js';
import { setupHmrListener } from './overlay-hmr.js';

let initialized = false;

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

  // Create overlays and store them in selection module
  const hoverOverlay = createOverlay('#7c3aed', 'dashed');
  const selectOverlay = createOverlay('#3b82f6', 'solid');
  setHoverOverlay(hoverOverlay);
  setSelectOverlay(selectOverlay);

  // Initialize toolbar refs before creating toolbar
  initToolbarRefs({ selectOverlay, selectedElement: selectedElementRef, deselect });
  setTextToolbarSelectedElement(selectedElementRef);

  // Create UI elements
  const toolbar = createToolbar();
  const filePanel = createFilePanel();
  createTextToolbar();
  setupTextToolbarHandlers();
  createPropertiesPanel();
  createAiChatPanel();
  createAiProjectPanel();

  // Restore saved editor mode
  try {
    const saved = localStorage.getItem('nk-editor-mode');
    if (saved === 'preview') setMode(false);
  } catch {}

  // Start annotator (assigns data-nk-id to custom elements)
  startAnnotator();

  // Setup inline text editing (double-click + double-tap handled inside)
  setupInlineTextEdit();

  // Wire up all event handlers
  setupMouseEvents();
  setupTouchEvents();
  setupToolbarHandlers(toolbar, filePanel);
  setupKeyboardHandlers(toolbar);
  setupScrollResize();
  setupHmrListener();
}
