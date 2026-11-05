/**
 * Main-thread API for the card press. Prints a deck (edition + seed) in a
 * worker, caches the result in IndexedDB, and exposes object URLs for the
 * renderer. Falls back to the main thread if OffscreenCanvas is missing.
 */
import { runPress, type CanvasEnv, type PressItem, type PressJob } from './deck';

export interface PrintedDeck {
  key: string;
  editionId: string;
  seed: number;
  back: string;
  backFoil: string | null;
  face: Record<string, string>;
  foil: Record<string, string>;
  ready: boolean;
}

const VERSION = 4;
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['S', 'H', 'D', 'C'];
export const ALL_CODES = SUITS.flatMap((s) => RANKS.map((r) => r + s));
// Print courts and aces first: they're the showpieces in the lobby
const PRINT_ORDER = [...ALL_CODES].sort((a, b) => weight(b) - weight(a));
function weight(c: string) {
  const r = c.slice(0, -1);
  return r === 'A' ? 3 : 'JQK'.includes(r) ? 2 : 0;
}

// ---------- IndexedDB cache ----------
type Stored = { back: Blob; backFoil: Blob | null; faces: Record<string, Blob>; foils: Record<string, Blob> };

function idb(): Promise<IDBDatabase | null> {
  return new Promise((res) => {
    try {
      const req = indexedDB.open('press', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('decks');
      req.onsuccess = () => res(req.result);
      req.onerror = () => res(null);
    } catch {
      res(null);
    }
  });
}
async function cacheGet(key: string): Promise<Stored | null> {
  const db = await idb();
  if (!db) return null;
  return new Promise((res) => {
    try {
      const r = db.transaction('decks').objectStore('decks').get(key);
      r.onsuccess = () => res((r.result as Stored) ?? null);
      r.onerror = () => res(null);
    } catch {
      res(null);
    }
  });
}
async function cachePut(key: string, val: Stored) {
  const db = await idb();
  if (!db) return;
  try {
    const tx = db.transaction('decks', 'readwrite');
    const store = tx.objectStore('decks');
    // keep the cache small: only the most recent few decks
    const keys = store.getAllKeys();
    keys.onsuccess = () => {
      const all = keys.result as string[];
      all.filter((k) => k !== key).slice(0, Math.max(0, all.length - 3)).forEach((k) => store.delete(k));
      store.put(val, key);
    };
  } catch {
    /* cache is a nicety */
  }
}

// ---------- environments ----------
function mainThreadEnv(): CanvasEnv {
  return {
    make(w, h) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      return {
        ctx,
        encode: (type, q) => new Promise<Blob>((r) => c.toBlob((b) => r(b!), type, q)),
      };
    },
    async load(url) {
      const img = new Image();
      img.src = url;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0);
      return { data: ctx.getImageData(0, 0, c.width, c.height).data, width: c.width, height: c.height };
    },
  };
}

let worker: Worker | null = null;
let jobId = 0;
function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    if (typeof OffscreenCanvas === 'undefined') return null;
    worker = new Worker(new URL('./press.worker.ts', import.meta.url), { type: 'module' });
    return worker;
  } catch {
    return null;
  }
}

async function runJob(job: PressJob, emit: (i: PressItem) => void): Promise<void> {
  const w = getWorker();
  if (!w) return runPress(mainThreadEnv(), job, emit);
  const id = ++jobId;
  return new Promise((resolve, reject) => {
    let settled = false;
    const fallback = () => {
      if (settled) return;
      settled = true;
      w.removeEventListener('message', onMsg);
      worker = null; // don't try the worker again
      runPress(mainThreadEnv(), job, emit).then(resolve, reject);
    };
    // if the worker script can't load (e.g. a strict host), print on the main thread
    w.addEventListener('error', fallback, { once: true });
    const watchdog = setTimeout(fallback, 15000);
    const onMsg = (e: MessageEvent) => {
      clearTimeout(watchdog);
      if (settled) return;
      if (e.data.id !== id) return;
      if (e.data.item) emit(e.data.item);
      else if (e.data.error) {
        // worker failed (e.g. no WebP encoder): retry on the main thread
        fallback();
      } else {
        settled = true;
        w.removeEventListener('message', onMsg);
        resolve();
      }
    };
    w.addEventListener('message', onMsg);
    w.postMessage({ id, job });
  });
}

