/**
 * Gin Rummy for two: draw, discard, knock at 10 or less, gin for a bonus,
 * lay-offs against a knock, undercuts, and game to 100 with line bonuses.
 */
import { code, label, newDeck, type Card } from '../core/cards';
import type { Action, Ctx, FxEvent, GameDef, Seat, View, Zone } from '../core/types';
import { arrangeForView, bestMelds, layOffAll, pipValue } from '../core/util/melds';

type Phase = 'first' | 'draw' | 'discard' | 'show' | 'over';
interface S {
  names: string[];
  cpu: boolean[];
  hands: Card[][];
  stock: Card[];
  pile: Card[];
  phase: Phase;
  turn: Seat;
  dealer: Seat;
  firstPasses: number;
  tookDiscard: string | null;
  scores: [number, number];
  wins: [number, number];
  target: number;
  hand: number;
  // the showdown
  knocker: Seat;
  shown: { melds: Card[][]; dead: Card[]; laid: Card[] }[];
  result: string;
  lines: string[];
  deal: number;
  fx: FxEvent[];
  fxn: number;
  log: string[];
}

const fx = (s: S, k: string) => {
  s.fx.push({ n: ++s.fxn, k });
  if (s.fx.length > 12) s.fx.shift();
};
const log = (s: S, m: string) => {
  s.log.push(m);
  if (s.log.length > 60) s.log.shift();
};
const other = (i: Seat) => 1 - i;

function startHand(s: S, ctx: Ctx) {
  s.hand++;
  s.dealer = other(s.dealer);
  const deck = newDeck(ctx.rng);
  s.hands = [[], []];
  for (let r = 0; r < 10; r++) for (const p of [other(s.dealer), s.dealer]) s.hands[p].push(deck.pop()!);
  s.pile = [deck.pop()!];
  s.stock = deck;
  s.phase = 'first';
  s.turn = other(s.dealer);
  s.firstPasses = 0;
  s.tookDiscard = null;
  s.shown = [];
  s.knocker = -1;
  s.result = '';
  s.lines = [];
  s.deal++;
  fx(s, 'shuffle');
  log(s, `Hand ${s.hand}: upcard ${label(s.pile[0])}`);
}

/** Best deadwood after discarding the best card (hand has 11 cards). */
export function bestDiscard(hand: Card[], forbid?: string | null) {
  let best: { card: Card; dw: number } | null = null;
  for (const c of hand) {
    if (c.id === forbid) continue;
    const dw = bestMelds(hand.filter((x) => x !== c)).dw;
    if (!best || dw < best.dw || (dw === best.dw && pipValue(c) > pipValue(best.card))) best = { card: c, dw };
  }
  return best!;
}

function act(s: S, seat: Seat, a: Action, ctx: Ctx): string | void {
  if (s.phase === 'show') return a.t === 'next' ? void startHand(s, ctx) : 'Hold on';
  if (s.phase === 'over') {
    if (a.t !== 'rematch') return 'The game is over';
    s.scores = [0, 0];
    s.wins = [0, 0];
    s.hand = 0;
    return void startHand(s, ctx);
  }
  if (seat !== s.turn) return "It isn't your turn";
  const hand = s.hands[seat];
  if (s.phase === 'first') {
    if (a.t === 'pass') {
      s.firstPasses++;
      log(s, `${s.names[seat]} passes the upcard`);
      if (s.firstPasses === 2) {
        s.phase = 'draw';
        s.turn = other(s.dealer);
      } else s.turn = other(seat);
      return;
    }
    if (a.t !== 'draw' || a.from !== 'discard') return 'Take the upcard or pass';
  }
  if (s.phase === 'first' || s.phase === 'draw') {
    if (a.t !== 'draw') return 'Draw from the stock or the discard pile';
    if (a.from === 'discard') {
      if (!s.pile.length) return 'The discard pile is empty';
      const c = s.pile.pop()!;
      hand.push(c);
      s.tookDiscard = c.id;
      log(s, `${s.names[seat]} takes ${label(c)}`);
    } else {
      if (s.phase === 'first') return 'Take the upcard or pass';
      hand.push(s.stock.pop()!);
      s.tookDiscard = null;
    }
    fx(s, 'draw');
    s.phase = 'discard';
    return;
  }
  if (s.phase !== 'discard') return 'Draw first';
  const card = hand.find((c) => c.id === a.card);
  if (!card) return 'Choose a card to discard';
  if (card.id === s.tookDiscard) return "You can't throw back the card you just took";
  if (a.t === 'knock' || a.t === 'gin') {
    const rest = hand.filter((c) => c !== card);
    const arr = bestMelds(rest);
    if (arr.dw > 10) return `Your deadwood is ${arr.dw}: you need 10 or less to knock`;
    s.hands[seat] = rest;
    s.pile.push(card);
    return knock(s, seat);
  }
  if (a.t !== 'discard') return 'Discard a card';
  s.hands[seat] = hand.filter((c) => c !== card);
  s.pile.push(card);
  s.tookDiscard = null;
  fx(s, 'fold');
  if (s.stock.length <= 2) {
    s.result = 'The stock ran out: no score';
    s.lines = ['This hand is a wash. The deal passes on.'];
    s.shown = s.hands.map((h) => ({ ...splitArr(h), laid: [] }));
    s.phase = 'show';
    return;
  }
  s.phase = 'draw';
  s.turn = other(seat);
}

