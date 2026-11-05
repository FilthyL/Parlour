/**
 * Classic Rummy for 2–6: draw, meld sets and runs onto the table, lay off on
 * any meld, discard. Go out to score the cards left in everyone else's
 * hand (double if you go "rummy", all at once). Game to 100.
 */
import { code, label, newDeck, type Card } from '../core/cards';
import type { Action, Ctx, FxEvent, GameDef, Seat, View, Zone } from '../core/types';
import { arrangeForView, bestMelds, canLayOff, isMeld, pipValue } from '../core/util/melds';

type Phase = 'draw' | 'play' | 'roundEnd' | 'over';
interface Meld {
  id: string;
  owner: Seat;
  cards: Card[];
}
interface S {
  n: number;
  names: string[];
  cpu: boolean[];
  hands: Card[][];
  stock: Card[];
  pile: Card[];
  melds: Meld[];
  melded: boolean[]; // has melded or laid off in an earlier turn (for "rummy")
  actedThisTurn: boolean;
  refills: number;
  phase: Phase;
  turn: Seat;
  dealer: Seat;
  tookDiscard: string | null;
  scores: number[];
  target: number;
  round: number;
  result: string;
  lines: string[];
  deal: number;
  fx: FxEvent[];
  fxn: number;
  log: string[];
  meldSeq: number;
}

const fx = (s: S, k: string) => {
  s.fx.push({ n: ++s.fxn, k });
  if (s.fx.length > 12) s.fx.shift();
};
const log = (s: S, m: string) => {
  s.log.push(m);
  if (s.log.length > 60) s.log.shift();
};
const handSize = (n: number) => (n === 2 ? 10 : n <= 4 ? 7 : 6);

function startRound(s: S, ctx: Ctx) {
  s.round++;
  s.dealer = (s.dealer + 1) % s.n;
  const deck = newDeck(ctx.rng);
  s.hands = s.names.map(() => []);
  for (let r = 0; r < handSize(s.n); r++) for (let k = 1; k <= s.n; k++) s.hands[(s.dealer + k) % s.n].push(deck.pop()!);
  s.pile = [deck.pop()!];
  s.stock = deck;
  s.melds = [];
  s.melded = s.names.map(() => false);
  s.actedThisTurn = false;
  s.refills = 0;
  s.phase = 'draw';
  s.turn = (s.dealer + 1) % s.n;
  s.tookDiscard = null;
  s.deal++;
  fx(s, 'shuffle');
  log(s, `Round ${s.round}`);
}

function wentOut(s: S, seat: Seat) {
  const rummy = !s.melded[seat];
  let pts = 0;
  s.lines = [];
  s.names.forEach((nm, i) => {
    if (i === seat) return;
    const v = s.hands[i].reduce((a, c) => a + pipValue(c), 0);
    pts += v;
    s.lines.push(`${nm} holds ${v}`);
  });
  if (rummy) pts *= 2;
  s.scores[seat] += pts;
  s.result = `${s.names[seat]} goes out${rummy ? ' with rummy!' : ''} +${pts}`;
  log(s, s.result);
  fx(s, 'win');
  if (s.scores[seat] >= s.target) {
    s.phase = 'over';
    s.result = `${s.names[seat]} wins with ${s.scores[seat]}`;
  } else s.phase = 'roundEnd';
}

