/**
 * Blackjack against the house: six-deck shoe with a cut card, dealer stands
 * on soft 17, blackjack pays 3:2, double on any two, split up to four hands
 * (split aces take one card), insurance when the dealer shows an ace, and a
 * dealer peek for blackjack.
 */
import { code, newDeck, type Card } from '../core/cards';
import type { Action, ChipStack, Ctx, FxEvent, GameDef, Level, Seat, View, Zone } from '../core/types';

interface Hand {
  cards: Card[];
  bet: number;
  done: boolean;
  doubled: boolean;
  fromSplit: boolean;
  aces: boolean; // split aces: one card only
  result?: string;
}

interface P {
  name: string;
  cpu: boolean;
  level: Level;
  bank: number;
  bet: number; // the stake being built in the betting phase
  ready: boolean;
  hands: Hand[];
  insurance: number;
  insured: boolean | null;
  say?: string;
}

type Phase = 'bet' | 'insurance' | 'play' | 'dealer' | 'settle' | 'over';
interface S {
  players: P[];
  shoe: Card[];
  cutAt: number;
  discard: Card[];
  dealer: Card[];
  holeShown: boolean;
  phase: Phase;
  turn: Seat;
  hi: number; // index of the hand being played
  round: number;
  maxRounds: number;
  deal: number;
  fx: FxEvent[];
  fxn: number;
  log: string[];
  min: number;
  max: number;
}

const val = (c: Card) => (c.r === 1 ? 11 : Math.min(10, c.r));
export function total(cards: Card[]) {
  let t = 0, aces = 0;
  for (const c of cards) {
    t += val(c);
    if (c.r === 1) aces++;
  }
  while (t > 21 && aces) {
    t -= 10;
    aces--;
  }
  return { t, soft: aces > 0 };
}
const isBJ = (h: Card[]) => h.length === 2 && total(h).t === 21;
const fx = (s: S, k: string) => {
  s.fx.push({ n: ++s.fxn, k });
  if (s.fx.length > 12) s.fx.shift();
};
const log = (s: S, m: string) => {
  s.log.push(m);
  if (s.log.length > 60) s.log.shift();
};
const fmt = (n: number) => n.toLocaleString('en-US');

function draw(s: S, ctx: Ctx): Card {
  // the cut card makes this rare: reshuffle the tray without stopping the round
  if (!s.shoe.length) s.shoe = ctx.rng.shuffle(s.discard.splice(0));
  return s.shoe.pop()!;
}

function newShoe(s: S, ctx: Ctx) {
  s.shoe = newDeck(ctx.rng, { decks: 6 });
  s.cutAt = Math.floor(s.shoe.length * 0.25);
  s.discard = [];
  s.deal++;
  fx(s, 'shuffle');
  log(s, 'A fresh six-deck shoe');
}

function startRound(s: S, ctx: Ctx) {
  // clear the felt into the discard tray
  for (const p of s.players) for (const h of p.hands) s.discard.push(...h.cards);
  s.discard.push(...s.dealer);
  s.dealer = [];
  s.holeShown = false;
  if (s.shoe.length < s.cutAt) newShoe(s, ctx);
  s.round++;
  if (s.maxRounds && s.round > s.maxRounds) {
    s.phase = 'over';
    return;
  }
  s.phase = 'bet';
  for (const p of s.players) {
    p.hands = [];
    p.insurance = 0;
    p.insured = null;
    p.ready = false;
    p.say = undefined;
    if (p.cpu) {
      const base = { easy: [5, 100], normal: [25, 50], hard: [25, 100] }[p.level];
      const want = Math.round((base[0] + ctx.rng.next() * (base[1] - base[0])) / 5) * 5;
      p.bet = Math.min(p.bank, Math.max(s.min, want));
      p.ready = true;
    } else p.bet = Math.min(p.bank, p.bet || 25);
    if (p.bank < s.min) {
      p.bet = 0;
      p.ready = true;
    }
  }
  if (s.players.every((p) => p.ready)) dealRound(s, ctx);
}

