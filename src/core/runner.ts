/**
 * Drives a game: applies actions, runs timed automatic steps, and plays the
 * CPU seats. The same runner powers local play, the online host and the
 * headless test simulator.
 */
import { makeRng, type Rng } from './rng';
import type { Action, Ctx, GameDef, Level, PlayerSlot, Seat, View } from './types';

export interface RunnerOptions {
  def: GameDef;
  players: PlayerSlot[];
  options?: Record<string, unknown>;
  seed: number;
  /** multiplier on every delay (0.6 fast … 1.4 relaxed) */
  pace?: () => number;
}

export class Runner {
  readonly def: GameDef;
  readonly players: PlayerSlot[];
  s: any;
  version = 0;
  private rng: Rng;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private listeners = new Set<() => void>();
  private holds = 0;
  private pace: () => number;
  disposed = false;

  constructor(o: RunnerOptions) {
    this.def = o.def;
    this.players = o.players.map((p) => ({ ...p }));
    this.rng = makeRng(o.seed);
    this.pace = o.pace ?? (() => 1);
    this.s = this.def.create(this.players, this.ctx(), o.options ?? {});
    queueMicrotask(() => this.changed());
  }

  private ctx(level?: Level): Ctx {
    return { rng: this.rng, level };
  }

  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  view(seat: Seat): View {
    return this.def.view(this.s, seat);
  }

  toAct(): Seat[] {
    return this.def.toAct(this.s);
  }

  /** Apply an action for a seat. Returns an error message if it's illegal. */
  submit(seat: Seat, a: Action): string | undefined {
    if (this.disposed) return 'Game closed';
    if (!this.def.toAct(this.s).includes(seat)) return "It isn't your turn";
    let err: string | void;
    try {
      err = this.def.act(this.s, seat, a, this.ctx(this.players[seat]?.level));
    } catch (e) {
      console.error(e);
      err = 'That move failed';
    }
    if (err) return err;
    this.changed();
  }

  /** Pause CPU moves and timed steps while the local renderer animates. */
  hold<T>(p: Promise<T>): Promise<T> {
    this.holds++;
    this.clear();
    return p.finally(() => {
      this.holds--;
      if (!this.holds) this.schedule();
    });
  }

  /** A remote player dropped out or came back. */
  setKind(seat: Seat, kind: PlayerSlot['kind']) {
    this.players[seat].kind = kind;
    this.schedule();
  }

  dispose() {
    this.disposed = true;
    this.clear();
    this.listeners.clear();
  }

  private changed() {
    this.version++;
    this.listeners.forEach((fn) => fn());
    this.schedule();
  }

  private clear() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  private schedule() {
    this.clear();
    if (this.disposed || this.holds) return;
    const v = this.version;
    const auto = this.def.auto?.(this.s);
    if (auto != null) {
      this.timers.push(
        setTimeout(() => {
          if (this.version !== v || this.disposed || this.holds) return;
          this.def.step?.(this.s, this.ctx());
          this.changed();
        }, auto * this.pace()),
      );
    }
    for (const seat of this.def.toAct(this.s)) {
      const p = this.players[seat];
      if (!p || p.kind !== 'cpu') continue;
      const think = this.thinkTime(seat);
      const fire = () => {
        if (this.version !== v || this.disposed || this.holds) return;
        const a = this.def.cpu(this.s, seat, this.ctx(p.level));
        if (!a) {
          // nothing to do yet (real-time games poll)
          this.timers.push(setTimeout(fire, 120));
          return;
        }
        const delay = typeof a.delay === 'number' ? (a.delay as number) : 0;
        const go = () => {
          if (this.version !== v || this.disposed) return;
          const err = this.submit(seat, a);
          if (err) console.warn(`[cpu ${seat}] ${this.def.meta.id}:`, err, a);
        };
        if (delay) this.timers.push(setTimeout(go, delay));
        else go();
      };
      this.timers.push(setTimeout(fire, think * this.pace()));
    }
  }

  private thinkTime(seat: Seat) {
    const base = this.def.meta.cpuThink ?? 850;
    return base * (0.65 + this.rng.next() * 0.7) * (seat % 2 ? 1.05 : 0.95);
  }
}

/**
 * Headless simulation with every seat played by the CPU. Used by the tests:
 * throws if a CPU makes an illegal move or the game stalls.
 */
export function simulate(
  def: GameDef,
  n: number,
  seed: number,
  opts: { maxSteps?: number; options?: Record<string, unknown>; level?: Level; onStep?: (s: any) => void } = {},
) {
  const rng = makeRng(seed);
  const level = opts.level ?? 'normal';
  const players: PlayerSlot[] = Array.from({ length: n }, (_, i) => ({ name: `CPU ${i + 1}`, kind: 'cpu', level }));
  const ctx: Ctx = { rng, level };
  const s = def.create(players, ctx, opts.options ?? {});
  const max = opts.maxSteps ?? 200000;
  let steps = 0;
  while (!def.over(s)) {
    opts.onStep?.(s);
    if (++steps > max) throw new Error(`${def.meta.id}: no finish after ${max} steps`);
    let acted = false;
    for (const seat of def.toAct(s)) {
      const a = def.cpu(s, seat, ctx);
      if (!a) continue;
      const err = def.act(s, seat, a, ctx);
      if (err) throw new Error(`${def.meta.id}: CPU ${seat} illegal ${JSON.stringify(a)} → ${err}`);
      acted = true;
      break;
    }
    if (acted) continue;
    if (def.auto?.(s) != null) {
      def.step!(s, ctx);
      continue;
    }
    throw new Error(`${def.meta.id}: stalled (toAct=${JSON.stringify(def.toAct(s))})`);
  }
  return { state: s, steps };
}
