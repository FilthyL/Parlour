/**
 * Cribbage for two: discard to the crib, cut the starter, peg to 31 (15s,
 * pairs, runs, go, last card), then count hands and crib (15s, pairs, runs,
 * flushes, nobs). First to 121 wins, and pegging out ends it on the spot.
 */
import { code, label, newDeck, type Card } from '../core/cards';
import type { Action, Ctx, GameDef, Seat, View, Zone } from '../core/types';
import { base, fx, humans, log, type Base } from './shared';

type Phase = 'discard' | 'cut' | 'peg' | 'show' | 'over';
interface S extends Base {
  hands: Card[][]; // full kept hand (4 cards) for the show
  pegHands: Card[][]; // cards still to peg
  played: Card[][]; // pegged cards in front of each player
  crib: Card[];
  stock: Card[];
  starter: Card | null;
  phase: Phase;
  dealer: Seat;
  turn: Seat;
  count: number;
  seq: Card[];
  lastPlayer: Seat;
  discards: (Card[] | null)[];
  scores: [number, number];
  prev: [number, number];
  showStep: number; // 0 pone, 1 dealer, 2 crib
  showLines: string[];
  showTitle: string;
  says: (string | undefined)[];
  winner: Seat;
  target: number;
}

const val = (c: Card) => Math.min(10, c.r);
/** peg() can end the game at any moment */
const isOver = (s: S) => s.phase === ('over' as Phase);
const other = (i: Seat) => 1 - i;

/** Score a hand of four plus the starter. */
export function scoreHand(hand: Card[], starter: Card, crib = false): { total: number; lines: string[] } {
  const all = [...hand, starter];
  const lines: string[] = [];
  let total = 0;
  // fifteens
  let fifteens = 0;
  for (let m = 1; m < 32; m++) {
    let s = 0;
    for (let i = 0; i < 5; i++) if (m & (1 << i)) s += val(all[i]);
    if (s === 15) fifteens++;
  }
  if (fifteens) {
    total += fifteens * 2;
    lines.push(`Fifteen ${fifteens * 2}`);
  }
  // pairs
  let pairs = 0;
  for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) if (all[i].r === all[j].r) pairs++;
  if (pairs) {
    total += pairs * 2;
    lines.push(`${pairs === 1 ? 'A pair' : pairs === 3 ? 'Pair royal' : pairs === 6 ? 'Double pair royal' : `${pairs} pairs`} ${pairs * 2}`);
  }
  // runs (with multiplicity)
  const counts = new Map<number, number>();
  for (const c of all) counts.set(c.r, (counts.get(c.r) ?? 0) + 1);
  const ranks = [...counts.keys()].sort((a, b) => a - b);
  let runPts = 0;
  for (let i = 0; i < ranks.length; ) {
    let j = i;
    while (j + 1 < ranks.length && ranks[j + 1] === ranks[j] + 1) j++;
    const len = j - i + 1;
    if (len >= 3) {
      let mult = 1;
      for (let k = i; k <= j; k++) mult *= counts.get(ranks[k])!;
      runPts += len * mult;
      lines.push(`${mult > 1 ? `${mult === 2 ? 'Double' : mult === 3 ? 'Triple' : 'Quadruple'} run` : 'Run'} of ${len} ${len * mult}`);
    }
    i = j + 1;
  }
  total += runPts;
  // flush
  if (hand.every((c) => c.s === hand[0].s)) {
    if (starter.s === hand[0].s) {
      total += 5;
      lines.push('Flush 5');
    } else if (!crib) {
      total += 4;
      lines.push('Flush 4');
    }
  }
  // nobs
  if (hand.some((c) => c.r === 11 && c.s === starter.s)) {
    total += 1;
    lines.push('One for his nobs');
  }
  return { total, lines };
}

