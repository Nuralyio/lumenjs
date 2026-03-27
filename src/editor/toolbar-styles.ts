/**
 * Toolbar and file panel CSS styles.
 */

export function injectToolbarStyles() {
  const style = document.createElement('style');
  style.textContent = `
    #nk-editor-toolbar {
      position: fixed; top: 0; left: 0; right: 0; height: 44px;
      background: #1e1b2e; color: #e2e8f0; font-family: system-ui, -apple-system, sans-serif;
      font-size: 12px; z-index: 99999; box-shadow: 0 2px 12px rgba(0,0,0,0.3);
      user-select: none; -webkit-user-select: none; touch-action: manipulation;
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
    .nk-tb-project-ai-label { font-size: 11px; font-weight: 600; }
    .nk-tb-page-ai {
      display: flex; align-items: center; gap: 0;
      background: #0f0d1a; border: 1px solid #334155; border-radius: 8px;
      padding: 0 2px 0 8px; height: 30px; transition: border-color 0.15s;
    }
    .nk-tb-page-ai:focus-within { border-color: #7c3aed; }
    .nk-tb-page-ai-icon { color: #7c3aed; font-size: 12px; flex-shrink: 0; margin-right: 4px; }
    .nk-tb-page-ai-input {
      background: transparent; border: none; color: #e2e8f0; font-size: 12px;
      font-family: inherit; outline: none; width: 180px; padding: 0;
    }
    .nk-tb-page-ai-input::placeholder { color: #64748b; }
    .nk-tb-page-ai-send {
      background: #7c3aed; border: none; color: #fff; width: 24px; height: 24px;
      border-radius: 6px; cursor: pointer; font-size: 10px; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center; transition: opacity 0.15s;
    }
    .nk-tb-page-ai-send:disabled { opacity: 0.3; cursor: default; }
    .nk-tb-page-ai-send:not(:disabled):hover { background: #6d28d9; }
    @media (max-width: 640px) {
      .nk-tb-project-ai-label { display: none; }
      .nk-tb-page-ai-input { width: 100px; }
    }
    .nk-tb-toggle {
      display: inline-flex; align-items: center; padding: 2px; gap: 0;
      background: #0f0d1a; border: 1px solid #334155; border-radius: 6px;
      cursor: pointer; font-family: inherit;
      -webkit-tap-highlight-color: transparent; touch-action: manipulation;
    }
    .nk-tb-toggle span {
      padding: 4px 10px; border-radius: 4px; font-size: 11px; font-weight: 600;
      color: #64748b; transition: all 0.15s; letter-spacing: 0.03em;
    }
    .nk-tb-toggle span.active { background: #7c3aed; color: #fff; }
    .nk-tb-tag { color: #67e8f9; font-family: 'SF Mono', ui-monospace, monospace; }
    .nk-tb-source { color: #86efac; font-family: 'SF Mono', ui-monospace, monospace; font-size: 11px; }
    .nk-tb-attrs { color: #94a3b8; font-size: 11px; }

    /* File panel — sidebar on desktop, full-width sheet on mobile */
    #nk-file-panel {
      position: fixed; top: 44px; left: 0; width: 320px; max-height: calc(100vh - 44px);
      background: #1e1b2e; border-right: 1px solid #334155; border-bottom: 1px solid #334155;
      z-index: 99999; display: none; flex-direction: column; font-family: system-ui, -apple-system, sans-serif;
      box-shadow: 4px 0 16px rgba(0,0,0,0.3);
      padding-bottom: env(safe-area-inset-bottom, 0); touch-action: manipulation;
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
    .nk-fp-list {
      flex: 1; overflow-y: auto; padding: 4px 0;
      -webkit-overflow-scrolling: touch;
    }
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

    /* Tabs in file panel header */
    .nk-fp-tabs {
      display: flex; gap: 2px; background: #0f0d1a; border-radius: 6px; padding: 2px;
    }
    .nk-fp-tab {
      padding: 4px 12px; border: none; border-radius: 4px; font-size: 11px; font-weight: 600;
      font-family: inherit; color: #64748b; background: transparent; cursor: pointer;
      transition: all 0.15s; -webkit-tap-highlight-color: transparent; touch-action: manipulation;
    }
    .nk-fp-tab:hover { color: #e2e8f0; }
    .nk-fp-tab.active { background: #7c3aed; color: #fff; }

    /* Pages view */
    .nk-fp-pages {
      flex: 1; overflow-y: auto; padding: 4px 0; -webkit-overflow-scrolling: touch;
    }
    .nk-fp-layout-group { margin-bottom: 4px; }
    .nk-fp-layout-label {
      padding: 8px 12px 4px; font-size: 10px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.05em; color: #7c3aed; font-family: system-ui, sans-serif;
    }
    .nk-fp-route {
      display: flex; align-items: center; gap: 8px; padding: 6px 12px 6px 24px; cursor: pointer;
      color: #94a3b8; font-size: 12px; font-family: 'SF Mono', ui-monospace, monospace;
      transition: background 0.1s; -webkit-tap-highlight-color: transparent; touch-action: manipulation;
    }
    .nk-fp-route:hover { background: #262338; color: #e2e8f0; }
    .nk-fp-route:active { background: #334155; }
    .nk-fp-route.active { background: #7c3aed22; color: #c084fc; }

    /* File editor — right of sidebar on desktop, full-width on mobile */
    #nk-file-editor {
      position: fixed; top: 44px; left: 320px; right: 0; max-height: calc(100vh - 44px);
      background: #0f0d1a; border-bottom: 1px solid #334155; z-index: 99999;
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
    .nk-fe-editor {
      flex: 1; width: 100%; background: #0f0d1a; color: #e2e8f0; border: none; padding: 12px;
      font-family: 'SF Mono', ui-monospace, monospace; font-size: 13px; line-height: 1.6;
      overflow: auto; outline: none; tab-size: 2; min-height: 250px;
      -webkit-overflow-scrolling: touch;
    }
    .nk-hl-k { color: #ff7b72; }
    .nk-hl-s { color: #a5d6ff; }
    .nk-hl-c { color: #8b949e; font-style: italic; }
    .nk-hl-n, .nk-hl-l { color: #79c0ff; }
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

    /* Mobile responsive (<640px) */
    @media (max-width: 640px) {
      .nk-tb-files-label { display: none; }
      .nk-tb-source { display: none; }
      .nk-tb-attrs { display: none; }
      .nk-tb-hint { font-size: 11px; }

      #nk-file-panel {
        width: 100%; right: 0; border-right: none;
        max-height: 50vh;
      }
      .nk-fp-close-btn { display: block; }
      .nk-fp-item { padding: 10px 12px; font-size: 13px; }

      #nk-file-editor {
        left: 0; max-height: 60vh;
      }
      .nk-fe-editor { font-size: 14px; min-height: 200px; }
    }

    /* Push page content down so toolbar doesn't cover it */
    body { padding-top: 44px !important; }
  `;
  document.head.appendChild(style);
}
