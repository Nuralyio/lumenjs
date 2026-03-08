import { escapeHtml } from '../shared/utils.js';

export function renderErrorPage(status: number, title: string, message: string, detail?: string): string {
  const gradients: Record<number, string> = {
    404: 'linear-gradient(135deg, #6366f1, #8b5cf6, #a855f7)',
    500: 'linear-gradient(135deg, #ef4444, #f97316, #f59e0b)',
    502: 'linear-gradient(135deg, #f97316, #ef4444)',
    503: 'linear-gradient(135deg, #64748b, #475569)',
  };
  const gradient = gradients[status] || gradients[500];

  const detailBlock = detail
    ? `<div style="margin-top:1.5rem;padding:.75rem 1rem;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;text-align:left">
        <div style="font-size:.6875rem;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:.375rem">Details</div>
        <pre style="margin:0;font-size:.75rem;color:#64748b;white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${escapeHtml(detail)}</pre>
      </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${status} — ${escapeHtml(title)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #fafbfc;
      padding: 2rem;
    }
    .container { text-align: center; max-width: 440px; }
    .status {
      font-size: 5rem;
      font-weight: 200;
      letter-spacing: -2px;
      line-height: 1;
      color: #cbd5e1;
      user-select: none;
    }
    h1 { font-size: 1rem; font-weight: 500; color: #334155; margin: 1.25rem 0 .5rem; }
    .message { color: #94a3b8; font-size: .8125rem; line-height: 1.5; margin-bottom: 2rem; }
    .btn {
      display: inline-flex; align-items: center; gap: .375rem;
      padding: .4375rem 1rem;
      background: #f8fafc; color: #475569;
      border: 1px solid #e2e8f0;
      border-radius: 6px; font-size: .8125rem; font-weight: 400;
      text-decoration: none; transition: all .15s;
      cursor: pointer;
    }
    .btn:hover { background: #f1f5f9; border-color: #cbd5e1; }
    .btn svg { flex-shrink: 0; }
    .divider { width: 32px; height: 2px; background: #e2e8f0; border-radius: 1px; margin: 1.25rem auto; }
    .footer { margin-top: 3rem; font-size: .6875rem; color: #e2e8f0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="status">${status}</div>
    <div class="divider"></div>
    <h1>${escapeHtml(title)}</h1>
    <p class="message">${escapeHtml(message)}</p>
    <a href="/" class="btn">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
      Back to home
    </a>
    ${detailBlock}
    <div class="footer">LumenJS</div>
  </div>
</body>
</html>`;
}
