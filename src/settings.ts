/** Per-viewer preferences, remembered in localStorage when it's available. */
import { randomSeed } from './core/rng';

export interface Settings {
  edition: string;
  deckSeed: number;
  felt: 'emerald' | 'sapphire' | 'bordeaux' | 'onyx';
  cardistry: 0 | 1 | 2 | 3; // techniques per deal
  pace: 'relaxed' | 'normal' | 'fast';
  volume: number;
  muted: boolean;
  name: string;
  level: 'easy' | 'normal' | 'hard';
}

const KEY = 'parlour.settings.v1';
const defaults = (): Settings => ({
  edition: 'vortex',
  deckSeed: randomSeed() % 100000,
  felt: 'emerald',
  cardistry: 2,
  pace: 'normal',
  volume: 0.8,
  muted: false,
  name: 'You',
  level: 'normal',
});

let cur: Settings = defaults();
try {
  const raw = localStorage.getItem(KEY);
  if (raw) cur = { ...cur, ...JSON.parse(raw) };
  else localStorage.setItem(KEY, JSON.stringify(cur));
} catch {
  /* private mode: keep defaults */
}

const subs = new Set<(s: Settings) => void>();
export const settings = {
  get: () => cur,
  set(patch: Partial<Settings>) {
    cur = { ...cur, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(cur));
    } catch {
      /* ignore */
    }
    subs.forEach((f) => f(cur));
  },
  on(f: (s: Settings) => void) {
    subs.add(f);
    return () => subs.delete(f);
  },
  pace: () => ({ relaxed: 1.35, normal: 1, fast: 0.6 })[cur.pace],
};
