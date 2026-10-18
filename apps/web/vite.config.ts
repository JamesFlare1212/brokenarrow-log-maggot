import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { browserFixtures } from './dev/fixtures.ts';
export default defineConfig(({ mode }) => ({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  plugins: [react(), ...(mode === 'fixtures' ? [browserFixtures()] : [])],
  resolve: {
    alias: {
      '@ba/contracts': fileURLToPath(
        new URL('../../packages/contracts/src/index.ts', import.meta.url),
      ),
      '@ba/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  server: { host: '127.0.0.1', port: mode === 'fixtures' ? 5174 : 5173, strictPort: true },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        app: fileURLToPath(new URL('./index.html', import.meta.url)),
        recorder: fileURLToPath(new URL('./recorder.html', import.meta.url)),
      },
    },
  },
}));
