/// <reference lib="webworker" />
import { runPress, type CanvasEnv, type PressJob } from './deck';

const env: CanvasEnv = {
  make(w, h) {
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    return { ctx, encode: (type, q) => c.convertToBlob({ type, quality: q }) };
  },
  async load(url) {
    const blob = await (await fetch(url)).blob();
    const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0);
    return { data: ctx.getImageData(0, 0, bmp.width, bmp.height).data, width: bmp.width, height: bmp.height };
  },
};

self.onmessage = async (e: MessageEvent<{ id: number; job: PressJob }>) => {
  const { id, job } = e.data;
  try {
    await runPress(env, job, (item) => (self as unknown as Worker).postMessage({ id, item }));
    (self as unknown as Worker).postMessage({ id, done: true });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