const splitArr = (h: Card[]) => {
  const a = bestMelds(h);
  return { melds: a.melds, dead: a.deadwood };
};

function knock(s: S, k: Seat) {
  const d = other(k);
  const ka = bestMelds(s.hands[k]);
  const gin = ka.dw === 0;
  const da = bestMelds(s.hands[d]);
  let defDead = da.deadwood, laid: Card[] = [];
  if (!gin) {
    const lo = layOffAll(ka.melds, da.deadwood);
    laid = lo.laid;
    defDead = lo.rest;
  }
  const kdw = ka.dw, ddw = defDead.reduce((a, c) => a + pipValue(c), 0);
  s.knocker = k;
  s.shown = [];
  s.shown[k] = { melds: ka.melds, dead: ka.deadwood, laid: [] };
  s.shown[d] = { melds: da.melds, dead: defDead, laid };
  let w: Seat, pts: number;
  if (gin) {
    w = k;
    pts = 25 + ddw;
    s.result = `${s.names[k]} goes gin! +${pts}`;
    fx(s, 'win');
  } else if (kdw < ddw) {
    w = k;
    pts = ddw - kdw;
    s.result = `${s.names[k]} knocks with ${kdw}: +${pts}`;
  } else {
    w = d;
    pts = 25 + kdw - ddw;
    s.result = `Undercut! ${s.names[d]} +${pts}`;
    fx(s, 'allin');
  }
  s.scores[w] += pts;
  s.wins[w]++;
  s.lines = [`${s.names[k]} deadwood ${kdw} · ${s.names[d]} deadwood ${ddw}${laid.length ? ` after laying off ${laid.length}` : ''}`, `Score ${s.names[0]} ${s.scores[0]} – ${s.scores[1]} ${s.names[1]}`];
  log(s, s.result);
  if (s.scores[w] >= s.target) {
    const total = (i: Seat) => s.scores[i] + 100 * (i === w ? 1 : 0) + 25 * s.wins[i];
    s.result = `${s.names[w]} wins the game, ${total(w)} to ${total(other(w))}`;
    s.lines = [`Includes a 100-point game bonus and 25 per hand won.`];
    s.phase = 'over';
    fx(s, 'win');
  } else s.phase = 'show';
}

function cpu(s: S, seat: Seat, ctx: Ctx): Action | null {
  if (s.turn !== seat) return null;
  const hand = s.hands[seat];
  const now = bestMelds(hand).dw;
  if (s.phase === 'first' || s.phase === 'draw') {
    const top = s.pile[s.pile.length - 1];
    if (top) {
      const withTop = bestDiscard([...hand, top], top.id);
      const gain = now - withTop.dw;
      if (gain >= (ctx.level === 'hard' ? 3 : 5) || withTop.dw === 0) return { t: 'draw', from: 'discard' };
    }
    return s.phase === 'first' ? { t: 'pass' } : { t: 'draw', from: 'stock' };
  }
  if (s.phase !== 'discard') return null;
  const b = bestDiscard(hand, s.tookDiscard);
  const knockAt = { easy: 10, normal: 10, hard: s.stock.length > 20 ? 6 : 10 }[ctx.level ?? 'normal'];
  if (b.dw === 0) return { t: 'gin', card: b.card.id };
  if (b.dw <= knockAt) return { t: 'knock', card: b.card.id };
  return { t: 'discard', card: b.card.id };
}

