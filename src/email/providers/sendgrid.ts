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
          from: (() => {
            const hasAngleBrackets = /<.+>/.test(message.from);
            const email = hasAngleBrackets ? message.from.replace(/.*<(.+)>/, '$1') : message.from;
            const name = hasAngleBrackets ? message.from.replace(/<.+>/, '').trim() || undefined : undefined;
            return { email, name };
          })(),
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
