import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: {
    alias: {
      '@ba/contracts': fileURLToPath(
        new URL('../../packages/contracts/src/index.ts', import.meta.url),
      ),
      '@ba/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
      '@ba/server': fileURLToPath(new URL('../server/src/index.ts', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    sourcemap: true,
    lib: {
      entry: {
        main: fileURLToPath(new URL('./src/main.ts', import.meta.url)),
        preload: fileURLToPath(new URL('./src/preload.ts', import.meta.url)),
        'recorder-preload': fileURLToPath(new URL('./src/recorder-preload.ts', import.meta.url)),
      },
      formats: ['cjs'],
      fileName: (_format, name) => `${name}.cjs`,
    },
    rollupOptions: {
      external: [
        'electron',
        'electron-updater',
        'uiohook-napi',
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
      ],
    },
  },
});
