import type { Server } from 'http';
import { logger } from './logger.js';

export interface ShutdownConfig {
  /** Max time to wait for connections to drain (ms). Default: 30000. */
  timeout?: number;
  /** Extra cleanup functions to run before exit. */
  onShutdown?: () => Promise<void> | void;
}

export function setupGracefulShutdown(server: Server, config?: ShutdownConfig): void {
  const timeout = config?.timeout ?? 30_000;
  let isShuttingDown = false;

  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info(`Received ${signal}, starting graceful shutdown...`);

    // Stop accepting new connections
    server.close(() => {
      logger.info('All connections drained.');
    });

    // Force-close after timeout
    const forceTimer = setTimeout(() => {
      logger.warn('Shutdown timeout reached, forcing exit.', { timeout });
      process.exit(1);
    }, timeout);
    forceTimer.unref();

    // Run custom cleanup
    if (config?.onShutdown) {
      try {
        await config.onShutdown();
        logger.info('Custom cleanup completed.');
      } catch (err: any) {
        logger.error('Error during custom cleanup.', { error: err?.message });
      }
    }

    // Close idle keep-alive connections
    server.closeIdleConnections();

    logger.info('Graceful shutdown complete.');
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
