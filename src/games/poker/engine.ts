/**
 * Shared poker engine: Texas Hold'em, Omaha (pot-limit) and Five Card Draw.
 * No-limit / pot-limit betting, blinds (rising on a schedule), side pots,
 * all-in run-outs, showdown and eliminations.
 */
import { code, hi, newDeck, rankName, type Card } from '../../core/cards';
import type { Action, Ctx, FxEvent, Level, PlayerSlot, Seat, View, Zone, CardView } from '../../core/types';
import { equity, evaluate, type Variant } from '../../core/util/poker';

export interface PokerCfg {
  variant: Variant;
  holeCards: number;
  limit: 'NL' | 'PL';
  label: string;
}

interface P {
  name: string;
  chips: number;
  cpu: boolean;
  out: boolean;
}

type Phase = 'bet' | 'deal' | 'runout' | 'draw' | 'between' | 'over';

export interface PokerState {
  cfg: PokerCfg;
  players: P[];
  n: number;
  start: number;
  hand: number;
  dealer: number;
  sbSeat: number;
  bbSeat: number;
  sb: number;
  bb: number;
  bb0: number;
  blindEvery: number;
  deck: Card[];
  muck: Card[];
  hole: Card[][];
  board: Card[];
  bet: number[];
  committed: number[];
  folded: boolean[];
  allin: boolean[];
  acted: boolean[];
  drawn: boolean[];
  street: number;
  phase: Phase;
  actor: number;
  curBet: number;
  minRaise: number;
  say: (string | undefined)[];
  shown: boolean[];
  winners: number[];
  bestIds: string[];
  title: string;
  lines: string[];
  deal: number;
  fx: FxEvent[];
  fxn: number;
  log: string[];
}

const fx = (s: PokerState, k: string) => {
  s.fx.push({ n: ++s.fxn, k });
  if (s.fx.length > 12) s.fx.shift();
};
const log = (s: PokerState, m: string) => {
  s.log.push(m);
  if (s.log.length > 60) s.log.shift();
};
const fmt = (n: number) => n.toLocaleString('en-US');

const inHand = (s: PokerState, i: number) => !s.players[i].out && !s.folded[i];
const canAct = (s: PokerState, i: number) => inHand(s, i) && !s.allin[i];
function nextFrom(s: PokerState, from: number, pred: (i: number) => boolean) {
  for (let k = 1; k <= s.n; k++) {
    const i = (from + k) % s.n;
    if (pred(i)) return i;
  }
  return -1;
}
const potTotal = (s: PokerState) => s.committed.reduce((a, b) => a + b, 0);

export function createPoker(cfg: PokerCfg, players: PlayerSlot[], ctx: Ctx, options: Record<string, unknown>): PokerState {
  const start = Number(options.stack ?? 1000);
  const bb = Number(options.bigBlind ?? 20);
  const s: PokerState = {
    cfg,
    players: players.map((p) => ({ name: p.name, chips: start, cpu: p.kind === 'cpu', out: false })),
    n: players.length,
    start,
    hand: 0,
    dealer: ctx.rng.int(players.length),
    sbSeat: -1,
    bbSeat: -1,
    sb: bb / 2,
    bb,
    bb0: bb,
    blindEvery: options.risingBlinds === false ? 0 : 8,
    deck: [],
    muck: [],
    hole: [],
    board: [],
    bet: [],
    committed: [],
    folded: [],
    allin: [],
    acted: [],
    drawn: [],
    street: 0,
    phase: 'between',
    actor: -1,
    curBet: 0,
    minRaise: bb,
    say: [],
    shown: [],
    winners: [],
    bestIds: [],
    title: '',
    lines: [],
    deal: 0,
    fx: [],
    fxn: 0,
    log: [],
  };
  startHand(s, ctx);
  return s;
}

