import type { IncomingMessage, ServerResponse } from 'http';

export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
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
