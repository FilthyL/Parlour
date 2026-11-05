import { describe, expect, it } from 'vitest';
import { best5, bestOmaha } from '../src/core/util/poker';
import type { Card } from '../src/core/cards';
import { simulate } from '../src/core/runner';
import { holdem } from '../src/games/holdem';

const C = (s: string): Card => {
  const r = s.slice(0, -1), suit = s.slice(-1) as Card['s'];
  const rank = r === 'A' ? 1 : r === 'K' ? 13 : r === 'Q' ? 12 : r === 'J' ? 11 : Number(r);
  return { id: s, r: rank, s: suit };
};
const H = (...cs: string[]) => cs.map(C);

describe('hand evaluator', () => {
  it('ranks categories', () => {
    expect(best5(H('AS', 'KS', 'QS', 'JS', '10S', '2D', '3C')).name).toBe('Royal flush');
    expect(best5(H('5S', '4S', '3S', '2S', 'AS', 'KD', 'QC')).name).toBe('Straight flush, 5 high');
    expect(best5(H('9S', '9H', '9D', '9C', 'AS', 'KD', 'QC')).name).toBe('Four 9s');
    expect(best5(H('KS', 'KH', 'KD', '7C', '7S', '2D', '3C')).name).toBe('Full house, Kings over 7s');
    expect(best5(H('AH', '9H', '7H', '4H', '2H', 'KS', 'KD')).cat).toBe(5);
    expect(best5(H('AH', '2D', '3C', '4S', '5H', 'KS', 'KD')).name).toBe('Straight, 5 high');
    expect(best5(H('QS', 'QH', 'QD', '7C', '6S', '2D', '3C')).cat).toBe(3);
    expect(best5(H('JS', 'JH', '4D', '4C', 'AS', '2D', '3C')).name).toBe('Two pair, Jacks and 4s');
    expect(best5(H('6S', '6H', 'AD', 'KC', '9S', '2D', '3C')).name).toBe('Pair of Sixes');
    expect(best5(H('AS', 'JH', '9D', '7C', '5S', '3D', '2C')).name).toBe('Ace high');
  });
  it('compares kickers and two trips', () => {
    const a = best5(H('AS', 'AD', 'KC', '9S', '7D', '3C', '2H'));
    const b = best5(H('AH', 'AC', 'QC', '9H', '7S', '3D', '2D'));
    expect(a.score).toBeGreaterThan(b.score);
    expect(best5(H('8S', '8H', '8D', '5C', '5S', '5D', 'AC')).name).toBe('Full house, 8s over 5s');
  });
  it('omaha must use exactly two hole cards', () => {
    // four spades on board, one spade in hand → no flush in Omaha
    const v = bestOmaha(H('AS', 'KD', 'QC', 'JH'), H('2S', '5S', '8S', '9S', 'KH'));
    expect(v.cat).toBeLessThan(5);
  });
});

describe("Texas Hold'em", () => {
  for (const n of [2, 3, 6, 9]) {
    it(`plays a full ${n}-player game to a winner, conserving chips`, () => {
      const { state, steps } = simulate(holdem, n, 1000 + n, { level: 'easy' });
      const total = state.players.reduce((a: number, p: any) => a + p.chips, 0);
      expect(total).toBe(1000 * n);
      expect(state.players.filter((p: any) => p.chips > 0).length).toBe(1);
      expect(steps).toBeGreaterThan(10);
    });
  }
  it('never shows hidden hole cards to another seat', () => {
    let checked = 0;
    simulate(holdem, 5, 77, {
      level: 'easy',
      onStep: (st) => {
        for (let v = 0; v < 5; v++) {
          const view = holdem.view(st, v);
          for (const z of view.zones) {
            if (!z.id.startsWith('h') || z.id === 'h' + v) continue;
            const seat = Number(z.id.slice(1));
            if (st.shown[seat]) continue;
            for (const c of z.cards) expect(c.f).toBeUndefined();
            checked++;
          }
          for (const id of ['deck', 'muck']) for (const c of view.zones.find((z) => z.id === id)!.cards) expect(c.f).toBeUndefined();
        }
      },
    });
    expect(checked).toBeGreaterThan(100);
  });
});

import { omaha } from '../src/games/omaha';
import { draw } from '../src/games/draw';
describe('Omaha and Five Card Draw', () => {
  for (const [def, n] of [[omaha, 2], [omaha, 6], [draw, 2], [draw, 5]] as const) {
    it(`${def.meta.id}: ${n}-player game finishes and conserves chips`, () => {
      const { state } = simulate(def, n, 4242 + n, { level: 'easy' });
      expect(state.players.reduce((a: number, p: any) => a + p.chips, 0)).toBe(1000 * n);
      expect(state.players.filter((p: any) => p.chips > 0).length).toBe(1);
    });
  }
  it('draw: hand size stays five through the draw', () => {
    simulate(draw, 4, 9, { level: 'easy', onStep: (st) => st.hole.forEach((h: any[], i: number) => { if (!st.folded[i] && !st.players[i].out) expect(h.length).toBe(5); }) });
  });
});
