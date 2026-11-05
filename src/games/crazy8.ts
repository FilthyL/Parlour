import { code, label, newDeck, type Card, type Suit } from '../core/cards';
import type { Action, Ctx, GameDef, Seat, View } from '../core/types';
import { base, fx, handZone, humans, log, stackZone, type Base } from './shared';
import { SUIT_GLYPH, SUIT_WORD } from './tricks/common';

interface S extends Base {
  hands: Card[][];
  stock: Card[];
  pile: Card[];
  suit: Suit; // suit in force (declared after an eight)
  phase: 'play' | 'choose' | 'roundEnd' | 'over';
  turn: Seat;
  dealer: Seat;
  drewThisTurn: number;
  passes: number;
  scores: number[];
  target: number;
  round: number;
  result: string;
  lines: string[];
  says: (string | undefined)[];
}

const pts = (c: Card) => (c.r === 8 ? 50 : c.r >= 11 ? 10 : c.r === 1 ? 1 : c.r);
const top = (s: S) => s.pile[s.pile.length - 1];
const canPlay = (s: S, c: Card) => c.r === 8 || c.s === s.suit || c.r === top(s).r;

function startRound(s: S, ctx: Ctx) {
  s.round++;
  s.dealer = (s.dealer + 1) % s.n;
  const deck = newDeck(ctx.rng);
  const size = s.n === 2 ? 7 : 5;
  s.hands = s.names.map(() => []);
  for (let r = 0; r < size; r++) for (let k = 1; k <= s.n; k++) s.hands[(s.dealer + k) % s.n].push(deck.pop()!);
  // an eight can't start the pile: bury it
  let st = deck.pop()!;
  while (st.r === 8) {
    deck.unshift(st);
    st = deck.pop()!;
  }
  s.pile = [st];
  s.stock = deck;
  s.suit = st.s;
  s.phase = 'play';
  s.turn = (s.dealer + 1) % s.n;
  s.drewThisTurn = 0;
  s.passes = 0;
  s.says = s.names.map(() => undefined);
  s.deal++;
  fx(s, 'shuffle');
  log(s, `Round ${s.round}: ${label(st)} starts`);
}

function next(s: S) {
  s.turn = (s.turn + 1) % s.n;
  s.drewThisTurn = 0;
}

function endRound(s: S, winner: Seat, blocked = false) {
  let gain = 0;
  s.lines = s.names.map((nm, i) => {
    const v = s.hands[i].reduce((a, c) => a + pts(c), 0);
    if (i !== winner) gain += v;
    return `${nm} holds ${v}`;
  });
  if (blocked) gain = Math.max(0, gain - s.hands[winner].reduce((a, c) => a + pts(c), 0) * (s.n - 1));
  s.scores[winner] += gain;
  s.result = blocked ? `Blocked! ${s.names[winner]} has the lowest hand: +${gain}` : `${s.names[winner]} goes out: +${gain}`;
  log(s, s.result);
  fx(s, 'win');
  if (s.scores[winner] >= s.target) {
    s.phase = 'over';
    s.result = `${s.names[winner]} wins with ${s.scores[winner]}`;
  } else s.phase = 'roundEnd';
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
  if (s.phase === 'choose') {
    if (a.t !== 'suit' || !['S', 'H', 'D', 'C'].includes(a.suit as string)) return 'Choose a suit';
    s.suit = a.suit as Suit;
    s.says[seat] = `${SUIT_GLYPH[s.suit]} ${SUIT_WORD[s.suit]}`;
    log(s, `${s.names[seat]} calls ${SUIT_WORD[s.suit]}`);
    s.phase = 'play';
    if (!hand.length) return endRound(s, seat);
    return next(s);
  }
  if (a.t === 'draw') {
    if (hand.some((c) => canPlay(s, c))) return 'You have a card you can play';
    if (!s.stock.length) return 'The stock is empty: pass instead';
    hand.push(s.stock.pop()!);
    s.drewThisTurn++;
    fx(s, 'draw');
    return;
  }
  if (a.t === 'pass') {
    if (s.stock.length || hand.some((c) => canPlay(s, c))) return 'You can still draw or play';
    s.says[seat] = 'Pass';
    s.passes++;
    if (s.passes >= s.n) {
      const low = Math.min(...s.hands.map((h) => h.reduce((x, c) => x + pts(c), 0)));
      return endRound(s, s.hands.findIndex((h) => h.reduce((x, c) => x + pts(c), 0) === low), true);
    }
    return next(s);
  }
  const card = hand.find((c) => c.id === a.card);
  if (a.t !== 'play' || !card) return 'Play a card or draw';
  if (!canPlay(s, card)) return `Match the ${SUIT_WORD[s.suit].toLowerCase()} or a ${label(top(s)).slice(0, -1)}, or play an eight`;
  s.hands[seat] = hand.filter((c) => c !== card);
  s.pile.push(card);
  s.passes = 0;
  s.says[seat] = undefined;
  fx(s, card.r === 8 ? 'allin' : 'chips');
  if (card.r === 8) {
    s.phase = 'choose';
    return;
  }
  s.suit = card.s;
  if (!s.hands[seat].length) return endRound(s, seat);
  next(s);
}

