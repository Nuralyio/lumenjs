import { describe, it, expect, vi, afterEach } from 'vitest';
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
});
