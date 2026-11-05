/**
 * Six-card Golf: a 2×3 grid of face-down cards, swap toward the lowest
 * total, pairs in a column cancel. Nine holes, lowest score wins.
 */
import { code, newDeck, type Card } from '../core/cards';
import type { Action, Ctx, GameDef, Seat, View, Zone } from '../core/types';
import { base, fx, humans, log, stackZone, type Base } from './shared';

interface S extends Base {
  grids: (Card | null)[][]; // six per player, index = row*3 + col
  up: boolean[][];
  stock: Card[];
  pile: Card[];
  held: Card | null;
  heldFrom: 'stock' | 'discard' | null;
  phase: 'reveal' | 'draw' | 'place' | 'holeEnd' | 'over';
  turn: Seat;
  dealer: Seat;
  revealed: number[];
  closer: Seat; // player who turned their last card
  lastTurns: number;
  hole: number;
  holes: number;
  turns: number;
  scores: number[];
  holeScores: number[];
  result: string;
  lines: string[];
}

const cardVal = (c: Card) => (c.r === 2 ? -2 : c.r === 13 ? 0 : c.r >= 11 ? 10 : c.r);
export function gridScore(grid: (Card | null)[]) {
  let t = 0;
  for (let col = 0; col < 3; col++) {
    const a = grid[col]!, b = grid[col + 3]!;
    if (a.r === b.r) continue; // a pair in a column cancels
    t += cardVal(a) + cardVal(b);
  }
  return t;
}

function startHole(s: S, ctx: Ctx) {
  s.hole++;
  s.dealer = (s.dealer + 1) % s.n;
  const deck = newDeck(ctx.rng);
  s.grids = s.names.map(() => [0, 1, 2, 3, 4, 5].map(() => deck.pop()!));
  s.up = s.names.map(() => [false, false, false, false, false, false]);
  s.pile = [deck.pop()!];
  s.stock = deck;
  s.held = null;
  s.heldFrom = null;
  s.revealed = s.names.map(() => 0);
  s.closer = -1;
  s.lastTurns = 0;
  s.turns = 0;
  s.phase = 'reveal';
  s.turn = (s.dealer + 1) % s.n;
  s.deal++;
  fx(s, 'shuffle');
  log(s, `Hole ${s.hole}`);
}

function endTurn(s: S, seat: Seat) {
  s.turns++;
  if (s.turns >= s.n * 25) return endHole(s); // safety net: every hole ends
  if (s.closer < 0 && s.up[seat].every(Boolean)) {
    s.closer = seat;
    s.lastTurns = s.n - 1;
    log(s, `${s.names[seat]} has turned every card: one more turn each`);
  } else if (s.closer >= 0) s.lastTurns--;
  if (s.closer >= 0 && s.lastTurns <= 0) return endHole(s);
  s.turn = (seat + 1) % s.n;
  s.phase = 'draw';
}

function endHole(s: S) {
  s.up = s.up.map((u) => u.map(() => true));
  s.holeScores = s.grids.map((g) => gridScore(g));
  s.lines = s.names.map((nm, i) => {
    s.scores[i] += s.holeScores[i];
    return `${nm}: ${s.holeScores[i] >= 0 ? '+' : ''}${s.holeScores[i]} (${s.scores[i]})`;
  });
  const low = Math.min(...s.holeScores);
  s.result = `Hole ${s.hole}: ${s.names.filter((_, i) => s.holeScores[i] === low).join(' & ')} low with ${low}`;
  fx(s, 'win');
  if (s.hole >= s.holes) {
    const best = Math.min(...s.scores);
    s.result = `${s.names.filter((_, i) => s.scores[i] === best).join(' & ')} win${s.scores.filter((v) => v === best).length > 1 ? '' : 's'} with ${best}`;
    s.phase = 'over';
  } else s.phase = 'holeEnd';
}

function act(s: S, seat: Seat, a: Action, ctx: Ctx): string | void {
  if (s.phase === 'holeEnd') return a.t === 'next' ? void startHole(s, ctx) : 'Hold on';
  if (s.phase === 'over') {
    if (a.t !== 'rematch') return 'The game is over';
    s.scores = s.scores.map(() => 0);
    s.hole = 0;
    return void startHole(s, ctx);
  }
  if (s.phase === 'reveal') {
    const i = Number(a.idx);
    if (a.t !== 'flip' || !(i >= 0 && i < 6)) return 'Turn up two of your cards';
    if (s.revealed[seat] >= 2) return 'Waiting for the others';
    if (s.up[seat][i]) return 'That card is already up';
    s.up[seat][i] = true;
    s.revealed[seat]++;
    fx(s, 'flip');
    if (s.revealed.every((r) => r >= 2)) s.phase = 'draw';
    return;
  }
  if (seat !== s.turn) return "It isn't your turn";
  if (s.phase === 'draw') {
    if (a.t !== 'draw') return 'Draw from the stock or the discard pile';
    if (a.from === 'discard') {
      s.held = s.pile.pop()!;
      s.heldFrom = 'discard';
    } else {
      if (!s.stock.length) {
        const top = s.pile.pop()!;
        s.stock = ctx.rng.shuffle(s.pile.splice(0));
        s.pile = [top];
      }
      s.held = s.stock.pop()!;
      s.heldFrom = 'stock';
    }
    fx(s, 'draw');
    s.phase = 'place';
    return;
  }
  if (s.phase !== 'place' || !s.held) return 'Draw first';
  if (a.t === 'discard') {
    if (s.heldFrom === 'discard') return 'A card taken from the discard pile must be swapped in';
    s.pile.push(s.held);
    s.held = null;
    fx(s, 'fold');
    return endTurn(s, seat);
  }
  const i = Number(a.idx);
  if (a.t !== 'swap' || !(i >= 0 && i < 6)) return 'Swap with one of your cards, or discard';
  const out = s.grids[seat][i]!;
  s.grids[seat][i] = s.held;
  s.up[seat][i] = true;
  s.pile.push(out);
  s.held = null;
  fx(s, 'chips');
  endTurn(s, seat);
}

