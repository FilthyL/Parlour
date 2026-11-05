import { code, hi, newDeck, type Card } from '../core/cards';
import type { Action, Ctx, GameDef, Seat, View, Zone } from '../core/types';
import { baseView, chooseCard, dealRound, followable, fx, log, SUIT_GLYPH, SUIT_WORD, trickWinner, trickZones, type TrickBase } from './tricks/common';

interface S extends TrickBase {
  phase: 'bid' | 'play' | 'collect' | 'roundEnd' | 'over';
  round: number;
  sizes: number[];
  bids: (number | null)[];
  upcard: Card | null;
  stock: Card[];
  scores: number[];
  result: string;
  lines: string[];
}

const size = (s: S) => s.sizes[s.round - 1];

function startRound(s: S, ctx: Ctx) {
  s.round++;
  s.dealer = (s.dealer + 1) % s.n;
  const deck = newDeck(ctx.rng);
  s.hands = dealRound(deck, s.n, s.dealer, size(s));
  s.upcard = deck.length ? deck.pop()! : null;
  s.stock = deck;
  s.trump = s.upcard ? s.upcard.s : null;
  s.won = s.hands.map(() => []);
  s.tricks = s.hands.map(() => 0);
  s.bids = s.hands.map(() => null);
  s.trick = [];
  s.collecting = null;
  s.phase = 'bid';
  s.turn = (s.dealer + 1) % s.n;
  s.deal++;
  fx(s, 'shuffle');
  log(s, `Round ${s.round}: ${size(s)} card${size(s) > 1 ? 's' : ''} each, trump ${s.trump ? SUIT_WORD[s.trump] : 'none'}`);
}

/** The dealer may not bid the number that makes the total equal the tricks available. */
function forbidden(s: S, seat: Seat): number | null {
  if (seat !== s.dealer) return null;
  const sum = s.bids.reduce<number>((a, b) => a + (b ?? 0), 0);
  const f = size(s) - sum;
  return f >= 0 ? f : null;
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
  if (s.phase === 'bid') {
    const b = Number(a.bid);
    if (a.t !== 'bid' || !Number.isInteger(b) || b < 0 || b > size(s)) return `Bid from 0 to ${size(s)}`;
    if (forbidden(s, seat) === b) return `As dealer you can't bid ${b}: the bids would add up exactly`;
    s.bids[seat] = b;
    log(s, `${s.names[seat]} bids ${b}`);
    fx(s, 'check');
    if (s.bids.every((x) => x !== null)) {
      s.phase = 'play';
      s.leader = s.turn = (s.dealer + 1) % s.n;
    } else s.turn = (seat + 1) % s.n;
    return;
  }
  if (s.phase !== 'play') return 'Wait for the trick to be collected';
  const card = s.hands[seat].find((c) => c.id === a.card);
  if (a.t !== 'play' || !card) return 'Play a card from your hand';
  if (!followable(s.hands[seat], s.trick).includes(card)) return 'You must follow suit';
  s.hands[seat] = s.hands[seat].filter((c) => c !== card);
  s.trick.push({ seat, card });
  if (s.trick.length === s.n) {
    s.collecting = trickWinner(s.trick, s.trump).seat;
    s.phase = 'collect';
  } else s.turn = (seat + 1) % s.n;
}

function step(s: S, ctx: Ctx) {
  if (s.phase === 'roundEnd') return startRound(s, ctx);
  if (s.phase !== 'collect') return;
  const w = s.collecting!;
  s.won[w].push(...s.trick.map((p) => p.card));
  s.tricks[w]++;
  s.trick = [];
  s.collecting = null;
  fx(s, 'collect');
  if (s.hands.every((h) => !h.length)) return endRound(s);
  s.phase = 'play';
  s.leader = s.turn = w;
}