/** Turn the discards over once; the second time the stock runs out, the round is void. */
function refillStock(s: S, ctx: Ctx): boolean {
  if (s.stock.length) return true;
  if (s.refills >= 1 || s.pile.length < 2) {
    s.result = 'The stock ran out again: no score this round';
    s.lines = ['Nobody could go out. The deal passes on.'];
    s.phase = 'roundEnd';
    log(s, s.result);
    return false;
  }
  s.refills++;
  const top = s.pile.pop()!;
  s.stock = ctx.rng.shuffle(s.pile.splice(0));
  s.pile = [top];
  log(s, 'The discards are turned over to make a new stock');
  return true;
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
  const hand = s.hands[seat];
  if (s.phase === 'draw') {
    if (a.t !== 'draw') return 'Draw from the stock or the discard pile';
    if (a.from === 'discard') {
      const c = s.pile.pop();
      if (!c) return 'The discard pile is empty';
      hand.push(c);
      s.tookDiscard = c.id;
      log(s, `${s.names[seat]} takes ${label(c)}`);
    } else {
      if (!refillStock(s, ctx)) return;
      hand.push(s.stock.pop()!);
      s.tookDiscard = null;
    }
    fx(s, 'draw');
    s.phase = 'play';
    return;
  }
  const ids = (a.cards as string[] | undefined) ?? (a.card ? [a.card as string] : []);
  const cards = ids.map((id) => hand.find((c) => c.id === id)).filter(Boolean) as Card[];
  if (cards.length !== ids.length) return 'Those cards are not in your hand';
  switch (a.t) {
    case 'meld': {
      if (!isMeld(cards)) return 'That is not a set or a run';
      s.hands[seat] = hand.filter((c) => !cards.includes(c));
      s.melds.push({ id: `m${++s.meldSeq}`, owner: seat, cards: [...cards].sort((x, y) => x.r - y.r) });
      log(s, `${s.names[seat]} melds ${cards.map(label).join(' ')}`);
      s.actedThisTurn = true;
      fx(s, 'chips');
      if (!s.hands[seat].length) return wentOut(s, seat);
      return;
    }
    case 'layoff': {
      const m = s.melds.find((x) => x.id === a.meld);
      if (!m) return 'Pick a meld on the table';
      if (cards.length !== 1) return 'Lay off one card at a time';
      if (!canLayOff(m.cards, cards[0])) return `${label(cards[0])} doesn't fit that meld`;
      s.hands[seat] = hand.filter((c) => c !== cards[0]);
      m.cards = [...m.cards, cards[0]].sort((x, y) => x.r - y.r);
      log(s, `${s.names[seat]} lays off ${label(cards[0])}`);
      s.actedThisTurn = true;
      fx(s, 'chips');
      if (!s.hands[seat].length) return wentOut(s, seat);
      return;
    }
    case 'discard': {
      if (cards.length !== 1) return 'Discard exactly one card';
      if (cards[0].id === s.tookDiscard && hand.length > 1) return "You can't throw back the card you just took";
      s.hands[seat] = hand.filter((c) => c !== cards[0]);
      s.pile.push(cards[0]);
      fx(s, 'fold');
      // melding or laying off this turn means a later go-out isn't "rummy"
      if (s.actedThisTurn) s.melded[seat] = true;
      s.actedThisTurn = false;
      s.tookDiscard = null;
      if (!s.hands[seat].length) return wentOut(s, seat);
      s.phase = 'draw';
      s.turn = (seat + 1) % s.n;
      return;
    }
    default:
      return 'Meld, lay off, or discard to end your turn';
  }
}

// ---------------------------------------------------------------- CPU
function cpu(s: S, seat: Seat, ctx: Ctx): Action | null {
  if (s.turn !== seat) return null;
  const hand = s.hands[seat];
  if (s.phase === 'draw') {
    const top = s.pile[s.pile.length - 1];
    if (top) {
      const before = bestMelds(hand).dw;
      const after = bestMelds([...hand, top]).dw;
      const fits = s.melds.some((m) => canLayOff(m.cards, top));
      if (before - after >= pipValue(top) + (ctx.level === 'easy' ? 4 : 1) || fits) return { t: 'draw', from: 'discard' };
    }
    return { t: 'draw', from: 'stock' };
  }
  if (s.phase !== 'play') return null;
  // meld everything we can (holding back only if it would leave us with no discard)
  const arr = bestMelds(hand);
  if (arr.melds.length) return { t: 'meld', cards: arr.melds[0].map((c) => c.id) };
  for (const c of hand) {
    const m = s.melds.find((x) => canLayOff(x.cards, c));
    if (m) return { t: 'layoff', meld: m.id, cards: [c.id] };
  }
  // discard the highest deadwood card we didn't just take
  const choices = arr.deadwood.filter((c) => c.id !== s.tookDiscard);
  const pool = choices.length ? choices : hand.filter((c) => c.id !== s.tookDiscard);
  const d = (pool.length ? pool : hand).sort((x, y) => pipValue(y) - pipValue(x))[0];
  return { t: 'discard', cards: [d.id] };
}

