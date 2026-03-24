import type { EmailProvider, EmailMessage } from '../types.js';

export function createSendGridProvider(apiKey: string): EmailProvider {
  return {
    async send(message: EmailMessage & { from: string }) {
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: message.to }] }],
          from: { email: message.from.replace(/.*<(.+)>/, '$1'), name: message.from.replace(/<.+>/, '').trim() || undefined },
          subject: message.subject,
          content: [
            ...(message.text ? [{ type: 'text/plain', value: message.text }] : []),
            { type: 'text/html', value: message.html },
          ],
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`SendGrid API error (${res.status}): ${err}`);
      }
    },
  };
}
