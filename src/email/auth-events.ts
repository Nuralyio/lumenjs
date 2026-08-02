/**
 * Wiring the auth module's events to the email module.
 *
 * Auth generates the tokens and emits events; email sends them. The two have
 * always been able to meet — but only the dev server ever introduced them
 * (vite-plugin-auth.ts). A built app emitted `verification-email` and
 * `password-reset` into an `onEvent` that was never set, so `handleForgotPassword`
 * generated no token at all and answered 200: a silent dead end. This is the
 * mapping, extracted so the dev server and the production server share one copy
 * rather than drifting.
 */
import type { AuthEvent } from '../auth/types.js';
import type { EmailConfig, EmailMessage } from './types.js';
import { getTemplate, renderEmailTemplate, sendEmail } from './index.js';

export type SendFn = (config: EmailConfig, message: EmailMessage) => Promise<void>;

/**
 * An `onEvent` handler that sends the mail each auth event calls for.
 *
 * `send` is injected so a test can assert what would be sent without a network
 * or a mock framework. Failures are caught and logged, never thrown: every one
 * of auth's four emission sites already swallows exceptions, so a throw here
 * would be invisible anyway — better to log it.
 *
 * `password-changed` sends only when a template named `password-changed`
 * resolves (a file in emails/ or a config.templates entry). There is no
 * built-in, so existing apps get no new mail; an app that wants the "your
 * password was changed" notice drops in a template and it appears.
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
 * Attach the mailer to an auth config — but only when the app has not set its
 * own `onEvent` and an email config exists. Returns whether it wired anything.
 *
 * The "not set" guard is the whole backward-compatibility contract: an app
 * with a hand-written `onEvent` (apps/social) is left exactly as it was.
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