function dealRound(s: S, ctx: Ctx) {
  const active = s.players.filter((p) => p.bet > 0);
  if (!active.length) {
    // nobody can bet: everyone rebuys at the table
    s.players.forEach((p) => (p.bank = 1000));
    return startRound(s, ctx);
  }
  for (const p of active) {
    p.bank -= p.bet;
    p.hands = [{ cards: [], bet: p.bet, done: false, doubled: false, fromSplit: false, aces: false }];
  }
  for (let r = 0; r < 2; r++) {
    for (const p of active) p.hands[0].cards.push(draw(s, ctx));
    s.dealer.push(draw(s, ctx));
  }
  fx(s, 'chips');
  log(s, `Round ${s.round}: dealer shows ${code(s.dealer[0])}`);
  if (s.dealer[0].r === 1) {
    s.phase = 'insurance';
    for (const p of s.players) p.insured = p.hands.length > 0 && p.bank >= Math.floor(p.hands[0].bet / 2) ? null : false;
    if (s.players.every((p) => p.insured !== null)) afterInsurance(s, ctx);
    return;
  }
  afterInsurance(s, ctx);
}

function afterInsurance(s: S, ctx: Ctx) {
  // dealer peeks with an ace or ten up
  if ((s.dealer[0].r === 1 || val(s.dealer[0]) === 10) && isBJ(s.dealer)) {
    s.holeShown = true;
    log(s, 'Dealer has blackjack');
    fx(s, 'flip');
    return settle(s, ctx);
  }
  for (const p of s.players) {
    if (p.insurance) {
      p.say = 'Insurance lost';
      p.insurance = 0;
    }
  }
  s.phase = 'play';
  s.turn = -1;
  advance(s, ctx);
}

/** Move to the next unfinished hand, or to the dealer. */
function advance(s: S, ctx: Ctx) {
  for (let i = Math.max(0, s.turn); i < s.players.length; i++) {
    const p = s.players[i];
    for (let h = i === s.turn ? s.hi : 0; h < p.hands.length; h++) {
      const hand = p.hands[h];
      if (hand.done) continue;
      if (hand.cards.length === 1) hand.cards.push(draw(s, ctx)); // second card for a split hand
      if (isBJ(hand.cards) && !hand.fromSplit) {
        hand.done = true;
        p.say = 'Blackjack!';
        continue;
      }
      if (hand.aces && hand.cards.length >= 2) {
        hand.done = true;
        continue;
      }
      if (total(hand.cards).t >= 21) {
        hand.done = true;
        continue;
      }
      s.turn = i;
      s.hi = h;
      return;
    }
  }
  s.phase = 'dealer';
  s.holeShown = true;
  fx(s, 'flip');
}

function dealerStep(s: S, ctx: Ctx) {
  const live = s.players.some((p) => p.hands.some((h) => total(h.cards).t <= 21 && !(isBJ(h.cards) && !h.fromSplit)));
  const d = total(s.dealer);
  if (live && (d.t < 17)) {
    s.dealer.push(draw(s, ctx));
    fx(s, 'street');
    return;
  }
  settle(s, ctx);
}

function settle(s: S, _ctx: Ctx) {
  const d = total(s.dealer);
  const dBJ = isBJ(s.dealer);
  for (const p of s.players) {
    if (dBJ && p.insurance) {
      p.bank += p.insurance * 3;
      p.say = `Insurance pays ${fmt(p.insurance * 2)}`;
    }
    let net = 0;
    for (const h of p.hands) {
      const t = total(h.cards).t;
      const bj = isBJ(h.cards) && !h.fromSplit;
      let pay = 0;
      if (t > 21) h.result = 'Bust';
      else if (bj && !dBJ) {
        pay = h.bet + Math.floor(h.bet * 1.5);
        h.result = 'Blackjack';
      } else if (dBJ && !bj) h.result = 'Dealer blackjack';
      else if (bj && dBJ) {
        pay = h.bet;
        h.result = 'Push';
      } else if (d.t > 21 || t > d.t) {
        pay = h.bet * 2;
        h.result = 'Win';
      } else if (t === d.t) {
        pay = h.bet;
        h.result = 'Push';
      } else h.result = 'Lose';
      p.bank += pay;
      net += pay - h.bet;
    }
    if (p.hands.length) p.say = net > 0 ? `Wins ${fmt(net)}` : net < 0 ? `Loses ${fmt(-net)}` : 'Push';
  }
  s.phase = 'settle';
  log(s, `Dealer ${d.t > 21 ? 'busts' : `has ${d.t}`}`);
  fx(s, 'pot');
}

