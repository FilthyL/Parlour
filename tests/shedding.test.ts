import { describe, expect, it } from 'vitest';
import { simulate } from '../src/core/runner';
import { president } from '../src/games/president';
import { cheat } from '../src/games/cheat';
import { sevens } from '../src/games/sevens';

describe('President', () => {
  for (const n of [4, 5, 7]) it(`${n} players play five rounds`, () => {
    const { state } = simulate(president, n, 110 + n, { onStep: (st) => expect(st.hands.flat().length + st.pile.length + (st.phase === 'play' || st.phase === 'clear' ? 0 : 0)).toBeLessThanOrEqual(52) });
    expect(state.round).toBe(5);
    expect(state.scores.reduce((a: number, b: number) => a + b, 0)).toBe(5 * (n * (n - 1)) / 2);
  });
});

describe('Cheat', () => {
  for (const n of [3, 5, 8]) it(`${n} players until someone is out`, () => {
    const { state } = simulate(cheat, n, 120 + n, { onStep: (st) => expect(st.hands.flat().length + st.pile.length).toBe(52) });
    expect(state.hands[state.winner].length).toBe(0);
  });
});

describe('Sevens', () => {
  for (const n of [3, 6, 8]) it(`${n} players reach the target`, () => {
    const { state } = simulate(sevens, n, 130 + n, {
      onStep: (st) => {
        const rows = Object.values(st.rows) as any[][];
        expect(st.hands.flat().length + rows.flat().length).toBe(52);
        for (const r of rows) if (r.length) { const rs = r.map((c: any) => c.r).sort((a: number, b: number) => a - b); expect(rs[rs.length - 1] - rs[0] + 1).toBe(rs.length); expect(rs).toContain(7); }
      },
    });
    expect(Math.max(...state.scores)).toBeGreaterThanOrEqual(30);
  });
});