// ---------------------------------------------------------------- view
function meldSpot(k: number, n: number): { x: number; y: number; p: [number, number] } {
  const cols = n > 8 ? 5 : 4;
  const r = Math.floor(k / cols), c = k % cols;
  const rowCount = Math.min(cols, n - r * cols);
  return { x: (c - (rowCount - 1) / 2) * 0.42, y: 0.12 + r * 0.3, p: [(c % 2 ? 0.45 : -0.45), -0.02 + Math.floor(k / 2) * 0.18] };
}

function view(s: S, viewer: Seat): View {
  const myTurn = s.turn === viewer && (s.phase === 'draw' || s.phase === 'play');
  const zones: Zone[] = [];
  zones.push({ id: 'stock', at: { x: -0.18, y: -0.36, p: [-0.24, -0.42] }, lay: 'stack', deck: true, count: s.stock.length, label: String(s.stock.length), scale: 0.85, act: myTurn && s.phase === 'draw' ? { t: 'draw', from: 'stock' } : undefined, cards: s.stock.slice(-6).map((c) => ({ id: c.id })) });
  zones.push({ id: 'pile', at: { x: 0.18, y: -0.36, p: [0.24, -0.42] }, lay: 'stack', scale: 0.85, act: myTurn && s.phase === 'draw' && s.pile.length ? { t: 'draw', from: 'discard' } : undefined, cards: s.pile.slice(-5).map((c, i, arr) => ({ id: c.id, f: code(c), rot: ((c.id.charCodeAt(c.id.length - 1) % 9) - 4) * 1.5, hi: myTurn && s.phase === 'draw' && i === arr.length - 1 })) });
  s.melds.forEach((m, k) =>
    zones.push({
      id: m.id,
      at: meldSpot(k, s.melds.length),
      lay: 'row',
      gap: 0.3,
      scale: 0.62,
      act: myTurn && s.phase === 'play' ? { t: 'layoff', meld: m.id } : undefined,
      needSel: myTurn && s.phase === 'play' ? [1, 1] : undefined,
      cards: m.cards.map((c) => ({ id: c.id, f: code(c) })),
    }),
  );
  for (let i = 0; i < s.n; i++) {
    const hand = i === viewer ? arrangeForView(s.hands[i]) : s.hands[i];
    const reveal = s.phase === 'roundEnd' || s.phase === 'over';
    zones.push({
      id: 'h' + i,
      at: { seat: i, slot: 'hand' },
      lay: 'fan',
      cards: hand.map((c) => ({ id: c.id, f: i === viewer || reveal ? code(c) : undefined, sel: i === viewer && myTurn && s.phase === 'play' ? true : undefined, hi: i === viewer && c.id === s.tookDiscard })),
    });
  }
  const buttons: View['buttons'] = [];
  let prompt: string | undefined;
  if (myTurn && s.phase === 'draw') {
    buttons.push({ label: 'Draw from stock', a: { t: 'draw', from: 'stock' }, kind: 'primary', key: 'd' });
    if (s.pile.length) buttons.push({ label: `Take ${label(s.pile[s.pile.length - 1])}`, a: { t: 'draw', from: 'discard' } });
    prompt = 'Draw a card';
  } else if (myTurn && s.phase === 'play') {
    buttons.push({ label: 'Meld selected', a: { t: 'meld' }, needSel: [3, 13], key: 'm' });
    buttons.push({ label: 'Discard selected', a: { t: 'discard' }, needSel: [1, 1], kind: 'primary', key: 'x' });
    prompt = 'Select cards to meld, or one card and tap a meld to lay off. Discard to end your turn';
  } else if (s.phase === 'draw' || s.phase === 'play') prompt = `${s.names[s.turn]} is playing…`;
  if (s.phase === 'roundEnd' && !s.cpu[viewer]) buttons.push({ label: 'Next round', a: { t: 'next' }, kind: 'primary', key: 'n' });
  if (s.phase === 'over' && !s.cpu[viewer]) buttons.push({ label: 'Play again', a: { t: 'rematch' }, kind: 'primary' });
  return {
    game: 'rummy',
    viewer,
    seats: s.names.map((name, i) => ({ name, cpu: s.cpu[i], score: `${s.scores[i]} pts`, sub: `${s.hands[i].length} cards`, badges: i === s.dealer ? ['D'] : [], active: s.turn === i && (s.phase === 'draw' || s.phase === 'play'), win: (s.phase === 'roundEnd' || s.phase === 'over') && s.result.startsWith(name) })),
    zones,
    buttons,
    prompt,
    status: `Round ${s.round} · to ${s.target} · ${s.melds.length} meld${s.melds.length === 1 ? '' : 's'} on the table`,
    banner: s.phase === 'roundEnd' || s.phase === 'over' ? { title: s.result, lines: s.lines, tone: s.result.startsWith(s.names[viewer]) ? 'win' : 'info' } : undefined,
    log: s.log.slice(-30),
    deal: s.deal,
    fx: s.fx,
    over: s.phase === 'over',
  };
}

