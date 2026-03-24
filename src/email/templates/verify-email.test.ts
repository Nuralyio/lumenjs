import { describe, it, expect } from 'vitest';
import { renderVerifyEmail } from './verify-email.js';
import { renderPasswordReset } from './password-reset.js';
import { renderWelcome } from './welcome.js';
import { getTemplate, renderEmailTemplate } from '../index.js';
import type { EmailConfig } from '../types.js';

describe('email templates', () => {
  it('renders verify email template', () => {
    const html = renderVerifyEmail({ appName: 'TestApp', url: 'https://example.com/verify?token=abc' });
    expect(html).toContain('Verify your email address');
    expect(html).toContain('https://example.com/verify?token=abc');
    expect(html).toContain('TestApp');
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('renders verify email with username', () => {
    const html = renderVerifyEmail({ appName: 'TestApp', url: 'https://example.com/verify', userName: 'John' });
    expect(html).toContain('Hi John,');
  });

  it('renders password reset template', () => {
    const html = renderPasswordReset({ appName: 'TestApp', url: 'https://example.com/reset?token=xyz' });
    expect(html).toContain('Reset your password');
    expect(html).toContain('https://example.com/reset?token=xyz');
    expect(html).toContain('expires in 1 hour');
  });

  it('renders welcome template', () => {
    const html = renderWelcome({ appName: 'TestApp', loginUrl: 'https://example.com/login', userName: 'Jane' });
    expect(html).toContain('Welcome to TestApp');
    expect(html).toContain('Hi Jane,');
    expect(html).toContain('https://example.com/login');
  });

  it('all templates produce valid HTML', () => {
    const templates = [
      renderVerifyEmail({ appName: 'App', url: 'https://x.com' }),
      renderPasswordReset({ appName: 'App', url: 'https://x.com' }),
      renderWelcome({ appName: 'App', loginUrl: 'https://x.com' }),
    ];
    for (const html of templates) {
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('</html>');
      expect(html).toContain('<table');
      expect(html).toContain('#7c3aed');
    }
  });
});

describe('custom templates', () => {
  const baseConfig: EmailConfig = { provider: 'resend', from: 'test@test.com', resend: { apiKey: 'test' } };

  it('uses built-in template when no custom provided', () => {
    const renderer = getTemplate(baseConfig, 'verify-email');
    expect(renderer).toBeDefined();
    const html = renderer!({ appName: 'App', url: 'https://x.com' });
    expect(html).toContain('Verify your email');
  });

  it('uses custom template when provided', () => {
    const config: EmailConfig = {
      ...baseConfig,
      templates: {
        'verify-email': (data) => `<h1>Custom verify for ${data.appName}</h1><a href="${data.url}">Click</a>`,
      },
    };
    const renderer = getTemplate(config, 'verify-email');
    const html = renderer!({ appName: 'MyApp', url: 'https://custom.com' });
    expect(html).toContain('Custom verify for MyApp');
    expect(html).toContain('https://custom.com');
    expect(html).not.toContain('<!DOCTYPE html>'); // no built-in wrapper
  });

  it('falls back to built-in for non-overridden templates', () => {
    const config: EmailConfig = {
      ...baseConfig,
      templates: {
        'verify-email': () => '<p>custom</p>',
      },
    };
    // password-reset not overridden — should use built-in
    const renderer = getTemplate(config, 'password-reset');
    const html = renderer!({ appName: 'App', url: 'https://x.com' });
    expect(html).toContain('Reset your password');
  });

  it('renderEmailTemplate returns null for unknown template', () => {
    const html = renderEmailTemplate(baseConfig, 'unknown-template', { appName: 'App', url: '' });
    expect(html).toBeNull();
  });

  it('supports fully custom templates', () => {
    const config: EmailConfig = {
      ...baseConfig,
      templates: {
        'invite': (data) => `<p>You're invited to ${data.appName}! ${data.url}</p>`,
      },
    };
    const html = renderEmailTemplate(config, 'invite', { appName: 'Nuraly', url: 'https://nuraly.io/invite/abc' });
    expect(html).toContain("You're invited to Nuraly!");
    expect(html).toContain('https://nuraly.io/invite/abc');
  });
});