function startHand(s: PokerState, ctx: Ctx) {
  for (const p of s.players) if (p.chips <= 0) p.out = true;
  const alive = s.players.filter((p) => !p.out).length;
  if (alive < 2) {
    s.phase = 'over';
    const w = s.players.findIndex((p) => !p.out);
    s.winners = [w];
    s.title = `${s.players[w].name} wins the table`;
    s.lines = [`${fmt(s.players[w].chips)} chips after ${s.hand} hands.`];
    fx(s, 'win');
    return;
  }
  s.hand++;
  if (s.blindEvery && s.hand > 1 && (s.hand - 1) % s.blindEvery === 0) {
    s.bb = Math.round((s.bb * 1.5) / 10) * 10;
    s.sb = s.bb / 2;
    log(s, `Blinds rise to ${fmt(s.sb)}/${fmt(s.bb)}`);
  }
  const N = s.n;
  s.deck = newDeck(ctx.rng);
  s.muck = [];
  s.hole = Array.from({ length: N }, () => []);
  s.board = [];
  s.bet = new Array(N).fill(0);
  s.committed = new Array(N).fill(0);
  s.folded = s.players.map((p) => p.out);
  s.allin = new Array(N).fill(false);
  s.acted = new Array(N).fill(false);
  s.drawn = new Array(N).fill(false);
  s.say = new Array(N).fill(undefined);
  s.shown = new Array(N).fill(false);
  s.winners = [];
  s.bestIds = [];
  s.title = '';
  s.lines = [];
  s.street = 0;
  s.dealer = nextFrom(s, s.dealer, (i) => !s.players[i].out);
  const headsUp = alive === 2;
  s.sbSeat = headsUp ? s.dealer : nextFrom(s, s.dealer, (i) => !s.players[i].out);
  s.bbSeat = nextFrom(s, s.sbSeat, (i) => !s.players[i].out);
  post(s, s.sbSeat, s.sb);
  post(s, s.bbSeat, s.bb);
  s.say[s.sbSeat] = `Small blind ${fmt(s.bet[s.sbSeat])}`;
  s.say[s.bbSeat] = `Big blind ${fmt(s.bet[s.bbSeat])}`;
  s.curBet = s.bb;
  s.minRaise = s.bb;
  // deal hole cards one at a time, starting left of the button
  for (let r = 0; r < s.cfg.holeCards; r++) {
    let i = s.dealer;
    for (let k = 0; k < alive; k++) {
      i = nextFrom(s, i, (j) => !s.players[j].out);
      s.hole[i].push(s.deck.pop()!);
    }
  }
  s.deal++;
  fx(s, 'shuffle');
  log(s, `Hand ${s.hand}: ${s.players[s.dealer].name} has the button`);
  s.phase = 'bet';
  s.actor = nextFrom(s, s.bbSeat, (i) => canAct(s, i));
  if (roundDone(s)) endRound(s);
}

function post(s: PokerState, i: number, amt: number) {
  const p = s.players[i];
  const a = Math.min(amt, p.chips);
  p.chips -= a;
  s.bet[i] += a;
  s.committed[i] += a;
  if (p.chips === 0) s.allin[i] = true;
}

function roundDone(s: PokerState) {
  const live = s.players.map((_, i) => i).filter((i) => inHand(s, i));
  if (live.length <= 1) return true;
  const able = live.filter((i) => !s.allin[i]);
  if (able.length === 0) return true;
  if (able.length === 1 && s.bet[able[0]] >= s.curBet) return true;
  return able.every((i) => s.acted[i] && s.bet[i] === s.curBet);
}

function endRound(s: PokerState) {
  const live = s.players.map((_, i) => i).filter((i) => inHand(s, i));
  if (live.length === 1) return award(s, false);
  s.bet.fill(0);
  s.curBet = 0;
  s.minRaise = s.bb;
  s.acted.fill(false);
  const able = live.filter((i) => !s.allin[i]);
  const lastStreet = s.cfg.variant === 'draw' ? 1 : 3;
  if (s.street >= lastStreet) return award(s, true);
  if (s.cfg.variant === 'draw') {
    if (able.length <= 1) {
      // nobody left to bet: everyone stands pat
      s.street = 1;
      return award(s, true);
    }
    s.phase = 'draw';
    s.actor = nextFrom(s, s.dealer, (i) => canAct(s, i));
    s.say = s.say.map(() => undefined);
    return;
  }
  if (able.length <= 1) {
    s.phase = 'runout';
    live.forEach((i) => (s.shown[i] = true));
    fx(s, 'flip');
    return;
  }
  s.phase = 'deal';
}

