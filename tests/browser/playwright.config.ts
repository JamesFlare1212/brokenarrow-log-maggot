import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const baseURL = 'http://127.0.0.1:5174';

export default defineConfig({
  testDir: '.',
  outputDir: '../../.test-data/playwright',
  workers: 1,
  reporter: 'list',
  use: {
    baseURL,
    browserName: 'chromium',
    channel: process.env.BA_BROWSER_CHANNEL || undefined,
    viewport: { width: 1000, height: 700 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm dev:web',
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
