import { renderTemplate, renderButton } from './base.js';

export function renderWelcome(opts: { appName: string; userName?: string; loginUrl: string }): string {
  const greeting = opts.userName ? `Hi ${opts.userName},` : 'Hi,';
  const content = `
    <h1 style="font-size:22px; font-weight:800; color:#0f1419; margin:0 0 16px; line-height:1.3;">Welcome to ${opts.appName}!</h1>
    <p style="font-size:15px; color:#536471; line-height:1.6; margin:0 0 8px;">${greeting}</p>
    <p style="font-size:15px; color:#536471; line-height:1.6; margin:0 0 4px;">Your email has been verified and your account is ready. You can now sign in and start exploring.</p>
    ${renderButton('Sign in', opts.loginUrl)}
    <p style="font-size:13px; color:#8b98a5; line-height:1.5; margin:0;">Welcome aboard. We're glad you're here.</p>
  `;
  return renderTemplate(opts.appName, content);
}