function endRound(s: S) {
  s.lines = s.names.map((nm, i) => {
    const made = s.tricks[i] === s.bids[i];
    const pts = made ? 10 + s.bids[i]! : 0;
    s.scores[i] += pts;
    return `${nm}: bid ${s.bids[i]}, took ${s.tricks[i]} ${made ? `+${pts}` : '· missed'} (${s.scores[i]})`;
  });
  if (s.round >= s.sizes.length) {
    const top = Math.max(...s.scores);
    s.result = `${s.names.filter((_, i) => s.scores[i] === top).join(' & ')} win${s.scores.filter((v) => v === top).length > 1 ? '' : 's'} with ${top}`;
    s.phase = 'over';
    fx(s, 'win');
  } else {
    s.result = `Round ${s.round} of ${s.sizes.length}`;
    s.phase = 'roundEnd';
  }
}

function cpu(s: S, seat: Seat, ctx: Ctx): Action | null {
  if (s.turn !== seat) return null;
  if (s.phase === 'bid') {
    const hand = s.hands[seat];
    let est = 0;
    for (const c of hand) {
      if (s.trump && c.s === s.trump) est += hi(c) >= 12 ? 0.95 : hi(c) >= 9 ? 0.5 : 0.3;
      else if (hi(c) === 14) est += 0.8;
      else if (hi(c) === 13) est += 0.4;
    }
    est *= 4 / Math.max(3, s.n); // more players → fewer tricks each
    let b = Math.max(0, Math.min(size(s), Math.round(est + (ctx.level === 'easy' ? ctx.rng.range(-0.8, 0.8) : 0))));
    if (forbidden(s, seat) === b) b = b > 0 && (est < b || b === size(s)) ? b - 1 : b + 1;
    return { t: 'bid', bid: Math.max(0, Math.min(size(s), b)) };
  }
  if (s.phase !== 'play') return null;
  const wantWin = s.tricks[seat] < s.bids[seat]!;
  return { t: 'play', card: chooseCard(followable(s.hands[seat], s.trick), s.trick, { trump: s.trump, wantWin, seat, n: s.n }).id };
}