function dealStreet(s: PokerState) {
  s.muck.push(s.deck.pop()!); // burn
  const k = s.street === 0 ? 3 : 1;
  for (let j = 0; j < k; j++) s.board.push(s.deck.pop()!);
  s.street++;
  fx(s, s.street === 1 ? 'flop' : 'street');
  log(s, `${['', 'Flop', 'Turn', 'River'][s.street]}: ${s.board.map(code).join(' ')}`);
}

function award(s: PokerState, showdown: boolean) {
  const live = s.players.map((_, i) => i).filter((i) => inHand(s, i));
  s.phase = 'between';
  s.actor = -1;
  s.bet.fill(0);
  if (!showdown || live.length === 1) {
    const w = live[0];
    const amt = potTotal(s);
    s.players[w].chips += amt;
    s.winners = [w];
    s.title = `${s.players[w].name} takes ${fmt(amt)}`;
    s.lines = ['Everyone else folded.'];
    log(s, `${s.players[w].name} wins ${fmt(amt)} uncontested`);
    s.committed.fill(0);
    fx(s, 'pot');
    return;
  }
  live.forEach((i) => (s.shown[i] = true));
  const val = new Map(live.map((i) => [i, evaluate(s.cfg.variant, s.hole[i], s.board)]));
  // side pots by contribution level
  const levels = [...new Set(s.committed.filter((c) => c > 0))].sort((a, b) => a - b);
  let prev = 0;
  const lines: string[] = [];
  const winnersAll = new Set<number>();
  let mainBest: number | null = null;
  levels.forEach((lv, li) => {
    let amount = 0;
    for (let i = 0; i < s.n; i++) amount += Math.max(0, Math.min(s.committed[i], lv) - prev);
    const elig = live.filter((i) => s.committed[i] >= lv);
    prev = lv;
    if (!amount || !elig.length) return;
    const top = Math.max(...elig.map((i) => val.get(i)!.score));
    const ws = elig.filter((i) => val.get(i)!.score === top);
    const share = Math.floor(amount / ws.length);
    let rem = amount - share * ws.length;
    // odd chips go to the first winner left of the button
    const order = [...ws].sort((a, b) => ((a - s.dealer + s.n) % s.n) - ((b - s.dealer + s.n) % s.n));
    for (const w of order) {
      s.players[w].chips += share + (rem > 0 ? 1 : 0);
      if (rem > 0) rem--;
      winnersAll.add(w);
    }
    if (mainBest === null) mainBest = ws[0];
    const potName = li === 0 ? 'Main pot' : `Side pot ${li}`;
    const hand = val.get(ws[0])!.name;
    lines.push(`${potName} ${fmt(amount)}: ${ws.map((w) => s.players[w].name).join(' & ')}${ws.length > 1 ? ' split' : ''}, ${hand}`);
  });
  s.winners = [...winnersAll];
  const w0 = mainBest ?? s.winners[0];
  s.bestIds = val.get(w0)!.cards.map((c) => c.id);
  s.title = `${s.players[w0].name} wins with ${lowerFirst(val.get(w0)!.name)}`;
  s.lines = lines;
  lines.forEach((l) => log(s, l));
  s.committed.fill(0);
  fx(s, 'pot');
}

const lowerFirst = (t: string) => {
  const article = /^(Pair|Two pair|Three|Four|Straight|Flush|Full house|Royal)/.test(t) ? (/^(Pair|Straight|Flush|Full house|Royal flush|Straight flush)/.test(t) ? 'a ' : '') : '';
  return article + t.charAt(0).toLowerCase() + t.slice(1);
};

// ---------------------------------------------------------------- limits

export function raiseBounds(s: PokerState, i: number) {
  const toCall = Math.max(0, s.curBet - s.bet[i]);
  const allIn = s.bet[i] + s.players[i].chips;
  let minTo = s.curBet === 0 ? Math.max(s.bb, 1) : s.curBet + s.minRaise;
  let maxTo = allIn;
  if (s.cfg.limit === 'PL') maxTo = Math.min(allIn, s.curBet + potTotal(s) + toCall);
  minTo = Math.min(minTo, allIn);
  return { toCall, minTo, maxTo, allIn, canRaise: allIn > s.curBet && s.players.some((_, j) => j !== i && canAct(s, j) ) };
}