function view(s: S, viewer: Seat): View {
  const zones: Zone[] = [];
  const show = s.phase === 'show' || s.phase === 'over';
  const myTurn = s.turn === viewer && !show;
  const drawing = myTurn && (s.phase === 'draw' || s.phase === 'first');
  zones.push({
    id: 'stock',
    at: { x: -0.2, y: -0.12, p: [-0.3, -0.2] },
    lay: 'stack',
    deck: true,
    count: s.stock.length,
    label: `${s.stock.length}`,
    act: drawing && s.phase === 'draw' ? { t: 'draw', from: 'stock' } : undefined,
    cards: s.stock.slice(-6).map((c) => ({ id: c.id })),
  });
  zones.push({
    id: 'pile',
    at: { x: 0.2, y: -0.12, p: [0.3, -0.2] },
    lay: 'stack',
    act: drawing && s.pile.length ? { t: 'draw', from: 'discard' } : undefined,
    cards: s.pile.slice(-5).map((c, i, arr) => ({ id: c.id, f: code(c), rot: ((c.id.charCodeAt(c.id.length - 1) % 9) - 4) * 1.5, hi: drawing && i === arr.length - 1 })),
  });
  for (let i = 0; i < 2; i++) {
    if (show && s.shown[i]) {
      const sh = s.shown[i];
      const groups = [...sh.melds, ...(sh.dead.length ? [sh.dead] : [])];
      groups.forEach((g, k) =>
        zones.push({
          id: `p${i}g${k}`,
          at: { seat: i, slot: 'hand', i: k, n: groups.length },
          lay: 'row',
          gap: 0.34,
          scale: i === viewer ? 0.7 : 1.15,
          cards: g.map((c) => ({ id: c.id, f: code(c), dim: k === groups.length - 1 && sh.dead.length > 0, hi: sh.laid.includes(c) })),
        }),
      );
      continue;
    }
    const hand = i === viewer ? arrangeForView(s.hands[i]) : s.hands[i];
    const discarding = myTurn && s.phase === 'discard' && i === viewer;
    zones.push({
      id: 'h' + i,
      at: { seat: i, slot: 'hand' },
      lay: 'fan',
      cards: hand.map((c) => ({
        id: c.id,
        f: i === viewer ? code(c) : undefined,
        act: discarding && c.id !== s.tookDiscard ? { t: 'discard', card: c.id } : undefined,
        hi: i === viewer && c.id === s.tookDiscard,
      })),
    });
  }
  const buttons: View['buttons'] = [];
  let prompt: string | undefined;
  const mine = s.hands[viewer];
  if (myTurn && s.phase === 'first') {
    buttons.push({ label: 'Pass', a: { t: 'pass' }, kind: 'ghost' });
    buttons.push({ label: `Take ${label(s.pile[s.pile.length - 1])}`, a: { t: 'draw', from: 'discard' }, kind: 'primary' });
    prompt = 'Take the upcard, or pass it';
  } else if (myTurn && s.phase === 'draw') {
    buttons.push({ label: 'Draw from stock', a: { t: 'draw', from: 'stock' }, kind: 'primary', key: 'd' });
    if (s.pile.length) buttons.push({ label: `Take ${label(s.pile[s.pile.length - 1])}`, a: { t: 'draw', from: 'discard' }, key: 't' });
    prompt = `Draw a card · deadwood ${bestMelds(mine).dw}`;
  }
  else if (myTurn && s.phase === 'discard') {
    const b = bestDiscard(mine, s.tookDiscard);
    if (b.dw === 0) buttons.push({ label: `Gin! (discard ${label(b.card)})`, a: { t: 'gin', card: b.card.id }, kind: 'primary', key: 'g' });
    else if (b.dw <= 10) buttons.push({ label: `Knock with ${b.dw} (discard ${label(b.card)})`, a: { t: 'knock', card: b.card.id }, kind: 'primary', key: 'k' });
    prompt = `Tap a card to discard · best deadwood ${b.dw}`;
  } else if (!show) prompt = `${s.names[s.turn]} is ${s.phase === 'discard' ? 'discarding' : 'drawing'}…`;
  if (s.phase === 'show' && !s.cpu[viewer]) buttons.push({ label: 'Next hand', a: { t: 'next' }, kind: 'primary', key: 'n' });
  if (s.phase === 'over' && !s.cpu[viewer]) buttons.push({ label: 'Play again', a: { t: 'rematch' }, kind: 'primary' });
  return {
    game: 'gin',
    viewer,
    seats: s.names.map((name, i) => ({ name, cpu: s.cpu[i], score: `${s.scores[i]} pts`, sub: `${s.wins[i]} hand${s.wins[i] === 1 ? '' : 's'} won`, badges: i === s.dealer ? ['D'] : [], active: s.turn === i && !show, win: show && s.result.startsWith(s.names[i]) })),
    zones,
    buttons,
    prompt,
    status: `Hand ${s.hand} · ${s.names[0]} ${s.scores[0]} – ${s.scores[1]} ${s.names[1]} · to ${s.target}`,
    banner: show && s.result ? { title: s.result, lines: s.lines, tone: s.result.includes(s.names[viewer]) && !s.result.startsWith('Undercut') ? 'win' : 'info' } : undefined,
    log: s.log.slice(-30),
    deal: s.deal,
    fx: s.fx,
    over: s.phase === 'over',
  };
}