export const rummy: GameDef<S> = {
  meta: {
    id: 'rummy',
    name: 'Rummy',
    family: 'Rummy',
    players: { min: 2, max: 6, def: 4 },
    blurb: 'Meld on the table, lay off on anyone’s runs, and go out before the others.',
    hero: ['5S', '6S', '7S', '8S', 'JD'],
    length: '20–40 min',
    options: [{ id: 'target', label: 'Game ends at', type: 'select', default: 100, choices: [{ value: 50, label: '50 points' }, { value: 100, label: '100 points' }, { value: 150, label: '150 points' }] }],
    rules: [
      ['Deal', 'Two players get ten cards each, three or four players get seven, five or six get six. The next card starts the discard pile.'],
      ['Your turn', 'Draw the top card of the stock or the discard pile. Then you may lay down melds (sets of three or four of a kind, or runs of three or more in one suit, ace low) and lay off single cards on any meld on the table. End your turn by discarding.'],
      ['Going out', 'The first player to get rid of all their cards, by melding, laying off or discarding, wins the round.'],
      ['Scoring', 'The winner scores the cards left in every other hand: courts 10, aces 1, others their number. Going out in one turn without having melded before is <em>rummy</em> and scores double.'],
      ['Stock', 'If the stock runs out, the discards (except the top card) are turned over once to form a new stock. If it runs out a second time, the round ends with no score.'],
    ],
  },
  create: (players, ctx, options) => {
    const s: S = {
      n: players.length, names: players.map((p) => p.name), cpu: players.map((p) => p.kind === 'cpu'), hands: [], stock: [], pile: [], melds: [], melded: [], actedThisTurn: false, refills: 0, phase: 'draw', turn: 0,
      dealer: ctx.rng.int(players.length), tookDiscard: null, scores: players.map(() => 0), target: Number(options.target ?? 100), round: 0, result: '', lines: [], deal: 0, fx: [], fxn: 0, log: [], meldSeq: 0,
    };
    startRound(s, ctx);
    return s;
  },
  toAct: (s) => (s.phase === 'roundEnd' || s.phase === 'over' ? s.names.map((_, i) => i).filter((i) => !s.cpu[i]) : [s.turn]),
  act,
  auto: (s) => (s.phase === 'roundEnd' && s.cpu.every(Boolean) ? 10 : null),
  step: (s, ctx) => startRound(s, ctx),
  cpu,
  view,
  over: (s) => s.phase === 'over',
};
