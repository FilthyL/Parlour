/** Orchestrates a full press run (back + 52 faces) in any canvas environment. */
import { makePaper } from './paper';
import { reprintBack, reprintFace } from './printer';
import { drawBack } from './guilloche';
import { editionById } from './editions';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface CanvasEnv {
  make(w: number, h: number): { ctx: Ctx2D; encode(type: string, q?: number): Promise<Blob> };
  load(url: string): Promise<{ data: Uint8ClampedArray; width: number; height: number }>;
}

export interface PressJob {
  editionId: string;
  seed: number;
  baseUrl: string; // where public/press lives
  codes: string[];
  width: number;
  height: number;
}

export type PressItem =
  | { kind: 'back'; face: Blob; foil: Blob | null }
  | { kind: 'face'; code: string; face: Blob; foil: Blob | null };

async function encode(env: CanvasEnv, px: Uint8ClampedArray, W: number, H: number, q = 0.9) {
  const c = env.make(W, H);
  const img = c.ctx.createImageData(W, H);
  img.data.set(px);
  c.ctx.putImageData(img, 0, 0);
  return c.encode('image/webp', q);
}

export async function runPress(env: CanvasEnv, job: PressJob, emit: (item: PressItem) => void) {
  const ed = editionById(job.editionId);
  const paper = makePaper(job.seed);
  const W = job.width, H = job.height;

  // Back first: face-down cards are what the dealer handles first
  const f = env.make(W, H), a = env.make(W, H);
  drawBack(f.ctx, a.ctx, W, H, job.seed);
  const fd = f.ctx.getImageData(0, 0, W, H).data, ad = a.ctx.getImageData(0, 0, W, H).data;
  const back = reprintBack(fd, ad, W, H, paper, ed, job.seed);
  emit({ kind: 'back', face: await encode(env, back.face, W, H, 0.92), foil: back.foil ? await encode(env, back.foil, W, H, 0.8) : null });

  for (let i = 0; i < job.codes.length; i++) {
    const code = job.codes[i];
    const plates = await env.load(`${job.baseUrl}plates/${code}.png`);
    const res = reprintFace(plates.data, W, H, paper, ed, job.seed, i);
    emit({
      kind: 'face',
      code,
      face: await encode(env, res.face, W, H, 0.9),
      foil: res.foil ? await encode(env, res.foil, W, H, 0.75) : null,
    });
  }
}
