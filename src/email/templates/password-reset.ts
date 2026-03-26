import { renderTemplate, renderButton, escapeHtml } from './base.js';

export function renderPasswordReset(opts: { appName: string; url: string; userName?: string }): string {
  const greeting = opts.userName ? `Hi ${escapeHtml(opts.userName)},` : 'Hi,';
  const safeAppName = escapeHtml(opts.appName);
  const safeUrl = escapeHtml(opts.url);
  const content = `
    <h1 style="font-size:22px; font-weight:800; color:#0f1419; margin:0 0 16px; line-height:1.3;">Reset your password</h1>
    <p style="font-size:15px; color:#536471; line-height:1.6; margin:0 0 8px;">${greeting}</p>
    <p style="font-size:15px; color:#536471; line-height:1.6; margin:0 0 4px;">We received a request to reset your password for your ${safeAppName} account. Click the button below to choose a new password.</p>
    ${renderButton('Reset password', opts.url)}
    <p style="font-size:13px; color:#8b98a5; line-height:1.5; margin:0;">This link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email.</p>
    <p style="font-size:12px; color:#8b98a5; line-height:1.5; margin:16px 0 0; word-break:break-all;">Or copy this link: ${safeUrl}</p>
  `;
  return renderTemplate(opts.appName, content);
}