function act(s: S, seat: Seat, a: Action, ctx: Ctx): string | void {
  const p = s.players[seat];
  if (s.phase === 'bet') {
    if (p.ready && a.t !== 'unready') return 'Waiting for the others to bet';
    switch (a.t) {
      case 'chip': {
        const v = Number(a.v);
        if (p.bet + v > Math.min(s.max, p.bank)) return p.bet + v > p.bank ? 'Not enough chips' : `Table maximum is ${fmt(s.max)}`;
        p.bet += v;
        fx(s, 'chips');
        return;
      }
      case 'clear':
        p.bet = 0;
        return;
      case 'rebuy':
        if (p.bank >= s.min) return 'You still have chips';
        p.bank = 1000;
        return;
      case 'sitout':
        p.bet = 0;
        p.ready = true;
        break;
      case 'deal':
        if (p.bet < s.min) return `Minimum bet is ${s.min}`;
        p.ready = true;
        break;
      default:
        return 'Place a bet';
    }
    if (s.players.every((x) => x.ready)) dealRound(s, ctx);
    return;
  }
  if (s.phase === 'insurance') {
    if (p.insured !== null) return 'Waiting for the others';
    if (a.t === 'insure') {
      const cost = Math.floor(p.hands[0].bet / 2);
      p.bank -= cost;
      p.insurance = cost;
      p.insured = true;
      p.say = 'Insured';
    } else p.insured = false;
    if (s.players.every((x) => x.insured !== null)) afterInsurance(s, ctx);
    return;
  }
  if (s.phase === 'settle') return a.t === 'next' ? void startRound(s, ctx) : 'Hold on';
  if (s.phase === 'over') return a.t === 'rematch' ? void reset(s, ctx) : 'The session is over';
  if (s.phase !== 'play' || seat !== s.turn) return "It isn't your turn";
  const hand = p.hands[s.hi];
  const opts = options(s, seat);
  switch (a.t) {
    case 'hit':
      hand.cards.push(draw(s, ctx));
      if (total(hand.cards).t >= 21) hand.done = true;
      p.say = total(hand.cards).t > 21 ? 'Bust' : undefined;
      break;
    case 'stand':
      hand.done = true;
      p.say = `Stands on ${total(hand.cards).t}`;
      break;
    case 'double':
      if (!opts.double) return 'You can only double on your first two cards';
      p.bank -= hand.bet;
      hand.bet *= 2;
      hand.doubled = true;
      hand.cards.push(draw(s, ctx));
      hand.done = true;
      p.say = 'Double';
      fx(s, 'chips');
      break;
    case 'split': {
      if (!opts.split) return 'You can split two cards of the same value';
      const [a1, a2] = hand.cards;
      const aces = a1.r === 1;
      p.bank -= hand.bet;
      p.hands.splice(s.hi, 1, { cards: [a1], bet: hand.bet, done: false, doubled: false, fromSplit: true, aces }, { cards: [a2], bet: hand.bet, done: false, doubled: false, fromSplit: true, aces });
      p.hands[s.hi].cards.push(draw(s, ctx));
      p.say = 'Split';
      fx(s, 'chips');
      break;
    }
    default:
      return 'Hit, stand, double or split';
  }
  advance(s, ctx);
}

