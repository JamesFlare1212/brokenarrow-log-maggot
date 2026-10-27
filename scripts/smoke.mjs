import { spawn } from 'node:child_process';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import electron from 'electron';
import { createRequire } from 'node:module';
const root = resolve('.test-data/smoke');
await mkdir(root, { recursive: true });
const realData = process.argv.includes('--real');
const expectedMatches = realData
  ? (
      await createRequire(import.meta.url)('../apps/server/dist/index.cjs').loadRealData(
        resolve('tests/fixtures/real'),
      )
    ).manifest.expected.seededMatches
  : null;
const directory = realData
  ? await createRequire(import.meta.url)('../apps/server/dist/index.cjs').prepareRealData(
      resolve('tests/fixtures/real'),
      root,
    )
  : await mkdtemp(join(root, 'run-'));
const environment = { ...process.env, BA_SMOKE: '1', BA_USER_DATA: directory };
if (realData) environment.BA_OFFLINE = '1';
delete environment.ELECTRON_RUN_AS_NODE;
const executablePath = process.argv.slice(2).find((argument) => argument !== '--real');
const executable = executablePath ? resolve(executablePath) : electron;
const child = spawn(executable, executablePath ? [] : ['.'], {
  windowsHide: true,
  env: environment,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '',
  errors = '',
  timedOut = false;
child.stdout.on('data', (data) => {
  output += data.toString();
  process.stdout.write(data);
});
child.stderr.on('data', (data) => {
  errors += data.toString();
});
const timeout = setTimeout(() => {
  timedOut = true;
  child.kill();
}, 30000);
const code = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', resolve);
});
clearTimeout(timeout);
const line = output.split(/\r?\n/).find((line) => line.startsWith('SMOKE_RESULT '));
let result = null;
try {
  result = line ? JSON.parse(line.slice(13)) : null;
} catch {}
if (
  timedOut ||
  code !== 0 ||
  !result?.hasBridge ||
  result.buttons < 5 ||
  (process.platform === 'win32' &&
    (!result.windowChrome ||
      Object.values(result.windowChrome).some((passed) => passed !== true))) ||
  (realData && result.matches !== expectedMatches)
) {
  console.error(errors || 'Electron smoke test failed to initialize');
  process.exitCode = 1;
} else
  console.log(
    realData
      ? `Electron real-data smoke passed: ${result.matches} real matches loaded through the native bridge, offline.`
      : 'Electron smoke passed: SQLite service, sandboxed preload, React renderer and integrated window chrome initialized.',
  );