/** Points for the card just played in the pegging sequence. */
export function pegPoints(seq: Card[], count: number): { pts: number; why: string[] } {
  const why: string[] = [];
  let pts = 0;
  if (count === 15) {
    pts += 2;
    why.push('Fifteen 2');
  }
  if (count === 31) {
    pts += 2;
    why.push('Thirty-one 2');
  }
  let same = 1;
  for (let i = seq.length - 2; i >= 0 && seq[i].r === seq[seq.length - 1].r; i--) same++;
  if (same >= 2) {
    const p = { 2: 2, 3: 6, 4: 12 }[same]!;
    pts += p;
    why.push(`${same === 2 ? 'Pair' : same === 3 ? 'Pair royal' : 'Double pair royal'} ${p}`);
  }
  for (let k = seq.length; k >= 3; k--) {
    const rs = seq.slice(-k).map((c) => c.r).sort((a, b) => a - b);
    let ok = true;
    for (let i = 1; i < rs.length; i++) if (rs[i] !== rs[i - 1] + 1) { ok = false; break; }
    if (ok) {
      pts += k;
      why.push(`Run of ${k} ${k}`);
      break;
    }
  }
  return { pts, why };
}

function peg(s: S, i: Seat, pts: number, why: string) {
  if (!pts || s.phase === 'over') return;
  s.prev[i] = s.scores[i];
  s.scores[i] = Math.min(s.target, s.scores[i] + pts);
  s.says[i] = why;
  log(s, `${s.names[i]}: ${why}`);
  fx(s, 'chips');
  if (s.scores[i] >= s.target) {
    s.winner = i;
    s.phase = 'over';
    fx(s, 'win');
  }
}

function startHand(s: S, ctx: Ctx) {
  s.dealer = other(s.dealer);
  const deck = newDeck(ctx.rng);
  s.hands = [[], []];
  for (let r = 0; r < 6; r++) for (const p of [other(s.dealer), s.dealer]) s.hands[p].push(deck.pop()!);
  s.stock = deck;
  s.crib = [];
  s.starter = null;
  s.discards = [null, null];
  s.pegHands = [[], []];
  s.played = [[], []];
  s.count = 0;
  s.seq = [];
  s.lastPlayer = -1;
  s.says = [undefined, undefined];
  s.showStep = 0;
  s.showLines = [];
  s.showTitle = '';
  s.phase = 'discard';
  s.deal++;
  fx(s, 'shuffle');
  log(s, `${s.names[s.dealer]} deals; the crib is theirs`);
}

const canPlayAny = (s: S, i: Seat) => s.pegHands[i].some((c) => s.count + val(c) <= 31);

function afterPegPlay(s: S) {
  if (s.phase === 'over') return;
  const lp = s.lastPlayer;
  const done = !s.pegHands[0].length && !s.pegHands[1].length;
  if (done) {
    if (s.count !== 31) peg(s, lp, 1, 'Last card 1');
    if (isOver(s)) return;
    s.phase = 'show';
    s.showStep = 0;
    s.pegHands = [[], []];
    return prepareShow(s);
  }
  if (s.count === 31) return resetCount(s, other(lp));
  const o = other(lp);
  if (canPlayAny(s, o)) return void (s.turn = o);
  if (s.pegHands[o].length) s.says[o] = 'Go';
  if (canPlayAny(s, lp)) return void (s.turn = lp);
  // nobody can play: one for the go, and start again from zero
  peg(s, lp, 1, 'One for the go');
  if (isOver(s)) return;
  resetCount(s, o);
}

function resetCount(s: S, nextP: Seat) {
  s.count = 0;
  s.seq = [];
  s.turn = s.pegHands[nextP].length ? nextP : other(nextP);
}

function prepareShow(s: S) {
  const who = s.showStep === 0 ? other(s.dealer) : s.dealer;
  const hand = s.showStep === 2 ? s.crib : s.hands[who];
  const r = scoreHand(hand, s.starter!, s.showStep === 2);
  s.showTitle = `${s.names[who]}'s ${s.showStep === 2 ? 'crib' : 'hand'}: ${r.total}`;
  s.showLines = r.lines.length ? r.lines : ['Nineteen (nothing)'];
  peg(s, who, r.total, `${s.showStep === 2 ? 'Crib' : 'Hand'} ${r.total}`);
}

