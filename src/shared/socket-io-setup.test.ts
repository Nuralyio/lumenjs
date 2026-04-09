import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { setupSocketIO } from './socket-io-setup.js';

// Mock socket.io Server as a constructable class
vi.mock('socket.io', () => {
  class MockServer {
    private _namespaces = new Map<string, any>();
    private _opts: any;

    constructor(httpServer: any, opts: any) {
      this._opts = opts;
    }

    of(ns: string) {
      if (!this._namespaces.has(ns)) {
        const handlers = new Map<string, Function>();
        this._namespaces.set(ns, {
          on: vi.fn((event: string, handler: Function) => {
            handlers.set(event, handler);
          }),
          to: vi.fn(() => ({ emit: vi.fn() })),
          emit: vi.fn(),
          _handlers: handlers,
        });
      }
      return this._namespaces.get(ns);
    }
  }

  return { Server: MockServer };
});

describe('setupSocketIO', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('creates namespaces for routes with hasSocket', async () => {
    const io = await setupSocketIO({
      httpServer: {},
      loadModule: async () => ({}),
      routes: [
        { path: '/chat', hasSocket: true, filePath: '/pages/chat.ts' },
        { path: '/about', hasSocket: false, filePath: '/pages/about.ts' },
      ],
    });

    // /nk/chat namespace should exist, /nk/about should not
    const chatNs = io.of('/nk/chat');
    expect(chatNs.on).toHaveBeenCalledWith('connection', expect.any(Function));
  });

  it('creates /nk/index namespace for root route', async () => {
    const io = await setupSocketIO({
      httpServer: {},
      loadModule: async () => ({}),
      routes: [
        { path: '/', hasSocket: true, filePath: '/pages/index.ts' },
      ],
    });

    const indexNs = io.of('/nk/index');
    expect(indexNs.on).toHaveBeenCalledWith('connection', expect.any(Function));
  });

  it('calls socket handler on connection and invokes cleanup on disconnect', async () => {
    const cleanupFn = vi.fn();
    const socketFn = vi.fn(() => cleanupFn);

    const io = await setupSocketIO({
      httpServer: {},
      loadModule: async () => ({ socket: socketFn }),
      routes: [
        { path: '/test', hasSocket: true, filePath: '/pages/test.ts' },
      ],
    });

    // Get the connection handler
    const ns = io.of('/nk/test');
    const connectionHandler = ns._handlers.get('connection');

    const socketHandlers = new Map<string, Function>();
    const mockSocket = {
      emit: vi.fn(),
      on: vi.fn((event: string, handler: Function) => {
        socketHandlers.set(event, handler);
      }),
      join: vi.fn(),
      leave: vi.fn(),
      to: vi.fn(() => ({ emit: vi.fn() })),
      handshake: {
        query: {},
        headers: { host: 'localhost' },
      },
    };

    await connectionHandler(mockSocket);

    expect(socketFn).toHaveBeenCalledTimes(1);
    expect(socketFn).toHaveBeenCalledWith(
      expect.objectContaining({
        on: expect.any(Function),
        push: expect.any(Function),
        room: expect.objectContaining({
          join: expect.any(Function),
          leave: expect.any(Function),
          broadcast: expect.any(Function),
          broadcastAll: expect.any(Function),
        }),
        params: {},
        headers: { host: 'localhost' },
        socket: mockSocket,
      })
    );

    // Simulate disconnect
    const disconnectHandler = socketHandlers.get('disconnect');
    disconnectHandler!();
    expect(cleanupFn).toHaveBeenCalledTimes(1);
  });

  it('parses params from handshake query', async () => {
    const socketFn = vi.fn();

    const io = await setupSocketIO({
      httpServer: {},
      loadModule: async () => ({ socket: socketFn }),
      routes: [
        { path: '/chat/:room', hasSocket: true, filePath: '/pages/chat/[room].ts' },
      ],
    });

    const ns = io.of('/nk/chat/:room');
    const connectionHandler = ns._handlers.get('connection');

    const mockSocket = {
      emit: vi.fn(),
      on: vi.fn(),
      join: vi.fn(),
      leave: vi.fn(),
      to: vi.fn(() => ({ emit: vi.fn() })),
      handshake: {
        query: { __params: JSON.stringify({ room: 'general' }), __locale: 'en' },
        headers: {},
      },
    };

    await connectionHandler(mockSocket);

    expect(socketFn).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { room: 'general' },
        locale: 'en',
      })
    );
  });

  it('handles module without socket export gracefully', async () => {
    const io = await setupSocketIO({
      httpServer: {},
      loadModule: async () => ({ loader: () => ({}) }),
      routes: [
        { path: '/no-socket', hasSocket: true, filePath: '/pages/no-socket.ts' },
      ],
    });

    const ns = io.of('/nk/no-socket');
    const connectionHandler = ns._handlers.get('connection');

    const mockSocket = {
      emit: vi.fn(),
      on: vi.fn(),
      handshake: { query: {}, headers: {} },
    };

    // Should not throw
    await connectionHandler(mockSocket);
    expect(mockSocket.on).not.toHaveBeenCalled();
  });

  describe('_socket.ts co-location fallback', () => {
    let tmpDir: string;

    beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-socket-test-')); });
    afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

    it('loads socket fn from co-located _socket.ts when index.ts has no inline socket', async () => {
      const indexFile = path.join(tmpDir, 'index.ts');
      const socketFile = path.join(tmpDir, '_socket.ts');
      fs.writeFileSync(indexFile, 'export class Page {}');
      fs.writeFileSync(socketFile, '');

      const socketFn = vi.fn();
      const loadModule = vi.fn(async (fp: string) => {
        if (fp === socketFile) return { socket: socketFn };
        return {}; // index.ts has no socket export
      });

      const io = await setupSocketIO({
        httpServer: {},
        loadModule,
        routes: [{ path: '/chat', hasSocket: true, filePath: indexFile }],
      });

      const ns = io.of('/nk/chat');
      const connectionHandler = ns._handlers.get('connection');

      const mockSocket = {
        emit: vi.fn(), on: vi.fn(), join: vi.fn(), leave: vi.fn(),
        to: vi.fn(() => ({ emit: vi.fn() })),
        handshake: { query: {}, headers: {} },
      };

      await connectionHandler(mockSocket);

      // loadModule should have been called for index.ts (no socket), then _socket.ts (fallback)
      expect(loadModule).toHaveBeenCalledWith(indexFile);
      expect(loadModule).toHaveBeenCalledWith(socketFile);
      expect(socketFn).toHaveBeenCalledTimes(1);
    });

    it('prefers inline socket over co-located _socket.ts', async () => {
      const indexFile = path.join(tmpDir, 'index.ts');
      const socketFile = path.join(tmpDir, '_socket.ts');
      fs.writeFileSync(indexFile, '');
      fs.writeFileSync(socketFile, '');

      const inlineSocketFn = vi.fn();
      const colocatedSocketFn = vi.fn();
      const loadModule = vi.fn(async (fp: string) => {
        if (fp === socketFile) return { socket: colocatedSocketFn };
        return { socket: inlineSocketFn }; // index.ts has inline socket
      });

      const io = await setupSocketIO({
        httpServer: {},
        loadModule,
        routes: [{ path: '/chat', hasSocket: true, filePath: indexFile }],
      });

      const ns = io.of('/nk/chat');
      const connectionHandler = ns._handlers.get('connection');

      const mockSocket = {
        emit: vi.fn(), on: vi.fn(), join: vi.fn(), leave: vi.fn(),
        to: vi.fn(() => ({ emit: vi.fn() })),
        handshake: { query: {}, headers: {} },
      };

      await connectionHandler(mockSocket);

      expect(inlineSocketFn).toHaveBeenCalledTimes(1);
      expect(colocatedSocketFn).not.toHaveBeenCalled();
      // loadModule should only have been called for index.ts (inline wins)
      expect(loadModule).toHaveBeenCalledTimes(1);
      expect(loadModule).toHaveBeenCalledWith(indexFile);
    });

    it('does not attempt fallback for non-index page files', async () => {
      const pageFile = path.join(tmpDir, 'about.ts');
      const socketFile = path.join(tmpDir, '_socket.ts');
      fs.writeFileSync(pageFile, '');
      fs.writeFileSync(socketFile, '');

      const colocatedSocketFn = vi.fn();
      const loadModule = vi.fn(async (fp: string) => {
        if (fp === socketFile) return { socket: colocatedSocketFn };
        return {}; // about.ts has no socket
      });

      const io = await setupSocketIO({
        httpServer: {},
        loadModule,
        routes: [{ path: '/about', hasSocket: true, filePath: pageFile }],
      });

      const ns = io.of('/nk/about');
      const connectionHandler = ns._handlers.get('connection');

      const mockSocket = {
        emit: vi.fn(), on: vi.fn(),
        handshake: { query: {}, headers: {} },
      };

      await connectionHandler(mockSocket);

      // Only called once for about.ts, no fallback to _socket.ts
      expect(loadModule).toHaveBeenCalledTimes(1);
      expect(loadModule).toHaveBeenCalledWith(pageFile);
      expect(colocatedSocketFn).not.toHaveBeenCalled();
    });
  });
});