function cpu(s: S, seat: Seat, ctx: Ctx): Action | null {
  if (s.turn !== seat || (s.phase !== 'play' && s.phase !== 'choose')) return null;
  const hand = s.hands[seat];
  if (s.phase === 'choose') {
    const counts = (['S', 'H', 'D', 'C'] as Suit[]).map((x) => [x, hand.filter((c) => c.s === x && c.r !== 8).length] as const).sort((a, b) => b[1] - a[1]);
    return { t: 'suit', suit: ctx.level === 'easy' ? ctx.rng.pick(['S', 'H', 'D', 'C']) : counts[0][0] };
  }
  const ok = hand.filter((c) => canPlay(s, c));
  if (!ok.length) return s.stock.length ? { t: 'draw' } : { t: 'pass' };
  const nonEight = ok.filter((c) => c.r !== 8);
  const pool = nonEight.length ? nonEight : ok;
  const suitCount = (x: Suit) => hand.filter((c) => c.s === x).length;
  const pick = [...pool].sort((a, b) => suitCount(b.s) - suitCount(a.s) || pts(b) - pts(a))[0];
  return { t: 'play', card: (ctx.level === 'easy' ? ctx.rng.pick(pool) : pick).id };
}

function view(s: S, viewer: Seat): View {
  const myTurn = s.turn === viewer && s.phase === 'play';
  const zones = s.names.map((_, i) =>
    handZone(i, viewer, s.hands[i], {
      act: myTurn && i === viewer ? (c) => (canPlay(s, c) ? { t: 'play', card: c.id } : undefined) : undefined,
      reveal: s.phase === 'roundEnd' || s.phase === 'over',
      dim: myTurn && i === viewer ? (c) => !canPlay(s, c) : undefined,
    }),
  );
  zones.push(stackZone('stock', s.stock, { x: -0.17, y: -0.12, p: [-0.24, -0.2] }, { deck: true, label: String(s.stock.length), act: myTurn && !s.hands[viewer].some((c) => canPlay(s, c)) && s.stock.length ? { t: 'draw' } : undefined }));
  zones.push(stackZone('pile', s.pile, { x: 0.17, y: -0.12, p: [0.24, -0.2] }, { faceUp: true }));
  const buttons: View['buttons'] = [];
  let prompt: string | undefined;
  const stuck = myTurn && !s.hands[viewer].some((c) => canPlay(s, c));
  if (s.phase === 'choose' && s.turn === viewer) {
    for (const x of ['S', 'H', 'D', 'C'] as Suit[]) buttons.push({ label: `${SUIT_GLYPH[x]} ${SUIT_WORD[x]}`, a: { t: 'suit', suit: x }, kind: 'primary' });
    prompt = 'Crazy eight! Choose the suit';
  } else if (myTurn) {
    if (stuck && s.stock.length) buttons.push({ label: 'Draw', a: { t: 'draw' }, kind: 'primary', key: 'd' });
    if (stuck && !s.stock.length) buttons.push({ label: 'Pass', a: { t: 'pass' }, kind: 'primary', key: 'p' });
    prompt = stuck ? (s.stock.length ? 'Nothing to play: draw a card' : 'Nothing to play and no stock: pass') : `Play a ${SUIT_WORD[s.suit].toLowerCase().slice(0, -1)}, a ${label(top(s)).slice(0, -1)}, or an eight`;
  } else if (s.phase === 'play' || s.phase === 'choose') prompt = `${s.names[s.turn]} to play`;
  if (s.phase === 'roundEnd' && !s.cpu[viewer]) buttons.push({ label: 'Next round', a: { t: 'next' }, kind: 'primary', key: 'n' });
  if (s.phase === 'over' && !s.cpu[viewer]) buttons.push({ label: 'Play again', a: { t: 'rematch' }, kind: 'primary' });
  return {
    game: 'crazy8',
    viewer,
    seats: s.names.map((name, i) => ({ name, cpu: s.cpu[i], score: `${s.scores[i]} pts`, sub: `${s.hands[i].length} cards`, say: s.says[i], badges: i === s.dealer ? ['D'] : [], active: s.turn === i && (s.phase === 'play' || s.phase === 'choose'), win: s.phase !== 'play' && s.result.includes(name) })),
    zones,
    buttons,
    prompt,
    status: `Round ${s.round} · suit in play ${SUIT_GLYPH[s.suit]} ${SUIT_WORD[s.suit]} · to ${s.target}`,
    banner: s.phase === 'roundEnd' || s.phase === 'over' ? { title: s.result, lines: s.lines, tone: s.result.includes(s.names[viewer]) ? 'win' : 'info' } : undefined,
    log: s.log.slice(-30),
    deal: s.deal,
    fx: s.fx,
    over: s.phase === 'over',
  };
}

