/**
 * Wiring the auth module's events to the email module: auth emits events, email
 * sends them. Extracted so the dev and production servers share one copy.
 */
import type { AuthEvent } from '../auth/types.js';
import type { EmailConfig, EmailMessage } from './types.js';
import { getTemplate, renderEmailTemplate, sendEmail } from './index.js';

export type SendFn = (config: EmailConfig, message: EmailMessage) => Promise<void>;

/**
 * An `onEvent` handler that sends the mail each auth event calls for. `send` is
 * injected so a test can assert what would be sent without a network. Failures
 * are caught and logged, never thrown (auth's emission sites swallow exceptions
 * anyway). `password-changed` sends only when a `password-changed` template
 * resolves — there is no built-in, so existing apps get no new mail.
 */
export function createAuthEventMailer(
  emailConfig: EmailConfig,
  appName: string,
  send: SendFn = sendEmail,
): (event: AuthEvent) => Promise<void> {
  return async (event: AuthEvent): Promise<void> => {
    try {
      if (event.type === 'verification-email') {
        const html = renderEmailTemplate(emailConfig, 'verify-email', { appName, url: event.url });
        if (html) await send(emailConfig, { to: event.email, subject: `Verify your email - ${appName}`, html });
      } else if (event.type === 'password-reset') {
        const html = renderEmailTemplate(emailConfig, 'password-reset', { appName, url: event.url });
        if (html) await send(emailConfig, { to: event.email, subject: `Reset your password - ${appName}`, html });
      } else if (event.type === 'password-changed') {
        if (getTemplate(emailConfig, 'password-changed')) {
          const html = renderEmailTemplate(emailConfig, 'password-changed', { appName, url: '' });
          if (html) await send(emailConfig, { to: event.email, subject: `Your password was changed - ${appName}`, html });
        }
      }
    } catch (err) {
      console.error('[LumenJS Email] Failed to send:', (err as any)?.message ?? err);
    }
  };
}

/**
 * Attach the mailer to an auth config, but only when the app has not set its
 * own `onEvent` and an email config exists; returns whether it wired anything.
 * The "not set" guard is the backward-compat contract — a hand-written
 * `onEvent` is left exactly as it was.
 */
export function autoWireAuthEmail(
  authConfig: { onEvent?: (e: AuthEvent) => void | Promise<void> },
  emailConfig: EmailConfig | null,
  appName: string,
): boolean {
  if (!authConfig || authConfig.onEvent || !emailConfig) return false;
  authConfig.onEvent = createAuthEventMailer(emailConfig, appName);
  return true;
}
