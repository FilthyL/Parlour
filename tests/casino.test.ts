import { describe, expect, it } from 'vitest';
import { simulate } from '../src/core/runner';
import { blackjack, total } from '../src/games/blackjack';
import { baccarat, bacTotal, bankerDraws } from '../src/games/baccarat';
import type { Card } from '../src/core/cards';

const C = (r: number, s: Card['s'] = 'S'): Card => ({ id: `${r}${s}${Math.random()}`, r, s });

describe('Blackjack', () => {
  it('totals soft and hard hands', () => {
    expect(total([C(1), C(6)])).toEqual({ t: 17, soft: true });
    expect(total([C(1), C(6), C(10)])).toEqual({ t: 17, soft: false });
    expect(total([C(1), C(1), C(9)]).t).toBe(21);
    expect(total([C(13), C(12), C(2)]).t).toBe(22);
  });
  for (const n of [1, 4, 7]) it(`${n} players, 80 rounds, cards conserved`, () => {
    const { state } = simulate(blackjack, n, 300 + n, {
      options: { rounds: 80 },
      onStep: (st) => {
        const onTable = st.dealer.length + st.players.reduce((a: number, p: any) => a + p.hands.reduce((b: number, h: any) => b + h.cards.length, 0), 0);
        expect(st.shoe.length + st.discard.length + onTable).toBe(312);
        if (st.phase === 'dealer' || st.phase === 'settle') expect(st.holeShown).toBe(true);
      },
    });
    expect(state.round).toBe(81);
  });
});

describe('Baccarat', () => {
  it('follows the third-card tableau', () => {
    expect(bankerDraws(5, null)).toBe(true);
    expect(bankerDraws(6, null)).toBe(false);
    expect(bankerDraws(3, C(8))).toBe(false);
    expect(bankerDraws(3, C(9))).toBe(true);
    expect(bankerDraws(4, C(1))).toBe(false);
    expect(bankerDraws(4, C(2))).toBe(true);
    expect(bankerDraws(5, C(4))).toBe(true);
    expect(bankerDraws(5, C(3))).toBe(false);
    expect(bankerDraws(6, C(6))).toBe(true);
    expect(bankerDraws(6, C(5))).toBe(false);
    expect(bankerDraws(7, C(6))).toBe(false);
    expect(bacTotal([C(7), C(8)])).toBe(5);
    expect(bacTotal([C(13), C(9)])).toBe(9);
  });
  it('200 coups run and hand sizes stay legal', () => {
    simulate(baccarat, 5, 777, {
      options: { rounds: 200 },
      onStep: (st) => {
        expect(st.ph.length).toBeLessThanOrEqual(3);
        expect(st.bh.length).toBeLessThanOrEqual(3);
        if (st.phase === 'settle' && st.ph.length === 3) expect(bacTotal(st.ph.slice(0, 2))).toBeLessThanOrEqual(5);
      },
    });
  });
});
