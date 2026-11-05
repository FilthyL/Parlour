import { code, hi, newDeck, type Card, type Suit } from '../core/cards';
import type { Action, Ctx, GameDef, Seat, View, Zone } from '../core/types';
import { baseView, chooseCard, dealRound, fx, log, SUIT_GLYPH, SUIT_WORD, trickWinner, trickZones, type Power, type SuitOf, type TrickBase } from './tricks/common';

type Phase = 'bid1' | 'discard' | 'bid2' | 'play' | 'collect' | 'roundEnd' | 'over';
interface S extends TrickBase {
  phase: Phase;
  hand: number;
  kitty: Card[];
  up: Card | null;
  upTurned: boolean;
  maker: Seat;
  alone: boolean;
  out: Seat; // partner sitting out when someone goes alone (−1 = none)
  passes: number;
  score: [number, number];
  target: number;
  result: string;
  lines: string[];
  says: (string | undefined)[];
}

const team = (i: Seat) => i % 2;
const partner = (i: Seat) => (i + 2) % 4;
const sameColor = (a: Suit, b: Suit) => (a === 'H' || a === 'D') === (b === 'H' || b === 'D');
const isRight = (c: Card, t: Suit | null) => !!t && c.r === 11 && c.s === t;
const isLeft = (c: Card, t: Suit | null) => !!t && c.r === 11 && c.s !== t && sameColor(c.s, t);
const suitOfT = (t: Suit | null): SuitOf => (c) => (isLeft(c, t) ? t! : c.s);
const power: Power = (c, lead, t) => {
  if (isRight(c, t)) return 300;
  if (isLeft(c, t)) return 299;
  if (t && c.s === t) return 200 + hi(c);
  return c.s === lead ? hi(c) : 0;
};
const teamName = (s: S, t: number) => `${s.names[t]} & ${s.names[t + 2]}`;

function nextActive(s: S, i: Seat) {
  let j = (i + 1) % 4;
  if (j === s.out) j = (j + 1) % 4;
  return j;
}

function startHand(s: S, ctx: Ctx) {
  s.hand++;
  s.dealer = (s.dealer + 1) % 4;
  const deck = newDeck(ctx.rng, { ranks: [1, 9, 10, 11, 12, 13] });
  s.hands = dealRound(deck, 4, s.dealer, 5);
  s.kitty = deck;
  s.up = s.kitty[s.kitty.length - 1];
  s.upTurned = false;
  s.trump = null;
  s.won = [[], [], [], []];
  s.tricks = [0, 0, 0, 0];
  s.trick = [];
  s.maker = -1;
  s.alone = false;
  s.out = -1;
  s.passes = 0;
  s.collecting = null;
  s.says = [undefined, undefined, undefined, undefined];
  s.phase = 'bid1';
  s.turn = (s.dealer + 1) % 4;
  s.deal++;
  fx(s, 'shuffle');
  log(s, `Hand ${s.hand}: ${code(s.up)} turned up`);
}

function setTrump(s: S, seat: Seat, suit: Suit, alone: boolean) {
  s.trump = suit;
  s.maker = seat;
  s.alone = alone;
  s.out = alone ? partner(seat) : -1;
  s.says[seat] = `${alone ? 'Alone: ' : ''}${SUIT_WORD[suit]}`;
  log(s, `${s.names[seat]} makes ${SUIT_WORD[suit]}${alone ? ' and goes alone' : ''}`);
  fx(s, 'allin');
}

function beginPlay(s: S) {
  s.phase = 'play';
  s.leader = s.turn = nextActive(s, s.dealer);
  if (s.out >= 0) s.hands[s.out].forEach(() => {}); // partner lays cards aside (kept in hand, face down)
}

function legal(s: S, seat: Seat): Card[] {
  const hand = s.hands[seat];
  if (!s.trick.length) return hand;
  const sf = suitOfT(s.trump);
  const lead = sf(s.trick[0].card);
  const same = hand.filter((c) => sf(c) === lead);
  return same.length ? same : hand;
}

