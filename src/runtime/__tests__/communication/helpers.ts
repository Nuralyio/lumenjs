import { vi } from 'vitest';

export function makeMockSocket(opts: { connected?: boolean; active?: boolean } = {}) {
  const listeners: Record<string, Function[]> = {};
  const sock: any = {
    connected: opts.connected ?? false,
    active: opts.active ?? true,
    emit: vi.fn(),
    disconnect: vi.fn(),
    on(event: string, handler: Function) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    },
    get _nkDataListenerCount() { return (listeners['nk:data'] || []).length; },
    _trigger(payload: { event: string; data?: any }) {
      for (const h of listeners['nk:data'] || []) h(payload);
    },
  };
  return sock;
}