export const crazy8: GameDef<S> = {
  meta: {
    id: 'crazy8',
    name: 'Crazy Eights',
    family: 'Shedding',
    players: { min: 2, max: 7, def: 4 },
    blurb: 'Match the suit or the number, and save your eights to change the suit.',
    hero: ['8S', '8H', '8D', '8C', 'KH'],
    length: '10–20 min',
    options: [{ id: 'target', label: 'Game ends at', type: 'select', default: 100, choices: [{ value: 50, label: '50 points' }, { value: 100, label: '100 points' }] }],
    rules: [
      ['Deal', 'Two players get seven cards each; three or more get five. The next card starts the discard pile (an eight is buried and another turned).'],
      ['Play', 'On your turn, play a card that matches the top card’s suit or rank. Eights are wild: play one any time and name the next suit.'],
      ['Drawing', 'If you cannot play, draw from the stock until you can. If the stock is empty and you cannot play, you pass.'],
      ['Scoring', 'The first player out scores the cards left in everyone else’s hand: eights 50, courts 10, aces 1, others their number. If everyone is blocked, the lowest hand wins the difference.'],
      ['Game', 'The first player to reach 100 wins.'],
    ],
  },
  create: (players, ctx, options) => {
    const s: S = { ...base(players), hands: [], stock: [], pile: [], suit: 'S', phase: 'play', turn: 0, dealer: ctx.rng.int(players.length), drewThisTurn: 0, passes: 0, scores: players.map(() => 0), target: Number(options.target ?? 100), round: 0, result: '', lines: [], says: [] };
    startRound(s, ctx);
    return s;
  },
  toAct: (s) => (s.phase === 'roundEnd' || s.phase === 'over' ? humans(s) : [s.turn]),
  act,
  auto: (s) => (s.phase === 'roundEnd' && s.cpu.every(Boolean) ? 10 : null),
  step: (s, ctx) => startRound(s, ctx),
  cpu,
  view,
  over: (s) => s.phase === 'over',
};

export { code };
