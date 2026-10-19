import { createHash } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { access, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { gunzipSync, gzipSync } from 'node:zlib';

const { BatraceClient, Database, LogParser, loadRealData, readOfflineFixtureRecords } =
  createRequire(import.meta.url)('../apps/server/dist/index.cjs');
const root = resolve('tests/fixtures');
const output = join(root, 'batrace/offline');
const checkpoint = resolve('.test-data/offline-capture');
const recordsDirectory = join(checkpoint, 'records');
const workerOption = process.argv.indexOf('--workers');
const workerCount = workerOption < 0 ? 4 : Number(process.argv[workerOption + 1]);
const requestTimeout = process.argv.includes('--retry-transient') ? 60000 : 15000;
if (!Number.isInteger(workerCount) || workerCount < 1 || workerCount > 8)
  throw new Error('--workers must be between 1 and 8');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const unpack = async (file, expectedHash) => {
  const bytes = await readFile(file);
  if (expectedHash && hash(bytes) !== expectedHash)
    throw new Error('Capture source checksum is invalid: ' + file);
  return JSON.parse(gunzipSync(bytes).toString('utf8'));
};
const atomic = async (file, bytes) => {
  await writeFile(file + '.tmp', bytes);
  await rename(file + '.tmp', file);
};
await mkdir(recordsDirectory, { recursive: true });
await mkdir(output, { recursive: true });
const lock = join(checkpoint, 'capture.lock');
try {
  await writeFile(lock, String(process.pid), { flag: 'wx' });
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  const owner = Number(await readFile(lock, 'utf8'));
  let active = true;
  try {
    process.kill(owner, 0);
  } catch (error) {
    if (error.code === 'ESRCH') active = false;
    else throw error;
  }
  if (active) throw new Error('An offline capture is already running: ' + owner);
  unlinkSync(lock);
  await writeFile(lock, String(process.pid), { flag: 'wx' });
}
process.once('exit', () => {
  try {
    unlinkSync(lock);
  } catch {}
});
let previousArchive;
try {
  previousArchive = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
if (previousArchive) {
  if (previousArchive.version !== 1)
    throw new Error('Unsupported existing offline BATrace archive');
  let restored = 0;
  for await (const record of readOfflineFixtureRecords(output, previousArchive)) {
    const destination = join(recordsDirectory, record.kind + '-' + record.id + '.json.gz');
    try {
      await access(destination);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await atomic(destination, gzipSync(JSON.stringify(record), { level: 9 }));
      restored++;
    }
  }
  console.log(JSON.stringify({ restoredFromArchive: restored }));
}
const { data, manifest: realManifest } = await loadRealData(join(root, 'real'));
const historyManifest = JSON.parse(
  await readFile(join(root, 'batrace/history/manifest.json'), 'utf8'),
);
const medalManifest = JSON.parse(
  await readFile(join(root, 'batrace/history/medal-manifest.json'), 'utf8'),
);
const history = await unpack(
  join(root, 'batrace/history/responses.json.gz'),
  historyManifest.sha256,
);
const medals = await unpack(join(root, 'batrace/history/analyses.json.gz'), medalManifest.sha256);
const players = new Map();
const matches = new Set(history.matches.map((match) => match.id));
const addPlayer = (id, name) => {
  if (/^[1-9]\d*$/.test(String(id)))
    players.set(String(id), name || players.get(String(id)) || String(id));
};
const addRoster = (value) => {
  const data = value?.matchInfo?.Data ?? value?.Data;
  if (data && typeof data === 'object')
    for (const [id, player] of Object.entries(data)) addPlayer(player.Id ?? id, player.Name);
  if (typeof data === 'string') for (const [, id] of data.matchAll(/(\d+)\s*=/g)) addPlayer(id);
  for (const player of value?.mvpRanking ?? [])
    addPlayer(player.playerId, player.playerName ?? player.name);
};
for (const row of data.tables.accounts) addPlayer(row.id, row.name);
for (const response of history.responses)
  for (const [id, player] of Object.entries(response.value.matchInfo.Data))
    addPlayer(player.Id ?? id, player.Name);
for (const row of data.tables.players) addPlayer(row.id, row.name);
for (const log of data.logs) {
  const collect = ({ match }) => {
    if (!match) return;
    if (match.fid) matches.add(match.fid);
    for (const player of match.players) addPlayer(player.id, player.name);
  };
  const parser = new LogParser(collect);
  parser.reset(log.path);
  parser.feed(log.content.split('\n'), true);
  collect({ match: parser.snapshot().current });
}
const initial = new Map();
for (const row of data.tables.api_cache) {
  const value = JSON.parse(row.payload);
  initial.set(row.key, { key: row.key, at: row.at, source: 'recorded', value, requests: [] });
  if (row.key.startsWith('myMatches:'))
    for (const match of value.matches ?? []) {
      if (/^\d+$/.test(String(match.matchId))) matches.add(String(match.matchId));
      addRoster(match.data);
    }
  if (row.key.startsWith('amatch:')) matches.add(row.key.slice(7));
  const playerKey = /^(?:info|analysis|myMatches):(\d+)(?::10)?$/.exec(row.key);
  if (playerKey) addPlayer(playerKey[1], value.info?.name);
  addRoster(value);
}
for (const [kind, responses, requests] of [
  ['match', history.responses, history.requests],
  ['amatch', medals.responses, medals.requests],
])
  for (const response of responses)
    initial.set(kind + ':' + response.id, {
      key: kind + ':' + response.id,
      at: response.at,
      source: 'recorded',
      value: response.value,
      requests: requests.filter(
        (request) =>
          request.path.endsWith('=' + response.id) || request.path === '/match/' + response.id,
      ),
    });
for (const failure of history.failures)
  initial.set('match:' + failure.id, {
    key: 'match:' + failure.id,
    at: history.capturedAt,
    source: 'recorded',
    error: failure.error,
    requests: history.requests.filter(
      (request) =>
        request.path.endsWith('=' + failure.id) || request.path === '/match/' + failure.id,
    ),
  });
for (const file of await readdir(join(root, 'batrace'))) {
  const player = /^player-(\d+)\.html$/.exec(file);
  const match = /^match-(\d+)\.html$/.exec(file);
  if (player) addPlayer(player[1]);
  if (match) matches.add(match[1]);
}
// Reconcile full root rosters on resume without recursively expanding recent opponents.
for (const id of matches)
  for (const kind of ['match', 'amatch']) {
    const existing = initial.get(kind + ':' + id);
    if (existing?.value) addRoster(existing.value);
    try {
      const recorded = await unpack(join(recordsDirectory, kind + '-' + id + '.json.gz'));
      if (!recorded.error) addRoster(recorded.value);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
const tasks = [
  ...[...matches].flatMap((id) =>
    ['match', 'amatch'].map((kind) => ({ id, kind, key: kind + ':' + id })),
  ),
  ...[...players].flatMap(([id]) =>
    ['info', 'analysis', 'myMatches'].map((kind) => ({
      id,
      kind,
      key: kind + ':' + id + (kind === 'myMatches' ? ':10' : ''),
    })),
  ),
];
const completed = new Set(
  (await readdir(recordsDirectory))
    .filter((file) => file.endsWith('.json.gz'))
    .map((file) => file.slice(0, -8)),
);
const retried = new Map();
if (process.argv.includes('--retry-transient'))
  for (const name of completed) {
    const record = await unpack(join(recordsDirectory, name + '.json.gz'));
    const lastRequest = record.requests.at(-1);
    const status = lastRequest?.status;
    if (
      record.error &&
      record.source === 'network' &&
      (lastRequest?.error || status == null || status === 408 || status === 429 || status >= 500)
    ) {
      completed.delete(name);
      retried.set(record.key, record);
    }
  }
const filename = (task) => task.kind + '-' + task.id;
let done = 0,
  failed = 0,
  requested = 0,
  stopped = false;
process.once('SIGINT', () => {
  stopped = true;
});
const startedAt = Date.now();
const source = {
  realSha256: realManifest.sha256,
  historySha256: historyManifest.sha256,
  medalSha256: medalManifest.sha256,
};
async function writeTargets() {
  await atomic(
    join(checkpoint, 'targets.json'),
    JSON.stringify(
      {
        version: 1,
        source,
        matches: [...matches],
        players: [...players].map(([id, name]) => ({ id, name })),
        tasks,
      },
      null,
      2,
    ),
  );
}
await writeTargets();
console.log(
  JSON.stringify({
    matches: matches.size,
    players: players.size,
    endpoints: tasks.length,
    checkpoints: completed.size,
  }),
);

let requestQueue = Promise.resolve(),
  lastRequest = 0,
  pauseUntil = 0;
let interval = 2000,
  stableResponses = 0;
async function schedule() {
  const turn = requestQueue.then(async () => {
    for (;;) {
      const delay = Math.max(0, lastRequest + interval - Date.now(), pauseUntil - Date.now());
      if (!delay) break;
      await sleep(delay);
    }
    lastRequest = Date.now();
  });
  requestQueue = turn.catch(() => {});
  await turn;
}
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
let next = 0;
const timer = setInterval(() => {
  console.log(
    JSON.stringify({
      completed: done,
      total: tasks.length,
      failures: failed,
      requests: requested,
      elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
      interval,
    }),
  );
}, 30000);
const pending = tasks.filter((task) => !completed.has(filename(task)));
done = tasks.length - pending.length;
function validate(kind, value) {
  if (kind === 'analysis' && value?.matchCount == null && !Array.isArray(value?.trend?.points))
    throw new Error('Recorded player analysis is incomplete');
  if (kind === 'myMatches' && !Array.isArray(value?.matches))
    throw new Error('Recorded recent matches are incomplete');
  if (kind === 'amatch' && !Array.isArray(value?.mvpRanking))
    throw new Error('Recorded match analysis is incomplete');
}
async function worker() {
  const db = new Database(':memory:');
  let record;
  const client = new BatraceClient(
    db,
    {
      fetch: async (url, options) => {
        await schedule();
        requested++;
        const parsed = new URL(String(url));
        const request = {
          path: parsed.pathname + parsed.search,
          at: Date.now(),
          status: null,
          contentType: null,
          body: null,
        };
        record.requests.push(request);
        try {
          // Queue time is separate from the HTTP transport timeout.
          const response = await fetch(url, {
            ...options,
            signal: AbortSignal.timeout(requestTimeout),
          });
          request.status = response.status;
          request.contentType = response.headers.get('content-type');
          request.body = await response.clone().text();
          if (response.status === 429) {
            stableResponses = 0;
            if (Date.now() >= pauseUntil) interval = Math.min(5000, Math.round(interval * 1.5));
            pauseUntil = Math.max(
              pauseUntil,
              Date.now() + Math.max(60000, Number(response.headers.get('retry-after')) * 1000 || 0),
            );
          } else if (response.ok && ++stableResponses >= 50) {
            interval = Math.max(2000, Math.round(interval * 0.8));
            stableResponses = 0;
          }
          return response;
        } catch (error) {
          request.error = error.message;
          throw error;
        }
      },
    },
    version,
  );
  try {
    while (!stopped) {
      const task = pending[next++];
      if (!task) break;
      const existing = initial.get(task.key);
      record = existing
        ? { ...existing, kind: task.kind, id: task.id }
        : { ...task, at: Date.now(), source: 'network', requests: [] };
      if (!existing && retried.has(task.key))
        record.requests.push(...retried.get(task.key).requests);
      try {
        if (!existing) {
          const method = {
            match: 'match',
            amatch: 'analysisMatch',
            info: 'playerInfo',
            analysis: 'analysisPlayer',
            myMatches: 'playerMatches',
          }[task.kind];
          const result = await client[method](task.id, true);
          record.value = result.value;
          record.at = result.at;
        }
        if (!record.error) validate(task.kind, record.value);
      } catch (error) {
        record.error = error.message;
        delete record.value;
      }
      if (record.error) failed++;
      await atomic(
        join(recordsDirectory, filename(task) + '.json.gz'),
        gzipSync(JSON.stringify(record), { level: 9 }),
      );
      db.sql.prepare('DELETE FROM api_cache').run();
      completed.add(filename(task));
      done++;
    }
  } finally {
    await client.close();
    db.close();
  }
}
try {
  const roots = pending.filter((task) => task.kind === 'match' || task.kind === 'amatch');
  pending.splice(0, pending.length, ...roots);
  await Promise.all(Array.from({ length: workerCount }, worker));
  if (!stopped) {
    for (const id of matches)
      for (const kind of ['match', 'amatch']) {
        const record = await unpack(join(recordsDirectory, kind + '-' + id + '.json.gz'));
        if (!record.error) addRoster(record.value);
      }
    const known = new Set(tasks.filter((task) => task.kind === 'info').map((task) => task.id));
    for (const id of players.keys())
      if (!known.has(id))
        for (const kind of ['info', 'analysis', 'myMatches'])
          tasks.push({ id, kind, key: kind + ':' + id + (kind === 'myMatches' ? ':10' : '') });
    pending.splice(
      0,
      pending.length,
      ...tasks.filter(
        (task) => task.kind !== 'match' && task.kind !== 'amatch' && !completed.has(filename(task)),
      ),
    );
    next = 0;
    done = tasks.length - pending.length;
    await writeTargets();
    console.log(
      JSON.stringify({
        phase: 'players',
        players: players.size,
        endpoints: tasks.length,
        remaining: pending.length,
      }),
    );
    await Promise.all(Array.from({ length: workerCount }, worker));
  }
} finally {
  clearInterval(timer);
}
if (stopped) {
  console.log('Capture interrupted; rerun to resume the recorded endpoints.');
  process.exitCode = 130;
} else {
  const files = [];
  const counts = {};
  for (let offset = 0; offset < tasks.length; offset += 256) {
    const records = await Promise.all(
      tasks
        .slice(offset, offset + 256)
        .map((task) => unpack(join(recordsDirectory, filename(task) + '.json.gz'))),
    );
    for (const record of records) {
      const count = (counts[record.kind] ??= {
        recorded: 0,
        available: 0,
        unavailable: 0,
        requests: 0,
      });
      count.recorded++;
      count[record.error ? 'unavailable' : 'available']++;
      count.requests += record.requests.length;
    }
    const bytes = gzipSync(JSON.stringify(records), { level: 9 });
    const path = 'responses-' + String(files.length).padStart(3, '0') + '.json.gz';
    await atomic(join(output, path), bytes);
    files.push({
      path,
      sha256: hash(bytes),
      records: records.length,
      keys: records.map((record) => record.key),
    });
  }
  const manifest = {
    version: 1,
    capturedAt: startedAt,
    completedAt: Date.now(),
    source,
    matches: [...matches],
    players: [...players].map(([id, name]) => ({ id, name })),
    counts,
    files,
  };
  await atomic(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(
    JSON.stringify(
      { output, matches: matches.size, players: players.size, counts, files: files.length },
      null,
      2,
    ),
  );
}
