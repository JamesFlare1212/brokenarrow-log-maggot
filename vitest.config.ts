import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { availableParallelism } from 'node:os';
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./apps/web/src', import.meta.url)),
      '@ba/contracts': fileURLToPath(new URL('./packages/contracts/src/index.ts', import.meta.url)),
      '@ba/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)),
      '@ba/server': fileURLToPath(new URL('./apps/server/src/index.ts', import.meta.url)),
    },
  },
  test: {
    setupFiles: ['tests/setup-dom.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environment: 'node',
    // Corpus-heavy suites share disk bandwidth, so extra workers can cause test timeouts.
    maxWorkers: Math.min(4, availableParallelism()),
    testTimeout: 10000,
    restoreMocks: true,
  },
});
