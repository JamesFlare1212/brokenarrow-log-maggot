import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { StringDecoder } from 'node:string_decoder';
import { gzipSync } from 'node:zlib';

const { LogParser, REAL_DATA_TABLES, realMatchFacts } = createRequire(import.meta.url)(
  '../apps/server/dist/index.cjs',
);
const option = (name) => {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  if (!process.argv[index + 1] || process.argv[index + 1].startsWith('--'))
    throw new Error(`Missing ${name}`);
  return process.argv[index + 1];
};
const userDirectory = resolve(
  option('--user-data') || join(process.env.APPDATA || '', 'broken-arrow-log-assistant'),
);
const output = resolve(option('--out') || 'tests/fixtures/real');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

// The export has no Chromium profile, settings secrets, legacy raw JSON or arbitrary app_state.
const secretKey =
  /authorization|cookie|password|secret|credential|privateheaders|(?:access|refresh|session|auth)[_-]?token|api[_-]?key/i;
function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !secretKey.test(key))
        .map(([key, child]) => [key, sanitize(child)]),
    );
  if (typeof value === 'string') return value.replace(/[A-Za-z]:\\[^\r\n]+/g, '[local-path]');
  return value;
}

const source = new DatabaseSync(join(userDirectory, 'assistant.sqlite'), { readOnly: true });
let data;
let configuredLogs;
try {
  // One read transaction includes committed WAL data without copying or changing the live DB.
  source.exec('BEGIN');
  const settings = source.prepare("SELECT value FROM settings WHERE key='public'").get();
  const config = settings ? JSON.parse(settings.value) : {};
  configuredLogs = config.logDir;
  const preferences = Object.fromEntries(
    [
      'theme',
      'lang',
      'panelOrder',
      'collapsedPanels',
      'multiAccountBond',
      'banCardVisible',
      'replayQuality',
      'replayFps',
      'replayBitrateMbps',
    ]
      .filter((key) => config[key] !== undefined)
      .map((key) => [key, config[key]]),
  );
  const tables = {};
  for (const table of REAL_DATA_TABLES) {
    const exists = source
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
      .get(table);
    tables[table] = exists
      ? source
          .prepare(`SELECT * FROM ${table} ORDER BY rowid`)
          .all()
          .map((row) =>
            Object.fromEntries(
              Object.entries(row).map(([key, value]) => [
                key,
                key === 'payload' ? JSON.stringify(sanitize(JSON.parse(value))) : sanitize(value),
              ]),
            ),
          )
      : [];
  }
  const active = source.prepare("SELECT value FROM app_state WHERE key='activeAccountId'").get();
  data = {
    version: 1,
    capturedAt: Date.now(),
    preferences,
    activeAccountId: active ? JSON.parse(active.value) : null,
    tables,
    logs: [],
  };
  source.exec('COMMIT');
} finally {
  source.close();
}
if (!option('--logs') && !configuredLogs)
  throw new Error('Specify --logs or configure a GameLogs directory in the app');
