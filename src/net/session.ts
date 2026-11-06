/**
 * Online rooms, host-authoritative. The host runs the game; each remote
 * player receives only their own seat's View and sends back actions. A
 * player who drops out is replaced by a CPU and gets the seat back when they
 * rejoin from the same browser.
 *
 *   client → host   hello {name, key} · act {a}
 *   host → client   welcome {seat} · lobby {seats, game, players} · start {game}
 *                   view {v} · err {msg} · full · closed
 */
import { Runner } from '../core/runner';
import { randomSeed } from '../core/rng';
import type { Action, GameDef, PlayerSlot, View } from '../core/types';
import { gameById } from '../games';
import type { Controller } from '../render/table';
import { settings } from '../settings';
import type { ClientTransport, HostTransport } from './transport';

export interface RoomSeat {
  name: string;
  kind: 'host' | 'remote' | 'open';
  id?: string;
  key?: string;
  away?: boolean;
}

export interface LobbyState {
  code: string;
  game: string;
  seats: RoomSeat[];
  started: boolean;
}

const CPU_NAMES = ['Ada', 'Bea', 'Cyrus', 'Dario', 'Esme', 'Felix', 'Greta', 'Hugo', 'Iris', 'Jules', 'Kit', 'Lena', 'Milo', 'Nora'];

export function browserKey() {
  try {
    let k = localStorage.getItem('parlour.key');
    if (!k) {
      k = Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem('parlour.key', k);
    }
    return k;
  } catch {
    return Math.random().toString(36).slice(2);
  }
}

type Fn = () => void;

export class HostRoom {
  seats: RoomSeat[];
  runner: Runner | null = null;
  private subs = new Set<Fn>();
  private toasts = new Set<(m: string) => void>();

  constructor(
    readonly t: HostTransport,
    readonly game: GameDef,
    readonly cfg: { players: number; options: Record<string, unknown>; level: PlayerSlot['level']; name: string },
  ) {
    this.seats = Array.from({ length: cfg.players }, (_, i) => (i === 0 ? { name: cfg.name, kind: 'host' as const } : { name: '', kind: 'open' as const }));
    t.onMessage((id, msg) => this.message(id, msg));
    t.onLeave((id) => this.left(id));
  }

