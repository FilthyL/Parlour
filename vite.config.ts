import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { target: 'es2022', assetsInlineLimit: 0, chunkSizeWarningLimit: 1200 },
  worker: { format: 'es' },
  test: { environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 120000 },
} as any);
