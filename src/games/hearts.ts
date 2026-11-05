import { code, hi, label, newDeck, type Card } from '../core/cards';
import type { Action, Ctx, GameDef, Seat, View } from '../core/types';
import { baseView, chooseCard, dealRound, followable, fx, log, plainPower, trickWinner, trickZones, type TrickBase } from './tricks/common';

const PASS = ['left', 'right', 'across', 'hold'] as const;

interface S extends TrickBase {
  phase: 'pass' | 'play' | 'collect' | 'roundEnd' | 'over';
  hand: number;
  passes: (Card[] | null)[];
  broken: boolean;
  firstTrick: boolean;
  scores: number[];
  round: number[];
  target: number;
  result: string;
  lines: string[];
  received: string[][];
}

const points = (c: Card) => (c.s === 'H' ? 1 : c.s === 'S' && c.r === 12 ? 13 : 0);
const isQS = (c: Card) => c.s === 'S' && c.r === 12;
const passDir = (s: S) => PASS[(s.hand - 1) % 4];
const passTarget = (s: S, i: Seat) => (passDir(s) === 'left' ? (i + 1) % 4 : passDir(s) === 'right' ? (i + 3) % 4 : (i + 2) % 4);

function startHand(s: S, ctx: Ctx) {
  s.hand++;
  s.dealer = (s.dealer + 1) % 4;
  s.hands = dealRound(newDeck(ctx.rng), 4, s.dealer, 13);
  s.won = [[], [], [], []];
  s.tricks = [0, 0, 0, 0];
  s.round = [0, 0, 0, 0];
  s.trick = [];
  s.broken = false;
  s.firstTrick = true;
  s.passes = [null, null, null, null];
  s.received = [[], [], [], []];
  s.collecting = null;
  s.deal++;
  fx(s, 'shuffle');
  if (passDir(s) === 'hold') beginPlay(s);
  else s.phase = 'pass';
  log(s, `Hand ${s.hand}: ${passDir(s) === 'hold' ? 'no passing' : `pass three cards ${passDir(s)}`}`);
}

function beginPlay(s: S) {
  s.phase = 'play';
  const opener = s.hands.findIndex((h) => h.some((c) => c.s === 'C' && c.r === 2));
  s.leader = s.turn = opener;
}

function legal(s: S, seat: Seat): Card[] {
  const hand = s.hands[seat];
  if (!s.trick.length) {
    if (s.firstTrick) return hand.filter((c) => c.s === 'C' && c.r === 2);
    if (!s.broken) {
      const nonHearts = hand.filter((c) => c.s !== 'H');
      if (nonHearts.length) return nonHearts;
    }
    return hand;
  }
  let ok = followable(hand, s.trick);
  if (s.firstTrick && ok.length && ok[0].s !== s.trick[0].card.s) {
    // void on the first trick: no points allowed unless that's all you have
    const clean = ok.filter((c) => points(c) === 0);
    if (clean.length) ok = clean;
  }
  return ok;
}

function create(players: { name: string; kind: string }[], ctx: Ctx, options: Record<string, unknown>): S {
  const s: S = {
    n: 4,
    names: players.map((p) => p.name),
    cpu: players.map((p) => p.kind === 'cpu'),
    hands: [],
    trick: [],
    lastTrick: [],
    leader: 0,
    turn: 0,
    won: [],
    tricks: [],
    trump: null,
    dealer: ctx.rng.int(4),
    deal: 0,
    fx: [],
    fxn: 0,
    log: [],
    collecting: null,
    phase: 'pass',
    hand: 0,
    passes: [],
    broken: false,
    firstTrick: true,
    scores: [0, 0, 0, 0],
    round: [0, 0, 0, 0],
    target: Number(options.target ?? 100),
    result: '',
    lines: [],
    received: [[], [], [], []],
  };
  startHand(s, ctx);
  return s;
}

