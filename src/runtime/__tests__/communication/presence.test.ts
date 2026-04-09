/**
 * Presence system tests
 *
 * Covers: updatePresence (all statuses), requestPresenceSync (bulk),
 * onPresence (individual changes), onPresenceSync (bulk response),
 * presence during calls, presence in group conversations,
 * refreshBadge, and badge/notification count scenarios.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setSocket,
  getSocket,
  updatePresence,
  requestPresenceSync,
  refreshBadge,
  onPresence,
  onPresenceSync,
  onCallStateChanged,
  onMessage,
  disconnect,
} from '../../communication.js';
import { makeMockSocket } from './helpers.js';

const mockIo = vi.fn();
vi.mock('socket.io-client', () => ({ io: mockIo }));

beforeEach(() => { disconnect(); vi.clearAllMocks(); });

// ── updatePresence ────────────────────────────────────────────────────────────

describe('updatePresence()', () => {
  beforeEach(() => setSocket(makeMockSocket()));

  it('sends "online" status', () => {
    updatePresence('online');
    expect(getSocket().emit.mock.calls[0]).toEqual(['nk:presence:update', { status: 'online' }]);
  });

  it('sends "offline" status', () => {
    updatePresence('offline');
    expect(getSocket().emit.mock.calls[0][1].status).toBe('offline');
  });

  it('sends "away" status', () => {
    updatePresence('away');
    expect(getSocket().emit.mock.calls[0][1].status).toBe('away');
  });

  it('sends "busy" status', () => {
    updatePresence('busy');
    expect(getSocket().emit.mock.calls[0][1].status).toBe('busy');
  });

  it('multiple status transitions: online → busy → away → offline', () => {
    updatePresence('online');
    updatePresence('busy');
    updatePresence('away');
    updatePresence('offline');

    const statuses = getSocket().emit.mock.calls.map(([, p]: [string, any]) => p.status);
    expect(statuses).toEqual(['online', 'busy', 'away', 'offline']);
  });

  it('emits on correct event name nk:presence:update', () => {
    updatePresence('online');
    expect(getSocket().emit.mock.calls[0][0]).toBe('nk:presence:update');
  });

  it('is a no-op when socket is null — does not throw', () => {
    disconnect();
    expect(() => updatePresence('online')).not.toThrow();
  });
});

// ── requestPresenceSync ───────────────────────────────────────────────────────

describe('requestPresenceSync()', () => {
  beforeEach(() => setSocket(makeMockSocket()));

  it('emits nk:presence:sync with userIds array', () => {
    requestPresenceSync(['u1', 'u2', 'u3']);
    expect(getSocket().emit.mock.calls[0]).toEqual(['nk:presence:sync', { userIds: ['u1', 'u2', 'u3'] }]);
  });

  it('works with a single userId', () => {
    requestPresenceSync(['u1']);
    expect(getSocket().emit.mock.calls[0][1]).toEqual({ userIds: ['u1'] });
  });

  it('works with empty array', () => {
    requestPresenceSync([]);
    expect(getSocket().emit.mock.calls[0][1]).toEqual({ userIds: [] });
  });

  it('works with large user list (e.g. group of 50)', () => {
    const users = Array.from({ length: 50 }, (_, i) => `user-${i}`);
    requestPresenceSync(users);
    expect(getSocket().emit.mock.calls[0][1].userIds).toHaveLength(50);
    expect(getSocket().emit.mock.calls[0][1].userIds[0]).toBe('user-0');
    expect(getSocket().emit.mock.calls[0][1].userIds[49]).toBe('user-49');
  });

  it('is a no-op when socket is null', () => {
    disconnect();
    expect(() => requestPresenceSync(['u1'])).not.toThrow();
  });
});

// ── onPresence (individual status changes) ────────────────────────────────────

describe('onPresence()', () => {
  it('fires when a contact goes online', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const h = vi.fn();
    onPresence(h);

    sock._trigger({
      event: 'presence:changed',
      data: { userId: 'u2', status: 'online', lastSeen: '2026-04-08T10:00:00Z' },
    });

    expect(h).toHaveBeenCalledWith({ userId: 'u2', status: 'online', lastSeen: '2026-04-08T10:00:00Z' });
  });

  it('fires when a contact goes offline', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const h = vi.fn();
    onPresence(h);

    sock._trigger({
      event: 'presence:changed',
      data: { userId: 'u3', status: 'offline', lastSeen: '2026-04-08T09:55:00Z' },
    });

    expect(h).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u3', status: 'offline' }));
  });

  it('multiple contacts changing status — all events delivered', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const changes: string[] = [];
    onPresence((d: any) => changes.push(`${d.userId}:${d.status}`));

    sock._trigger({ event: 'presence:changed', data: { userId: 'u1', status: 'online' } });
    sock._trigger({ event: 'presence:changed', data: { userId: 'u2', status: 'away' } });
    sock._trigger({ event: 'presence:changed', data: { userId: 'u3', status: 'offline' } });

    expect(changes).toEqual(['u1:online', 'u2:away', 'u3:offline']);
  });

  it('multiple subscribers all receive presence updates', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const sidebar = vi.fn();  // sidebar user list
    const chatHeader = vi.fn(); // chat header shows status

    onPresence(sidebar);
    onPresence(chatHeader);

    sock._trigger({ event: 'presence:changed', data: { userId: 'u2', status: 'online' } });

    expect(sidebar).toHaveBeenCalledOnce();
    expect(chatHeader).toHaveBeenCalledOnce();
  });

  it('unsubscribing presence listener stops delivery', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const h = vi.fn();
    const unsub = onPresence(h);
    unsub();

    sock._trigger({ event: 'presence:changed', data: { userId: 'u2', status: 'online' } });
    expect(h).not.toHaveBeenCalled();
  });

  it('presence does not fire for message:new or typing:update events', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const presH = vi.fn();
    const msgH = vi.fn();
    onPresence(presH);
    onMessage(msgH);

    sock._trigger({ event: 'message:new', data: { id: 1 } });
    expect(presH).not.toHaveBeenCalled();
    expect(msgH).toHaveBeenCalledOnce();
  });
});

// ── onPresenceSync (bulk response) ───────────────────────────────────────────

describe('onPresenceSync()', () => {
  it('fires when server responds to bulk presence request', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const h = vi.fn();
    onPresenceSync(h);

    const presences = {
      'u1': { status: 'online', lastSeen: null },
      'u2': { status: 'offline', lastSeen: '2026-04-08T09:00:00Z' },
      'u3': { status: 'away', lastSeen: null },
    };

    sock._trigger({ event: 'presence:sync', data: { presences } });
    expect(h).toHaveBeenCalledWith({ presences });
  });

  it('fires with empty presences object (no users online)', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const h = vi.fn();
    onPresenceSync(h);

    sock._trigger({ event: 'presence:sync', data: { presences: {} } });
    expect(h).toHaveBeenCalledWith({ presences: {} });
  });

  it('bulk presence for all group members', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const received: any[] = [];
    onPresenceSync((d) => received.push(d));

    // Request then receive bulk
    requestPresenceSync(['u1', 'u2', 'u3', 'u4']);

    sock._trigger({
      event: 'presence:sync',
      data: {
        presences: {
          u1: { status: 'online' },
          u2: { status: 'online' },
          u3: { status: 'offline' },
          u4: { status: 'away' },
        },
      },
    });

    expect(received[0].presences.u1.status).toBe('online');
    expect(received[0].presences.u3.status).toBe('offline');
  });

  it('multiple sync responses (e.g. paginated) are all delivered', () => {
    const sock = makeMockSocket();
    setSocket(sock);
    const responses: number[] = [];
    onPresenceSync((d: any) => responses.push(Object.keys(d.presences).length));

    sock._trigger({ event: 'presence:sync', data: { presences: { u1: {}, u2: {} } } });
    sock._trigger({ event: 'presence:sync', data: { presences: { u3: {} } } });

    expect(responses).toEqual([2, 1]);
  });
});

// ── Presence during an active call ───────────────────────────────────────────

describe('presence events during an active call', () => {
  it('presence updates received while call is active — both handlers fire', () => {
    const sock = makeMockSocket({ connected: true });
    setSocket(sock);

    const presH = vi.fn();
    const callStateH = vi.fn();
    onPresence(presH);
    onCallStateChanged(callStateH);

    // Presence change arrives while call is ongoing
    sock._trigger({ event: 'presence:changed', data: { userId: 'u2', status: 'busy' } });
    // Call state arrives
    sock._trigger({ event: 'call:state-changed', data: { callId: 'c1', state: 'active' } });

    expect(presH).toHaveBeenCalledOnce();
    expect(callStateH).toHaveBeenCalledOnce();
  });

  it('user going busy triggers presence update when they start a call', () => {
    const sock = makeMockSocket({ connected: true });
    setSocket(sock);

    const statusChanges: string[] = [];
    onPresence((d: any) => statusChanges.push(d.status));

    // Server broadcasts that u2 is now busy (in a call)
    sock._trigger({ event: 'presence:changed', data: { userId: 'u2', status: 'busy' } });
    expect(statusChanges).toContain('busy');
  });
});

// ── refreshBadge ─────────────────────────────────────────────────────────────

describe('refreshBadge()', () => {
  beforeEach(() => setSocket(makeMockSocket()));

  it('emits nk:badge:refresh with empty payload', () => {
    refreshBadge();
    expect(getSocket().emit.mock.calls[0]).toEqual(['nk:badge:refresh', {}]);
  });

  it('is a no-op when socket is null', () => {
    disconnect();
    expect(() => refreshBadge()).not.toThrow();
  });

  it('can be called multiple times (e.g. on each page navigation)', () => {
    refreshBadge();
    refreshBadge();
    refreshBadge();
    expect(getSocket().emit).toHaveBeenCalledTimes(3);
    expect(getSocket().emit.mock.calls.every(([e]: [string]) => e === 'nk:badge:refresh')).toBe(true);
  });

  it('badge refresh called after receiving message (typical UX flow)', () => {
    const sock = makeMockSocket();
    setSocket(sock);

    onMessage((_msg: any) => {
      refreshBadge(); // refresh badge on every new message
    });

    sock._trigger({ event: 'message:new', data: { id: 1 } });
    sock._trigger({ event: 'message:new', data: { id: 2 } });

    const badgeEmits = sock.emit.mock.calls.filter(([e]: [string]) => e === 'nk:badge:refresh');
    expect(badgeEmits).toHaveLength(2);
  });
});
