import { createHmac, createHash } from 'crypto';
import type { EmailProvider, EmailMessage } from '../types.js';

/**
 * Amazon SES v2, signed with SigV4 by hand.
 *
 * No AWS SDK: the SDK is tens of megabytes and this is one signed POST. The
 * signature is the boilerplate every SigV4 client repeats — canonical request,
 * string to sign, a four-step derived key, one header — kept here so an app on
 * SES needs no dependency the other providers do not.
 */
export function createSesProvider(opts: {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}): EmailProvider {
  const service = 'ses';
  const host = `email.${opts.region}.amazonaws.com`;

  return {
    async send(message: EmailMessage & { from: string }) {
      const body = JSON.stringify({
        FromEmailAddress: message.from,
        Destination: { ToAddresses: [message.to] },
        Content: {
          Simple: {
            Subject: { Data: message.subject, Charset: 'UTF-8' },
            Body: {
              Html: { Data: message.html, Charset: 'UTF-8' },
              ...(message.text ? { Text: { Data: message.text, Charset: 'UTF-8' } } : {}),
            },
          },
        },
      });

      const now = new Date();
      const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');       // 20260802T150000Z
      const dateStamp = amzDate.slice(0, 8);                                 // 20260802
      const canonicalUri = '/v2/email/outbound-emails';
      const payloadHash = sha256Hex(body);

      const headers: Record<string, string> = {
        'content-type': 'application/json',
        host,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate,
        ...(opts.sessionToken ? { 'x-amz-security-token': opts.sessionToken } : {}),
      };
      const signedHeaders = Object.keys(headers).sort().join(';');
      const canonicalHeaders = Object.keys(headers).sort().map((k) => `${k}:${headers[k]}\n`).join('');

      const canonicalRequest = [
        'POST', canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash,
      ].join('\n');

      const scope = `${dateStamp}/${opts.region}/${service}/aws4_request`;
      const stringToSign = [
        'AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest),
      ].join('\n');

      const kDate = hmac(`AWS4${opts.secretAccessKey}`, dateStamp);
      const kRegion = hmac(kDate, opts.region);
      const kService = hmac(kRegion, service);
      const kSigning = hmac(kService, 'aws4_request');
      const signature = hmac(kSigning, stringToSign).toString('hex');

      const authorization =
        `AWS4-HMAC-SHA256 Credential=${opts.accessKeyId}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`;

      const res = await fetch(`https://${host}${canonicalUri}`, {
        method: 'POST',
        headers: { ...headers, Authorization: authorization },
        body,
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`SES API error (${res.status}): ${err}`);
      }
    },
  };
}

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

function hmac(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}