function putTo(s: PokerState, i: number, to: number) {
  const p = s.players[i];
  const add = Math.min(p.chips, to - s.bet[i]);
  p.chips -= add;
  s.bet[i] += add;
  s.committed[i] += add;
  if (p.chips === 0) s.allin[i] = true;
}

export function pokerAct(s: PokerState, seat: Seat, a: Action, ctx: Ctx): string | void {
  if (s.phase === 'between') {
    if (a.t !== 'next') return 'The next hand is on its way';
    startHand(s, ctx);
    return;
  }
  if (s.phase === 'over') {
    if (a.t !== 'rematch') return 'The game is over';
    s.players.forEach((p) => { p.chips = s.start; p.out = false; });
    s.hand = 0;
    s.bb = s.bb0;
    s.sb = s.bb / 2;
    startHand(s, ctx);
    return;
  }
  if (s.phase === 'draw') {
    if (seat !== s.actor) return "It isn't your turn";
    if (a.t !== 'draw') return 'Choose cards to discard';
    const ids = (a.cards as string[]) ?? [];
    const hand = s.hole[seat];
    const max = hand.some((c) => c.r === 1) && !ids.some((id) => hand.find((c) => c.id === id)?.r === 1) ? 4 : 3;
    if (ids.length > max) return `You can draw at most ${max}`;
    const keep = hand.filter((c) => !ids.includes(c.id));
    if (keep.length + ids.length !== hand.length) return 'Those cards are not in your hand';
    for (const id of ids) s.muck.push(hand.find((c) => c.id === id)!);
    const fresh: Card[] = [];
    for (let k = 0; k < ids.length; k++) {
      if (!s.deck.length) { s.deck = ctx.rng.shuffle(s.muck.splice(0)); }
      fresh.push(s.deck.pop()!);
    }
    s.hole[seat] = [...keep, ...fresh];
    s.drawn[seat] = true;
    s.say[seat] = ids.length ? `Draws ${ids.length}` : 'Stands pat';
    log(s, `${s.players[seat].name} ${ids.length ? `draws ${ids.length}` : 'stands pat'}`);
    fx(s, 'draw');
    const nx = nextFrom(s, seat, (i) => canAct(s, i) && !s.drawn[i]);
    if (nx >= 0) s.actor = nx;
    else {
      s.street = 1;
      s.phase = 'bet';
      s.acted.fill(false);
      s.actor = nextFrom(s, s.dealer, (i) => canAct(s, i));
      if (roundDone(s)) endRound(s);
    }
    return;
  }
  if (s.phase !== 'bet') return 'Hold on, the dealer is dealing';
  if (seat !== s.actor) return "It isn't your turn";
  const p = s.players[seat];
  const b = raiseBounds(s, seat);
  const name = p.name;
  switch (a.t) {
    case 'fold':
      s.folded[seat] = true;
      s.muck.push(...s.hole[seat]);
      s.hole[seat] = [];
      s.say[seat] = 'Fold';
      log(s, `${name} folds`);
      fx(s, 'fold');
      break;
    case 'check':
      if (b.toCall > 0) return `You need ${fmt(b.toCall)} to call`;
      s.say[seat] = 'Check';
      log(s, `${name} checks`);
      fx(s, 'check');
      break;
    case 'call': {
      if (b.toCall <= 0) return 'Nothing to call: check instead';
      putTo(s, seat, s.curBet);
      s.say[seat] = s.allin[seat] ? 'All-in' : `Call ${fmt(s.bet[seat])}`;
      log(s, `${name} calls ${fmt(s.bet[seat])}`);
      fx(s, s.allin[seat] ? 'allin' : 'chips');
      break;
    }
    case 'raise':
    case 'allin': {
      let to = a.t === 'allin' ? b.allIn : Math.round(Number(a.amount));
      if (s.cfg.limit === 'PL' && a.t === 'allin') to = b.maxTo;
      if (!Number.isFinite(to)) return 'Enter an amount';
      if (to > b.maxTo) return `The most you can make it is ${fmt(b.maxTo)}`;
      if (to <= s.curBet) return a.t === 'allin' ? 'Call instead' : `Raise to more than ${fmt(s.curBet)}`;
      if (to < b.minTo && to < b.allIn) return `The minimum is ${fmt(b.minTo)}`;
      const prevBet = s.curBet;
      putTo(s, seat, to);
      const size = s.bet[seat] - prevBet;
      if (size >= s.minRaise) {
        s.minRaise = size;
        // a full raise reopens the action
        for (let i = 0; i < s.n; i++) if (i !== seat) s.acted[i] = false;
      }
      s.curBet = Math.max(s.curBet, s.bet[seat]);
      const verb = prevBet === 0 ? 'Bet' : 'Raise to';
      s.say[seat] = s.allin[seat] ? `All-in ${fmt(s.bet[seat])}` : `${verb} ${fmt(s.bet[seat])}`;
      log(s, `${name} ${s.allin[seat] ? 'is all-in for' : prevBet === 0 ? 'bets' : 'raises to'} ${fmt(s.bet[seat])}`);
      fx(s, s.allin[seat] ? 'allin' : 'chips');
      break;
    }
    default:
      return 'Unknown move';
  }
  s.acted[seat] = true;
  if (roundDone(s)) return endRound(s);
  s.actor = nextFrom(s, seat, (i) => canAct(s, i));
}