  onLobby(fn: Fn) {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  lobby(): LobbyState {
    return { code: this.t.code, game: this.game.meta.id, seats: this.seats, started: !!this.runner };
  }

  private changed() {
    this.subs.forEach((f) => f());
    const msg = { t: 'lobby', lobby: this.lobby() };
    for (const s of this.seats) if (s.kind === 'remote' && s.id && !s.away) this.t.send(s.id, msg);
  }

  private seatOf(id: string) {
    return this.seats.findIndex((s) => s.id === id && s.kind === 'remote');
  }

  private message(id: string, msg: any) {
    if (msg?.t === 'hello') {
      const name = String(msg.name ?? 'Guest').slice(0, 14) || 'Guest';
      // rejoining from the same browser reclaims the seat
      let seat = this.seats.findIndex((s) => s.kind === 'remote' && s.key && s.key === msg.key);
      if (seat < 0 && !this.runner) seat = this.seats.findIndex((s) => s.kind === 'open');
      if (seat < 0) {
        this.t.send(id, { t: 'full' });
        return;
      }
      const wasAway = this.seats[seat].away;
      this.seats[seat] = { name, kind: 'remote', id, key: msg.key, away: false };
      this.t.send(id, { t: 'welcome', seat, game: this.game.meta.id });
      if (this.runner) {
        if (wasAway) this.runner.setKind(seat, 'remote');
        this.t.send(id, { t: 'start', game: this.game.meta.id });
        this.t.send(id, { t: 'view', v: this.runner.view(seat) });
        this.notify(`${name} is back`);
      } else this.notify(`${name} joined`);
      this.changed();
      return;
    }
    if (msg?.t === 'act' && this.runner) {
      const seat = this.seatOf(id);
      if (seat < 0) return;
      const err = this.runner.submit(seat, msg.a as Action);
      if (err) this.t.send(id, { t: 'err', msg: err });
    }
  }

  private left(id: string) {
    const seat = this.seats.findIndex((s) => s.id === id);
    if (seat < 0) return;
    const s = this.seats[seat];
    if (this.runner) {
      s.away = true;
      this.runner.setKind(seat, 'cpu');
      this.notify(`${s.name} left: the computer is playing their seat`);
    } else this.seats[seat] = { name: '', kind: 'open' };
    this.changed();
  }

  private notify(m: string) {
    this.toasts.forEach((f) => f(m));
  }

  /** Start the game: open seats become CPU players. */
  start(): Runner {
    const names = CPU_NAMES.filter((n) => !this.seats.some((s) => s.name === n)).sort(() => Math.random() - 0.5);
    const players: PlayerSlot[] = this.seats.map((s) =>
      s.kind === 'host' ? { name: s.name, kind: 'human' } : s.kind === 'remote' ? { name: s.name, kind: 'remote' } : { name: names.pop() ?? 'CPU', kind: 'cpu', level: this.cfg.level },
    );
    this.runner = new Runner({ def: this.game, players, options: this.cfg.options, seed: randomSeed(), pace: () => settings.pace() });
    for (const [i, s] of this.seats.entries()) if (s.kind === 'remote' && s.id) this.t.send(s.id, { t: 'start', game: this.game.meta.id, seat: i });
    this.runner.onChange(() => {
      for (const [i, s] of this.seats.entries()) if (s.kind === 'remote' && s.id && !s.away) this.t.send(s.id, { t: 'view', v: this.runner!.view(i) });
    });
    this.changed();
    return this.runner;
  }

  controller(leave: () => void): Controller {
    const r = this.runner!;
    return {
      meta: this.game.meta,
      label: `Room ${this.t.code}`,
      view: () => r.view(0),
      submit: (a) => r.submit(0, a),
      onChange: (cb) => r.onChange(cb),
      hold: (p) => r.hold(p),
      onToast: (cb) => {
        this.toasts.add(cb);
        return () => this.toasts.delete(cb);
      },
      leave,
    };
  }

  close() {
    for (const s of this.seats) if (s.kind === 'remote' && s.id) this.t.send(s.id, { t: 'closed' });
    this.runner?.dispose();
    setTimeout(() => this.t.close(), 200);
  }
}

export class ClientRoom {
  seat = -1;
  lobby: LobbyState | null = null;
  view: View | null = null;
  game: GameDef | null = null;
  status: 'joining' | 'lobby' | 'playing' | 'full' | 'closed' = 'joining';
  private subs = new Set<Fn>();
  private viewSubs = new Set<Fn>();
  private toasts = new Set<(m: string) => void>();

  constructor(readonly t: ClientTransport, readonly code: string, name: string) {
    t.onMessage((m) => this.message(m));
    t.onClose(() => {
      this.status = 'closed';
      this.emit();
      this.toasts.forEach((f) => f('The connection to the host was lost'));
    });
    t.send({ t: 'hello', name, key: browserKey() });
  }

  on(fn: Fn) {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  private emit() {
    this.subs.forEach((f) => f());
  }

  private message(m: any) {
    switch (m?.t) {
      case 'welcome':
        this.seat = m.seat;
        this.game = gameById(m.game) ?? null;
        this.status = 'lobby';
        break;
      case 'lobby':
        this.lobby = m.lobby;
        break;
      case 'start':
        this.game = gameById(m.game) ?? this.game;
        this.status = 'playing';
        break;
      case 'view':
        this.view = m.v;
        this.viewSubs.forEach((f) => f());
        return;
      case 'err':
        this.toasts.forEach((f) => f(m.msg));
        return;
      case 'full':
        this.status = 'full';
        break;
      case 'closed':
        this.status = 'closed';
        this.toasts.forEach((f) => f('The host closed the room'));
        break;
    }
    this.emit();
  }

  controller(leave: () => void): Controller {
    return {
      meta: this.game!.meta,
      label: `Room ${this.code}`,
      view: () => this.view,
      submit: (a) => {
        this.t.send({ t: 'act', a });
        return undefined;
      },
      onChange: (cb) => {
        this.viewSubs.add(cb);
        return () => this.viewSubs.delete(cb);
      },
      onToast: (cb) => {
        this.toasts.add(cb);
        return () => this.toasts.delete(cb);
      },
      leave,
    };
  }

  close() {
    this.t.close();
  }
}