function act(s: S, seat: Seat, a: Action, ctx: Ctx): string | void {
  if (s.phase === 'roundEnd') return a.t === 'next' ? void startHand(s, ctx) : 'Hold on';
  if (s.phase === 'over') {
    if (a.t !== 'rematch') return 'The game is over';
    s.score = [0, 0];
    s.hand = 0;
    return void startHand(s, ctx);
  }
  if (seat !== s.turn) return "It isn't your turn";
  if (s.phase === 'bid1') {
    if (a.t === 'pass') {
      s.says[seat] = 'Pass';
      s.passes++;
      if (s.passes === 4) {
        s.phase = 'bid2';
        s.passes = 0;
        s.upTurned = true;
        s.says = s.says.map(() => undefined);
        log(s, 'Everyone passed; the upcard is turned down');
      }
      s.turn = (seat + 1) % 4;
      return;
    }
    if (a.t !== 'order') return 'Order it up or pass';
    setTrump(s, seat, s.up!.s, !!a.alone);
    // dealer picks up the upcard
    s.kitty = s.kitty.filter((c) => c !== s.up);
    s.hands[s.dealer].push(s.up!);
    s.up = null;
    if (s.out === s.dealer) {
      // dealer sits out: the upcard goes back to the kitty
      s.hands[s.dealer].pop();
      beginPlay(s);
    } else {
      s.phase = 'discard';
      s.turn = s.dealer;
    }
    return;
  }
  if (s.phase === 'discard') {
    const card = s.hands[seat].find((c) => c.id === a.card);
    if ((a.t !== 'discard' && a.t !== 'play') || !card) return 'Discard one card';
    s.hands[seat] = s.hands[seat].filter((c) => c !== card);
    s.kitty.push(card);
    fx(s, 'fold');
    return void beginPlay(s);
  }
  if (s.phase === 'bid2') {
    if (a.t === 'pass') {
      if (seat === s.dealer && s.passes === 3) {
        log(s, 'Everyone passed twice: the deal moves on');
        return void startHand(s, ctx);
      }
      s.says[seat] = 'Pass';
      s.passes++;
      s.turn = (seat + 1) % 4;
      return;
    }
    const suit = a.suit as Suit;
    if (a.t !== 'name' || !['S', 'H', 'D', 'C'].includes(suit)) return 'Name a suit or pass';
    if (suit === s.kitty[s.kitty.length - 1].s) return 'You cannot name the suit that was turned down';
    setTrump(s, seat, suit, !!a.alone);
    return void beginPlay(s);
  }
  if (s.phase !== 'play') return 'Wait for the trick to be collected';
  const card = s.hands[seat].find((c) => c.id === a.card);
  if (a.t !== 'play' || !card) return 'Play a card from your hand';
  if (!legal(s, seat).includes(card)) return 'You must follow suit (the left bower counts as trump)';
  s.hands[seat] = s.hands[seat].filter((c) => c !== card);
  s.trick.push({ seat, card });
  const players = s.out >= 0 ? 3 : 4;
  if (s.trick.length === players) {
    s.collecting = trickWinner(s.trick, s.trump, power, suitOfT(s.trump)).seat;
    s.phase = 'collect';
  } else s.turn = nextActive(s, seat);
}

function step(s: S, ctx: Ctx) {
  if (s.phase === 'roundEnd') return startHand(s, ctx);
  if (s.phase !== 'collect') return;
  const w = s.collecting!;
  s.won[w].push(...s.trick.map((p) => p.card));
  s.tricks[w]++;
  s.trick = [];
  s.collecting = null;
  fx(s, 'collect');
  const total = s.tricks.reduce((a, b) => a + b, 0);
  if (total === 5) return endHand(s);
  s.phase = 'play';
  s.leader = s.turn = w;
}