function options(s: S, seat: Seat) {
  const p = s.players[seat];
  const h = p.hands[s.hi];
  if (!h) return { double: false, split: false };
  const two = h.cards.length === 2;
  return {
    double: two && !h.aces && p.bank >= h.bet,
    split: two && val(h.cards[0]) === val(h.cards[1]) && p.hands.length < 4 && p.bank >= h.bet && !(h.aces && h.fromSplit),
  };
}

function reset(s: S, ctx: Ctx) {
  s.players.forEach((p) => (p.bank = 1000));
  s.round = 0;
  startRound(s, ctx);
}

// ---------------------------------------------------------------- CPU: basic strategy
function basic(hand: Card[], up: Card, canDouble: boolean, canSplit: boolean): 'hit' | 'stand' | 'double' | 'split' {
  const u = val(up);
  const { t, soft } = total(hand);
  if (canSplit) {
    const r = val(hand[0]);
    if (r === 11 || r === 8) return 'split';
    if ((r === 2 || r === 3 || r === 7) && u <= 7) return 'split';
    if (r === 6 && u <= 6) return 'split';
    if (r === 9 && u !== 7 && u <= 9) return 'split';
    if (r === 4 && (u === 5 || u === 6)) return 'split';
  }
  if (soft && hand.length >= 2) {
    if (t >= 19) return 'stand';
    if (t === 18) return canDouble && u >= 3 && u <= 6 ? 'double' : u <= 8 ? 'stand' : 'hit';
    if (t === 17) return canDouble && u >= 3 && u <= 6 ? 'double' : 'hit';
    if (t >= 15) return canDouble && u >= 4 && u <= 6 ? 'double' : 'hit';
    return canDouble && u >= 5 && u <= 6 ? 'double' : 'hit';
  }
  if (t >= 17) return 'stand';
  if (t >= 13) return u <= 6 ? 'stand' : 'hit';
  if (t === 12) return u >= 4 && u <= 6 ? 'stand' : 'hit';
  if (t === 11) return canDouble && u <= 10 ? 'double' : 'hit';
  if (t === 10) return canDouble && u <= 9 ? 'double' : 'hit';
  if (t === 9) return canDouble && u >= 3 && u <= 6 ? 'double' : 'hit';
  return 'hit';
}

function cpu(s: S, seat: Seat, ctx: Ctx): Action | null {
  const p = s.players[seat];
  if (s.phase === 'insurance') return p.insured === null ? { t: ctx.level === 'easy' && ctx.rng.chance(0.3) ? 'insure' : 'decline' } : null;
  if (s.phase === 'bet') return p.ready ? null : { t: 'deal' };
  if (s.phase !== 'play' || s.turn !== seat) return null;
  const h = p.hands[s.hi];
  const o = options(s, seat);
  let move = basic(h.cards, s.dealer[0], o.double, o.split);
  if (ctx.level === 'easy' && ctx.rng.chance(0.2)) move = total(h.cards).t < 15 ? 'hit' : 'stand';
  return { t: move };
}

// ---------------------------------------------------------------- view
function handLabel(h: Card[], fromSplit = false) {
  const { t, soft } = total(h);
  if (isBJ(h) && !fromSplit) return 'Blackjack';
  if (t > 21) return `Bust ${t}`;
  return soft && t < 21 ? `Soft ${t}` : String(t);
}

