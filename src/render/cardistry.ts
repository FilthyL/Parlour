/**
 * The dealer's cardistry: 22 animated techniques performed with a "show
 * deck" of sprites at the dealer's spot before each deal.
 *
 *   Shuffles    riffle + bridge, overhand, Hindu, faro + waterfall, dribble
 *   Cuts        Charlier, swivel, revolution, Sybil, triple (box) cut
 *   Flourishes  pressure fan, thumb fan, ribbon spread, ribbon turnover,
 *               spring, arm spread, twirl, rosette, helicopter toss,
 *               tornado, vortex spiral, cascade wave
 *
 * Each technique animates every card with the Web Animations API and cues
 * the matching card sounds. Show cards start face down (back at rotateY 0)
 * and show a face at rotateY 180.
 */
import { currentDeck, ALL_CODES } from './press';
import { sfx } from './sound';

interface P {
  x: number;
  y: number;
  r?: number; // in-plane rotation (deg)
  ry?: number; // flip (deg)
  rx?: number;
  s?: number;
  z?: number;
}

interface Stage {
  cards: HTMLDivElement[];
  cur: P[];
  cw: number;
  ch: number;
  k: number; // pace multiplier on durations
  skip: boolean;
}

const tf = (p: P) => `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) rotate(${(p.r ?? 0).toFixed(1)}deg) rotateX(${p.rx ?? 0}deg) rotateY(${p.ry ?? 0}deg) scale(${p.s ?? 1})`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rest = (i: number): P => ({ x: -i * 0.22, y: -i * 0.42, z: i });

