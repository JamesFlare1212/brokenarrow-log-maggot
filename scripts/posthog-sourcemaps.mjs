import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '..');
const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
const directories = ['apps/web/dist', 'apps/server/dist', 'apps/desktop/dist'].map((path) =>
  join(root, path),
);
const cli = join(dirname(require.resolve('@posthog/cli/package.json')), 'run-posthog-cli.js');
const upload = process.argv.includes('--upload');
const dryRun = process.argv.includes('--dry-run');
const configured = !!process.env.POSTHOG_CLI_API_KEY && !!process.env.POSTHOG_CLI_PROJECT_ID;

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) =>
        entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)],
      ),
    )
  ).flat();
}
async function run(args) {
  const child = spawn(process.execPath, [cli, ...args], {
    cwd: root,
    env: {
      ...process.env,
      POSTHOG_CLI_HOST: process.env.POSTHOG_CLI_HOST || 'https://posthog.jamesflare.com',
    },
    stdio: 'inherit',
    windowsHide: true,
  });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  if (code !== 0) throw new Error(`PostHog CLI exited with code ${code}`);
}

let count = 0;
for (const directory of directories) {
  const paths = await files(directory);
  const maps = paths.filter((path) => /\.(?:js|cjs)\.map$/.test(path));
  if (!maps.length) throw new Error(`No JavaScript source maps in ${directory}`);
  for (const path of maps) {
    const map = JSON.parse(await readFile(path, 'utf8'));
    if (
      map.version !== 3 ||
      typeof map.mappings !== 'string' ||
      !map.mappings.length ||
      !Array.isArray(map.sources) ||
      !map.sources.length
    )
      throw new Error(`Invalid source map: ${path}`);
    count++;
  }
  if (configured || dryRun)
    await run([
      ...(dryRun ? ['--dry-run'] : []),
      'sourcemap',
      upload ? 'upload' : 'inject',
      '--directory',
      directory,
      '--release-name',
      'brokenarrow.desktop',
      '--release-version',
      version,
    ]);
}
console.log(`Validated ${count} source maps for Broken Arrow ${version}.`);
if (!configured && !dryRun) {
  if (upload)
    throw new Error('Source map upload requires POSTHOG_CLI_API_KEY and POSTHOG_CLI_PROJECT_ID.');
  console.log('PostHog injection/upload skipped: CI credentials are not configured.');
}