function view(s: S, viewer: Seat): View {
  const zones: Zone[] = [];
  zones.push({ id: 'shoe', at: { x: 0.52, y: -0.5, p: [0.42, -0.62] }, lay: 'stack', deck: true, scale: 0.75, count: s.shoe.length, cards: s.shoe.slice(-6).map((c) => ({ id: c.id, rot: -8 })) });
  zones.push({ id: 'discard', at: { x: -0.52, y: -0.5, p: [-0.42, -0.62] }, lay: 'stack', scale: 0.75, cards: s.discard.slice(-6).map((c) => ({ id: c.id, rot: 8 })) });
  zones.push({
    id: 'dealer',
    at: { x: 0, y: -0.46, p: [0, -0.4] },
    lay: 'row',
    gap: 0.4,
    label: s.dealer.length ? (s.holeShown ? `Dealer ${handLabel(s.dealer)}` : `Dealer shows ${handLabel([s.dealer[0]])}`) : undefined,
    cards: s.dealer.map((c, i) => ({ id: c.id, f: i === 1 && !s.holeShown ? undefined : code(c) })),
  });
  const chips: ChipStack[] = [];
  s.players.forEach((p, i) => {
    const n = p.hands.length;
    p.hands.forEach((h, k) => {
      const active = s.phase === 'play' && s.turn === i && s.hi === k;
      zones.push({
        id: `p${i}h${k}`,
        at: { seat: i, slot: 'hand', i: k, n },
        lay: 'row',
        gap: 0.42,
        label: `${handLabel(h.cards, h.fromSplit)}${h.result && s.phase === 'settle' ? ` · ${h.result}` : ''}`,
        cards: h.cards.map((c) => ({ id: c.id, f: code(c), hi: active, dim: s.phase === 'settle' && (h.result === 'Lose' || h.result === 'Bust' || h.result === 'Dealer blackjack') })),
      });
    });
    const staked = s.phase === 'bet' ? p.bet : p.hands.reduce((a, h) => a + h.bet, 0);
    if (staked > 0) chips.push({ id: `bet${i}`, at: { seat: i, slot: 'bet' }, amount: staked });
  });
  const me = s.players[viewer];
  const buttons: View['buttons'] = [];
  let prompt: string | undefined;
  if (s.phase === 'bet' && !me.cpu) {
    if (!me.ready) {
      if (me.bank < s.min) buttons.push({ label: 'Rebuy 1,000', a: { t: 'rebuy' }, kind: 'primary' });
      else {
        for (const v of [5, 25, 100, 500]) buttons.push({ label: `+${v}`, a: { t: 'chip', v }, kind: 'ghost' });
        buttons.push({ label: 'Clear', a: { t: 'clear' }, kind: 'ghost' });
        buttons.push({ label: `Deal ${fmt(me.bet)}`, a: { t: 'deal' }, kind: 'primary', key: 'd' });
      }
      prompt = `Place your bet (${fmt(s.min)}–${fmt(s.max)})`;
    } else prompt = 'Waiting for the others to bet…';
  } else if (s.phase === 'insurance' && me.insured === null) {
    buttons.push({ label: `Insurance ${fmt(Math.floor(me.hands[0].bet / 2))}`, a: { t: 'insure' } });
    buttons.push({ label: 'No insurance', a: { t: 'decline' }, kind: 'primary' });
    prompt = 'The dealer shows an ace. Insurance pays 2 to 1 if they have blackjack';
  } else if (s.phase === 'play' && s.turn === viewer) {
    const o = options(s, viewer);
    buttons.push({ label: 'Stand', a: { t: 'stand' }, key: 's' });
    buttons.push({ label: 'Hit', a: { t: 'hit' }, kind: 'primary', key: 'h' });
    if (o.double) buttons.push({ label: 'Double', a: { t: 'double' }, key: 'd' });
    if (o.split) buttons.push({ label: 'Split', a: { t: 'split' }, key: 'p' });
    prompt = `${me.hands.length > 1 ? `Hand ${s.hi + 1}: ` : ''}${handLabel(me.hands[s.hi].cards)} against the dealer's ${code(s.dealer[0])}`;
  } else if (s.phase === 'play') prompt = `${s.players[s.turn].name} is playing`;
  else if (s.phase === 'settle' && !me.cpu) buttons.push({ label: 'Next round', a: { t: 'next' }, kind: 'primary', key: 'n' });
  else if (s.phase === 'over' && !me.cpu) buttons.push({ label: 'Play again', a: { t: 'rematch' }, kind: 'primary' });
  return {
    game: 'blackjack',
    viewer,
    seats: s.players.map((p, i) => ({
      name: p.name,
      cpu: p.cpu,
      chips: p.bank,
      say: p.say,
      active: (s.phase === 'play' && s.turn === i) || (s.phase === 'bet' && !p.ready) || (s.phase === 'insurance' && p.insured === null),
      win: s.phase === 'settle' && !!p.say?.startsWith('Wins'),
      out: !p.hands.length && s.phase !== 'bet',
    })),
    zones,
    chips,
    buttons,
    prompt,
    status: `Round ${s.round} · six decks · dealer stands on soft 17 · blackjack pays 3:2`,
    log: s.log.slice(-30),
    deal: s.deal,
    turn: s.phase === 'play' ? s.turn : undefined,
    fx: s.fx,
    over: s.phase === 'over',
  };
}

