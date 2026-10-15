import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@ba/contracts': fileURLToPath(new URL('./packages/contracts/src/index.ts', import.meta.url)),
      '@ba/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)),
      '@ba/server': fileURLToPath(new URL('./apps/server/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environment: 'node',
    testTimeout: 10000,
    restoreMocks: true,
  },
});