export function pokerAuto(s: PokerState): number | null {
  if (s.phase === 'deal') return 650;
  if (s.phase === 'runout') return 1300;
  if (s.phase === 'between') return 5600;
  return null;
}

export function pokerStep(s: PokerState, ctx: Ctx) {
  if (s.phase === 'deal') {
    dealStreet(s);
    s.phase = 'bet';
    s.say = s.say.map((v, i) => (s.allin[i] ? v : undefined));
    s.actor = nextFrom(s, s.dealer, (i) => canAct(s, i));
    if (roundDone(s)) endRound(s);
  } else if (s.phase === 'runout') {
    dealStreet(s);
    if (s.street >= 3) award(s, true);
  } else if (s.phase === 'between') startHand(s, ctx);
}

export function pokerToAct(s: PokerState): Seat[] {
  if (s.phase === 'bet' || s.phase === 'draw') return s.actor >= 0 ? [s.actor] : [];
  if (s.phase === 'between' || s.phase === 'over') return s.players.map((p, i) => (p.cpu ? -1 : i)).filter((i) => i >= 0);
  return [];
}

// ---------------------------------------------------------------- CPU

const ITERS: Record<Level, number> = { easy: 90, normal: 260, hard: 520 };

export function pokerCpu(s: PokerState, seat: Seat, ctx: Ctx): Action | null {
  if (s.actor !== seat) return null;
  const level = ctx.level ?? 'normal';
  const rng = ctx.rng;
  if (s.phase === 'draw') return { t: 'draw', cards: chooseDraw(s.hole[seat]) };
  if (s.phase !== 'bet') return null;
  const opp = s.players.filter((_, i) => i !== seat && inHand(s, i)).length;
  const eq = equity(s.cfg.variant, s.hole[seat], s.board, Math.min(opp, 5), ITERS[level], rng, s.muck);
  const b = raiseBounds(s, seat);
  const pot = potTotal(s);
  const odds = b.toCall / Math.max(1, pot + b.toCall);
  const fair = 1 / (opp + 1);
  const rel = eq / fair;
  const r = rng.next();
  const bluff = { easy: 0.03, normal: 0.07, hard: 0.11 }[level];
  const loose = { easy: 0.08, normal: 0.02, hard: -0.01 }[level];
  const sizeTo = (frac: number) => {
    const target = s.curBet + Math.round(((pot + b.toCall) * frac) / Math.max(1, s.sb)) * s.sb;
    return Math.max(b.minTo, Math.min(b.maxTo, target));
  };
  const raise = (frac: number): Action =>
    b.canRaise && b.minTo <= b.maxTo && b.maxTo > s.curBet ? { t: 'raise', amount: sizeTo(frac) } : b.toCall > 0 ? { t: 'call' } : { t: 'check' };
  if (b.toCall === 0) {
    if (rel > 1.9 && r < 0.85) return raise(rel > 2.6 ? 0.9 : 0.6);
    if (rel > 1.35 && r < 0.45) return raise(0.5);
    if (s.street > 0 && r < bluff) return raise(0.55);
    return { t: 'check' };
  }
  // facing a bet
  if (eq + loose < odds) {
    if (b.toCall <= s.bb && eq > 0.22 && r < 0.6) return { t: 'call' };
    if (r < bluff * 0.5 && b.canRaise) return raise(0.8);
    return { t: 'fold' };
  }
  if (rel > 2.3 && r < 0.7) return raise(rel > 3 ? 1 : 0.75);
  if (rel > 1.6 && r < 0.25) return raise(0.6);
  // committing a big share of our stack needs real strength
  if (b.toCall > s.players[seat].chips * 0.6 && eq < 0.55 && r < 0.7) return { t: 'fold' };
  return { t: 'call' };
}