export const blackjack: GameDef<S> = {
  meta: {
    id: 'blackjack',
    name: 'Blackjack',
    family: 'Casino',
    players: { min: 1, max: 7, def: 3 },
    blurb: 'Beat the dealer to 21 from a six-deck shoe. Double, split, and take insurance if you dare.',
    hero: ['AS', 'KH', 'JD', 'AC', '10S'],
    length: 'Play as long as you like',
    options: [{ id: 'max', label: 'Table maximum', type: 'select', default: 500, choices: [{ value: 200, label: '200' }, { value: 500, label: '500' }, { value: 1000, label: '1,000' }] }],
    rules: [
      ['Goal', 'Get closer to 21 than the dealer without going over. Number cards count their value, face cards count 10, aces count 1 or 11.'],
      ['The deal', 'Place a bet, then everyone gets two cards face up and the dealer takes one up, one down. An ace and a ten-value card is a <em>blackjack</em>, paying 3 to 2.'],
      ['Your turn', '<em>Hit</em> to take a card, <em>stand</em> to stop, <em>double</em> your bet on your first two cards for exactly one more card, or <em>split</em> a pair into two hands (up to four). Split aces get one card each.'],
      ['Insurance', 'When the dealer shows an ace you may insure for half your bet. It pays 2 to 1 if the dealer has blackjack.'],
      ['The dealer', 'The dealer checks for blackjack when showing an ace or ten, reveals the hole card after everyone has played, and draws to 16, standing on all 17s.'],
      ['Payouts', 'Win pays 1 to 1, blackjack 3 to 2, ties push. The shoe is reshuffled when the cut card comes out.'],
    ],
  },
  create: (players, ctx, options) => {
    const s: S = {
      players: players.map((p) => ({ name: p.name, cpu: p.kind === 'cpu', level: p.level ?? 'normal', bank: 1000, bet: 25, ready: false, hands: [], insurance: 0, insured: null })),
      shoe: [], cutAt: 0, discard: [], dealer: [], holeShown: false, phase: 'bet', turn: -1, hi: 0, round: 0,
      maxRounds: Number(options.rounds ?? 0), deal: 0, fx: [], fxn: 0, log: [], min: 5, max: Number(options.max ?? 500),
    };
    newShoe(s, ctx);
    startRound(s, ctx);
    return s;
  },
  toAct: (s) => {
    if (s.phase === 'bet') return s.players.map((p, i) => (!p.ready ? i : -1)).filter((i) => i >= 0);
    if (s.phase === 'insurance') return s.players.map((p, i) => (p.insured === null ? i : -1)).filter((i) => i >= 0);
    if (s.phase === 'play') return [s.turn];
    if (s.phase === 'settle' || s.phase === 'over') return s.players.map((p, i) => (p.cpu ? -1 : i)).filter((i) => i >= 0);
    return [];
  },
  act,
  auto: (s) => (s.phase === 'dealer' ? 800 : s.phase === 'settle' ? (s.players.every((p) => p.cpu) ? 10 : 4200) : null),
  step: (s, ctx) => (s.phase === 'dealer' ? dealerStep(s, ctx) : s.phase === 'settle' ? startRound(s, ctx) : undefined),
  cpu,
  view,
  over: (s) => s.phase === 'over',
};