function endHand(s: S) {
  const mt = team(s.maker);
  const took = s.tricks[mt] + s.tricks[mt + 2];
  let pts: number, who: number;
  if (took >= 3) {
    who = mt;
    pts = took === 5 ? (s.alone ? 4 : 2) : 1;
    s.result = took === 5 ? `${teamName(s, mt)} march${s.alone ? ' alone' : ''}! +${pts}` : `${teamName(s, mt)} make it, +1`;
  } else {
    who = 1 - mt;
    pts = 2;
    s.result = `Euchred! ${teamName(s, who)} +2`;
  }
  s.score[who] += pts;
  s.lines = [`Makers took ${took} of 5 tricks`, `${teamName(s, 0)} ${s.score[0]} · ${teamName(s, 1)} ${s.score[1]}`];
  log(s, s.result);
  if (s.score[who] >= s.target) {
    s.phase = 'over';
    s.result = `${teamName(s, who)} win ${s.score[who]} to ${s.score[1 - who]}`;
    fx(s, 'win');
  } else s.phase = 'roundEnd';
}

// ---------------------------------------------------------------- CPU
function strength(hand: Card[], t: Suit) {
  let v = 0;
  for (const c of hand) {
    if (isRight(c, t)) v += 3;
    else if (isLeft(c, t)) v += 2.5;
    else if (c.s === t) v += { 14: 1.6, 13: 1.3, 12: 1.1, 10: 0.9, 9: 0.8 }[hi(c)] ?? 0;
    else if (hi(c) === 14) v += 0.9;
  }
  const suits = new Set(hand.filter((c) => !isLeft(c, t)).map((c) => c.s));
  v += (4 - suits.size) * 0.4; // voids help
  return v;
}

function cpu(s: S, seat: Seat, ctx: Ctx): Action | null {
  if (s.turn !== seat) return null;
  const hand = s.hands[seat];
  const thresh = { easy: 6.6, normal: 6.0, hard: 5.6 }[ctx.level ?? 'normal'];
  if (s.phase === 'bid1') {
    const t = s.up!.s;
    let v = strength(hand, t);
    const upV = isRight(s.up!, t) ? 3 : 1.2;
    if (seat === s.dealer) v = strength([...hand.filter((c) => c !== worstCard(hand, t)), s.up!], t);
    else if (partner(seat) === s.dealer) v += upV * 0.6;
    else v -= upV * 0.5;
    if (v >= thresh) return { t: 'order', alone: v >= 10.5 };
    return { t: 'pass' };
  }
  if (s.phase === 'discard') return { t: 'discard', card: worstCard(hand, s.trump!).id };
  if (s.phase === 'bid2') {
    const down = s.kitty[s.kitty.length - 1].s;
    const best = (['S', 'H', 'D', 'C'] as Suit[]).filter((x) => x !== down).map((x) => [x, strength(hand, x)] as const).sort((a, b) => b[1] - a[1])[0];
    const stuck = seat === s.dealer && s.passes === 3;
    if (best[1] >= thresh - 0.4 || (stuck && best[1] >= thresh - 1.4)) return { t: 'name', suit: best[0], alone: best[1] >= 10.5 };
    return { t: 'pass' };
  }
  if (s.phase !== 'play') return null;
  const ok = legal(s, seat);
  return { t: 'play', card: chooseCard(ok, s.trick, { trump: s.trump, power, suitOf: suitOfT(s.trump), wantWin: true, partner: s.out >= 0 ? undefined : partner(seat), seat, n: s.out >= 0 ? 3 : 4 }).id };
}

function worstCard(hand: Card[], t: Suit) {
  const sf = suitOfT(t);
  const non = hand.filter((c) => sf(c) !== t);
  const pool = non.length ? non : hand;
  return [...pool].sort((a, b) => power(a, sf(a), t) - power(b, sf(b), t) || hi(a) - hi(b))[0];
}

