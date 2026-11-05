/** Meld finding for rummy games: sets, runs, best arrangement, lay-offs. */
import type { Card } from '../cards';

/** Deadwood / penalty value: ace 1, pips face value, courts 10. */
export const pipValue = (c: Card) => Math.min(10, c.r);

export function isSet(cards: Card[]) {
  return cards.length >= 3 && cards.length <= 4 && cards.every((c) => c.r === cards[0].r) && new Set(cards.map((c) => c.s)).size === cards.length;
}

/** Ace is low only (A-2-3 is a run, Q-K-A is not). */
export function isRun(cards: Card[]) {
  if (cards.length < 3 || !cards.every((c) => c.s === cards[0].s)) return false;
  const r = cards.map((c) => c.r).sort((a, b) => a - b);
  for (let i = 1; i < r.length; i++) if (r[i] !== r[i - 1] + 1) return false;
  return true;
}

export const isMeld = (cards: Card[]) => isSet(cards) || isRun(cards);

/** Every candidate meld inside a hand. */
export function candidates(hand: Card[]): Card[][] {
  const out: Card[][] = [];
  const byRank = new Map<number, Card[]>();
  for (const c of hand) byRank.set(c.r, [...(byRank.get(c.r) ?? []), c]);
  for (const g of byRank.values()) {
    if (g.length >= 3) {
      out.push(g.slice(0, 4));
      if (g.length === 4) for (let skip = 0; skip < 4; skip++) out.push(g.filter((_, i) => i !== skip));
    }
  }
  for (const s of ['S', 'H', 'D', 'C']) {
    const cs = hand.filter((c) => c.s === s).sort((a, b) => a.r - b.r);
    for (let i = 0; i < cs.length; i++) {
      for (let j = i + 2; j < cs.length; j++) {
        const run = cs.slice(i, j + 1);
        if (isRun(run)) out.push(run);
        else break;
      }
    }
  }
  return out;
}

export interface Arrangement {
  melds: Card[][];
  deadwood: Card[];
  dw: number;
}

/** The arrangement with the least deadwood (exact search; hands are small). */
export function bestMelds(hand: Card[]): Arrangement {
  const cands = candidates(hand);
  let best: Arrangement = { melds: [], deadwood: hand, dw: hand.reduce((a, c) => a + pipValue(c), 0) };
  const used = new Set<string>();
  const chosen: Card[][] = [];
  const rec = (start: number) => {
    const dead = hand.filter((c) => !used.has(c.id));
    const dw = dead.reduce((a, c) => a + pipValue(c), 0);
    if (dw < best.dw || (dw === best.dw && chosen.length > best.melds.length)) best = { melds: chosen.map((m) => [...m]), deadwood: dead, dw };
    for (let i = start; i < cands.length; i++) {
      const m = cands[i];
      if (m.some((c) => used.has(c.id))) continue;
      m.forEach((c) => used.add(c.id));
      chosen.push(m);
      rec(i + 1);
      chosen.pop();
      m.forEach((c) => used.delete(c.id));
    }
  };
  rec(0);
  return best;
}

/** Can `card` extend `meld` (a set or a run)? */
export function canLayOff(meld: Card[], card: Card) {
  return isMeld([...meld, card]);
}

/**
 * Lay off as many deadwood cards as possible onto melds, repeatedly (a laid
 * card can make room for the next one, e.g. 8 then 9 on a 5-6-7 run).
 */
export function layOffAll(melds: Card[][], deadwood: Card[]): { laid: Card[]; rest: Card[]; melds: Card[][] } {
  const ms = melds.map((m) => [...m]);
  let rest = [...deadwood];
  const laid: Card[] = [];
  let progress = true;
  while (progress) {
    progress = false;
    for (const c of [...rest]) {
      const m = ms.find((x) => canLayOff(x, c));
      if (m) {
        m.push(c);
        laid.push(c);
        rest = rest.filter((x) => x !== c);
        progress = true;
      }
    }
  }
  return { laid, rest, melds: ms };
}

/** Sort a hand so melds sit together, deadwood after, for display. */
export function arrangeForView(hand: Card[]): Card[] {
  const a = bestMelds(hand);
  const meldCards = a.melds.flatMap((m) => [...m].sort((x, y) => x.r - y.r));
  const dead = [...a.deadwood].sort((x, y) => x.s.localeCompare(y.s) || x.r - y.r);
  return [...meldCards, ...dead];
}
