import { spawn } from 'node:child_process';
import electron from 'electron';
import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const manager = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const build = spawn(manager, ['build'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  windowsHide: true,
});
await new Promise((resolve, reject) => {
  build.once('error', reject);
  build.once('exit', (code) =>
    code === 0 ? resolve() : reject(new Error(`Desktop build failed (${code})`)),
  );
});
const { prepareRealData } = createRequire(import.meta.url)('../apps/server/dist/index.cjs');
const environment = {
  ...process.env,
  BA_RENDERER_URL: 'http://127.0.0.1:5173/?real',
  BA_OFFLINE: '1',
  BA_USER_DATA: await prepareRealData(
    resolve('tests/fixtures/real'),
    resolve('.test-data/real-dev'),
  ),
};
console.log('Real-data development profile:', environment.BA_USER_DATA);
const server = await createServer({ configFile: 'apps/web/vite.config.ts' });
await server.listen();
server.printUrls();
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.'], { stdio: 'inherit', windowsHide: true, env: environment });
let closing = false;
const close = async (code) => {
  if (closing) return;
  closing = true;
  child.kill();
  await server.close();
  process.exit(code || 0);
};
child.once('error', (error) => {
  console.error(error);
  void close(1);
});
child.once('exit', (code) => void close(code));
process.on('SIGINT', () => void close(0));
process.on('SIGTERM', () => void close(0));