function act(s: S, seat: Seat, a: Action, ctx: Ctx): string | void {
  if (s.phase === 'pass') {
    if (a.t !== 'pass') return 'Choose three cards to pass';
    if (s.passes[seat]) return 'You already passed';
    const ids = (a.cards as string[]) ?? [];
    if (ids.length !== 3) return 'Pass exactly three cards';
    const cards = ids.map((id) => s.hands[seat].find((c) => c.id === id));
    if (cards.some((c) => !c)) return 'Those cards are not in your hand';
    s.passes[seat] = cards as Card[];
    s.hands[seat] = s.hands[seat].filter((c) => !ids.includes(c.id));
    fx(s, 'draw');
    if (s.passes.every(Boolean)) {
      for (let i = 0; i < 4; i++) {
        const to = passTarget(s, i);
        s.hands[to].push(...s.passes[i]!);
        s.received[to] = s.passes[i]!.map((c) => c.id);
      }
      log(s, 'Cards passed');
      beginPlay(s);
    }
    return;
  }
  if (s.phase === 'roundEnd') {
    if (a.t !== 'next') return 'Hold on';
    return void startHand(s, ctx);
  }
  if (s.phase === 'over') {
    if (a.t !== 'rematch') return 'The game is over';
    s.scores = [0, 0, 0, 0];
    s.hand = 0;
    return void startHand(s, ctx);
  }
  if (s.phase !== 'play') return 'Wait for the trick to be collected';
  if (seat !== s.turn) return "It isn't your turn";
  const card = s.hands[seat].find((c) => c.id === a.card);
  if (a.t !== 'play' || !card) return 'Play a card from your hand';
  if (!legal(s, seat).includes(card)) {
    if (s.firstTrick && !s.trick.length) return 'The 2 of clubs leads the first trick';
    if (!s.trick.length) return "Hearts aren't broken yet";
    return s.firstTrick ? 'No points on the first trick' : `You must follow ${s.trick[0].card.s === 'H' ? 'hearts' : 'suit'}`;
  }
  s.hands[seat] = s.hands[seat].filter((c) => c !== card);
  s.trick.push({ seat, card });
  s.received[seat] = [];
  if (card.s === 'H' && !s.broken) {
    s.broken = true;
    log(s, 'Hearts are broken');
    fx(s, 'flip');
  }
  if (isQS(card)) fx(s, 'allin');
  if (s.trick.length === 4) {
    s.collecting = trickWinner(s.trick, null).seat;
    s.phase = 'collect';
  } else s.turn = (seat + 1) % 4;
}

function step(s: S) {
  if (s.phase !== 'collect') return;
  const w = s.collecting!;
  const pts = s.trick.reduce((a, p) => a + points(p.card), 0);
  s.won[w].push(...s.trick.map((p) => p.card));
  s.round[w] += pts;
  s.tricks[w]++;
  s.lastTrick = s.trick;
  s.trick = [];
  s.collecting = null;
  s.firstTrick = false;
  log(s, `${s.names[w]} takes the trick${pts ? ` (${pts} point${pts > 1 ? 's' : ''})` : ''}`);
  fx(s, 'collect');
  if (s.hands.every((h) => !h.length)) return endHand(s);
  s.phase = 'play';
  s.leader = s.turn = w;
}

function endHand(s: S) {
  const moon = s.round.findIndex((r) => r === 26);
  const add = moon >= 0 ? s.round.map((_, i) => (i === moon ? 0 : 26)) : s.round;
  s.scores = s.scores.map((v, i) => v + add[i]);
  s.lines = s.names.map((nm, i) => `${nm}: ${add[i] ? `+${add[i]}` : '0'} → ${s.scores[i]}`);
  if (moon >= 0) {
    s.result = `${s.names[moon]} shot the moon!`;
    fx(s, 'win');
  } else s.result = `Hand ${s.hand} scored`;
  log(s, s.result);
  if (Math.max(...s.scores) >= s.target) {
    const low = Math.min(...s.scores);
    const w = s.scores.findIndex((v) => v === low);
    s.result = `${s.names[w]} wins with ${low} points`;
    s.phase = 'over';
    fx(s, 'win');
  } else s.phase = 'roundEnd';
}

