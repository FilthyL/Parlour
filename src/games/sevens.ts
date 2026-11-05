/**
 * Sevens (Fan Tan): build each suit out from its seven, up to the king and
 * down to the ace. If you can't play, you knock. First out wins the round.
 */
import { code, newDeck, type Card, type Suit } from '../core/cards';
import type { Action, Ctx, GameDef, Seat, View, Zone } from '../core/types';
import { base, fx, handZone, humans, log, type Base } from './shared';
import { SUIT_GLYPH } from './tricks/common';

interface S extends Base {
  hands: Card[][];
  rows: Record<Suit, Card[]>;
  phase: 'play' | 'roundEnd' | 'over';
  turn: Seat;
  scores: number[];
  target: number;
  round: number;
  says: (string | undefined)[];
  result: string;
  lines: string[];
}

const SUITS: Suit[] = ['S', 'H', 'D', 'C'];

function bounds(row: Card[]) {
  if (!row.length) return null;
  const rs = row.map((c) => c.r);
  return { lo: Math.min(...rs), hi: Math.max(...rs) };
}

function playable(s: S, c: Card) {
  const b = bounds(s.rows[c.s]);
  if (!b) return c.r === 7;
  return c.r === b.lo - 1 || c.r === b.hi + 1;
}

function legal(s: S, seat: Seat): Card[] {
  const h = s.hands[seat];
  const first = SUITS.every((x) => !s.rows[x].length);
  if (first) return h.filter((c) => c.r === 7 && c.s === 'D');
  return h.filter((c) => playable(s, c));
}

function startRound(s: S, ctx: Ctx) {
  s.round++;
  const deck = newDeck(ctx.rng);
  s.hands = s.names.map(() => []);
  let i = ctx.rng.int(s.n);
  while (deck.length) s.hands[i++ % s.n].push(deck.pop()!);
  s.rows = { S: [], H: [], D: [], C: [] };
  s.says = s.names.map(() => undefined);
  s.turn = s.hands.findIndex((h) => h.some((c) => c.r === 7 && c.s === 'D'));
  s.phase = 'play';
  s.deal++;
  fx(s, 'shuffle');
  log(s, `Round ${s.round}: ${s.names[s.turn]} holds the 7 of diamonds`);
}

function act(s: S, seat: Seat, a: Action, ctx: Ctx): string | void {
  if (s.phase === 'roundEnd') return a.t === 'next' ? void startRound(s, ctx) : 'Hold on';
  if (s.phase === 'over') {
    if (a.t !== 'rematch') return 'The game is over';
    s.scores = s.scores.map(() => 0);
    s.round = 0;
    return void startRound(s, ctx);
  }
  if (seat !== s.turn) return "It isn't your turn";
  const ok = legal(s, seat);
  if (a.t === 'knock') {
    if (ok.length) return 'You have a card you can play';
    s.says[seat] = 'Knock';
    fx(s, 'check');
    s.turn = (seat + 1) % s.n;
    return;
  }
  const card = s.hands[seat].find((c) => c.id === a.card);
  if (a.t !== 'play' || !card) return 'Play a card or knock';
  if (!ok.includes(card)) return SUITS.every((x) => !s.rows[x].length) ? 'The 7 of diamonds starts' : 'Play a 7, or the next card up or down a row';
  s.hands[seat] = s.hands[seat].filter((c) => c !== card);
  s.rows[card.s].push(card);
  s.says[seat] = undefined;
  fx(s, 'chips');
  if (!s.hands[seat].length) {
    s.lines = s.names.map((nm, i) => {
      const left = s.hands[i].length;
      s.scores[i] += left;
      return `${nm}: ${left ? `+${left}` : 'out first'} (${s.scores[i]})`;
    });
    s.result = `${s.names[seat]} goes out first`;
    fx(s, 'win');
    if (Math.max(...s.scores) >= s.target) {
      const low = Math.min(...s.scores);
      s.result = `${s.names.filter((_, i) => s.scores[i] === low).join(' & ')} win${s.scores.filter((v) => v === low).length > 1 ? '' : 's'} with ${low}`;
      s.phase = 'over';
    } else s.phase = 'roundEnd';
    return;
  }
  s.turn = (seat + 1) % s.n;
}

function cpu(s: S, seat: Seat, ctx: Ctx): Action | null {
  if (s.phase !== 'play' || s.turn !== seat) return null;
  const ok = legal(s, seat);
  if (!ok.length) return { t: 'knock' };
  if (ctx.level === 'easy') return { t: 'play', card: ctx.rng.pick(ok).id };
  const hand = s.hands[seat];
  // prefer cards that open the way to more of our own cards; avoid opening
  // suits we hold nothing further in (that only helps opponents)
  const value = (c: Card) => {
    const beyond = c.r === 7 ? hand.filter((x) => x.s === c.s && x !== c).length : c.r > 7 ? hand.filter((x) => x.s === c.s && x.r > c.r).length : hand.filter((x) => x.s === c.s && x.r < c.r).length;
    const end = c.r === 1 || c.r === 13 ? 0.5 : 0;
    return beyond * 2 + end - (beyond === 0 ? 1 : 0);
  };
  return { t: 'play', card: [...ok].sort((a, b) => value(b) - value(a))[0].id };
}

