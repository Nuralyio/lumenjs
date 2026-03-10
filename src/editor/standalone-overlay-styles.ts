/** All CSS for the standalone editor overlay UI. */
export const EDITOR_STYLES = `
#nk-editor-toolbar {
  position: fixed; bottom: 0; left: 0; right: 0; height: 44px;
  background: #1e1b2e; color: #e2e8f0; font-family: system-ui, -apple-system, sans-serif;
  font-size: 12px; z-index: 99999; box-shadow: 0 -2px 12px rgba(0,0,0,0.3);
  user-select: none; -webkit-user-select: none;
  padding-bottom: env(safe-area-inset-bottom, 0);
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
.nk-tb-tag { color: #67e8f9; font-family: 'SF Mono', ui-monospace, monospace; }
.nk-tb-source { color: #86efac; font-family: 'SF Mono', ui-monospace, monospace; font-size: 11px; }
.nk-tb-attrs { color: #94a3b8; font-size: 11px; }

#nk-file-panel {
  position: fixed; bottom: 44px; left: 0; width: 320px; max-height: calc(100vh - 88px);
  background: #1e1b2e; border-right: 1px solid #334155; border-top: 1px solid #334155;
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
.nk-fp-list { flex: 1; overflow-y: auto; padding: 4px 0; -webkit-overflow-scrolling: touch; }
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

#nk-file-editor {
  position: fixed; bottom: 44px; left: 320px; right: 0; max-height: calc(100vh - 88px);
  background: #0f0d1a; border-top: 1px solid #334155; z-index: 99999;
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

@media (max-width: 640px) {
  .nk-tb-files-label { display: none; }
  .nk-tb-source { display: none; }
  .nk-tb-attrs { display: none; }
  .nk-tb-hint { font-size: 11px; }
  #nk-file-panel { width: 100%; right: 0; border-right: none; max-height: 50vh; }
  .nk-fp-close-btn { display: block; }
  .nk-fp-item { padding: 10px 12px; font-size: 13px; }
  #nk-file-editor { left: 0; max-height: 60vh; }
  .nk-fe-textarea { font-size: 14px; min-height: 200px; }
}

body { padding-bottom: calc(44px + env(safe-area-inset-bottom, 0)) !important; }
`;