function cpu(s: S, seat: Seat, ctx: Ctx): Action | null {
  if (s.phase === 'pass') {
    if (s.passes[seat]) return null;
    return { t: 'pass', cards: choosePass(s.hands[seat], ctx.level === 'easy' ? ctx.rng : null).map((c) => c.id) };
  }
  if (s.phase === 'play' && s.turn === seat) return { t: 'play', card: choosePlay(s, seat).id };
  return null;
}

function choosePass(hand: Card[], rng: { next(): number } | null): Card[] {
  if (rng) return [...hand].sort(() => rng.next() - 0.5).slice(0, 3);
  const spades = hand.filter((c) => c.s === 'S').length;
  const score = (c: Card) => {
    let v = hi(c);
    if (isQS(c)) v += spades >= 5 ? -5 : 30;
    if (c.s === 'S' && hi(c) > 12 && spades < 4) v += 20;
    if (c.s === 'H') v += 4;
    // shorten short suits so we can get void
    v += (4 - hand.filter((x) => x.s === c.s).length) * 1.5;
    if (c.s === 'C' && c.r === 2) v -= 20;
    return v;
  };
  return [...hand].sort((a, b) => score(b) - score(a)).slice(0, 3);
}

function choosePlay(s: S, seat: Seat): Card {
  const ok = legal(s, seat);
  if (ok.length === 1) return ok[0];
  if (!s.trick.length) {
    // lead low; avoid leading spades when holding A/K of spades without the queen
    const risky = (c: Card) => c.s === 'S' && hi(c) >= 13 && !s.hands[seat].some(isQS);
    const safe = ok.filter((c) => !risky(c) && !isQS(c));
    return [...(safe.length ? safe : ok)].sort((a, b) => hi(a) - hi(b))[0];
  }
  const lead = s.trick[0].card.s;
  const following = ok[0].s === lead;
  if (!following) {
    // void: unload the queen, then high spades, then high hearts, then the highest card
    const qs = ok.find(isQS);
    if (qs) return qs;
    const hiSp = ok.filter((c) => c.s === 'S' && hi(c) >= 13);
    if (hiSp.length) return hiSp[0];
    const hearts = ok.filter((c) => c.s === 'H').sort((a, b) => hi(b) - hi(a));
    if (hearts.length) return hearts[0];
    return [...ok].sort((a, b) => hi(b) - hi(a))[0];
  }
  const card = chooseCard(ok, s.trick, { trump: null, power: plainPower, wantWin: false, seat, n: 4 });
  // when forced to win a spade trick, don't win it with the queen if there is a choice
  if (isQS(card) && ok.length > 1) return ok.filter((c) => !isQS(c)).sort((a, b) => hi(b) - hi(a))[0];
  return card;
}

