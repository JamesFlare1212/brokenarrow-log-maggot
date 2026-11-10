import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const retryDelays = [5_000, 15_000];

export function runInstaller(installer = require.resolve('electron/install.js')) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [installer], {
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          Object.assign(
            new Error(
              signal
                ? `Electron installer terminated by ${signal}`
                : `Electron installer exited with code ${code}`,
            ),
            { signal },
          ),
        );
    });
  });
}

export async function installElectron({
  run = runInstaller,
  wait = sleep,
  warn = console.warn,
} = {}) {
  for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
    try {
      await run();
      return;
    } catch (error) {
      if (error?.signal || attempt === retryDelays.length) throw error;
      const delay = retryDelays[attempt];
      warn(
        `Electron installation attempt ${attempt + 1}/${retryDelays.length + 1} failed; retrying in ${delay / 1000}s.`,
      );
      await wait(delay);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await installElectron();
  } catch (error) {
    console.error('Electron installation failed:', error);
    process.exitCode = 1;
  }
}