// ---------------------------------------------------------------- view
function view(s: S, viewer: Seat): View {
  const myTurn = s.turn === viewer;
  const playable = myTurn && s.phase === 'play' ? legal(s, viewer) : myTurn && s.phase === 'discard' ? s.hands[viewer] : undefined;
  const handPower = (c: Card) => (s.trump ? power(c, suitOfT(s.trump)(c), s.trump) : hi(c));
  const extra: Zone[] = [];
  if (s.phase === 'bid1' || s.phase === 'bid2' || s.phase === 'discard') {
    extra.push({
      id: 'kitty',
      at: { x: 0, y: -0.05 },
      lay: 'stack',
      deck: true,
      cards: s.kitty.map((c, i) => ({ id: c.id, f: s.up && c === s.up && !s.upTurned ? code(c) : undefined, rot: i === s.kitty.length - 1 && s.upTurned ? 90 : 0 })),
    });
  }
  const zones = trickZones(s, viewer, { playable, handPower, extraZones: extra });
  if (playable && s.phase === 'discard') zones.find((z) => z.id === 'h' + viewer)!.cards.forEach((c) => c.act && (c.act = { t: 'discard', card: c.id }));
  const buttons: View['buttons'] = [];
  let prompt: string | undefined;
  if (myTurn && s.phase === 'bid1') {
    const isDealer = viewer === s.dealer;
    buttons.push({ label: 'Pass', a: { t: 'pass' }, kind: 'ghost', key: 'p' });
    buttons.push({ label: isDealer ? 'Pick it up' : 'Order it up', a: { t: 'order' }, kind: 'primary', key: 'o' });
    buttons.push({ label: 'Go alone', a: { t: 'order', alone: true } });
    prompt = `Make ${SUIT_WORD[s.up!.s]} trump? ${isDealer ? 'You would pick up the ' + code(s.up!) : s.names[s.dealer] + ' picks up the ' + code(s.up!)}`;
  } else if (myTurn && s.phase === 'bid2') {
    const down = s.kitty[s.kitty.length - 1].s;
    const stuck = viewer === s.dealer && s.passes === 3;
    buttons.push({ label: stuck ? 'Pass (redeal)' : 'Pass', a: { t: 'pass' }, kind: 'ghost' });
    for (const x of ['S', 'H', 'D', 'C'] as Suit[]) if (x !== down) buttons.push({ label: `${SUIT_GLYPH[x]} ${SUIT_WORD[x]}`, a: { t: 'name', suit: x } });
    for (const x of ['S', 'H', 'D', 'C'] as Suit[]) if (x !== down) buttons.push({ label: `${SUIT_GLYPH[x]} alone`, a: { t: 'name', suit: x, alone: true }, kind: 'ghost' });
    prompt = 'Name trump, or pass';
  } else if (myTurn && s.phase === 'discard') prompt = 'You picked up the upcard: tap a card to discard';
  else if (myTurn && s.phase === 'play') prompt = s.trick.length ? 'Follow suit if you can' : 'Your lead';
  else if (s.phase === 'play' || s.phase.startsWith('bid')) prompt = `${s.names[s.turn]} ${s.phase === 'play' ? 'to play' : 'is deciding'}`;
  if (s.phase === 'roundEnd' && !s.cpu[viewer]) buttons.push({ label: 'Next hand', a: { t: 'next' }, kind: 'primary', key: 'n' });
  if (s.phase === 'over' && !s.cpu[viewer]) buttons.push({ label: 'Play again', a: { t: 'rematch' }, kind: 'primary' });
  return baseView(s, viewer, 'euchre', {
    seats: s.names.map((name, i) => ({
      name,
      cpu: s.cpu[i],
      team: team(i),
      score: `${s.score[team(i)]} pts`,
      sub: s.trump ? `${s.tricks[i]} trick${s.tricks[i] === 1 ? '' : 's'}${i === s.maker ? ' · maker' : ''}${i === s.out ? ' · sitting out' : ''}` : undefined,
      badges: i === s.dealer ? ['D'] : [],
      say: s.says[i],
      out: i === s.out,
      active: myTurnOf(s, i),
      win: s.phase === 'over' && s.score[team(i)] >= s.target,
    })),
    zones,
    buttons,
    prompt,
    status: `${teamName(s, 0)} ${s.score[0]} – ${s.score[1]} ${teamName(s, 1)}${s.trump ? ` · trump ${SUIT_GLYPH[s.trump]} ${SUIT_WORD[s.trump]}` : ''} · to ${s.target}`,
    banner: s.phase === 'roundEnd' || s.phase === 'over' ? { title: s.result, lines: s.lines, tone: s.phase === 'over' && s.score[team(viewer)] >= s.target ? 'win' : 'info' } : undefined,
    over: s.phase === 'over',
  });
}
const myTurnOf = (s: S, i: Seat) => s.turn === i && ['bid1', 'bid2', 'discard', 'play'].includes(s.phase);

