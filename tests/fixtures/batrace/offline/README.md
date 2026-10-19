# Complete offline BATrace development archive

This archive covers the people and match IDs referenced by the committed local GameLogs, original database fixture, static player-page fixture, and historical BATrace match corpus. Its target inventory includes 139 match IDs, the complete historical log rosters, and all participants in the recorded root match details and analyses. Each match has detail and analysis records; each player has basic information, analysis, and the ten most recent matches. The manifest accounts for every endpoint result, including recorded failures.

The target set is fixed before capture. Recent-game summaries returned by player queries remain available for navigation. They do not recursively add their opponents to the target player inventory. The 329 original history records without a FID retain their local log evidence and cannot be looked up as remote matches.

The completed 2026-10-19 capture contains 11,189 endpoint records for 139 match IDs and 3,637 players in 44 shards (41.29 MiB compressed). All 3,637 player-information and recent-match requests are available. Player analysis is available for 2,631 players; BATrace explicitly returned `No valid matches` for the other 1,006. Match details and analyses are available for 124 match IDs, with actual unavailable responses retained for the other 15. All 11 initial analysis timeouts were recovered in the retry pass.

## Stored data

- `manifest.json` identifies the source fixture checksums, all target IDs, endpoint availability, and every compressed response shard.
- `responses-*.json.gz` retain complete parsed endpoint results and the recorded request paths, timestamps, HTTP statuses, content types, and response bodies. Records reused from prior captures retain their original provenance and available HTTP evidence.
- Missing, deleted, and incomplete responses retain their actual errors. An unavailable response is never converted into a successful empty player or match.

Player names, IDs, and public game statistics are preserved. Request headers, cookies, credentials, application settings, and local source paths are excluded. Each shard has a SHA-256 checksum and a bounded decompression size. Its source checksums must agree with the sibling history corpus and the original real-data fixture.

## Offline development and tests

```sh
pnpm dev
pnpm dev:web
pnpm test
pnpm check
pnpm smoke:real
```

Desktop and browser development profiles import the same archive into independent writable SQLite copies. The import keeps every endpoint beyond the production cache's 2,000-entry limit. It preserves existing match rows and encounter histories, loads player names and searchable recorded ratings, and attaches match titles and score-label evidence through the production services.

Force refresh uses the recorded responses. Missing endpoint keys fail explicitly; recorded failures replay their captured errors. Recorded recent-game summaries are exposed as summary match data for navigation, with full archived match responses taking precedence. Unit histories and match analyses remain available only where actually recorded. The active account's Maggot Index can run from its recorded ranked analyses. Its online freshness check remains enforced during ordinary network operation.

UI unit fixtures select their required players and matches from these same shards. Service-backed UI regressions render real match statistics, award evidence, player reports, recent games, force refresh, and the Maggot Index while rejecting network access. Corpus regressions check every endpoint and player, unavailable matches, duplicate keys, response checksums, and atomic rollback of a corrupt import.

## Capture and resume

```sh
pnpm data:capture
pnpm data:capture --retry-transient
```

Capture is the explicit network operation. It uses the production BATrace client with four workers by default, shared request spacing of at least two seconds, adaptive backoff, retry behavior, and page fallbacks. `pnpm data:capture --workers 8` overlaps up to eight responses under the same shared rate limit. HTTP transport timeouts begin after the rate-limit queue. A rate limit pauses the entire queue for at least one minute. Existing archived responses and checkpoints are reused; a fresh checkout can restore its checkpoints from the checksum-verified archive. Every completed endpoint is atomically checkpointed under `.test-data/offline-capture/records`; rerunning the command resumes the remaining endpoints. A process lock prevents duplicate collectors. A completed pass writes the compressed shards and manifest into this directory.

The live application database and game logs are not changed. Review the manifest, failures, and fixture diffs after a refresh, then run `pnpm check`, `pnpm format:check`, `pnpm smoke`, and `pnpm smoke:real`.

Root match rosters are reconciled before capturing players, so participants found only in the full match or MVP response are included. `--retry-transient` retries recorded network timeouts, rate limits, and server errors while retaining their previous HTTP attempts and allowing one minute for each transport attempt. Genuine missing-data responses remain recorded as unavailable.
