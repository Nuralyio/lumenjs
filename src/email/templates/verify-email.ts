import { renderTemplate, renderButton } from './base.js';

export function renderVerifyEmail(opts: { appName: string; url: string; userName?: string }): string {
  const greeting = opts.userName ? `Hi ${opts.userName},` : 'Hi,';
  const content = `
    <h1 style="font-size:22px; font-weight:800; color:#0f1419; margin:0 0 16px; line-height:1.3;">Verify your email address</h1>
    <p style="font-size:15px; color:#536471; line-height:1.6; margin:0 0 8px;">${greeting}</p>
    <p style="font-size:15px; color:#536471; line-height:1.6; margin:0 0 4px;">Thanks for signing up for ${opts.appName}. Please verify your email address by clicking the button below.</p>
    ${renderButton('Verify email', opts.url)}
    <p style="font-size:13px; color:#8b98a5; line-height:1.5; margin:0;">If you didn't create an account, you can safely ignore this email.</p>
    <p style="font-size:12px; color:#8b98a5; line-height:1.5; margin:16px 0 0; word-break:break-all;">Or copy this link: ${opts.url}</p>
  `;
  return renderTemplate(opts.appName, content);
}
