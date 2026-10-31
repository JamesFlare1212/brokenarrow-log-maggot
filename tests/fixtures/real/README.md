# Captured local game data

This corpus comes from the user's authorized local Broken Arrow GameLogs and
application SQLite database. Names, player IDs, match IDs, deck names, and recorded
ratings remain real. The [offline BATrace archive](../batrace/offline/README.md)
adds match details and analyses, player information, analysis, and recent games.
Desktop development, browser development, and service-backed UI tests use the same
recorded sources.

- 272 original logs totaling 448,035,631 bytes, covering 2025 through October 30, 2026.
- 496 identifiable matches: 167 with a FID and 329 without one.
- The original database snapshot retains 13 API match archives, 600 players, account
  views, name histories, bans, map names, player snapshots, and 28 API cache entries.
- All 13 database matches also occur in the logs; the merged archive has 496 matches.

The October 31 expansion added 14 logs and 42 matches. The previous 258 logs,
database tables, preferences, and active account were preserved exactly. It also
covers startup-only logs, two- and four-player rosters, a short match without
points, and estimated durations where no authoritative network duration exists.

`snapshot.json.gz` stores portable database rows and extracted match events.
`manifest.json` records the capture timestamp, compressed SHA-256, original file
hashes, byte and line counts, event hashes, and frozen parser facts. Tests verify
the compressed snapshot and each log's map, roster, local identity, deck, points,
mode, and authoritative duration before replaying the full archive and deduplication.

The four October 30 zombie scenarios are classified as `pve` directly from their
recorded scenario names. Their outcomes remain unknown because no explicit winner
was logged. Golden parser facts include mode classification, and the real-data
regressions verify all four FIDs without relying on BATrace match availability.

All 329 records without a FID can be read through the local-detail service without
network access. The archive displays their saved roster, duration, total points,
and deck where recorded, with clear missing-data labels and disabled remote-only
actions. The captured 2025 Airport match also covers local list navigation, direct
links, source notices, and unavailable-action behavior in both UI languages.

Export reads only allowed game-data tables. Browser profiles, cookies, login
tokens, private headers, original settings, and migration JSON are excluded.
Absolute paths are removed and network addresses are consistently replaced with
test addresses. Event extraction parses both each complete original
log and its compact copy, then requires identical match facts. Original log files
remain on the user's machine and are never added to Git.

## Offline development and tests

```sh
pnpm test
pnpm dev
pnpm dev:web
pnpm smoke:real
```

Each development launch creates an independent writable profile under
`.test-data/real-dev/` or `.test-data/web-dev/`, containing extracted logs and SQLite.
Queries and force refreshes use recorded responses; missing endpoints report an
error. Background queries, synchronization, and recording are disabled by default.
Deck and recording paths point to the isolated copy. Changes affect only that
profile; restarting creates a new one.

`pnpm dev` starts Vite and Electron on port 5173. `pnpm dev:web` serves the same
real data through the browser development interface on port 5174, with hot updates.
Native directory selection, recording, update installation, and path changes are
unavailable in browser mode. UI unit tests select the needed records through
`tests/fixtures/ui.ts`; unconfigured RPC calls fail explicitly.

The sibling historical match and analysis captures are also checksum-verified and
loaded into development and real-data smoke profiles. They supply title and
score-label evidence without inserting additional archive rows. See the
[score-label integration notes](../../../../docs/title-medal-comparison.md#integrated-score-label-display).

## Update the corpus

To update logs while retaining the existing database fixture:

```sh
pnpm data:import --logs-only
pnpm data:capture
```

`--logs-only` requires an existing checksum-valid snapshot. It preserves its
database tables, preferences, and active account, then extracts all current logs.
The default source is the GameLogs directory configured in the local application.
The capture command fills missing BATrace endpoints, retaining existing responses
and unchanged response shards. Review current API structure before deciding
whether older captures need replacement; the latest audit is recorded in
[`compatibility.json`](../batrace/offline/compatibility.json).

To replace both the database snapshot and logs from the current application:

```sh
pnpm data:import
pnpm data:capture
```

The default database is `%APPDATA%/broken-arrow-log-assistant/assistant.sqlite`.
Explicit sources can be supplied with either import mode:

```sh
pnpm data:import --logs-only --user-data "C:/path/to/app-data" --logs "F:/path/to/GameLogs"
```

With `--logs-only` and an explicit `--logs` path, no local application database is
required; only the existing fixture and selected logs are read.

Import uses a read-only SQLite transaction, including committed WAL data, and
never changes the application database or original logs. After updating both
corpora, review the fixture diff and run `pnpm check`, `pnpm format:check`,
`pnpm smoke`, and `pnpm smoke:real`. CI uses the committed compact data and requires
neither a game installation nor network access.
