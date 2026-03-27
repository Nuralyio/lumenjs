import { randomUUID } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';

const REQUEST_ID_HEADER = 'x-request-id';

/** Attach a unique request ID to each request. Reuses incoming X-Request-ID if present. */
export function createRequestIdMiddleware() {
  return (req: IncomingMessage, res: ServerResponse, next: (err?: any) => void) => {
    const existing = req.headers[REQUEST_ID_HEADER];
    const requestId = (typeof existing === 'string' && existing) || randomUUID();

    // Attach to request for downstream use
    (req as any).id = requestId;

    // Echo back in response
    res.setHeader('X-Request-ID', requestId);
    next();
  };
}

/** Get the request ID from a request object. */
export function getRequestId(req: IncomingMessage): string | undefined {
  return (req as any).id;
}