function act(s: S, seat: Seat, a: Action, ctx: Ctx): string | void {
  if (s.phase === 'over') {
    if (a.t !== 'rematch') return 'The game is over';
    s.scores = [0, 0];
    s.prev = [0, 0];
    s.winner = -1;
    return void startHand(s, ctx);
  }
  if (s.phase === 'discard') {
    if (s.discards[seat]) return 'Waiting for your opponent';
    const cards = ((a.cards as string[]) ?? []).map((id) => s.hands[seat].find((c) => c.id === id)).filter(Boolean) as Card[];
    if (a.t !== 'crib' || cards.length !== 2) return 'Choose two cards for the crib';
    s.discards[seat] = cards;
    s.hands[seat] = s.hands[seat].filter((c) => !cards.includes(c));
    s.crib.push(...cards);
    fx(s, 'fold');
    if (s.discards.every(Boolean)) s.phase = 'cut';
    return;
  }
  if (s.phase === 'cut') {
    if (seat !== other(s.dealer) || a.t !== 'cut') return 'The pone cuts the deck';
    return void doCut(s, ctx);
  }
  if (s.phase === 'show') {
    if (a.t !== 'next') return 'Continue the count';
    return void nextShow(s, ctx);
  }
  if (s.phase !== 'peg') return 'Hold on';
  if (seat !== s.turn) return "It isn't your turn";
  const card = s.pegHands[seat].find((c) => c.id === a.card);
  if (a.t !== 'play' || !card) return 'Play a card';
  if (s.count + val(card) > 31) return `That would make ${s.count + val(card)}: over 31`;
  s.pegHands[seat] = s.pegHands[seat].filter((c) => c !== card);
  s.played[seat].push(card);
  s.seq.push(card);
  s.count += val(card);
  s.lastPlayer = seat;
  s.says = [undefined, undefined];
  s.says[seat] = String(s.count);
  const pp = pegPoints(s.seq, s.count);
  if (pp.pts) peg(s, seat, pp.pts, `${s.count}: ${pp.why.join(', ')}`);
  else fx(s, 'draw');
  afterPegPlay(s);
}

function doCut(s: S, ctx: Ctx) {
  const at = 4 + ctx.rng.int(s.stock.length - 8);
  s.starter = s.stock.splice(at, 1)[0];
  log(s, `The starter is ${label(s.starter)}`);
  fx(s, 'flip');
  s.phase = 'peg';
  s.pegHands = [[...s.hands[0]], [...s.hands[1]]];
  s.turn = other(s.dealer);
  if (s.starter.r === 11) peg(s, s.dealer, 2, 'Two for his heels');
}

function nextShow(s: S, ctx: Ctx) {
  if (s.showStep >= 2) return startHand(s, ctx);
  s.showStep++;
  prepareShow(s);
}

// ---------------------------------------------------------------- CPU
function chooseDiscard(hand: Card[], dealer: boolean, ctx: Ctx): Card[] {
  if (ctx.level === 'easy') return ctx.rng.shuffle([...hand]).slice(0, 2);
  const deck = newDeck(ctx.rng).filter((c) => !hand.some((h) => h.r === c.r && h.s === c.s));
  let best: Card[] = [], bv = -Infinity;
  for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) {
    const keep = hand.filter((_, k) => k !== i && k !== j);
    const toss = [hand[i], hand[j]];
    let ev = 0;
    for (const st of deck) ev += scoreHand(keep, st).total;
    ev /= deck.length;
    // a rough crib value for the two tossed cards
    let crib = toss[0].r === toss[1].r ? 2 : 0;
    if (val(toss[0]) + val(toss[1]) === 15) crib += 2;
    if (toss.some((c) => c.r === 5)) crib += 1;
    if (Math.abs(toss[0].r - toss[1].r) === 1) crib += 0.5;
    const v = ev + (dealer ? crib : -crib);
    if (v > bv) { bv = v; best = toss; }
  }
  return best;
}