function view(s: S, viewer: Seat): View {
  const myTurn = s.phase === 'play' && s.turn === viewer;
  const passing = s.phase === 'pass' && !s.passes[viewer] && !s.cpu[viewer];
  const zones = trickZones(s, viewer, { playable: myTurn ? legal(s, viewer) : undefined, selectable: passing });
  // highlight cards just received in a pass
  const mine = zones.find((z) => z.id === 'h' + viewer)!;
  mine.cards.forEach((c) => s.received[viewer].includes(c.id) && (c.hi = true));
  const buttons: View['buttons'] = [];
  let prompt: string | undefined;
  if (passing) {
    buttons.push({ label: `Pass ${passDir(s)}`, a: { t: 'pass' }, needSel: [3, 3], kind: 'primary' });
    prompt = `Choose three cards to pass ${passDir(s)}${passDir(s) === 'across' ? '' : ''}`;
  } else if (s.phase === 'pass') prompt = 'Waiting for everyone to pass…';
  else if (myTurn) prompt = !s.trick.length ? (s.firstTrick ? 'Lead the 2 of clubs' : 'Your lead') : 'Your turn: follow suit if you can';
  else if (s.phase === 'play') prompt = `${s.names[s.turn]} to play`;
  if ((s.phase === 'roundEnd') && !s.cpu[viewer]) buttons.push({ label: 'Next hand', a: { t: 'next' }, kind: 'primary', key: 'n' });
  if (s.phase === 'over' && !s.cpu[viewer]) buttons.push({ label: 'Play again', a: { t: 'rematch' }, kind: 'primary' });
  return baseView(s, viewer, 'hearts', {
    seats: s.names.map((name, i) => ({
      name,
      cpu: s.cpu[i],
      score: `${s.scores[i]} pts`,
      sub: s.phase === 'play' || s.phase === 'collect' ? `${s.round[i]} this hand` : undefined,
      active: (s.phase === 'play' && s.turn === i) || (s.phase === 'pass' && !s.passes[i]),
      win: s.phase === 'over' && s.scores[i] === Math.min(...s.scores),
    })),
    zones,
    buttons,
    prompt,
    status: `Hand ${s.hand} · ${passDir(s) === 'hold' ? 'no pass' : 'pass ' + passDir(s)}${s.broken ? ' · hearts broken' : ''} · to ${s.target}`,
    banner: s.phase === 'roundEnd' || s.phase === 'over' ? { title: s.result, lines: s.lines, tone: s.phase === 'over' && s.scores[viewer] === Math.min(...s.scores) ? 'win' : 'info' } : undefined,
    scores: { head: ['Player', 'Score'], rows: s.names.map((n, i) => [n, s.scores[i]]) },
    turn: s.phase === 'play' ? s.turn : undefined,
    over: s.phase === 'over',
  });
}

export const hearts: GameDef<S> = {
  meta: {
    id: 'hearts',
    name: 'Hearts',
    family: 'Trick-taking',
    players: { min: 4, max: 4, def: 4 },
    blurb: 'Dodge every heart and the Queen of Spades, or take them all and shoot the moon.',
    hero: ['QS', 'AH', 'KH', '10H', '2C'],
    length: '15–25 min',
    options: [{ id: 'target', label: 'Game ends at', type: 'select', default: 100, choices: [{ value: 50, label: '50 points' }, { value: 100, label: '100 points' }] }],
    rules: [
      ['Goal', 'Take as few points as possible. Each heart is worth 1 point and the Queen of Spades is worth 13. When someone reaches 100, the lowest score wins.'],
      ['Passing', 'Before each hand, pass three cards: left, then right, then across, then no pass, repeating.'],
      ['Play', 'The holder of the 2 of clubs leads it. You must follow the suit led if you can; otherwise play any card. The highest card of the suit led wins the trick, and its winner leads next.'],
      ['Restrictions', 'No hearts or Queen of Spades may be played on the first trick (unless you have nothing else). Hearts cannot be led until a heart has been played.'],
      ['Shooting the moon', 'Take all 13 hearts and the Queen of Spades in one hand and everyone else scores 26 instead.'],
    ],
  },
  create: (p, ctx, o) => create(p, ctx, o),
  toAct: (s) => (s.phase === 'pass' ? [0, 1, 2, 3].filter((i) => !s.passes[i]) : s.phase === 'play' ? [s.turn] : s.phase === 'roundEnd' || s.phase === 'over' ? [0, 1, 2, 3].filter((i) => !s.cpu[i]) : []),
  act,
  auto: (s) => (s.phase === 'collect' ? 1100 : s.phase === 'roundEnd' && s.cpu.every(Boolean) ? 10 : null),
  step: (s, ctx) => (s.phase === 'roundEnd' ? startHand(s, ctx) : step(s)),
  cpu,
  view,
  over: (s) => s.phase === 'over',
};

export const _test = { legal, points, code, label };
