/**
 * Properties Panel — CSS styles, extracted from properties-panel.ts.
 */

export function injectPropertiesPanelStyles(): void {
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

    /* Floating properties icon (mobile only) */
    #nk-pp-fab {
      display: none; position: fixed; bottom: 24px; right: 16px;
      width: 48px; height: 48px; border-radius: 50%;
      background: #7c3aed; color: #fff; border: none;
      box-shadow: 0 4px 16px rgba(124,58,237,0.5);
      z-index: 99999; cursor: pointer; align-items: center; justify-content: center;
      font-size: 20px; -webkit-tap-highlight-color: transparent; touch-action: manipulation;
    }
    #nk-pp-fab.visible { display: flex; }
    #nk-pp-fab:active { background: #5b21b6; transform: scale(0.92); }

    /* Mobile responsive */
    @media (max-width: 640px) {
      #nk-props-panel {
        width: 100%; left: 0; right: 0; top: 0;
        height: 100vh; max-height: 100vh;
        border-left: none; border-bottom: none;
        touch-action: manipulation;
        z-index: 199999;
      }
      .nk-pp-ai-row { display: block; }
    }
  `;
  document.head.appendChild(style);
}
