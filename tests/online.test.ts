import { describe, expect, it, vi } from 'vitest';
import type { ClientTransport, HostTransport } from '../src/net/transport';

// the session module imports settings (localStorage) — give Node a stub
const store = new Map<string, string>();
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });

/** An in-memory pair of transports: one host, many clients. */
function memoryNet() {
  let join = (_: string) => {}, msg = (_: string, __: any) => {}, leave = (_: string) => {};
  const clients = new Map<string, (m: any) => void>();
  const closers = new Map<string, () => void>();
  const host: HostTransport = {
    code: 'TEST1',
    onJoin: (cb) => (join = cb),
    onMessage: (cb) => (msg = cb),
    onLeave: (cb) => (leave = cb),
    send: (id, m) => clients.get(id)?.(structuredClone(m)),
    close: () => {},
  };
  let n = 0;
  const connect = (): ClientTransport & { drop(): void } => {
    const id = 'c' + ++n;
    let onMsg = (_: any) => {};
    clients.set(id, (m) => onMsg(m));
    join(id);
    return {
      send: (m) => msg(id, structuredClone(m)),
      onMessage: (cb) => (onMsg = cb),
      onClose: (cb) => closers.set(id, cb),
      close: () => leave(id),
      drop: () => leave(id),
    };
  };
  return { host, connect };
}

describe('online rooms', async () => {
  const { HostRoom, ClientRoom } = await import('../src/net/session');
  const { holdem } = await import('../src/games/holdem');

  it('a guest joins, sees only their own cards, and can act', async () => {
    const net = memoryNet();
    const room = new HostRoom(net.host, holdem, { players: 3, options: {}, level: 'easy', name: 'Host' });
    const guest = new ClientRoom(net.connect(), 'TEST1', 'Guest');
    expect(guest.seat).toBe(1);
    expect(room.seats[1].name).toBe('Guest');
    const runner = room.start();
    await new Promise((r) => setTimeout(r, 0));
    expect(guest.status).toBe('playing');
    expect(guest.view?.viewer).toBe(1);
    // the guest's own hole cards are face up, everyone else's are hidden
    const zones = guest.view!.zones;
    expect(zones.find((z) => z.id === 'h1')!.cards.every((c) => c.f)).toBe(true);
    for (const z of zones) if (/^h[02]$/.test(z.id)) expect(z.cards.every((c) => !c.f)).toBe(true);
    // drive play until it is the guest's turn, then act through the network
    for (let i = 0; i < 20 && !runner.toAct().includes(1); i++) {
      const s = runner.toAct()[0];
      runner.submit(s, { t: 'call' }) && runner.submit(s, { t: 'check' });
    }
    if (runner.toAct().includes(1)) {
      const before = runner.version;
      guest.controller(() => {}).submit({ t: 'fold' });
      expect(runner.version).toBeGreaterThan(before);
    }
    runner.dispose();
  });

  it('a dropped player is replaced by the computer and can reclaim the seat', async () => {
    const net = memoryNet();
    const room = new HostRoom(net.host, holdem, { players: 2, options: {}, level: 'easy', name: 'Host' });
    const conn = net.connect();
    const guest = new ClientRoom(conn, 'TEST1', 'Guest');
    expect(guest.seat).toBe(1);
    const runner = room.start();
    conn.drop();
    expect(room.seats[1].away).toBe(true);
    expect(runner.players[1].kind).toBe('cpu');
    // rejoin from the same browser key
    const again = new ClientRoom(net.connect(), 'TEST1', 'Guest');
    expect(again.seat).toBe(1);
    expect(runner.players[1].kind).toBe('remote');
    runner.dispose();
  });

  it('a full room turns latecomers away once the game has started', async () => {
    const net = memoryNet();
    const room = new HostRoom(net.host, holdem, { players: 2, options: {}, level: 'easy', name: 'Host' });
    room.start();
    const late = new ClientRoom(net.connect(), 'TEST1', 'Late');
    expect(late.status).toBe('full');
    room.runner!.dispose();
  });
});
