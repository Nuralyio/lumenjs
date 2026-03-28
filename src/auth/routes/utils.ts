import type { IncomingMessage, ServerResponse } from 'http';

const MAX_BODY_SIZE = 64 * 1024; // 64 KB — sufficient for auth payloads

export function readBody(req: IncomingMessage, maxSize: number = MAX_BODY_SIZE): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > maxSize) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

export function sendJson(res: ServerResponse, status: number, data: any): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/** Check if request wants token-based auth (mobile) -- only with explicit ?mode=token */
export function isTokenMode(url: URL, _req: IncomingMessage): boolean {
  return url.searchParams.get('mode') === 'token';
}

/** Validate returnTo is a safe relative path (prevents open redirect). */
export function safeReturnTo(returnTo: string | null, fallback: string): string {
  if (!returnTo) return fallback;
  // Must start with / and must not start with // (protocol-relative URL)
  if (returnTo.startsWith('/') && !returnTo.startsWith('//')) return returnTo;
  return fallback;
}
