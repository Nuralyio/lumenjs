import type { EmailProvider, EmailMessage } from '../types.js';

/**
 * Postmark, over its email API.
 *
 * JSON, authenticated with the server token in `X-Postmark-Server-Token`.
 * `MessageStream` defaults to Postmark's transactional stream, which is the
 * right one for verification and reset mail.
 */
export function createPostmarkProvider(opts: {
  serverToken: string;
  messageStream?: string;
}): EmailProvider {
  return {
    async send(message: EmailMessage & { from: string }) {
      const res = await fetch('https://api.postmarkapp.com/email', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'X-Postmark-Server-Token': opts.serverToken,
        },
        body: JSON.stringify({
          From: message.from,
          To: message.to,
          Subject: message.subject,
          HtmlBody: message.html,
          ...(message.text ? { TextBody: message.text } : {}),
          MessageStream: opts.messageStream ?? 'outbound',
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Postmark API error (${res.status}): ${err}`);
      }
    },
  };
}
