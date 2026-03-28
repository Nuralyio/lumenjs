import path from 'path';
import fs from 'fs';
import type { EmailConfig, EmailMessage, EmailProvider, TemplateData, TemplateRenderer } from './types.js';
import { renderVerifyEmail as builtInVerifyEmail } from './templates/verify-email.js';
import { renderPasswordReset as builtInPasswordReset } from './templates/password-reset.js';
import { renderWelcome as builtInWelcome } from './templates/welcome.js';
import { compileTemplate } from './template-engine.js';

export type { EmailConfig, EmailMessage, EmailProvider, EmailTemplates, TemplateData, TemplateRenderer } from './types.js';
export { renderVerifyEmail } from './templates/verify-email.js';
export { renderPasswordReset } from './templates/password-reset.js';
export { renderWelcome } from './templates/welcome.js';
export { renderTemplate, renderButton, escapeHtml } from './templates/base.js';
export { compileTemplate } from './template-engine.js';

const BUILT_IN_TEMPLATES: Record<string, TemplateRenderer> = {
  'verify-email': (d) => builtInVerifyEmail(d),
  'password-reset': (d) => builtInPasswordReset(d),
  'welcome': (d) => builtInWelcome({ ...d, loginUrl: d.loginUrl || d.url }),
};

let _projectDir: string | null = null;

/** Set the project directory for file-based template loading */
export function setEmailProjectDir(dir: string): void {
  _projectDir = dir;
}

/**
 * Load an HTML template file from the project's `emails/` directory.
 * Returns the raw HTML string or null if not found.
 */
function loadHtmlTemplate(name: string): string | null {
  if (!_projectDir) return null;
  const emailsDir = path.resolve(_projectDir, 'emails');
  const filePath = path.resolve(emailsDir, `${name}.html`);
  // Prevent path traversal outside the emails/ directory
  if (!filePath.startsWith(emailsDir + path.sep) && filePath !== emailsDir) return null;
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Get a template renderer. Resolution order:
 * 1. HTML file in emails/ directory (compiled with {{variable}} engine)
 * 2. Custom function in config.templates
 * 3. Built-in template
 */
export function getTemplate(config: EmailConfig, name: string): TemplateRenderer | undefined {
  // 1. File-based HTML template
  const htmlFile = loadHtmlTemplate(name);
  if (htmlFile) {
    return (data: TemplateData) => compileTemplate(htmlFile, data);
  }
  // 2. Custom function
  if (config.templates?.[name]) return config.templates[name];
  // 3. Built-in
  return BUILT_IN_TEMPLATES[name];
}

/**
 * Render a named template with data. Returns HTML string or null if template not found.
 */
export function renderEmailTemplate(config: EmailConfig, name: string, data: TemplateData): string | null {
  const renderer = getTemplate(config, name);
  return renderer ? renderer(data) : null;
}

async function createProvider(config: EmailConfig): Promise<EmailProvider> {
  switch (config.provider) {
    case 'smtp': {
      if (!config.smtp) throw new Error('[LumenJS Email] smtp config required for SMTP provider');
      const { createSmtpProvider } = await import('./providers/smtp.js');
      return createSmtpProvider(config.smtp);
    }
    case 'resend': {
      if (!config.resend?.apiKey) throw new Error('[LumenJS Email] resend.apiKey required for Resend provider');
      const { createResendProvider } = await import('./providers/resend.js');
      return createResendProvider(config.resend.apiKey);
    }
    case 'sendgrid': {
      if (!config.sendgrid?.apiKey) throw new Error('[LumenJS Email] sendgrid.apiKey required for SendGrid provider');
      const { createSendGridProvider } = await import('./providers/sendgrid.js');
      return createSendGridProvider(config.sendgrid.apiKey);
    }
    default:
      throw new Error(`[LumenJS Email] Unknown provider: ${config.provider}`);
  }
}

/** Strip HTML tags for plain text fallback */
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Send an email using the configured provider.
 */
export async function sendEmail(config: EmailConfig, message: EmailMessage): Promise<void> {
  const provider = await createProvider(config);
  await provider.send({
    from: config.from,
    to: message.to,
    subject: message.subject,
    html: message.html,
    text: message.text || htmlToText(message.html),
  });
}

/**
 * Create a reusable email sender function.
 */
export function createEmailSender(config: EmailConfig): (message: EmailMessage) => Promise<void> {
  let provider: EmailProvider | null = null;
  return async (message: EmailMessage) => {
    if (!provider) provider = await createProvider(config);
    await provider.send({
      from: config.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text || htmlToText(message.html),
    });
  };
}

/**
 * Load email config from lumenjs.email.ts.
 */
export async function loadEmailConfig(
  projectDir: string,
  ssrLoadModule?: (id: string) => Promise<any>,
): Promise<EmailConfig | null> {
  try {
    let mod: any;
    if (ssrLoadModule) {
      mod = await ssrLoadModule(path.join(projectDir, 'lumenjs.email.ts'));
    } else {
      mod = await import(path.join(projectDir, 'lumenjs.email.ts'));
    }
    const config = mod.default || mod;
    if (!config?.provider || !config?.from) return null;
    return config as EmailConfig;
  } catch {
    return null;
  }
}
