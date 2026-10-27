import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const directoryRoot = resolve('.test-data/ui-design-checks');
const checker = resolve('scripts/check-ui-design.mjs');
const directories: string[] = [];
const compliantSource = `
import { Card as Panel } from '@/components/ui/card';
export const Example = () => <Panel className="layout-card w-full"><span>Content</span></Panel>;
`;

async function fixture(source = compliantSource, css = '.layout-card { padding: 1rem; }') {
  await mkdir(directoryRoot, { recursive: true });
  const directory = await mkdtemp(join(directoryRoot, 'case-'));
  directories.push(directory);
  await Promise.all([
    mkdir(join(directory, 'apps/web/src'), { recursive: true }),
    mkdir(join(directory, 'docs')),
    mkdir(join(directory, 'design-system')),
  ]);
  await Promise.all([
    writeFile(join(directory, 'apps/web/src/Example.tsx'), source),
    writeFile(join(directory, 'apps/web/src/layout.css'), css),
    writeFile(join(directory, 'README.md'), '[Design](design-system/MASTER.md)\n'),
    writeFile(join(directory, 'AGENTS.md'), '# Instructions\n'),
    writeFile(join(directory, 'design-system/MASTER.md'), '# Current design\n'),
  ]);
  return directory;
}

function check(directory: string) {
  return spawnSync(process.execPath, [checker, '--json'], {
    cwd: directory,
    encoding: 'utf8',
    windowsHide: true,
  });
}

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    const target = resolve(directory);
    if (!target.startsWith(directoryRoot + sep)) throw new Error('Unsafe audit fixture cleanup');
    await rm(target, { recursive: true, force: true });
  }
});

describe('UI design guard', () => {
  it('allows layout-only card styling, renamed imports, and deliberate table surfaces', async () => {
    const directory = await fixture(
      compliantSource,
      '.layout-card { padding: 1rem; } .table-frame { background: var(--card); border-radius: 1rem; }',
    );
    const result = check(directory);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      cardSites: 1,
      featureOverrides: [],
      cssOverrides: [],
      brokenLinks: [],
    });
  });

  it.each([
    {
      name: 'feature surface overrides',
      source: compliantSource.replace('layout-card w-full', 'layout-card bg-white shadow-lg'),
      css: '',
      issue: 'featureOverrides',
    },
    {
      name: 'card radius overrides in CSS',
      source: compliantSource,
      css: '.layout-card { border-radius: 2rem; }',
      issue: 'cssOverrides',
    },
    {
      name: 'retired card-choice variants',
      source: 'export const Example = () => <ToggleGroup variant="appearance" />;',
      css: '',
      issue: 'retiredVariants',
    },
  ])('rejects $name', async ({ source, css, issue }) => {
    const directory = await fixture(source, css);
    const result = check(directory);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr)[issue]).toHaveLength(1);
  });

  it('rejects stale documentation links without rewriting documentation', async () => {
    const directory = await fixture();
    const path = join(directory, 'README.md');
    const markdown = '[Old tokens](apps/web/src/styles/retired-tokens.css)\n';
    await writeFile(path, markdown);
    const result = check(directory);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr).brokenLinks).toEqual([
      { file: 'README.md', target: 'apps/web/src/styles/retired-tokens.css' },
    ]);
    expect(await readFile(path, 'utf8')).toBe(markdown);
  });
});
