import { describe, it, expect, vi } from 'vitest';
import { createAuthEventMailer, autoWireAuthEmail } from './auth-events.js';
import type { EmailConfig, EmailMessage } from './types.js';

const config: EmailConfig = { provider: 'smtp', from: 'no-reply@app.co' };

function captor() {
  const sent: EmailMessage[] = [];
  const send = vi.fn(async (_c: EmailConfig, m: EmailMessage) => { sent.push(m); });
  return { sent, send };
}

describe('createAuthEventMailer', () => {
  it('sends a verification email with the app name in the subject and the url in the body', async () => {
    const { sent, send } = captor();
    const onEvent = createAuthEventMailer(config, 'Acme', send);
    await onEvent({ type: 'verification-email', email: 'a@b.co', token: 't', url: 'https://app.co/verify?token=t' });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('a@b.co');
    expect(sent[0].subject).toBe('Verify your email - Acme');
    expect(sent[0].html).toContain('https://app.co/verify?token=t');
  });

  it('sends a password reset email', async () => {
    const { sent, send } = captor();
    await createAuthEventMailer(config, 'Acme', send)(
      { type: 'password-reset', email: 'a@b.co', token: 't', url: 'https://app.co/reset?token=t' });
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe('Reset your password - Acme');
  });

  it('sends nothing for password-changed with no such template', async () => {
    const { sent, send } = captor();
    await createAuthEventMailer(config, 'Acme', send)(
      { type: 'password-changed', email: 'a@b.co', userId: 'u1' });
    expect(sent).toHaveLength(0);
  });

  it('does send password-changed when the app provides a template for it', async () => {
    const { sent, send } = captor();
    const withTemplate: EmailConfig = {
      ...config,
      templates: { 'password-changed': (d) => `<p>${d.appName}: changed</p>` },
    };
    await createAuthEventMailer(withTemplate, 'Acme', send)(
      { type: 'password-changed', email: 'a@b.co', userId: 'u1' });
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe('Your password was changed - Acme');
  });

  it('never throws when the sender fails — an unsendable email must not fail a signup', async () => {
    const send = vi.fn(async () => { throw new Error('smtp down'); });
    const onEvent = createAuthEventMailer(config, 'Acme', send);
    await expect(onEvent(
      { type: 'verification-email', email: 'a@b.co', token: 't', url: 'https://app.co/v' })).resolves.toBeUndefined();
  });
});

describe('autoWireAuthEmail', () => {
  it('sets onEvent when the app has none and an email config exists', () => {
    const authConfig: any = {};
    expect(autoWireAuthEmail(authConfig, config, 'Acme')).toBe(true);
    expect(typeof authConfig.onEvent).toBe('function');
  });

  it('leaves a hand-written onEvent exactly as it was — the back-compat contract', () => {
    const original = async () => {};
    const authConfig: any = { onEvent: original };
    expect(autoWireAuthEmail(authConfig, config, 'Acme')).toBe(false);
    expect(authConfig.onEvent).toBe(original);
  });

  it('does nothing without an email config', () => {
    const authConfig: any = {};
    expect(autoWireAuthEmail(authConfig, null, 'Acme')).toBe(false);
    expect(authConfig.onEvent).toBeUndefined();
  });
});
