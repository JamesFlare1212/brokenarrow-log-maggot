import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { gunzipSync, gzipSync } from 'node:zlib';

const { BatraceClient, Database, compareTitleMedals, MEDAL_SOURCE } = createRequire(
  import.meta.url,
)('../apps/server/dist/index.cjs');
const directory = resolve('tests/fixtures/batrace/history');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const historyBytes = await readFile(join(directory, 'responses.json.gz'));
const historyManifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
if (hash(historyBytes) !== historyManifest.sha256)
  throw new Error('Title history checksum is invalid');
const history = JSON.parse(gunzipSync(historyBytes).toString('utf8'));
const golden = (report) => ({
  ...report,
  matches: report.matches.map(({ awards, scoreLabels, ...match }) => ({
    ...match,
    ...(awards ? { awardsSha256: hash(JSON.stringify(awards)) } : {}),
    ...(scoreLabels ? { scoreLabelsSha256: hash(JSON.stringify(scoreLabels)) } : {}),
  })),
});
let fixture;
if (process.argv.includes('--capture')) {
  const sourceResponse = await fetch(
    `https://raw.githubusercontent.com/Zawinzala/Broken-Arrow-Maggot/${MEDAL_SOURCE.revision}/${MEDAL_SOURCE.file}`,
  );
  if (!sourceResponse.ok) throw new Error(`Upstream source HTTP ${sourceResponse.status}`);
  fixture = {
    version: 1,
    capturedAt: Date.now(),
    titleHistorySha256: hash(historyBytes),
    upstream: { ...MEDAL_SOURCE, sha256: hash(Buffer.from(await sourceResponse.arrayBuffer())) },
    responses: [],
    requests: [],
    failures: [],
  };
  const db = new Database(':memory:');
  const version = JSON.parse(await readFile('package.json', 'utf8')).version;
  const client = new BatraceClient(
    db,
    {
      fetch: async (url, options) => {
        const parsed = new URL(String(url));
        const record = {
          path: parsed.pathname + parsed.search,
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
    for (const response of history.responses) {
      try {
        const analysis = await client.analysisMatch(response.id);
        fixture.responses.push({ id: response.id, at: analysis.at, value: analysis.value });
        console.log(
          `Captured analysis ${fixture.responses.length}/${history.responses.length}: ${response.id}`,
        );
      } catch (error) {
        fixture.failures.push({ id: response.id, error: error.message });
        console.log(`Unavailable analysis ${response.id}: ${error.message}`);
      }
    }
  } finally {
    await client.close();
    db.close();
  }
  const bytes = gzipSync(Buffer.from(JSON.stringify(fixture)), { level: 9 });
  const report = compareTitleMedals(history, fixture);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'analyses.json.gz'), bytes);
  await writeFile(
    join(directory, 'medal-manifest.json'),
    JSON.stringify(
      {
        version: 1,
        capturedAt: fixture.capturedAt,
        sha256: hash(bytes),
        titleHistorySha256: fixture.titleHistorySha256,
        upstream: fixture.upstream,
        responses: fixture.responses.length,
        requests: fixture.requests.length,
        failures: fixture.failures,
        scope: report.scope,
      },
      null,
      2,
    ) + '\n',
  );
  await writeFile(
    join(directory, 'medal-expected.json'),
    JSON.stringify(golden(report), null, 2) + '\n',
  );
} else {
  const manifest = JSON.parse(await readFile(join(directory, 'medal-manifest.json'), 'utf8'));
  const bytes = await readFile(join(directory, 'analyses.json.gz'));
  if (
    manifest.version !== 1 ||
    hash(bytes) !== manifest.sha256 ||
    hash(historyBytes) !== manifest.titleHistorySha256
  )
    throw new Error('Medal history checksum or source history is invalid');
  fixture = JSON.parse(gunzipSync(bytes).toString('utf8'));
  const expected = JSON.parse(await readFile(join(directory, 'medal-expected.json'), 'utf8'));
  if (process.argv.includes('--update-expected'))
    await writeFile(
      join(directory, 'medal-expected.json'),
      JSON.stringify(golden(compareTitleMedals(history, fixture)), null, 2) + '\n',
    );
  else if (!isDeepStrictEqual(golden(compareTitleMedals(history, fixture)), expected))
    throw new Error('Medal comparison differs from medal-expected.json');
}
const report = compareTitleMedals(history, fixture);
console.log(
  JSON.stringify(
    {
      upstream: report.upstream,
      scope: report.scope,
      titles: report.titles,
      medals: report.medals,
      scoreLabels: report.scoreLabels,
    },
    null,
    2,
  ),
);
