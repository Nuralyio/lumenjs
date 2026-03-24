export interface TemplateData {
  appName: string;
  url: string;
  userName?: string;
  email?: string;
  loginUrl?: string;
  /** Arbitrary extra data for custom templates (arrays, objects, etc.) */
  [key: string]: any;
}

export type TemplateRenderer = (data: TemplateData) => string;

export interface EmailTemplates {
  'verify-email'?: TemplateRenderer;
  'password-reset'?: TemplateRenderer;
  'welcome'?: TemplateRenderer;
  [key: string]: TemplateRenderer | undefined;
}

export interface EmailConfig {
  provider: 'smtp' | 'resend' | 'sendgrid';
  from: string;
  smtp?: {
    host: string;
    port: number;
    secure?: boolean;
    auth: { user: string; pass: string };
  };
  resend?: {
    apiKey: string;
  };
  sendgrid?: {
    apiKey: string;
  };
  /** Custom email templates. Override built-in templates or add new ones. */
  templates?: EmailTemplates;
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface EmailProvider {
  send(message: EmailMessage & { from: string }): Promise<void>;
}
