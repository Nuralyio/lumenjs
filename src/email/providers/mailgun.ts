import type { EmailProvider, EmailMessage } from '../types.js';

/**
 * Mailgun, over its HTTP send API. Form-encoded (not JSON) with basic auth
 * `api:<key>`. `region: 'eu'` picks the EU host — a separate data residency.
 */
export function createMailgunProvider(opts: {
  apiKey: string;
  domain: string;
  region?: 'us' | 'eu';
}): EmailProvider {
  const base = opts.region === 'eu' ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net';
  return {
    async send(message: EmailMessage & { from: string }) {
      const form = new URLSearchParams();
      form.set('from', message.from);
      form.set('to', message.to);
      form.set('subject', message.subject);
      form.set('html', message.html);
      if (message.text) form.set('text', message.text);

      const res = await fetch(`${base}/v3/${opts.domain}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${Buffer.from(`api:${opts.apiKey}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Mailgun API error (${res.status}): ${err}`);
      }
    },
  };
}
