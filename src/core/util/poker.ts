/** Poker hand evaluation (5–7 cards, Omaha 2+3) and Monte Carlo equity. */
import { hi, rankName, rankPlural, type Card, type Suit } from '../cards';
import type { Rng } from '../rng';

export const CATEGORY = ['High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'];

export interface HandValue {
  score: number;
  cat: number;
  name: string;
  cards: Card[]; // the best five
}

const B = 15;
const enc = (cat: number, ks: number[]) => {
  let s = cat;
  for (let i = 0; i < 5; i++) s = s * B + (ks[i] ?? 0);
  return s;
};
const nm = (v: number) => rankName(v === 14 ? 1 : v);
const nms = (v: number) => rankPlural(v === 14 ? 1 : v);

/** Highest straight within cards (any suit mix). Returns the five cards, high first. */
function straightOf(cards: Card[]): Card[] | null {
  const byVal: (Card | undefined)[] = new Array(15);
  for (const c of cards) {
    const v = hi(c);
    if (!byVal[v]) byVal[v] = c;
  }
  byVal[1] = byVal[14]; // wheel
  for (let top = 14; top >= 5; top--) {
    let ok = true;
    for (let k = 0; k < 5; k++) if (!byVal[top - k]) { ok = false; break; }
    if (ok) return [0, 1, 2, 3, 4].map((k) => byVal[top - k]!);
  }
  return null;
}

export function best5(cards: Card[]): HandValue {
  const sorted = [...cards].sort((a, b) => hi(b) - hi(a));
  const bySuit: Record<Suit, Card[]> = { S: [], H: [], D: [], C: [] };
  for (const c of sorted) bySuit[c.s].push(c);
  const flush = (Object.values(bySuit) as Card[][]).find((l) => l.length >= 5);
  if (flush) {
    const sf = straightOf(flush);
    if (sf) {
      const top = hi(sf[0]) === 14 && hi(sf[1]) === 5 ? 5 : hi(sf[0]);
      return { score: enc(8, [top]), cat: 8, name: top === 14 ? 'Royal flush' : `Straight flush, ${nm(top)} high`, cards: sf };
    }
  }
  // rank groups, largest first then highest
  const groups = new Map<number, Card[]>();
  for (const c of sorted) {
    const v = hi(c);
    if (!groups.has(v)) groups.set(v, []);
    groups.get(v)!.push(c);
  }
  const g = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || b[0] - a[0]);
  const kick = (used: Card[], n: number) => sorted.filter((c) => !used.includes(c)).slice(0, n);

  if (g[0][1].length === 4) {
    const quad = g[0][1];
    const k = kick(quad, 1);
    return { score: enc(7, [g[0][0], hi(k[0])]), cat: 7, name: `Four ${nms(g[0][0])}`, cards: [...quad, ...k] };
  }
  if (g[0][1].length === 3 && g[1] && g[1][1].length >= 2) {
    const trips = g[0][1];
    const pair = g[1][1].slice(0, 2);
    return { score: enc(6, [g[0][0], g[1][0]]), cat: 6, name: `Full house, ${nms(g[0][0])} over ${nms(g[1][0])}`, cards: [...trips, ...pair] };
  }
  if (flush) {
    const f = flush.slice(0, 5);
    return { score: enc(5, f.map(hi)), cat: 5, name: `Flush, ${nm(hi(f[0]))} high`, cards: f };
  }
  const st = straightOf(sorted);
  if (st) {
    const top = hi(st[0]) === 14 && hi(st[1]) === 5 ? 5 : hi(st[0]);
    return { score: enc(4, [top]), cat: 4, name: `Straight, ${nm(top)} high`, cards: st };
  }
  if (g[0][1].length === 3) {
    const trips = g[0][1];
    const k = kick(trips, 2);
    return { score: enc(3, [g[0][0], ...k.map(hi)]), cat: 3, name: `Three ${nms(g[0][0])}`, cards: [...trips, ...k] };
  }
  if (g[0][1].length === 2 && g[1] && g[1][1].length === 2) {
    const p = [...g[0][1], ...g[1][1]];
    const k = kick(p, 1);
    return { score: enc(2, [g[0][0], g[1][0], hi(k[0])]), cat: 2, name: `Two pair, ${nms(g[0][0])} and ${nms(g[1][0])}`, cards: [...p, ...k] };
  }
  if (g[0][1].length === 2) {
    const p = g[0][1];
    const k = kick(p, 3);
    return { score: enc(1, [g[0][0], ...k.map(hi)]), cat: 1, name: `Pair of ${nms(g[0][0])}`, cards: [...p, ...k] };
  }
  const top = sorted.slice(0, 5);
  return { score: enc(0, top.map(hi)), cat: 0, name: `${nm(hi(top[0]))} high`, cards: top };
}

function combos<T>(arr: T[], k: number): T[][] {
  const out: T[][] = [];
  const rec = (start: number, acc: T[]) => {
    if (acc.length === k) return void out.push(acc);
    for (let i = start; i < arr.length; i++) rec(i + 1, [...acc, arr[i]]);
  };
  rec(0, []);
  return out;
}

/** Omaha: exactly two hole cards and three board cards. */
export function bestOmaha(hole: Card[], board: Card[]): HandValue {
  let best: HandValue | null = null;
  const hs = combos(hole, 2), bs = combos(board, 3);
  for (const h of hs) for (const b of bs) {
    const v = best5([...h, ...b]);
    if (!best || v.score > best.score) best = v;
  }
  return best!;
}

export type Variant = 'holdem' | 'omaha' | 'draw';
export const evaluate = (variant: Variant, hole: Card[], board: Card[]) =>
  variant === 'omaha' && board.length >= 3 ? bestOmaha(hole, board) : best5([...hole, ...board]);

/**
 * Monte Carlo equity of `hole` against `opponents` random hands, completing
 * the board to five cards (or none, for draw poker).
 */
export function equity(variant: Variant, hole: Card[], board: Card[], opponents: number, iters: number, rng: Rng, dead: Card[] = []): number {
  if (opponents <= 0) return 1;
  const known = new Set([...hole, ...board, ...dead].map((c) => c.r * 4 + 'SHDC'.indexOf(c.s)));
  const pool: Card[] = [];
  for (const s of ['S', 'H', 'D', 'C'] as Suit[]) for (let r = 1; r <= 13; r++) if (!known.has(r * 4 + 'SHDC'.indexOf(s))) pool.push({ id: `x${r}${s}`, r, s });
  const holeN = hole.length;
  const needBoard = variant === 'draw' ? 0 : 5 - board.length;
  let score = 0;
  for (let it = 0; it < iters; it++) {
    // partial Fisher–Yates: draw just what we need
    const need = needBoard + opponents * holeN;
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(rng.next() * (pool.length - i));
      const t = pool[i];
      pool[i] = pool[j];
      pool[j] = t;
    }
    const fullBoard = needBoard ? [...board, ...pool.slice(0, needBoard)] : board;
    const mine = evaluate(variant, hole, fullBoard).score;
    let best = -1, ties = 0, beaten = false;
    for (let o = 0; o < opponents; o++) {
      const oh = pool.slice(needBoard + o * holeN, needBoard + (o + 1) * holeN);
      const v = evaluate(variant, oh, fullBoard).score;
      if (v > mine) { beaten = true; break; }
      if (v === mine) ties++;
      best = Math.max(best, v);
    }
    if (!beaten) score += ties ? 1 / (ties + 1) : 1;
  }
  return score / iters;
}