// ---------- public API ----------
let manifest: { width: number; height: number } | null = null;
let current: PrintedDeck | null = null;
const listeners = new Set<(d: PrintedDeck) => void>();
let inflight: Promise<PrintedDeck> | null = null;
let inflightKey = '';

export const pressBase = () => new URL('press/', document.baseURI).href;
export const currentDeck = () => current;
export function onDeck(fn: (d: PrintedDeck) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const notify = (d: PrintedDeck) => {
  // publish the back globally: table sprites, the show deck and the lobby all use it
  const root = document.documentElement.style;
  if (d.back) root.setProperty('--back', `url("${d.back}")`);
  root.setProperty('--back-foil', d.backFoil ? `url("${d.backFoil}")` : 'none');
  listeners.forEach((fn) => fn(d));
};

export function printDeck(editionId: string, seed: number, onProgress?: (p: number) => void): Promise<PrintedDeck> {
  const key = `v${VERSION}:${editionId}:${seed}`;
  if (current?.key === key && current.ready) return Promise.resolve(current);
  if (inflight && inflightKey === key) return inflight;
  inflightKey = key;
  inflight = (async () => {
    if (!manifest) manifest = await (await fetch(pressBase() + 'manifest.json')).json();
    const old = current;
    const deck: PrintedDeck = { key, editionId, seed, back: '', backFoil: null, face: {}, foil: {}, ready: false };
    const url = (b: Blob) => URL.createObjectURL(b);
    const cached = await cacheGet(key);
    if (cached && Object.keys(cached.faces).length === 52) {
      deck.back = url(cached.back);
      deck.backFoil = cached.backFoil ? url(cached.backFoil) : null;
      for (const c of ALL_CODES) {
        deck.face[c] = url(cached.faces[c]);
        if (cached.foils[c]) deck.foil[c] = url(cached.foils[c]);
      }
      deck.ready = true;
      onProgress?.(1);
    } else {
      const store: Stored = { back: new Blob(), backFoil: null, faces: {}, foils: {} };
      let count = 0;
      let backDone = false;
      await runJob(
        { editionId, seed, baseUrl: pressBase(), codes: PRINT_ORDER, width: manifest!.width, height: manifest!.height },
        (item) => {
          if (item.kind === 'back') {
            deck.back = url(item.face);
            deck.backFoil = item.foil ? url(item.foil) : null;
            store.back = item.face;
            store.backFoil = item.foil;
            backDone = true;
            // publish early so face-down cards can show the new back immediately
            current = deck;
            notify(deck);
          } else {
            deck.face[item.code] = url(item.face);
            store.faces[item.code] = item.face;
            if (item.foil) {
              deck.foil[item.code] = url(item.foil);
              store.foils[item.code] = item.foil;
            }
            count++;
            if (old && !old.ready) {
              /* nothing to fall back to */
            }
            if (count % 6 === 0) notify(deck);
          }
          onProgress?.((count + (backDone ? 1 : 0)) / 53);
        },
      );
      deck.ready = true;
      cachePut(key, store);
    }
    current = deck;
    notify(deck);
    // free the previous deck's object URLs a little later (sprites may still show them)
    if (old && old.key !== key) {
      setTimeout(() => {
        [old.back, old.backFoil, ...Object.values(old.face), ...Object.values(old.foil)].forEach((u) => u && URL.revokeObjectURL(u));
      }, 4000);
    }
    inflight = null;
    return deck;
  })();
  return inflight;
}
