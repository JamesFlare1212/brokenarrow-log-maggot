import { spawn } from 'node:child_process';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import electron from 'electron';
const root = resolve('.test-data/smoke');
await mkdir(root, { recursive: true });
const directory = await mkdtemp(join(root, 'run-'));
const environment = { ...process.env, BA_SMOKE: '1', BA_USER_DATA: directory };
delete environment.ELECTRON_RUN_AS_NODE;
const executable = process.argv[2] ? resolve(process.argv[2]) : electron;
const child = spawn(executable, process.argv[2] ? [] : ['.'], {
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
if (timedOut || code !== 0 || !result?.hasBridge || result.buttons < 5) {
  console.error(errors || 'Electron smoke test failed to initialize');
  process.exitCode = 1;
} else
  console.log(
    'Electron smoke passed: SQLite service, sandboxed preload and React renderer initialized.',
  );
