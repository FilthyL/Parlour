/**
 * Sound: Kenney's CC0 casino samples through Web Audio, with random
 * variants, slight pitch jitter so repeats don't sound mechanical, and a
 * synthesized chime for wins.
 */
import { settings } from '../settings';

const BANK: Record<string, string[]> = {
  slide: ['cardSlide1', 'cardSlide2', 'cardSlide3', 'cardSlide4', 'cardSlide5', 'cardSlide6', 'cardSlide7', 'cardSlide8'],
  place: ['cardPlace1', 'cardPlace2', 'cardPlace3', 'cardPlace4'],
  shove: ['cardShove1', 'cardShove2', 'cardShove3', 'cardShove4'],
  fan: ['cardFan1', 'cardFan2'],
  shuffle: ['cardShuffle'],
  open: ['cardOpenPackage1', 'cardOpenPackage2'],
  takeout: ['cardTakeOutPackage1', 'cardTakeOutPackage2'],
  chip: ['chipLay1', 'chipLay2', 'chipLay3'],
  chips: ['chipsStack1', 'chipsStack2', 'chipsStack3', 'chipsStack4', 'chipsStack5', 'chipsStack6'],
  handle: ['chipsHandle1', 'chipsHandle2', 'chipsHandle3', 'chipsHandle4', 'chipsHandle5', 'chipsHandle6'],
  collide: ['chipsCollide1', 'chipsCollide2', 'chipsCollide3', 'chipsCollide4'],
};

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const buffers = new Map<string, AudioBuffer>();
const loading = new Map<string, Promise<void>>();
const last = new Map<string, number>();

function audio() {
  if (!ctx) {
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.connect(ctx.destination);
    } catch {
      return null;
    }
  }
  if (master) master.gain.value = settings.get().volume;
  return ctx;
}

function load(name: string) {
  if (buffers.has(name) || loading.has(name)) return loading.get(name);
  const a = audio();
  if (!a) return;
  const p = fetch(new URL(`sfx/${name}.mp3`, document.baseURI).href)
    .then((r) => r.arrayBuffer())
    .then((b) => a.decodeAudioData(b))
    .then((buf) => void buffers.set(name, buf))
    .catch(() => {});
  loading.set(name, p);
  return p;
}

/** Call once from a user gesture so browsers allow audio. */
export function unlockAudio() {
  const a = audio();
  if (a && a.state === 'suspended') a.resume();
  Object.values(BANK).flat().forEach(load);
}

export interface PlayOpts {
  vol?: number;
  rate?: number;
  delay?: number; // ms
  /** minimum ms between plays of this kind */
  throttle?: number;
}

export function sfx(kind: string, o: PlayOpts = {}) {
  if (settings.get().muted) return;
  const a = audio();
  if (!a || !master || a.state !== 'running') return;
  const now = performance.now();
  if (o.throttle && now - (last.get(kind) ?? 0) < o.throttle) return;
  last.set(kind, now);
  if (kind === 'win') return chime(o.delay ?? 0);
  const names = BANK[kind];
  if (!names) return;
  const name = names[Math.floor(Math.random() * names.length)];
  const buf = buffers.get(name);
  if (!buf) return void load(name);
  const src = a.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = (o.rate ?? 1) * (0.94 + Math.random() * 0.12);
  const g = a.createGain();
  g.gain.value = o.vol ?? 0.8;
  src.connect(g).connect(master);
  src.start(a.currentTime + (o.delay ?? 0) / 1000);
}

/** A soft three-note bell for wins (synthesized). */
function chime(delay: number) {
  const a = ctx!;
  const t0 = a.currentTime + delay / 1000;
  [659.25, 830.61, 987.77, 1318.5].forEach((f, i) => {
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    g.gain.setValueAtTime(0, t0 + i * 0.09);
    g.gain.linearRampToValueAtTime(0.16, t0 + i * 0.09 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.09 + 1.1);
    o.connect(g).connect(master!);
    o.start(t0 + i * 0.09);
    o.stop(t0 + i * 0.09 + 1.2);
  });
}