// ---------------------------------------------------------------- CPU
function cpu(s: S, seat: Seat, ctx: Ctx): Action | null {
  const grid = s.grids[seat], up = s.up[seat];
  if (s.phase === 'reveal') {
    if (s.revealed[seat] >= 2) return null;
    const down = [0, 1, 2, 3, 4, 5].filter((i) => !up[i]);
    return { t: 'flip', idx: ctx.rng.pick(down) };
  }
  if (s.turn !== seat) return null;
  // value of putting card c at slot i (lower is better)
  const after = (c: Card, i: number) => {
    const g = [...grid];
    g[i] = c;
    const known = g.map((x, k) => (k === i || up[k] ? x : null));
    let t = 0;
    for (let col = 0; col < 3; col++) {
      const a = known[col], b = known[col + 3];
      if (a && b) t += a.r === b.r ? 0 : cardVal(a) + cardVal(b);
      else t += (a ? cardVal(a) : 4.5) + (b ? cardVal(b) : 4.5);
    }
    return t;
  };
  const bestSlot = (c: Card) => {
    let best = -1, bv = Infinity;
    for (let i = 0; i < 6; i++) {
      const v = after(c, i);
      if (v < bv) { bv = v; best = i; }
    }
    return { i: best, v: bv };
  };
  const base = (() => {
    let t = 0;
    for (let col = 0; col < 3; col++) {
      const a = up[col] ? grid[col] : null, b = up[col + 3] ? grid[col + 3] : null;
      if (a && b) t += a.r === b.r ? 0 : cardVal(a) + cardVal(b);
      else t += (a ? cardVal(a) : 4.5) + (b ? cardVal(b) : 4.5);
    }
    return t;
  })();
  if (s.phase === 'draw') {
    const top = s.pile[s.pile.length - 1];
    if (top && bestSlot(top).v < base - 2.5) return { t: 'draw', from: 'discard' };
    return { t: 'draw', from: 'stock' };
  }
  if (s.phase === 'place' && s.held) {
    const b = bestSlot(s.held);
    // don't close out with a bad hand unless forced
    const closing = up.filter(Boolean).length === 5 && !up[b.i];
    if (s.heldFrom === 'discard' || b.v < base - 0.5) {
      // a hard CPU won't close out early with a poor hand (but every hole must end)
      if (closing && s.heldFrom === 'stock' && b.v > 10 && s.closer < 0 && ctx.level === 'hard' && s.turns < s.n * 6) return { t: 'discard' };
      return { t: 'swap', idx: b.i };
    }
    return { t: 'discard' };
  }
  return null;
}

