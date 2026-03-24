import type { EmailProvider, EmailMessage } from '../types.js';

export function createResendProvider(apiKey: string): EmailProvider {
  return {
    async send(message: EmailMessage & { from: string }) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: message.from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Resend API error (${res.status}): ${err}`);
      }
    },
  };
}
