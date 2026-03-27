import type { IncomingMessage, ServerResponse } from 'http';

export interface SecurityHeadersConfig {
  /** Content-Security-Policy. Set to false to disable. */
  contentSecurityPolicy?: string | false;
  /** X-Frame-Options. Default: 'DENY'. Set to false to disable. */
  frameOptions?: 'DENY' | 'SAMEORIGIN' | false;
  /** X-Content-Type-Options: nosniff. Default: true. */
  noSniff?: boolean;
  /** Strict-Transport-Security. Default: 'max-age=31536000; includeSubDomains'. Set to false to disable. */
  hsts?: string | false;
  /** Referrer-Policy. Default: 'strict-origin-when-cross-origin'. Set to false to disable. */
  referrerPolicy?: string | false;
  /** Permissions-Policy. Default restricts camera, microphone, geolocation. Set to false to disable. */
  permissionsPolicy?: string | false;
  /** Cross-Origin-Opener-Policy. Default: 'same-origin'. Set to false to disable. */
  crossOriginOpenerPolicy?: string | false;
}

const DEFAULTS: Required<SecurityHeadersConfig> = {
  contentSecurityPolicy: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'",
  frameOptions: 'DENY',
  noSniff: true,
  hsts: 'max-age=31536000; includeSubDomains',
  referrerPolicy: 'strict-origin-when-cross-origin',
  permissionsPolicy: 'camera=(), microphone=(), geolocation=()',
  crossOriginOpenerPolicy: 'same-origin',
};

export function createSecurityHeadersMiddleware(config?: SecurityHeadersConfig) {
  const opts = { ...DEFAULTS, ...config };

  return (_req: IncomingMessage, res: ServerResponse, next: (err?: any) => void) => {
    if (opts.contentSecurityPolicy !== false) {
      res.setHeader('Content-Security-Policy', opts.contentSecurityPolicy);
    }
    if (opts.frameOptions !== false) {
      res.setHeader('X-Frame-Options', opts.frameOptions);
    }
    if (opts.noSniff) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
    }
    if (opts.hsts !== false) {
      res.setHeader('Strict-Transport-Security', opts.hsts);
    }
    if (opts.referrerPolicy !== false) {
      res.setHeader('Referrer-Policy', opts.referrerPolicy);
    }
    if (opts.permissionsPolicy !== false) {
      res.setHeader('Permissions-Policy', opts.permissionsPolicy);
    }
    if (opts.crossOriginOpenerPolicy !== false) {
      res.setHeader('Cross-Origin-Opener-Policy', opts.crossOriginOpenerPolicy);
    }
    next();
  };
}
