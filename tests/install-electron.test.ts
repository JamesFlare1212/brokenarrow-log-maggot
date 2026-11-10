import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installElectron, runInstaller } from '../scripts/install-electron.mjs';

const root = resolve('.test-data/electron-installer-tests');
const directories: string[] = [];

function assertChild(parent: string, target: string) {
  const child = relative(parent, target);
  if (!child || isAbsolute(child) || child === '..' || child.startsWith('..' + sep))
    throw new Error('Installer test cleanup escaped its test root');
}

async function installer(source: string) {
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'run-'));
  directories.push(directory);
  const script = join(directory, 'installer.mjs');
  await writeFile(script, source);
  return script;
}

afterEach(async () => {
  if (!directories.length) return;
  const actualRoot = await realpath(root);
  assertChild(await realpath(process.cwd()), actualRoot);
  for (const directory of directories.splice(0)) {
    const target = await realpath(directory);
    assertChild(actualRoot, target);
    await rm(target, { recursive: true, force: true });
  }
});

describe('Electron install resilience', () => {
  it('returns immediately when the runtime is already available', async () => {
    const run = vi.fn(async () => {}),
      wait = vi.fn(async () => {}),
      warn = vi.fn();
    await installElectron({ run, wait, warn });
    expect(run).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('retries two failed installer processes before accepting a successful installation', async () => {
    const script = await installer(`
      import { readFile, writeFile } from 'node:fs/promises';
      const counter = new URL('./attempts', import.meta.url);
      const attempt = Number(await readFile(counter, 'utf8').catch(() => '0')) + 1;
      await writeFile(counter, String(attempt));
      process.exitCode = attempt < 3 ? 1 : 0;
    `);
    const run = vi.fn(() => runInstaller(script)),
      wait = vi.fn(async () => {}),
      warn = vi.fn();
    await installElectron({ run, wait, warn });
    expect(run).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls).toEqual([[5_000], [15_000]]);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('preserves a permanent installer failure after exactly three attempts', async () => {
    const script = await installer('process.exitCode = 17;');
    const run = vi.fn(() => runInstaller(script)),
      wait = vi.fn(async () => {});
    await expect(installElectron({ run, wait, warn: vi.fn() })).rejects.toThrow('code 17');
    expect(run).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls).toEqual([[5_000], [15_000]]);
  });

  it('does not restart an installer terminated by a signal', async () => {
    const error = Object.assign(new Error('Interrupted'), { signal: 'SIGTERM' });
    const run = vi.fn(async () => {
        throw error;
      }),
      wait = vi.fn(async () => {});
    await expect(installElectron({ run, wait, warn: vi.fn() })).rejects.toBe(error);
    expect(run).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });
});
