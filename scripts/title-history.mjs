import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { gunzipSync, gzipSync } from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';

const { BatraceClient, Database, summarizeTitleHistory } = createRequire(import.meta.url)(
  '../apps/server/dist/index.cjs',
);
const option = (name) => {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing ${name}`);
  return value;
};
const directory = resolve(option('--out') || 'tests/fixtures/batrace/history');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const golden = (report) => ({
  ...report,
  matches: report.matches.map(({ awards, ...match }) => ({
    ...match,
    ...(awards ? { awardsSha256: hash(JSON.stringify(awards)) } : {}),
  })),
});

async function capture() {
  const userDirectory = resolve(
    option('--user-data') || join(process.env.APPDATA || '', 'broken-arrow-log-assistant'),
  );
  const source = new DatabaseSync(join(userDirectory, 'assistant.sqlite'), { readOnly: true });
  let history, cache;
  try {
    source.exec('BEGIN');
    history = source
      .prepare('SELECT payload FROM matches ORDER BY rowid')
      .all()
      .map((row) => JSON.parse(row.payload));
    cache = source.prepare("SELECT key, at, payload FROM api_cache WHERE key LIKE 'match:%'").all();
    source.exec('COMMIT');
  } finally {
    source.close();
  }
  const fixture = {
    version: 1,
    capturedAt: Date.now(),
    source: {
      historyMatches: history.length,
      withoutFid: history.filter((match) => !match.fid).length,
    },
    matches: history
      .filter((match) => match.fid)
      .map((match) => ({
        id: match.fid,
        localPlayerId: match.localPlayerId,
        winnerTeamId: match.winnerTeamId,
      }))
      .sort((a, b) => Number(a.id) - Number(b.id)),
    responses: [],
    requests: [],
    failures: [],
  };
  if (!fixture.matches.length) throw new Error('No historical FIDs found');
  const ids = new Set(fixture.matches.map((match) => match.id));
  for (const row of cache) {
    const id = row.key.slice('match:'.length);
    if (ids.has(id))
      fixture.responses.push({ id, at: row.at, source: 'cache', value: JSON.parse(row.payload) });
  }
  const recorded = new Set(fixture.responses.map((response) => response.id));
  const db = new Database(':memory:');
  const version = JSON.parse(await readFile('package.json', 'utf8')).version;
  const client = new BatraceClient(
    db,
    {
      fetch: async (url, options) => {
        const record = {
          path: new URL(String(url)).pathname + new URL(String(url)).search,
          at: Date.now(),
          status: null,
          contentType: null,
          body: null,
        };
        fixture.requests.push(record);
        try {
          const response = await fetch(url, options);
          record.status = response.status;
          record.contentType = response.headers.get('content-type');
          record.body = await response.clone().text();
          return response;
        } catch (error) {
          record.error = error.message;
          throw error;
        }
      },
    },
    version,
  );
  try {
    for (const match of fixture.matches) {
      if (recorded.has(match.id)) continue;
      try {
        const result = await client.match(match.id, true);
        fixture.responses.push({
          id: match.id,
          at: result.at,
          source: 'network',
          value: result.value,
        });
        console.log(`Captured ${match.id}`);
      } catch (error) {
        fixture.failures.push({ id: match.id, error: error.message });
        console.log(`Unavailable ${match.id}: ${error.message}`);
      }
    }
  } finally {
    await client.close();
    db.close();
  }
  fixture.responses.sort((a, b) => Number(a.id) - Number(b.id));
  const bytes = gzipSync(Buffer.from(JSON.stringify(fixture)), { level: 9 });
  const report = summarizeTitleHistory(fixture);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'responses.json.gz'), bytes);
  await writeFile(
    join(directory, 'manifest.json'),
    JSON.stringify(
      {
        version: 1,
        capturedAt: fixture.capturedAt,
        sha256: hash(bytes),
        responses: fixture.responses.length,
        cached: fixture.responses.filter((response) => response.source === 'cache').length,
        fetched: fixture.responses.filter((response) => response.source === 'network').length,
        requests: fixture.requests.length,
        failures: fixture.failures,
        scope: report.scope,
      },
      null,
      2,
    ) + '\n',
  );
  await writeFile(join(directory, 'expected.json'), JSON.stringify(golden(report), null, 2) + '\n');
  return report;
}

let report;
if (process.argv.includes('--capture')) report = await capture();
else {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  const bytes = await readFile(join(directory, 'responses.json.gz'));
  if (manifest.version !== 1 || hash(bytes) !== manifest.sha256)
    throw new Error('Title history fixture checksum or version is invalid');
  report = summarizeTitleHistory(JSON.parse(gunzipSync(bytes).toString('utf8')));
  const expected = JSON.parse(await readFile(join(directory, 'expected.json'), 'utf8'));
  if (process.argv.includes('--update-expected'))
    await writeFile(
      join(directory, 'expected.json'),
      JSON.stringify(golden(report), null, 2) + '\n',
    );
  else if (!isDeepStrictEqual(golden(report), expected))
    throw new Error('Historical title regression: results differ from expected.json');
}
console.log(JSON.stringify({ ...report, matches: undefined }, null, 2));
