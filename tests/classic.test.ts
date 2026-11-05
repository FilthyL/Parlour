import { describe, expect, it } from 'vitest';
import { simulate } from '../src/core/runner';
import { golf, gridScore } from '../src/games/golf';
import { cribbage, pegPoints, scoreHand } from '../src/games/cribbage';
import { ers, slappable } from '../src/games/ers';
import type { Card } from '../src/core/cards';

let k = 0;
const C = (s: string): Card => {
  const r = s.slice(0, -1), suit = s.slice(-1) as Card['s'];
  return { id: `${s}#${k++}`, r: r === 'A' ? 1 : r === 'K' ? 13 : r === 'Q' ? 12 : r === 'J' ? 11 : Number(r), s: suit };
};
const H = (...x: string[]) => x.map(C);

describe('Golf', () => {
  it('scores columns with pairs cancelling', () => {
    expect(gridScore(H('KS', '2H', '5D', 'KH', '9C', '5S'))).toBe(-2 + 9);
    expect(gridScore(H('QS', 'AH', '3D', 'JS', 'AC', '7C'))).toBe(10 + 10 + 3 + 7);
  });
  for (const n of [2, 4]) it(`${n} players play nine holes`, () => {
    const { state } = simulate(golf, n, 140 + n, { onStep: (st) => expect(st.grids.flat().length + st.stock.length + st.pile.length + (st.held ? 1 : 0)).toBe(52) });
    expect(state.hole).toBe(9);
  });
});

describe('Cribbage scoring', () => {
  it('the perfect 29', () => {
    expect(scoreHand(H('5S', '5H', '5D', 'JC'), C('5C')).total).toBe(29);
  });
  it('a double run with fifteens', () => {
    // 4-5-5-6 + 9 : runs 4-5-6 ×2 = 6, pair 2, fifteens 4+5+6=2, 4+5+6=2, 6+9=2, 5+... → 
    const r = scoreHand(H('4H', '5S', '5D', '6C'), C('9H'));
    expect(r.total).toBe(6 + 2 + 2 * 3);
  });
  it('crib flush needs five', () => {
    expect(scoreHand(H('2H', '4H', '8H', 'QH'), C('9S'), true).lines.some((l) => l.startsWith('Flush'))).toBe(false);
    expect(scoreHand(H('2H', '4H', '8H', 'QH'), C('9S')).lines).toContain('Flush 4');
  });
  it('pegging points', () => {
    expect(pegPoints(H('7S', '8H'), 15).pts).toBe(2);
    expect(pegPoints(H('4S', '4H', '4D'), 12).pts).toBe(6);
    expect(pegPoints(H('3S', '5H', '4D'), 12).pts).toBe(3);
  });
  for (const seed of [1, 2, 3]) it(`a full game to 121 (seed ${seed})`, () => {
    const { state } = simulate(cribbage, 2, seed);
    expect(Math.max(...state.scores)).toBe(121);
  });
});

describe('Egyptian Rat Screw', () => {
  it('detects doubles and sandwiches', () => {
    expect(slappable(H('7S', '7H'))).toBe('double');
    expect(slappable(H('7S', '2H', '7D'))).toBe('sandwich');
    expect(slappable(H('7S', '2H', '8D'))).toBe(null);
  });
  for (const n of [2, 4, 6]) it(`${n} players until one holds every card (or the flip cap)`, () => {
    const { state } = simulate(ers, n, 150 + n, { onStep: (st) => expect(st.piles.flat().length + st.pile.length + st.burned.length).toBe(52) });
    expect(state.phase).toBe('over');
  });
});