/** Five Card Draw discards: keep made hands, draw to four-flushes and open-enders. */
export function chooseDraw(hand: Card[]): string[] {
  const v = evaluate('draw', hand, []);
  if (v.cat >= 4) return [];
  const byRank = new Map<number, Card[]>();
  hand.forEach((c) => byRank.set(hi(c), [...(byRank.get(hi(c)) ?? []), c]));
  const groups = [...byRank.values()].filter((g) => g.length >= 2);
  if (groups.length) {
    const keep = new Set(groups.flat().map((c) => c.id));
    return hand.filter((c) => !keep.has(c.id)).map((c) => c.id);
  }
  for (const suit of ['S', 'H', 'D', 'C']) {
    const f = hand.filter((c) => c.s === suit);
    if (f.length === 4) return hand.filter((c) => c.s !== suit).map((c) => c.id);
  }
  const vals = [...new Set(hand.map(hi))].sort((a, b) => a - b);
  for (let i = 0; i + 3 < vals.length; i++) {
    if (vals[i + 3] - vals[i] === 3) {
      const run = new Set(vals.slice(i, i + 4));
      const used = new Set<number>();
      const keep = hand.filter((c) => run.has(hi(c)) && !used.has(hi(c)) && used.add(hi(c)));
      return hand.filter((c) => !keep.includes(c)).map((c) => c.id);
    }
  }
  const sorted = [...hand].sort((a, b) => hi(b) - hi(a));
  const keepN = hi(sorted[0]) === 14 ? 1 : 2;
  return sorted.slice(keepN).map((c) => c.id);
}

// ---------------------------------------------------------------- view