function cpu(s: S, seat: Seat, ctx: Ctx): Action | null {
  if (s.phase === 'discard') return s.discards[seat] ? null : { t: 'crib', cards: chooseDiscard(s.hands[seat], seat === s.dealer, ctx).map((c) => c.id) };
  if (s.phase === 'cut') return seat === other(s.dealer) ? { t: 'cut' } : null;
  if (s.phase === 'show') return null;
  if (s.phase !== 'peg' || s.turn !== seat) return null;
  const ok = s.pegHands[seat].filter((c) => s.count + val(c) <= 31);
  if (ctx.level === 'easy') return { t: 'play', card: ctx.rng.pick(ok).id };
  const score = (c: Card) => {
    const cnt = s.count + val(c);
    let v = pegPoints([...s.seq, c], cnt).pts * 3;
    if (cnt === 5 || cnt === 21) v -= 2; // invites a fifteen or thirty-one
    if (cnt < 15 && cnt + 10 === 15) v -= 1;
    v -= val(c) * 0.05; // keep low cards for later counts
    if (s.seq.length && s.seq[s.seq.length - 1].r === c.r && cnt + val(c) <= 31) v -= 0.5; // risk of a pair royal
    return v;
  };
  return { t: 'play', card: [...ok].sort((a, b) => score(b) - score(a))[0].id };
}