// ---------------------------------------------------------------- view
function view(s: S, viewer: Seat): View {
  const myTurn = s.turn === viewer && (s.phase === 'draw' || s.phase === 'place');
  const revealing = s.phase === 'reveal' && s.revealed[viewer] < 2 && !s.cpu[viewer];
  const zones: Zone[] = s.names.map((_, i) => ({
    id: 'grid' + i,
    at: { seat: i, slot: i === viewer ? 'front' : 'hand' },
    lay: 'grid',
    cols: 3,
    gap: 1.05,
    scale: i === viewer ? 0.78 : 0.95,
    label: s.phase === 'holeEnd' || s.phase === 'over' ? `${s.holeScores[i]} this hole` : undefined,
    cards: s.grids[i].map((c, k) => ({
      id: c!.id,
      f: s.up[i][k] ? code(c!) : undefined,
      act: i === viewer && ((revealing && !s.up[i][k]) || (myTurn && s.phase === 'place')) ? (revealing ? { t: 'flip', idx: k } : { t: 'swap', idx: k }) : undefined,
    })),
  }));
  zones.push(stackZone('stock', s.stock, { x: -0.18, y: -0.08, p: [-0.24, -0.08] }, { deck: true, label: String(s.stock.length), act: myTurn && s.phase === 'draw' ? { t: 'draw', from: 'stock' } : undefined }));
  zones.push(stackZone('pile', s.pile, { x: 0.18, y: -0.08, p: [0.24, -0.08] }, { faceUp: true, act: myTurn && s.phase === 'draw' && s.pile.length ? { t: 'draw', from: 'discard' } : undefined }));
  if (s.held) zones.push({ id: 'held', at: { x: 0, y: -0.36, p: [0, -0.34] }, lay: 'row', label: `${s.names[s.turn]} holds`, cards: [{ id: s.held.id, f: code(s.held), hi: true }] });
  const buttons: View['buttons'] = [];
  let prompt: string | undefined;
  if (revealing) prompt = `Turn up ${2 - s.revealed[viewer]} of your cards`;
  else if (s.phase === 'reveal') prompt = 'Everyone is turning up two cards…';
  else if (myTurn && s.phase === 'draw') {
    buttons.push({ label: 'Draw from stock', a: { t: 'draw', from: 'stock' }, kind: 'primary', key: 'd' });
    if (s.pile.length) buttons.push({ label: `Take ${code(s.pile[s.pile.length - 1])}`, a: { t: 'draw', from: 'discard' } });
    prompt = 'Draw a card';
  } else if (myTurn && s.phase === 'place') {
    if (s.heldFrom === 'stock') buttons.push({ label: 'Discard it', a: { t: 'discard' }, kind: 'ghost', key: 'x' });
    prompt = 'Tap one of your six cards to swap it out';
  } else if (s.phase === 'draw' || s.phase === 'place') prompt = `${s.names[s.turn]}'s turn${s.closer >= 0 ? ' (last turns!)' : ''}`;
  if (s.phase === 'holeEnd' && !s.cpu[viewer]) buttons.push({ label: 'Next hole', a: { t: 'next' }, kind: 'primary', key: 'n' });
  if (s.phase === 'over' && !s.cpu[viewer]) buttons.push({ label: 'Play again', a: { t: 'rematch' }, kind: 'primary' });
  return {
    game: 'golf',
    viewer,
    seats: s.names.map((name, i) => ({ name, cpu: s.cpu[i], score: `${s.scores[i]} total`, badges: i === s.dealer ? ['D'] : [], active: (s.turn === i && (s.phase === 'draw' || s.phase === 'place')) || (s.phase === 'reveal' && s.revealed[i] < 2), win: s.phase === 'over' && s.scores[i] === Math.min(...s.scores) })),
    zones,
    buttons,
    prompt,
    status: `Hole ${s.hole} of ${s.holes} · kings 0, twos −2, column pairs cancel`,
    banner: s.phase === 'holeEnd' || s.phase === 'over' ? { title: s.result, lines: s.lines, tone: s.phase === 'over' && s.scores[viewer] === Math.min(...s.scores) ? 'win' : 'info' } : undefined,
    log: s.log.slice(-30),
    deal: s.deal,
    fx: s.fx,
    over: s.phase === 'over',
  };
}

export const golf: GameDef<S> = {
  meta: {
    id: 'golf',
    name: 'Golf',
    family: 'Classic',
    players: { min: 2, max: 4, def: 3 },
    blurb: 'Six cards in a grid, nine holes, and the lowest score takes the trophy.',
    hero: ['KS', '2H', '2D', 'AS', 'KC'],
    length: '15–25 min',
    options: [{ id: 'holes', label: 'Holes', type: 'select', default: 9, choices: [{ value: 3, label: '3 holes' }, { value: 9, label: '9 holes' }, { value: 18, label: '18 holes' }] }],
    rules: [
      ['Setup', 'Each player gets six cards face down in two rows of three, and turns up any two. The next card starts the discard pile.'],
      ['Your turn', 'Draw the top card of the stock or the discard pile. Swap it with one of your six cards (face up), sending that card to the discards, or, if it came from the stock, discard it.'],
      ['Ending a hole', 'When one player has all six cards face up, everyone else takes one more turn and the hole is scored.'],
      ['Scoring', 'Aces 1, 2s minus 2, 3–10 face value, jacks and queens 10, kings 0. Two cards of the same rank in a column score 0.'],
      ['Winning', 'After nine holes, the lowest total wins.'],
    ],
  },
  create: (players, ctx, options) => {
    const s: S = { ...base(players), grids: [], up: [], stock: [], pile: [], held: null, heldFrom: null, phase: 'reveal', turn: 0, dealer: ctx.rng.int(players.length), revealed: [], closer: -1, lastTurns: 0, turns: 0, hole: 0, holes: Number(options.holes ?? 9), scores: players.map(() => 0), holeScores: players.map(() => 0), result: '', lines: [] };
    startHole(s, ctx);
    return s;
  },
  toAct: (s) => (s.phase === 'reveal' ? s.revealed.map((r, i) => (r < 2 ? i : -1)).filter((i) => i >= 0) : s.phase === 'draw' || s.phase === 'place' ? [s.turn] : humans(s)),
  act,
  auto: (s) => (s.phase === 'holeEnd' && s.cpu.every(Boolean) ? 10 : null),
  step: (s, ctx) => startHole(s, ctx),
  cpu,
  view,
  over: (s) => s.phase === 'over',
};
