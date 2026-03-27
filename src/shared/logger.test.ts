import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger, configureLogger, initLogger } from './logger.js';

describe('logger', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    configureLogger({ level: 'debug', json: false });
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('logs info messages to stdout', () => {
    logger.info('test message');
    expect(stdoutSpy).toHaveBeenCalledOnce();
    expect(stdoutSpy.mock.calls[0][0]).toContain('test message');
  });

  it('logs error messages to stderr', () => {
    logger.error('error occurred');
    expect(stderrSpy).toHaveBeenCalledOnce();
    expect(stderrSpy.mock.calls[0][0]).toContain('error occurred');
  });

  it('respects log level filtering', () => {
    configureLogger({ level: 'warn' });
    logger.debug('should not appear');
    logger.info('should not appear');
    logger.warn('should appear');
    expect(stdoutSpy).toHaveBeenCalledOnce();
  });

  it('outputs JSON when configured', () => {
    configureLogger({ json: true });
    logger.info('json test', { key: 'value' });
    const output = stdoutSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.msg).toBe('json test');
    expect(parsed.level).toBe('info');
    expect(parsed.key).toBe('value');
    expect(parsed.timestamp).toBeDefined();
  });

  it('child logger includes preset fields', () => {
    configureLogger({ json: true });
    const child = logger.child({ requestId: 'abc-123' });
    child.info('child message');
    const output = stdoutSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.requestId).toBe('abc-123');
    expect(parsed.msg).toBe('child message');
  });

  it('child logger merges extra fields', () => {
    configureLogger({ json: true });
    const child = logger.child({ requestId: 'abc' });
    child.info('msg', { extra: true });
    const parsed = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
    expect(parsed.requestId).toBe('abc');
    expect(parsed.extra).toBe(true);
  });

  it('fatal logs to stderr', () => {
    logger.fatal('crash');
    expect(stderrSpy).toHaveBeenCalledOnce();
    expect(stderrSpy.mock.calls[0][0]).toContain('crash');
  });

  it('initLogger auto-configures from environment', () => {
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    initLogger();
    // Should set JSON mode in production
    logger.info('prod test');
    const output = stdoutSpy.mock.calls[0][0] as string;
    expect(() => JSON.parse(output)).not.toThrow();
    process.env.NODE_ENV = origEnv;
  });
});