function view(s: S, viewer: Seat): View {
  const myTurn = s.turn === viewer && (s.phase === 'bid' || s.phase === 'play');
  const extra: Zone[] = [];
  if (s.upcard) extra.push({ id: 'trumpcard', at: { x: -0.5, y: -0.06, p: [-0.3, -0.36] }, lay: 'stack', label: 'Trump', deck: true, cards: [...s.stock.slice(-3).map((c) => ({ id: c.id })), { id: s.upcard.id, f: code(s.upcard), rot: 8 }] });
  const zones = trickZones(s, viewer, { playable: myTurn && s.phase === 'play' ? followable(s.hands[viewer], s.trick) : undefined, extraZones: extra });
  const buttons: View['buttons'] = [];
  let prompt: string | undefined;
  if (myTurn && s.phase === 'bid') {
    const f = forbidden(s, viewer);
    for (let b = 0; b <= size(s); b++) buttons.push({ label: String(b), a: { t: 'bid', bid: b }, kind: b === f ? 'ghost' : undefined });
    prompt = `Bid exactly the tricks you'll take${f !== null ? ` (dealer can't bid ${f})` : ''}`;
  } else if (s.phase === 'bid') prompt = `${s.names[s.turn]} is bidding…`;
  else if (myTurn) prompt = `You need ${Math.max(0, s.bids[viewer]! - s.tricks[viewer])} more trick${s.bids[viewer]! - s.tricks[viewer] === 1 ? '' : 's'}${s.tricks[viewer] > s.bids[viewer]! ? ' (already over)' : ''}`;
  else if (s.phase === 'play') prompt = `${s.names[s.turn]} to play`;
  if (s.phase === 'roundEnd' && !s.cpu[viewer]) buttons.push({ label: 'Next round', a: { t: 'next' }, kind: 'primary', key: 'n' });
  if (s.phase === 'over' && !s.cpu[viewer]) buttons.push({ label: 'Play again', a: { t: 'rematch' }, kind: 'primary' });
  const bidSum = s.bids.reduce<number>((a, b) => a + (b ?? 0), 0);
  return baseView(s, viewer, 'ohhell', {
    seats: s.names.map((name, i) => ({
      name,
      cpu: s.cpu[i],
      score: `${s.scores[i]} pts`,
      sub: s.bids[i] === null ? undefined : `Bid ${s.bids[i]} · won ${s.tricks[i]}`,
      badges: i === s.dealer ? ['D'] : [],
      active: s.turn === i && (s.phase === 'bid' || s.phase === 'play'),
      win: s.phase === 'over' && s.scores[i] === Math.max(...s.scores),
    })),
    zones,
    buttons,
    prompt,
    status: `Round ${s.round}/${s.sizes.length} · ${size(s)} card${size(s) > 1 ? 's' : ''} · trump ${s.trump ? SUIT_GLYPH[s.trump] : 'none'} · bids ${bidSum}/${size(s)}`,
    banner: s.phase === 'roundEnd' || s.phase === 'over' ? { title: s.result, lines: s.lines, tone: s.phase === 'over' && s.scores[viewer] === Math.max(...s.scores) ? 'win' : 'info' } : undefined,
    over: s.phase === 'over',
  });
}

export const ohhell: GameDef<S> = {
  meta: {
    id: 'ohhell',
    name: 'Oh Hell',
    family: 'Trick-taking',
    players: { min: 3, max: 7, def: 4 },
    blurb: 'Bid exactly how many tricks you will take: no more, no less.',
    hero: ['7H', '7S', '7D', '7C', 'AS'],
    length: '25–40 min',
    options: [{ id: 'max', label: 'Largest hand', type: 'select', default: 7, choices: [{ value: 5, label: '5 cards (short)' }, { value: 7, label: '7 cards' }, { value: 10, label: '10 cards (long)' }] }],
    rules: [
      ['Rounds', 'The first round deals one card each, the next two, and so on up to the largest hand, then back down to one.'],
      ['Trump', 'After the deal the next card is turned up; its suit is trump for the round. If no cards are left, there is no trump.'],
      ['Bidding', "Starting left of the dealer, everyone bids how many tricks they will take. The dealer bids last and may not make the bids add up to the number of tricks (the <em>dealer's hook</em>): someone must miss."],
      ['Play', 'Follow suit if you can. The highest trump, or the highest card of the suit led, wins.'],
      ['Scoring', 'Take exactly your bid to score 10 plus your bid. Miss by any amount and score nothing. Highest total after the last round wins.'],
    ],
  },
  create: (players, ctx, options) => {
    const n = players.length;
    const max = Math.min(Number(options.max ?? 7), Math.floor(51 / n));
    const sizes = [...Array.from({ length: max }, (_, i) => i + 1), ...Array.from({ length: max - 1 }, (_, i) => max - 1 - i)];
    const s: S = {
      n, names: players.map((p) => p.name), cpu: players.map((p) => p.kind === 'cpu'), hands: [], trick: [], lastTrick: [], leader: 0, turn: 0,
      won: [], tricks: [], trump: null, dealer: ctx.rng.int(n), deal: 0, fx: [], fxn: 0, log: [], collecting: null,
      phase: 'bid', round: 0, sizes, bids: [], upcard: null, stock: [], scores: players.map(() => 0), result: '', lines: [],
    };
    startRound(s, ctx);
    return s;
  },
  toAct: (s) => (s.phase === 'bid' || s.phase === 'play' ? [s.turn] : s.phase === 'roundEnd' || s.phase === 'over' ? s.names.map((_, i) => i).filter((i) => !s.cpu[i]) : []),
  act,
  auto: (s) => (s.phase === 'collect' ? 1000 : s.phase === 'roundEnd' && s.cpu.every(Boolean) ? 10 : null),
  step,
  cpu,
  view,
  over: (s) => s.phase === 'over',
};