export const euchre: GameDef<S> = {
  meta: {
    id: 'euchre',
    name: 'Euchre',
    family: 'Trick-taking',
    players: { min: 4, max: 4, def: 4 },
    teams: true,
    blurb: 'Twenty-four cards, two bowers, and a partner. Order it up or get euchred.',
    hero: ['JH', 'JD', 'AH', 'KH', '9H'],
    length: '15–25 min',
    options: [{ id: 'target', label: 'Game ends at', type: 'select', default: 10, choices: [{ value: 5, label: '5 points' }, { value: 10, label: '10 points' }] }],
    rules: [
      ['The deck', 'Only the 9 through Ace of each suit: 24 cards. You partner the player opposite. Each player gets five cards and one card is turned up.'],
      ['Making trump', 'Starting left of the dealer, each player may <em>order up</em> the turned card, making its suit trump; the dealer then picks it up and discards. If all pass, players may name any other suit, or pass again (then the hand is redealt).'],
      ['The bowers', 'The Jack of trump (the <em>right bower</em>) is the highest card. The other Jack of the same colour (the <em>left bower</em>) is second highest and counts as a trump. Then A, K, Q, 10, 9 of trump.'],
      ['Play', 'The player left of the dealer leads. Follow suit if you can; otherwise play anything. The highest trump, or the highest card of the suit led, wins.'],
      ['Scoring', 'The making team scores 1 for 3 or 4 tricks and 2 for all five (a <em>march</em>). If they take fewer than 3 they are <em>euchred</em> and the other team scores 2. Going alone and marching scores 4. First team to 10 wins.'],
    ],
  },
  create: (players, ctx, options) => {
    const s: S = {
      n: 4, names: players.map((p) => p.name), cpu: players.map((p) => p.kind === 'cpu'), hands: [], trick: [], lastTrick: [], leader: 0, turn: 0,
      won: [], tricks: [], trump: null, dealer: ctx.rng.int(4), deal: 0, fx: [], fxn: 0, log: [], collecting: null,
      phase: 'bid1', hand: 0, kitty: [], up: null, upTurned: false, maker: -1, alone: false, out: -1, passes: 0, score: [0, 0], target: Number(options.target ?? 10), result: '', lines: [], says: [],
    };
    startHand(s, ctx);
    return s;
  },
  toAct: (s) => (['bid1', 'bid2', 'discard', 'play'].includes(s.phase) ? [s.turn] : s.phase === 'roundEnd' || s.phase === 'over' ? [0, 1, 2, 3].filter((i) => !s.cpu[i]) : []),
  act,
  auto: (s) => (s.phase === 'collect' ? 1100 : s.phase === 'roundEnd' && s.cpu.every(Boolean) ? 10 : null),
  step,
  cpu,
  view,
  over: (s) => s.phase === 'over',
};