function view(s: S, viewer: Seat): View {
  const myTurn = s.phase === 'play' && s.turn === viewer;
  const ok = myTurn ? legal(s, viewer) : [];
  const zones: Zone[] = s.names.map((_, i) =>
    handZone(i, viewer, s.hands[i], { act: myTurn && i === viewer ? (c) => (ok.includes(c) ? { t: 'play', card: c.id } : undefined) : undefined, dim: myTurn && i === viewer ? (c) => !ok.includes(c) : undefined, reveal: s.phase !== 'play', aceHigh: false }),
  );
  SUITS.forEach((suit, k) => {
    zones.push({
      id: 'row' + suit,
      at: { x: 0, y: -0.42 + k * 0.24, p: [0, -0.46 + k * 0.22] },
      lay: 'row',
      gap: 0.52,
      scale: 0.5,
      slots: 13,
      center: 6,
      deck: k === 0,
      label: s.rows[suit].length ? undefined : `${SUIT_GLYPH[suit]} opens with its 7`,
      cards: [...s.rows[suit]].sort((a, b) => a.r - b.r).map((c) => ({ id: c.id, f: code(c), pos: c.r - 1 })),
    });
  });
  const buttons: View['buttons'] = [];
  if (myTurn && !ok.length) buttons.push({ label: 'Knock (pass)', a: { t: 'knock' }, kind: 'primary', key: 'k' });
  if (s.phase === 'roundEnd' && !s.cpu[viewer]) buttons.push({ label: 'Next round', a: { t: 'next' }, kind: 'primary', key: 'n' });
  if (s.phase === 'over' && !s.cpu[viewer]) buttons.push({ label: 'Play again', a: { t: 'rematch' }, kind: 'primary' });
  return {
    game: 'sevens',
    viewer,
    seats: s.names.map((name, i) => ({ name, cpu: s.cpu[i], score: `${s.scores[i]} pts`, sub: `${s.hands[i].length} cards`, say: s.says[i], active: s.phase === 'play' && s.turn === i, win: s.phase !== 'play' && s.result.includes(name) })),
    zones,
    buttons,
    prompt: myTurn ? (ok.length ? 'Play a 7 or extend a row up or down' : 'Nothing fits: knock') : s.phase === 'play' ? `${s.names[s.turn]} to play` : undefined,
    status: `Round ${s.round} · penalty points, lowest wins · game ends at ${s.target}`,
    banner: s.phase !== 'play' ? { title: s.result, lines: s.lines, tone: s.result.includes(s.names[viewer]) ? 'win' : 'info' } : undefined,
    log: s.log.slice(-30),
    deal: s.deal,
    fx: s.fx,
    over: s.phase === 'over',
  };
}

export const sevens: GameDef<S> = {
  meta: {
    id: 'sevens',
    name: 'Sevens',
    family: 'Shedding',
    players: { min: 3, max: 8, def: 4 },
    blurb: 'Build the four suits out from the sevens, and block your rivals when you can.',
    hero: ['7S', '7H', '7D', '7C', '8D'],
    length: '15–25 min',
    options: [{ id: 'target', label: 'Game ends at', type: 'select', default: 30, choices: [{ value: 20, label: '20 points' }, { value: 30, label: '30 points' }, { value: 50, label: '50 points' }] }],
    rules: [
      ['Deal', 'All the cards are dealt (some players may have one more). Whoever holds the 7 of diamonds plays it first.'],
      ['Building', 'On your turn, play a 7 to start a new suit row, or the next card up (8, 9 … K) or down (6, 5 … A) on a row already started.'],
      ['Knocking', 'If you have a card that fits you must play it. Otherwise you knock and the turn passes.'],
      ['Scoring', 'The first player out ends the round. Everyone else scores a penalty point for each card left. When someone reaches the target, the lowest total wins.'],
    ],
  },
  create: (players, ctx, options) => {
    const s: S = { ...base(players), hands: [], rows: { S: [], H: [], D: [], C: [] }, phase: 'play', turn: 0, scores: players.map(() => 0), target: Number(options.target ?? 30), round: 0, says: [], result: '', lines: [] };
    startRound(s, ctx);
    return s;
  },
  toAct: (s) => (s.phase === 'play' ? [s.turn] : humans(s)),
  act,
  auto: (s) => (s.phase === 'roundEnd' && s.cpu.every(Boolean) ? 10 : null),
  step: (s, ctx) => startRound(s, ctx),
  cpu,
  view,
  over: (s) => s.phase === 'over',
};
