/**
 * Transports for online rooms. The host opens a room under a short code and
 * clients connect to it. Two implementations:
 *
 *   peer   WebRTC data channels through PeerJS (works across devices; the
 *          public PeerJS server only brokers the introduction)
 *   local  BroadcastChannel between tabs of one browser (development and
 *          automated tests; add ?net=local to the URL)
 */
export interface HostTransport {
  code: string;
  onJoin(cb: (id: string) => void): void;
  onMessage(cb: (id: string, msg: any) => void): void;
  onLeave(cb: (id: string) => void): void;
  send(id: string, msg: any): void;
  close(): void;
}

export interface ClientTransport {
  send(msg: any): void;
  onMessage(cb: (msg: any) => void): void;
  onClose(cb: () => void): void;
  close(): void;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const newCode = () => Array.from({ length: 5 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
export const normaliseCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
const peerId = (code: string) => `parlour-room-${code}`;

export function transportKind(): 'peer' | 'local' {
  try {
    return new URLSearchParams(location.search).get('net') === 'local' ? 'local' : 'peer';
  } catch {
    return 'peer';
  }
}

const timeout = <T>(p: Promise<T>, ms: number, msg: string) =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);

// ---------------------------------------------------------------- PeerJS

async function peerHost(code: string): Promise<HostTransport> {
  const { Peer } = await import('peerjs');
  const peer = new Peer(peerId(code), { debug: 0 });
  await timeout(
    new Promise<void>((res, rej) => {
      peer.on('open', () => res());
      peer.on('error', (e: any) => rej(e));
    }),
    12000,
    'The room server did not answer',
  );
  const conns = new Map<string, any>();
  let join = (_: string) => {}, message = (_: string, __: any) => {}, leave = (_: string) => {};
  peer.on('connection', (conn: any) => {
    conn.on('open', () => {
      conns.set(conn.peer, conn);
      join(conn.peer);
    });
    conn.on('data', (d: any) => message(conn.peer, d));
    conn.on('close', () => {
      conns.delete(conn.peer);
      leave(conn.peer);
    });
  });
  return {
    code,
    onJoin: (cb) => (join = cb),
    onMessage: (cb) => (message = cb),
    onLeave: (cb) => (leave = cb),
    send: (id, msg) => conns.get(id)?.send(msg),
    close: () => peer.destroy(),
  };
}

async function peerClient(code: string): Promise<ClientTransport> {
  const { Peer } = await import('peerjs');
  const peer = new Peer({ debug: 0 });
  await timeout(
    new Promise<void>((res, rej) => {
      peer.on('open', () => res());
      peer.on('error', (e: any) => rej(e));
    }),
    12000,
    'The room server did not answer',
  );
  const conn = peer.connect(peerId(code), { reliable: true });
  await timeout(
    new Promise<void>((res, rej) => {
      conn.on('open', () => res());
      conn.on('error', (e: any) => rej(e));
      peer.on('error', (e: any) => rej(e));
    }),
    12000,
    'That room did not answer',
  );
  let message = (_: any) => {}, closed = () => {};
  conn.on('data', (d: any) => message(d));
  conn.on('close', () => closed());
  return {
    send: (msg) => conn.send(msg),
    onMessage: (cb) => (message = cb),
    onClose: (cb) => (closed = cb),
    close: () => peer.destroy(),
  };
}

// ---------------------------------------------------------------- BroadcastChannel

function localHost(code: string): Promise<HostTransport> {
  const ch = new BroadcastChannel(peerId(code));
  let join = (_: string) => {}, message = (_: string, __: any) => {}, leave = (_: string) => {};
  ch.onmessage = (e) => {
    const { from, to, kind, data } = e.data ?? {};
    if (to !== 'host') return;
    if (kind === 'hello') {
      ch.postMessage({ from: 'host', to: from, kind: 'ack' });
      join(from);
    } else if (kind === 'bye') leave(from);
    else if (kind === 'msg') message(from, data);
  };
  return Promise.resolve({
    code,
    onJoin: (cb) => (join = cb),
    onMessage: (cb) => (message = cb),
    onLeave: (cb) => (leave = cb),
    send: (id, msg) => ch.postMessage({ from: 'host', to: id, kind: 'msg', data: msg }),
    close: () => ch.close(),
  });
}

function localClient(code: string): Promise<ClientTransport> {
  const ch = new BroadcastChannel(peerId(code));
  const me = 'c' + Math.random().toString(36).slice(2, 9);
  let message = (_: any) => {}, closed = () => {};
  const acked = new Promise<void>((res) => {
    ch.onmessage = (e) => {
      const { to, kind, data } = e.data ?? {};
      if (to !== me) return;
      if (kind === 'ack') res();
      else if (kind === 'msg') message(data);
    };
  });
  ch.postMessage({ from: me, to: 'host', kind: 'hello' });
  window.addEventListener('beforeunload', () => ch.postMessage({ from: me, to: 'host', kind: 'bye' }));
  return timeout(acked, 4000, 'That room did not answer').then(() => ({
    send: (msg: any) => ch.postMessage({ from: me, to: 'host', kind: 'msg', data: msg }),
    onMessage: (cb: (m: any) => void) => (message = cb),
    onClose: (cb: () => void) => (closed = cb),
    close: () => {
      ch.postMessage({ from: me, to: 'host', kind: 'bye' });
      ch.close();
      void closed;
    },
  }));
}

export async function openRoom(): Promise<HostTransport> {
  const kind = transportKind();
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = newCode();
    try {
      return kind === 'local' ? await localHost(code) : await peerHost(code);
    } catch (e: any) {
      if (e?.type === 'unavailable-id') continue; // code already taken: try another
      throw e;
    }
  }
  throw new Error('Could not find a free room code');
}

export function joinRoom(code: string): Promise<ClientTransport> {
  return transportKind() === 'local' ? localClient(code) : peerClient(code);
}
