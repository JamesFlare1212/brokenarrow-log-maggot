import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
const testWorkers = Number(process.env.BA_TEST_WORKERS ?? 4);
if (!Number.isInteger(testWorkers) || testWorkers < 1)
  throw new Error('BA_TEST_WORKERS must be a positive integer');
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
    testTimeout: 10000,
    // Bound concurrent SQLite and filesystem fixtures on machines with many cores.
    maxWorkers: testWorkers,
    restoreMocks: true,
  },
});