const logDirectory = resolve(option('--logs') || configuredLogs);
const addresses = new Map();
function address(value) {
  if (!addresses.has(value)) {
    const index = addresses.size + 1;
    addresses.set(value, `198.18.${Math.floor(index / 256)}.${index % 256}`);
  }
  return addresses.get(value);
}
function eventLine(line) {
  if (/^Log: \[AUTH\] Rest: Login success/.test(line)) return 'Log: [AUTH] Rest: Login success';
  if (/^Log: \[NET_ROOM\] Network lifecycle .*Action=Entered\b/.test(line)) {
    const fields = [
      ...line.matchAll(
        /\b(Stage|Action|ServerIp|ServerPort|ConnectionIp|ConnectionPort|FightId)=([^ |]+)/g,
      ),
    ].map(([, key, value]) => `${key}=${key.endsWith('Ip') ? address(value) : value}`);
    return 'Log: [NET_ROOM] Network lifecycle | ' + fields.join(' | ');
  }
  if (/^Log: \[NET_ROOM\] Connection closed\./.test(line)) {
    const lifetime = /LiveTime: (\d+) sec/.exec(line)?.[1];
    if (!lifetime) return null;
    const endpoint = /\bServer ([^,\s]+)/.exec(line)?.[1];
    const fightId = /\bFightId=(\d+)/.exec(line)?.[1];
    const colon = endpoint?.lastIndexOf(':');
    const server =
      endpoint && colon > 0 ? `${address(endpoint.slice(0, colon))}${endpoint.slice(colon)}` : null;
    return `Log: [NET_ROOM] Connection closed. ${server ? `Server ${server}, ` : ''}${fightId ? `FightId=${fightId} ` : ''}LiveTime: ${lifetime} sec`;
  }
  if (
    /^Log: (?:GetPersonaName\s|(?:\[LOBBY\] )?(?:Enter to lobby|Exit lobby)|Incoming client .* to lobby|Outgoing client .* exit|Start loading battle\.\.\.|(?:\[NET_ROOM\] GameRoom entered|Room entered - GameRoom)|Player list:\s*$|Room: \(GameRoom\||FID:\d+|Deck set to:|TOTAL POINTS:|GameController dispose called|\[NET_ROOM\] GameRoom exited|LoadSceneAsync: Hangar_Scene\b|Exit button pressed, exiting the game)/.test(
      line,
    ) ||
    /^ID:\s*\d+.*Team:\s*(?:Alpha|Bravo|Spectators)\s*$/.test(line)
  )
    return sanitize(line);
  return null;
}

async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await files(path)));
    else if (entry.isFile() && /\.(log|txt)$/i.test(entry.name)) result.push(path);
  }
  return result.sort();
}
const filesMetadata = [];
const fids = new Set();
let sessions = 0;
let withoutFid = 0;
for (const path of await files(logDirectory)) {
  const name = relative(logDirectory, path).replaceAll('\\', '/');
  const info = await stat(path);
  const sourceHash = createHash('sha256');
  const decoder = new StringDecoder('utf8');
  const events = [];
  const originalMatches = new Map();
  const collect = (matches) => (event) => {
    if (event.type === 'ended' || event.type === 'metadata')
      matches.set(event.match.sessionId, event.match);
  };
  const parser = new LogParser(collect(originalMatches));
  parser.reset(name);
  let pending = '';
  let timestamp = '';
  let emittedTimestamp = '';
  let lines = 0;
  const consume = (batch) => {
    parser.feed(batch, true);
    for (const raw of batch) {
      lines++;
      const line = raw.replace(/^\uFEFF/, '').replace(/\r$/, '');
      if (/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\]$/.test(line)) {
        timestamp = line;
        continue;
      }
      const event = eventLine(line);
      if (event === null) continue;
      if (timestamp && timestamp !== emittedTimestamp) {
        events.push(timestamp);
        emittedTimestamp = timestamp;
      }
      events.push(event);
    }
  };
  for await (const chunk of createReadStream(path, { highWaterMark: 64 * 1024 })) {
    sourceHash.update(chunk);
    pending += decoder.write(chunk);
    const batch = pending.split('\n');
    pending = batch.pop() || '';
    consume(batch);
  }
  pending += decoder.end();
  if (pending) consume([pending]);
  if (parser.snapshot().current)
    originalMatches.set(parser.snapshot().current.sessionId, parser.snapshot().current);
  const compactMatches = new Map();
  const compact = new LogParser(collect(compactMatches));
  compact.reset(name);
  compact.feed(events, true);
  if (compact.snapshot().current)
    compactMatches.set(compact.snapshot().current.sessionId, compact.snapshot().current);
  const semantic = (matches) =>
    [...matches.values()].map(({ id: _id, sessionId: _session, ...match }) => sanitize(match));
  // Filtering must retain every match fact, not merely produce plausible fixture data.
  if (JSON.stringify(semantic(originalMatches)) !== JSON.stringify(semantic(compactMatches)))
    throw new Error(`Event extraction changed parsed match facts in ${name}`);
  const content = events.length ? events.join('\n') + '\n' : '';
  data.logs.push({ path: name, content, modifiedAt: info.mtimeMs });
  filesMetadata.push({
    path: name,
    sourceSha256: sourceHash.digest('hex'),
    sourceBytes: info.size,
    sourceLines: lines,
    eventSha256: hash(content),
    eventLines: events.length,
    matchFactsSha256: hash(realMatchFacts(compactMatches.values())),
  });
  sessions += originalMatches.size;
  for (const match of originalMatches.values()) {
    if (match.fid) fids.add(match.fid);
    else withoutFid++;
  }
}
if (!filesMetadata.length)
  throw new Error('No game logs found; refusing to replace the fixture with an empty corpus');
const bytes = gzipSync(Buffer.from(JSON.stringify(data)), { level: 9 });
const manifest = {
  version: 1,
  capturedAt: data.capturedAt,
  sha256: hash(bytes),
  source: {
    logFiles: filesMetadata.length,
    logBytes: filesMetadata.reduce((sum, file) => sum + file.sourceBytes, 0),
    databaseMatches: data.tables.matches.length,
    databasePlayers: data.tables.players.length,
  },
  expected: {
    sessions,
    uniqueFids: fids.size,
    withoutFid,
    logMatches: fids.size + withoutFid,
    seededMatches:
      new Set([...fids, ...data.tables.matches.map((match) => match.fid || match.id)]).size +
      withoutFid,
  },
  files: filesMetadata,
};
await mkdir(output, { recursive: true });
await writeFile(join(output, 'snapshot.json.gz'), bytes);
await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(
  JSON.stringify(
    { output, ...manifest.source, ...manifest.expected, fixtureBytes: bytes.length },
    null,
    2,
  ),
);