/** Animate card i through frames (starting from its current pose). */
function go(st: Stage, i: number, frames: P[], d: number, o: { delay?: number; ease?: string; origin?: string } = {}) {
  const el = st.cards[i];
  if (o.origin) el.style.transformOrigin = o.origin;
  const from = st.cur[i];
  const kf = [from, ...frames].map((p, j, arr) => ({ transform: tf(p), zIndex: String(p.z ?? from.z ?? i), offset: j / (arr.length - 1) }));
  const a = el.animate(kf, { duration: st.skip ? 1 : d * st.k, delay: st.skip ? 0 : (o.delay ?? 0) * st.k, easing: o.ease ?? 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
  st.cur[i] = { ...frames[frames.length - 1], z: frames[frames.length - 1].z ?? from.z ?? i };
  return a.finished.catch(() => {});
}
const all = (ps: Promise<unknown>[]) => Promise.all(ps);
const range = (a: number, b: number) => Array.from({ length: b - a }, (_, i) => a + i);
const wait = (st: Stage, ms: number) => (st.skip ? Promise.resolve() : sleep(ms * st.k));
function restack(st: Stage, order: number[], d = 260) {
  // order[j] = card index that should end at height j
  return all(order.map((ci, j) => go(st, ci, [{ ...rest(j), z: j }], d, { delay: j * 4 })));
}
const play = (st: Stage, kind: string, o: { delay?: number; vol?: number; rate?: number } = {}) => {
  if (!st.skip) sfx(kind, { ...o, delay: (o.delay ?? 0) * st.k });
};

// ---------------------------------------------------------------- shuffles

async function riffle(st: Stage) {
  const N = st.cards.length, h = N >> 1;
  const { cw } = st;
  play(st, 'slide', { vol: 0.5 });
  await all(range(0, N).map((i) => {
    const left = i < h;
    const j = left ? i : i - h;
    return go(st, i, [{ x: (left ? -0.62 : 0.62) * cw - j * 0.22, y: -j * 0.42, r: left ? -7 : 7, z: j }], 280);
  }));
  // the riffle: interleave from the bottom of each half
  play(st, 'shuffle', { vol: 0.9 });
  const order: number[] = [];
  for (let j = 0; j < h; j++) order.push(j, j + h);
  await all(order.map((ci, j) => go(st, ci, [{ x: (ci < h ? -0.3 : 0.3) * cw, y: -j * 0.42 - 6, r: ci < h ? -3 : 3, rx: 18, z: j }, { ...rest(j), z: j }], 260, { delay: j * 18 })));
  await bridge(st, order);
}

async function bridge(st: Stage, order: number[]) {
  const { ch } = st;
  play(st, 'fan', { vol: 0.5, rate: 1.3 });
  const N = order.length;
  await all(order.map((ci, j) => go(st, ci, [{ ...rest(j), y: rest(j).y - Math.sin((Math.PI * j) / (N - 1)) * ch * 0.18, rx: 28, s: 0.98, z: j }, { ...rest(j), z: j }], 520, { delay: j * 9, ease: 'cubic-bezier(.3,.7,.3,1)' })));
}

async function overhand(st: Stage) {
  const N = st.cards.length;
  const { cw, ch } = st;
  let stack = range(0, N);
  for (let rep = 0; rep < 5; rep++) {
    const take = 3 + ((rep * 7) % 4);
    const packet = stack.slice(0, take); // from the bottom
    const restOf = stack.slice(take);
    stack = [...restOf, ...packet];
    play(st, 'slide', { vol: 0.45 });
    await all(packet.map((ci) => go(st, ci, [{ x: -0.35 * cw, y: -ch * 0.55, r: -6, z: 100 + ci }], 150)));
    await all(stack.map((ci, j) => go(st, ci, [{ ...rest(j), z: j }], 170)));
  }
}

async function hindu(st: Stage) {
  const N = st.cards.length;
  const { ch } = st;
  let stack = range(0, N);
  for (let rep = 0; rep < 5; rep++) {
    const take = 3 + ((rep * 5) % 3);
    const top = stack.slice(-take);
    const restOf = stack.slice(0, -take);
    play(st, 'shove', { vol: 0.5 });
    await all(top.map((ci, j) => go(st, ci, [{ x: 0, y: ch * 0.5, r: 2, z: 200 + j }], 170)));
    stack = [...top, ...restOf];
    await all(stack.map((ci, j) => go(st, ci, [{ ...rest(j), z: j }], 160)));
  }
}

async function faroWaterfall(st: Stage) {
  const N = st.cards.length, h = N >> 1;
  const { cw, ch } = st;
  play(st, 'slide', { vol: 0.5 });
  await all(range(0, N).map((i) => go(st, i, [{ x: (i < h ? -0.52 : 0.52) * cw, y: -(i % h) * 0.42, r: i < h ? 90 : -90, s: 0.9, z: i % h }], 300)));
  // the weave
  play(st, 'shuffle', { vol: 0.6, rate: 1.2 });
  const order: number[] = [];
  for (let j = 0; j < h; j++) order.push(j, j + h);
  await all(order.map((ci, j) => go(st, ci, [{ x: 0, y: -j * 0.42 - ch * 0.4, r: 0, s: 1, z: j }], 300, { delay: j * 12 })));
  // the waterfall: cards cascade down one by one
  await all(order.map((ci, j) => go(st, ci, [{ x: Math.sin(j) * 3, y: -ch * 0.9 + j * 0.2, z: j }, { ...rest(j), z: j }], 360, { delay: j * 22, ease: 'cubic-bezier(.5,0,.6,1.3)' })));
  play(st, 'place', { vol: 0.5 });
}

async function dribble(st: Stage) {
  const N = st.cards.length;
  const { ch } = st;
  await all(range(0, N).map((i) => go(st, i, [{ x: 0, y: -ch * 1.25 - i * 0.42, z: i }], 260)));
  const ps = range(0, N).map((i) => {
    if (i % 5 === 0) play(st, 'place', { vol: 0.3, delay: 60 + i * 30 });
    return go(st, i, [{ x: ((i * 37) % 13) - 6, y: -i * 0.42, r: ((i * 53) % 9) - 4, z: i }], 300, { delay: i * 30, ease: 'cubic-bezier(.55,0,1,.45)' });
  });
  await all(ps);
  await restack(st, range(0, N), 180);
}

// ---------------------------------------------------------------- cuts

async function charlier(st: Stage) {
  const N = st.cards.length, h = N >> 1;
  const { ch } = st;
  play(st, 'shove', { vol: 0.5 });
  // bottom packet drops open like a book hinge
  await all(range(0, h).map((i) => go(st, i, [{ ...rest(i), y: rest(i).y + ch * 0.1, r: -28, z: i }], 260, { origin: '0% 100%' })));
  // top packet swings down past it, bottom packet climbs over
  await all(range(h, N).map((i) => go(st, i, [{ ...rest(i - h), r: 6, z: i - h }], 300, { origin: '0% 100%' })));
  await all(range(0, h).map((i) => go(st, i, [{ ...rest(i + h), y: rest(i + h).y - ch * 0.15, r: -8, z: 100 + i }, { ...rest(N - h + i), z: N - h + i }], 320, { origin: '0% 100%' })));
  await all(range(h, N).map((i) => go(st, i, [{ ...rest(i - h), z: i - h }], 120, { origin: '50% 50%' })));
  play(st, 'place', { vol: 0.4 });
}

async function swivel(st: Stage) {
  const N = st.cards.length, h = N >> 1;
  play(st, 'slide', { vol: 0.5 });
  await all(range(h, N).map((i) => go(st, i, [{ ...rest(i), r: 90, z: 100 + i }, { ...rest(i), r: 180, z: 100 + i }], 420, { origin: '100% 0%' })));
  await all(range(h, N).map((i) => go(st, i, [{ ...rest(i - h), r: 180, z: i - h }], 180, { origin: '100% 0%' })));
  await all(range(0, h).map((i) => go(st, i, [{ ...rest(i + N - h), z: i + N - h }], 200, { origin: '50% 50%' })));
  await all(range(h, N).map((i) => go(st, i, [{ ...rest(i - h), r: 0, z: i - h }], 1, { origin: '50% 50%' })));
}

async function revolution(st: Stage) {
  const N = st.cards.length, h = N >> 1;
  const { ch } = st;
  play(st, 'shove', { vol: 0.45 });
  await all(range(0, h).map((i) => go(st, i, [{ x: 0, y: -ch * 0.7 - i * 0.42, z: 100 + i }], 220)));
  play(st, 'fan', { vol: 0.4, rate: 1.5 });
  await all(range(0, h).map((i) => go(st, i, [{ x: 0, y: -ch * 0.8 - i * 0.42, r: 180, z: 100 + i }, { x: 0, y: -ch * 0.7 - i * 0.42, r: 360, z: 100 + i }], 520)));
  await all(range(h, N).map((i) => go(st, i, [{ ...rest(i - h), z: i - h }], 160)));
  await all(range(0, h).map((i) => go(st, i, [{ ...rest(N - h + i), r: 360, z: N - h + i }], 220)));
  range(0, h).forEach((i) => (st.cur[i] = { ...st.cur[i], r: 0 }));
  await all(range(0, h).map((i) => go(st, i, [{ ...rest(N - h + i), r: 0, z: N - h + i }], 1)));
  play(st, 'place', { vol: 0.4 });
}

async function sybil(st: Stage) {
  const N = st.cards.length, q = Math.floor(N / 4);
  const { cw, ch } = st;
  const packets = [range(0, q), range(q, 2 * q), range(2 * q, 3 * q), range(3 * q, N)];
  const spots: P[] = [{ x: -1.15 * cw, y: -0.1 * ch, r: -12 }, { x: 1.15 * cw, y: -0.1 * ch, r: 12 }, { x: 0, y: -1.05 * ch, r: 0 }, { x: 0, y: 0.05 * ch, r: 0 }];
  play(st, 'shove', { vol: 0.5 });
  await all(packets.flatMap((pk, pi) => pk.map((ci, j) => go(st, ci, [{ x: spots[pi].x - j * 0.22, y: spots[pi].y - j * 0.42, r: spots[pi].r, z: pi * 10 + j }], 360, { delay: pi * 70 }))));
  await wait(st, 120);
  // the packets swap places in a little dance
  play(st, 'slide', { vol: 0.5 });
  const dance = [2, 3, 1, 0];
  await all(packets.flatMap((pk, pi) => pk.map((ci, j) => go(st, ci, [{ x: spots[dance[pi]].x - j * 0.22, y: spots[dance[pi]].y - j * 0.42, r: -(spots[dance[pi]].r ?? 0), z: pi * 10 + j }], 380))));
  const order = [...packets[3], ...packets[1], ...packets[0], ...packets[2]];
  await restack(st, order, 280);
  play(st, 'place', { vol: 0.45 });
}

async function boxCut(st: Stage) {
  const N = st.cards.length, t = Math.floor(N / 3);
  const { cw } = st;
  const packets = [range(0, t), range(t, 2 * t), range(2 * t, N)];
  const xs = [-1.25 * cw, 0, 1.25 * cw];
  for (let pi = 2; pi >= 0; pi--) {
    play(st, 'slide', { vol: 0.45 });
    await all(packets[pi].map((ci, j) => go(st, ci, [{ x: xs[2 - pi] - j * 0.22, y: -j * 0.42, z: j }], 260)));
  }
  await restack(st, [...packets[1], ...packets[2], ...packets[0]], 300);
  play(st, 'place', { vol: 0.45 });
}

// ---------------------------------------------------------------- flourishes

async function pressureFan(st: Stage) {
  const N = st.cards.length;
  play(st, 'fan', { vol: 0.8 });
  await all(range(0, N).map((i) => go(st, i, [{ x: 0, y: 0, r: -80 + (160 * i) / (N - 1), ry: 180, z: i }], 620, { delay: i * 6, origin: '50% 88%' })));
  await wait(st, 420);
  play(st, 'fan', { vol: 0.5, rate: 1.2 });
  await all(range(0, N).map((i) => go(st, i, [{ ...rest(i), r: 0, ry: 0, z: i }], 460, { origin: '50% 88%' })));
}

async function thumbFan(st: Stage) {
  const N = st.cards.length;
  play(st, 'fan', { vol: 0.7, rate: 1.1 });
  await all(range(0, N).map((i) => go(st, i, [{ x: 0, y: 0, r: (95 * i) / (N - 1) - 10, ry: 180, z: i }], 520, { delay: i * 8, origin: '16% 86%' })));
  await wait(st, 360);
  await all(range(0, N).map((i) => go(st, i, [{ ...rest(i), r: 0, ry: 0, z: i }], 420, { origin: '16% 86%' })));
}

async function ribbon(st: Stage, turnover: boolean) {
  const N = st.cards.length;
  const { cw } = st;
  const span = Math.min(cw * 5.5, cw * 0.32 * N);
  play(st, 'slide', { vol: 0.8, rate: 0.9 });
  await all(range(0, N).map((i) => go(st, i, [{ x: -span / 2 + (span * i) / (N - 1), y: 0, z: i }], 600, { delay: i * 10, ease: 'cubic-bezier(.2,.8,.2,1)' })));
  if (turnover) {
    play(st, 'fan', { vol: 0.6 });
    await all(range(0, N).map((i) => go(st, i, [{ ...st.cur[i], ry: 90, s: 1.06 }, { ...st.cur[i], ry: 180, s: 1 }], 340, { delay: i * 28 })));
    await wait(st, 300);
    play(st, 'fan', { vol: 0.5, rate: 1.2 });
    await all(range(0, N).map((i) => go(st, i, [{ ...st.cur[i], ry: 90, s: 1.06 }, { ...st.cur[i], ry: 0, s: 1 }], 300, { delay: (N - 1 - i) * 22 })));
  } else await wait(st, 260);
  play(st, 'slide', { vol: 0.6, rate: 1.2 });
  await all(range(0, N).map((i) => go(st, i, [{ ...rest(i), z: i }], 420, { delay: (N - 1 - i) * 6 })));
}

async function spring(st: Stage) {
  const N = st.cards.length;
  const { cw, ch } = st;
  await all(range(0, N).map((i) => go(st, i, [{ x: -1.5 * cw - i * 0.22, y: -i * 0.42, r: -8, z: i }], 260)));
  play(st, 'slide', { vol: 0.8, rate: 1.4 });
  await all(range(0, N).map((i) => go(st, i, [{ x: 0, y: -ch * 0.95, r: 0, rx: 30, z: 100 + i }, { x: 1.5 * cw - i * 0.22, y: -i * 0.42, r: 8, z: i }], 420, { delay: (N - 1 - i) * 16, ease: 'cubic-bezier(.3,0,.7,1)' })));
  play(st, 'place', { vol: 0.4 });
  await all(range(0, N).map((i) => go(st, i, [{ ...rest(i), r: 0, z: i }], 300)));
}

async function armSpread(st: Stage) {
  const N = st.cards.length;
  const { cw, ch } = st;
  const R = cw * 2.6;
  play(st, 'slide', { vol: 0.7 });
  await all(range(0, N).map((i) => {
    const a = Math.PI * (1.05 + (0.9 * i) / (N - 1));
    return go(st, i, [{ x: Math.cos(a) * R, y: Math.sin(a) * R + R * 0.75 - ch * 0.1, r: (a * 180) / Math.PI + 90, ry: 180, z: i }], 560, { delay: i * 14 });
  }));
  await wait(st, 380);
  play(st, 'slide', { vol: 0.6, rate: 1.3 });
  await all(range(0, N).map((i) => go(st, i, [{ ...rest(i), r: 0, ry: 0, z: i }], 420, { delay: (N - 1 - i) * 8 })));
}

async function twirl(st: Stage) {
  const N = st.cards.length;
  const { ch } = st;
  for (const ci of [N - 1, N - 2]) {
    play(st, 'fan', { vol: 0.4, rate: 1.6 });
    await go(st, ci, [{ x: 0, y: -ch * 1.25, r: 180, ry: 360, s: 1.1, z: 300 }, { x: 0, y: -ch * 1.1, r: 360, ry: 720, s: 1.1, z: 300 }, { ...rest(ci), r: 720, ry: 1080, s: 1, z: ci }], 900, { ease: 'cubic-bezier(.3,.6,.3,1)' });
    st.cur[ci] = { ...rest(ci), z: ci };
    await go(st, ci, [{ ...rest(ci), z: ci }], 1);
    play(st, 'place', { vol: 0.4 });
  }
}

async function rosette(st: Stage) {
  const N = st.cards.length;
  play(st, 'fan', { vol: 0.8, rate: 0.9 });
  await all(range(0, N).map((i) => go(st, i, [{ x: 0, y: 0, r: (360 * i) / N, ry: 180, z: i }], 760, { delay: i * 12, origin: '50% 112%' })));
  await all(range(0, N).map((i) => go(st, i, [{ x: 0, y: 0, r: (360 * i) / N + 45, ry: 180, z: i }], 520, { origin: '50% 112%', ease: 'linear' })));
  play(st, 'fan', { vol: 0.5, rate: 1.2 });
  await all(range(0, N).map((i) => go(st, i, [{ ...rest(i), r: 360, ry: 0, z: i }], 560, { origin: '50% 112%' })));
  range(0, N).forEach((i) => (st.cur[i] = { ...rest(i), z: i }));
  await all(range(0, N).map((i) => go(st, i, [{ ...rest(i), z: i }], 1, { origin: '50% 50%' })));
}

async function helicopter(st: Stage) {
  const N = st.cards.length;
  const { cw, ch } = st;
  const flyers = range(N - 6, N);
  play(st, 'slide', { vol: 0.6, rate: 1.5 });
  await all(flyers.map((ci, j) => {
    const x = (j - 2.5) * cw * 0.55;
    const peak = -ch * (1.1 + (j % 3) * 0.25);
    return go(st, ci, [{ x, y: peak, r: 360 + j * 90, ry: 180, s: 0.95, z: 300 + j }, { x: x * 0.4, y: peak * 0.5, r: 720 + j * 90, ry: 360, z: 300 + j }, { ...rest(ci), r: 1080, ry: 360, z: ci }], 1050, { delay: j * 70, ease: 'cubic-bezier(.2,.7,.4,1)' });
  }));
  flyers.forEach((ci) => (st.cur[ci] = { ...rest(ci), z: ci }));
  await all(flyers.map((ci) => go(st, ci, [{ ...rest(ci), z: ci }], 1)));
  play(st, 'place', { vol: 0.5 });
}

async function tornado(st: Stage) {
  const N = st.cards.length;
  const { cw, ch } = st;
  play(st, 'fan', { vol: 0.6, rate: 0.8 });
  await all(range(0, N).map((i) => {
    const frames: P[] = [];
    for (let k = 1; k <= 4; k++) {
      const th = (i / N) * Math.PI * 4 + k * 1.4;
      frames.push({ x: Math.cos(th) * cw * (0.5 + i / N), y: -ch * 0.15 - (i / N) * ch * 1.2 - k * 4, r: Math.sin(th) * 20, ry: k % 2 ? 180 : 0, s: 0.9 + 0.1 * Math.sin(th), z: Math.round(50 + 40 * Math.sin(th)) });
    }
    frames.push({ ...rest(i), ry: 0, z: i });
    return go(st, i, frames, 1300, { delay: i * 10, ease: 'ease-in-out' });
  }));
  play(st, 'place', { vol: 0.4 });
}

async function vortexSpiral(st: Stage) {
  const N = st.cards.length;
  const { cw } = st;
  play(st, 'slide', { vol: 0.7, rate: 0.8 });
  // an Archimedean spiral that winds in, like flow round a vortex core
  await all(range(0, N).map((i) => {
    const t = i / (N - 1);
    const th = t * Math.PI * 3.2;
    const r = cw * (0.4 + t * 2.1);
    return go(st, i, [{ x: Math.cos(th) * r, y: Math.sin(th) * r * 0.62 - cw * 0.2, r: (th * 180) / Math.PI + 90, ry: 180, z: i }], 700, { delay: i * 14 });
  }));
  await all(range(0, N).map((i) => {
    const t = i / (N - 1);
    const th = t * Math.PI * 3.2 + 1.2;
    const r = cw * (0.3 + t * 1.6);
    return go(st, i, [{ x: Math.cos(th) * r, y: Math.sin(th) * r * 0.62 - cw * 0.2, r: (th * 180) / Math.PI + 90, ry: 180, z: i }], 560, { ease: 'linear' });
  }));
  play(st, 'slide', { vol: 0.5, rate: 1.3 });
  await all(range(0, N).map((i) => go(st, i, [{ ...rest(i), r: 720, ry: 0, z: i }], 520, { delay: (N - 1 - i) * 8 })));
  range(0, N).forEach((i) => (st.cur[i] = { ...rest(i), z: i }));
  await all(range(0, N).map((i) => go(st, i, [{ ...rest(i), z: i }], 1)));
}

async function cascadeWave(st: Stage) {
  const N = st.cards.length;
  const { cw, ch } = st;
  const span = Math.min(cw * 5, cw * 0.3 * N);
  play(st, 'slide', { vol: 0.6 });
  await all(range(0, N).map((i) => go(st, i, [{ x: -span / 2 + (span * i) / (N - 1), y: 0, z: i }], 480, { delay: i * 8 })));
  await all(range(0, N).map((i) => go(st, i, [{ ...st.cur[i], y: -ch * 0.35, r: -6 }, { ...st.cur[i], y: 0, r: 0 }], 420, { delay: i * 26, ease: 'ease-in-out' })));
  await all(range(0, N).map((i) => go(st, i, [{ ...rest(i), z: i }], 380, { delay: (N - 1 - i) * 6 })));
}

// ---------------------------------------------------------------- director

export const SHUFFLES = { 'Riffle and bridge': riffle, Overhand: overhand, 'Hindu shuffle': hindu, 'Faro and waterfall': faroWaterfall, Dribble: dribble };
export const CUTS = { 'Charlier cut': charlier, 'Swivel cut': swivel, 'Revolution cut': revolution, Sybil: sybil, 'Triple cut': boxCut };
export const FLOURISHES = {
  'Pressure fan': pressureFan,
  'Thumb fan': thumbFan,
  'Ribbon spread': (st: Stage) => ribbon(st, false),
  'Ribbon turnover': (st: Stage) => ribbon(st, true),
  Spring: spring,
  'Arm spread': armSpread,
  Twirl: twirl,
  Rosette: rosette,
  'Helicopter toss': helicopter,
  Tornado: tornado,
  'Vortex spiral': vortexSpiral,
  'Cascade wave': cascadeWave,
};
export const TECHNIQUE_COUNT = Object.keys(SHUFFLES).length + Object.keys(CUTS).length + Object.keys(FLOURISHES).length;

type Tech = (st: Stage) => Promise<void>;
const recent: string[] = [];
function pickFrom(group: Record<string, Tech>): [string, Tech] {
  const names = Object.keys(group).filter((n) => !recent.includes(n));
  const pool = names.length ? names : Object.keys(group);
  const n = pool[Math.floor(Math.random() * pool.length)];
  recent.push(n);
  if (recent.length > 8) recent.shift();
  return [n, group[n]];
}

export interface Performance {
  done: Promise<void>;
  skip(): void;
}

/**
 * Perform `count` techniques at (x, y) inside `host`, then collapse the show
 * deck. `onName` reports each technique's name (shown as a caption).
 */
export function perform(host: HTMLElement, o: { x: number; y: number; cw: number; ch: number; count: number; pace: number; n?: number; onName?: (name: string) => void; only?: string; park?: { x: number; y: number; scale: number } }): Performance {
  const stage = document.createElement('div');
  stage.className = 'cardistry';
  stage.style.left = `${o.x}px`;
  stage.style.top = `${o.y}px`;
  stage.style.setProperty('--cw', `${o.cw}px`);
  stage.style.setProperty('--ch', `${o.ch}px`);
  host.appendChild(stage);
  const deck = currentDeck();
  const N = o.n ?? 24;
  const faces = [...ALL_CODES].sort(() => Math.random() - 0.5).slice(0, N);
  const cards: HTMLDivElement[] = [];
  for (let i = 0; i < N; i++) {
    const c = document.createElement('div');
    c.className = 'show-card';
    c.innerHTML = `<div class="sf sb"></div><div class="sf sfr" style="background-image:url('${deck?.face[faces[i]] ?? ''}')"></div>`;
    c.style.transform = tf(rest(i));
    c.style.zIndex = String(i);
    stage.appendChild(c);
    cards.push(c);
  }
  const st: Stage = { cards, cur: range(0, N).map(rest), cw: o.cw, ch: o.ch, k: o.pace, skip: false };
  const seq: [string, Tech][] = [];
  const all22: Record<string, Tech> = { ...SHUFFLES, ...CUTS, ...FLOURISHES };
  if (o.only && all22[o.only]) seq.push([o.only, all22[o.only]]);
  else if (o.count === 1) seq.push(pickFrom(all22));
  else {
    seq.push(pickFrom(SHUFFLES));
    if (o.count >= 3) seq.push(pickFrom(CUTS));
    seq.push(pickFrom(FLOURISHES));
  }
  const done = (async () => {
    stage.animate([{ opacity: 0, transform: 'scale(.9)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 220 * o.pace, fill: 'forwards' });
    for (const [name, fn] of seq) {
      if (st.skip) break;
      o.onName?.(name);
      await fn(st);
    }
    o.onName?.('');
    if (o.park && !st.skip) {
      // carry the squared deck to the dealer's spot
      sfx('slide', { vol: 0.5 });
      await stage.animate([{ transform: 'translate(0,0) scale(1)' }, { transform: `translate(${o.park.x - o.x}px, ${o.park.y - o.y}px) scale(${o.park.scale})` }], { duration: 320 * o.pace, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' }).finished.catch(() => {});
    }
    stage.classList.add('done');
    await sleep(st.skip ? 0 : 80);
    stage.remove();
  })();
  return {
    done,
    skip() {
      st.skip = true;
      stage.getAnimations({ subtree: true }).forEach((a) => a.finish());
    },
  };
}