export function pokerView(s: PokerState, viewer: Seat, gameId: string): View {
  const zones: Zone[] = [];
  const showAll = s.phase === 'over';
  zones.push({
    id: 'deck',
    at: { x: 0, y: -0.58 },
    lay: 'stack',
    deck: true,
    count: s.deck.length,
    cards: s.deck.slice(-6).map((c) => ({ id: c.id })),
  });
  if (s.cfg.variant !== 'draw')
    zones.push({
      id: 'board',
      at: { x: 0, y: -0.12 },
      lay: 'row',
      slots: 5,
      gap: 1.12,
      cards: s.board.map((c) => ({ id: c.id, f: code(c), hi: s.bestIds.includes(c.id), dim: s.bestIds.length > 0 && !s.bestIds.includes(c.id) })),
    });
  zones.push({
    id: 'muck',
    at: { x: 0.28, y: -0.6 },
    lay: 'stack',
    count: s.muck.length,
    scale: 0.8,
    cards: s.muck.slice(-5).map((c) => ({ id: c.id, rot: ((c.id.charCodeAt(c.id.length - 1) % 7) - 3) * 4 })),
  });
  const myDraw = s.phase === 'draw' && s.actor === viewer;
  for (let i = 0; i < s.n; i++) {
    if (s.players[i].out && !s.hole[i]?.length) continue;
    const vis = i === viewer || s.shown[i] || showAll;
    zones.push({
      id: 'h' + i,
      at: { seat: i, slot: 'hand' },
      lay: 'fan',
      cards: (s.hole[i] ?? []).map(
        (c): CardView => ({
          id: c.id,
          f: vis ? code(c) : undefined,
          hi: s.bestIds.includes(c.id),
          dim: s.bestIds.length > 0 && s.shown[i] && !s.bestIds.includes(c.id),
          sel: myDraw && i === viewer ? true : undefined,
        }),
      ),
    });
  }
  const chips = [];
  for (let i = 0; i < s.n; i++) if (s.bet[i] > 0) chips.push({ id: 'bet' + i, at: { seat: i, slot: 'bet' as const }, amount: s.bet[i] });
  const collected = potTotal(s) - s.bet.reduce((a, b) => a + b, 0);
  if (collected > 0) chips.push({ id: 'pot', at: { x: 0, y: 0.2 }, amount: collected, label: `Pot ${fmt(collected)}` });

  const buttons: View['buttons'] = [];
  let bet: View['bet'];
  let prompt: string | undefined;
  const me = s.players[viewer];
  if (s.phase === 'bet' && s.actor === viewer) {
    const b = raiseBounds(s, viewer);
    if (b.toCall > 0) buttons.push({ label: 'Fold', a: { t: 'fold' }, kind: 'ghost', key: 'f' });
    if (b.toCall === 0) buttons.push({ label: 'Check', a: { t: 'check' }, key: 'c' });
    else buttons.push({ label: b.toCall >= me.chips ? `Call all-in ${fmt(me.chips)}` : `Call ${fmt(b.toCall)}`, a: { t: 'call' }, key: 'c' });
    if (b.canRaise && b.maxTo > s.curBet && me.chips > b.toCall) {
      const pot = potTotal(s);
      const preset = (frac: number) => Math.max(b.minTo, Math.min(b.maxTo, s.curBet + Math.round(((pot + b.toCall) * frac) / s.sb) * s.sb));
      bet = {
        t: 'raise',
        min: b.minTo,
        max: b.maxTo,
        step: s.sb,
        presets: [
          { label: '½ pot', amount: preset(0.5) },
          { label: '¾ pot', amount: preset(0.75) },
          { label: 'Pot', amount: preset(1) },
          { label: s.cfg.limit === 'PL' ? 'Max' : 'All-in', amount: b.maxTo },
        ],
        verb: s.curBet === 0 ? 'Bet' : 'Raise to',
      };
    }
    prompt = b.toCall > 0 ? `${fmt(b.toCall)} to call · pot ${fmt(potTotal(s))}` : 'Check, or make a bet';
  } else if (myDraw) {
    const max = s.hole[viewer].some((c) => c.r === 1) ? 4 : 3;
    buttons.push({ label: 'Stand pat', a: { t: 'draw', cards: [] }, kind: 'ghost' });
    buttons.push({ label: 'Draw selected', a: { t: 'draw' }, needSel: [1, max], kind: 'primary' });
    prompt = `Pick up to ${max === 4 ? 'four (you hold an Ace)' : 'three'} cards to replace`;
  } else if (s.phase === 'bet' || s.phase === 'draw') {
    prompt = `${s.players[s.actor]?.name ?? ''} is ${s.phase === 'draw' ? 'drawing' : 'thinking'}…`;
  } else if (s.phase === 'between' && !s.players[viewer]?.cpu) {
    buttons.push({ label: 'Next hand', a: { t: 'next' }, kind: 'primary', key: 'n' });
  } else if (s.phase === 'over' && !s.players[viewer]?.cpu) {
    buttons.push({ label: 'Play again', a: { t: 'rematch' }, kind: 'primary' });
  }

  return {
    game: gameId,
    viewer,
    seats: s.players.map((p, i) => ({
      name: p.name,
      cpu: p.cpu,
      chips: p.chips,
      out: p.out || (s.folded[i] && s.phase !== 'over'),
      active: (s.phase === 'bet' || s.phase === 'draw') && s.actor === i,
      badges: [i === s.dealer ? 'D' : '', i === s.sbSeat ? 'SB' : '', i === s.bbSeat ? 'BB' : ''].filter(Boolean),
      say: s.say[i],
      win: s.winners.includes(i),
      sub: p.out ? 'Out' : s.allin[i] && s.phase !== 'between' ? 'All-in' : undefined,
    })),
    zones,
    chips,
    buttons,
    bet,
    prompt,
    status: `${s.cfg.label} · Blinds ${fmt(s.sb)}/${fmt(s.bb)} · Hand ${s.hand}`,
    banner: (s.phase === 'between' || s.phase === 'over') && s.title ? { title: s.title, lines: s.lines, tone: s.winners.includes(viewer) ? 'win' : 'info' } : undefined,
    log: s.log.slice(-30),
    deal: s.deal,
    dealer: s.dealer,
    turn: s.actor >= 0 ? s.actor : undefined,
    fx: s.fx,
    over: s.phase === 'over',
  };
}

export const describeRank = rankName;