// ---------------------------------------------------------------- view
function view(s: S, viewer: Seat): View {
  const zones: Zone[] = [];
  const show = s.phase === 'show' || s.phase === 'over';
  for (let i = 0; i < 2; i++) {
    const mine = i === viewer;
    const discarding = s.phase === 'discard' && mine && !s.discards[i] && !s.cpu[i];
    const pegging = s.phase === 'peg' && s.turn === i && mine;
    const hand = s.phase === 'discard' ? s.hands[i] : s.phase === 'peg' ? s.pegHands[i] : [];
    zones.push({
      id: 'h' + i,
      at: { seat: i, slot: 'hand' },
      lay: 'fan',
      cards: [...hand].sort((a, b) => (mine ? a.r - b.r : 0)).map((c) => ({ id: c.id, f: mine ? code(c) : undefined, sel: discarding ? true : undefined, act: pegging && s.count + val(c) <= 31 ? { t: 'play', card: c.id } : undefined, dim: pegging && s.count + val(c) > 31 })),
    });
    // pegged cards in front; at the show, the counted hand
    const front = show && s.showStep < 2 && ((s.showStep === 0 && i === other(s.dealer)) || s.showStep >= 1) ? s.hands[i] : s.played[i];
    if (front.length) zones.push({ id: 'front' + i, at: { seat: i, slot: 'front' }, lay: 'row', gap: 0.46, scale: 0.78, cards: front.map((c) => ({ id: c.id, f: code(c), dim: s.phase === 'peg' && !s.seq.includes(c) })) });
  }
  zones.push({ id: 'stock', at: { x: 0.36, y: -0.06, p: [0.3, -0.1] }, lay: 'stack', deck: true, count: s.stock.length, cards: [...s.stock.slice(-5).map((c) => ({ id: c.id })), ...(s.starter ? [{ id: s.starter.id, f: code(s.starter), rot: 6 }] : [])], label: s.starter ? 'Starter' : undefined, act: s.phase === 'cut' && viewer === other(s.dealer) ? { t: 'cut' } : undefined });
  const cribShown = show && s.showStep === 2;
  zones.push({ id: 'crib', at: { x: -0.36, y: -0.06, p: [-0.3, -0.1] }, lay: cribShown ? 'row' : 'stack', gap: 0.46, scale: cribShown ? 0.78 : 0.8, label: `${s.names[s.dealer]}'s crib`, cards: s.crib.map((c) => ({ id: c.id, f: cribShown ? code(c) : undefined })) });
  const buttons: View['buttons'] = [];
  let prompt: string | undefined;
  if (s.phase === 'discard' && !s.discards[viewer] && !s.cpu[viewer]) {
    buttons.push({ label: `To ${viewer === s.dealer ? 'your' : `${s.names[s.dealer]}'s`} crib`, a: { t: 'crib' }, needSel: [2, 2], kind: 'primary' });
    prompt = `Choose two cards for ${viewer === s.dealer ? 'your' : "your opponent's"} crib`;
  } else if (s.phase === 'discard') prompt = 'Waiting for the crib…';
  else if (s.phase === 'cut' && viewer === other(s.dealer)) {
    buttons.push({ label: 'Cut the deck', a: { t: 'cut' }, kind: 'primary', key: 'c' });
    prompt = 'Cut for the starter';
  } else if (s.phase === 'peg') prompt = s.turn === viewer ? `Count is ${s.count}: play a card (31 or under)` : `${s.names[s.turn]} to play · count ${s.count}`;
  else if (s.phase === 'show' && !s.cpu[viewer]) buttons.push({ label: s.showStep >= 2 ? 'Next hand' : 'Continue', a: { t: 'next' }, kind: 'primary', key: 'n' });
  if (s.phase === 'over' && !s.cpu[viewer]) buttons.push({ label: 'Play again', a: { t: 'rematch' }, kind: 'primary' });
  return {
    game: 'cribbage',
    viewer,
    seats: s.names.map((name, i) => ({ name, cpu: s.cpu[i], score: `${s.scores[i]} / ${s.target}`, say: s.says[i], badges: i === s.dealer ? ['D'] : [], active: (s.phase === 'peg' && s.turn === i) || (s.phase === 'discard' && !s.discards[i]), win: s.phase === 'over' && i === s.winner })),
    zones,
    buttons,
    prompt,
    status: `${s.names[0]} ${s.scores[0]} – ${s.scores[1]} ${s.names[1]}${s.phase === 'peg' ? ` · count ${s.count}` : ''}`,
    banner: s.phase === 'over' ? { title: `${s.names[s.winner]} wins ${s.scores[s.winner]} to ${s.scores[other(s.winner)]}`, lines: s.scores[other(s.winner)] < 91 ? ['A skunk!'] : [], tone: s.winner === viewer ? 'win' : 'info' } : s.phase === 'show' ? { title: s.showTitle, lines: s.showLines, tone: 'info' } : undefined,
    log: s.log.slice(-30),
    deal: s.deal,
    fx: s.fx,
    peg: { scores: [...s.scores], prev: [...s.prev], target: s.target },
    over: s.phase === 'over',
  };
}

export const cribbage: GameDef<S> = {
  meta: {
    id: 'cribbage',
    name: 'Cribbage',
    family: 'Classic',
    players: { min: 2, max: 2, def: 2 },
    blurb: 'Fifteen two, fifteen four… peg your way round the board to 121.',
    hero: ['5H', '5S', 'JD', '5C', '10H'],
    length: '20–30 min',
    rules: [
      ['Deal and crib', 'Each player gets six cards and puts two face down into the <em>crib</em>, which belongs to the dealer. The non-dealer cuts and the dealer turns up the <em>starter</em>. A jack turned up scores 2 for the dealer.'],
      ['Pegging', 'Players take turns playing a card face up, keeping a running count that may not pass 31. Score 2 for making 15 or 31, 2 for a pair (6 for three, 12 for four), and the length of any run formed by the last cards. If you cannot play without passing 31 you say “Go”; the last player to play scores 1 and the count starts again.'],
      ['The show', 'The non-dealer counts first, then the dealer, then the dealer’s crib, each with the starter: 2 for each combination making 15, 2 per pair, runs by length, 4 for a flush in hand (5 with the starter; the crib needs all five), and 1 for the jack of the starter’s suit (<em>nobs</em>).'],
      ['Winning', 'The first to 121 wins, even in the middle of pegging.'],
    ],
  },
  create: (players, ctx) => {
    const s: S = { ...base(players), hands: [], pegHands: [], played: [], crib: [], stock: [], starter: null, phase: 'discard', dealer: ctx.rng.int(2), turn: 0, count: 0, seq: [], lastPlayer: -1, discards: [], scores: [0, 0], prev: [0, 0], showStep: 0, showLines: [], showTitle: '', says: [], winner: -1, target: 121 };
    startHand(s, ctx);
    return s;
  },
  toAct: (s) => (s.phase === 'discard' ? [0, 1].filter((i) => !s.discards[i]) : s.phase === 'cut' ? [other(s.dealer)] : s.phase === 'peg' ? [s.turn] : humans(s)),
  act,
  auto: (s) => (s.phase === 'show' && s.cpu.every(Boolean) ? 10 : s.phase === 'show' ? null : null),
  step: (s, ctx) => (s.phase === 'show' ? nextShow(s, ctx) : undefined),
  cpu,
  view,
  over: (s) => s.phase === 'over',
};
