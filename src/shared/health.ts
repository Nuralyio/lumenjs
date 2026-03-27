import type { IncomingMessage, ServerResponse } from 'http';

export interface HealthCheckConfig {
  /** Endpoint path. Default: '/__health'. */
  path?: string;
  /** App version string. Default: reads from package.json or 'unknown'. */
  version?: string;
}

const startTime = Date.now();

export function createHealthCheckHandler(config?: HealthCheckConfig) {
  const healthPath = config?.path || '/__health';
  const version = config?.version || process.env.npm_package_version || 'unknown';

  return (req: IncomingMessage, res: ServerResponse, next: (err?: any) => void) => {
    if (req.url?.split('?')[0] !== healthPath) return next();

    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const body = JSON.stringify({
      status: 'ok',
      uptime,
      version,
      timestamp: new Date().toISOString(),
      memory: {
        rss: Math.round(process.memoryUsage.rss() / 1024 / 1024),
        heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      },
    });

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  };
}