export const gin: GameDef<S> = {
  meta: {
    id: 'gin',
    name: 'Gin Rummy',
    family: 'Rummy',
    players: { min: 2, max: 2, def: 2 },
    blurb: 'Build sets and runs, knock at ten or less, and watch for the undercut.',
    hero: ['7H', '8H', '9H', 'QS', 'QD'],
    length: '20–30 min',
    options: [{ id: 'target', label: 'Game ends at', type: 'select', default: 100, choices: [{ value: 50, label: '50 points' }, { value: 100, label: '100 points' }] }],
    rules: [
      ['Goal', 'Arrange your ten cards into <em>melds</em>: sets of three or four of a kind, and runs of three or more in one suit (ace is low). Cards outside melds are <em>deadwood</em>.'],
      ['Your turn', 'Draw the top card of the stock or the discard pile, then discard one card. You may not throw back the card you just took from the discard pile.'],
      ['First turn', 'The non-dealer may take the upcard or pass; then the dealer may. If both pass, the non-dealer draws from the stock.'],
      ['Knocking', 'When your deadwood is 10 or less after discarding, you may knock and lay down your hand. Your opponent lays down theirs and may lay off deadwood onto your melds.'],
      ['Scoring', 'The knocker scores the difference in deadwood. Gin (no deadwood) scores 25 plus the opponent’s deadwood, with no lay-offs. If the defender ties or beats the knocker, that is an <em>undercut</em>: the defender scores 25 plus the difference.'],
      ['Game', 'First to 100 wins, with a 100-point game bonus and 25 points for each hand won.'],
    ],
  },
  create: (players, ctx, options) => {
    const s: S = {
      names: players.map((p) => p.name), cpu: players.map((p) => p.kind === 'cpu'), hands: [], stock: [], pile: [], phase: 'first', turn: 0, dealer: ctx.rng.int(2), firstPasses: 0,
      tookDiscard: null, scores: [0, 0], wins: [0, 0], target: Number(options.target ?? 100), hand: 0, knocker: -1, shown: [], result: '', lines: [], deal: 0, fx: [], fxn: 0, log: [],
    };
    startHand(s, ctx);
    return s;
  },
  toAct: (s) => (s.phase === 'show' || s.phase === 'over' ? [0, 1].filter((i) => !s.cpu[i]) : [s.turn]),
  act,
  auto: (s) => (s.phase === 'show' && s.cpu.every(Boolean) ? 10 : null),
  step: (s, ctx) => startHand(s, ctx),
  cpu,
  view,
  over: (s) => s.phase === 'over',
};
