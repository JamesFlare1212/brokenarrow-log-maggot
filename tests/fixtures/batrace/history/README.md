# Recorded historical BATrace responses

This corpus was captured from the local application history using a read-only SQLite transaction. It is separate from the older GameLogs fixture in `tests/fixtures/real`: the live database contained four more matches at capture time.

- 458 historical matches: 129 unique FIDs and 329 records without a FID.
- 114 complete match responses: 101 retained from the application cache, with their original timestamps, and 13 fetched from BATrace.
- 43 newly recorded HTTP responses: 28 API requests and 15 dashboard fallbacks. The 15 missing matches returned HTTP 404 from the API and incomplete match data from the dashboard.

`responses.json.gz` retains the complete parsed match payloads, including unit data, and the exact body, status, content type, path, and timestamp of each newly requested HTTP response. It contains no request headers, browser profile, database settings, or local source paths. Cache payloads are the original parsed responses; their original HTTP bytes and headers were not retained by the application. Public player names and IDs remain unchanged.

`manifest.json` records capture provenance, coverage, failures, and the compressed file's SHA-256. `expected.json` freezes all 28 candidate and awarded frequencies, local-player frequencies, and a hash of every match's complete per-player result, including candidate order, final title order, and evidence parameters. The two-title limit can suppress a candidate; missing matches are excluded rather than counted as matches with no titles.

The normal `pnpm test` / `pnpm check` flow verifies the checksum and golden results, replays every complete response through the offline tracker, and replays every newly recorded HTTP success and failure through the production BATrace client with a stub transport. These tests never contact BATrace. The frequency report is documented in [Historical title coverage](../../../../docs/title-history.md).

To verify the frozen results and print all frequencies offline:

```sh
pnpm titles:history
```

To replace the corpus from the current local database, requesting only missing match responses:

```sh
pnpm titles:history --capture
pnpm titles:history --capture --user-data "C:/path/to/app-data" --out "tests/fixtures/batrace/history"
```

Capture uses the production client's request spacing, retries, validation, client identification headers, and dashboard fallback. It writes only the selected output directory and an in-memory test database. Review changes to all three corpus files and update the frequency report before committing a refreshed baseline. Run `pnpm check`, `pnpm format:check`, `pnpm smoke`, and `pnpm smoke:real` after refreshing it.

## Upstream medal comparison

`analyses.json.gz` stores 114 complete BATrace `/api/analysis/match` responses for the same match IDs, including each HTTP body, content type, status, and timestamp. `medal-manifest.json` verifies this file and links it to the exact `responses.json.gz` checksum, with the upstream repository revision and source checksum. There were 114 successful requests and no failures in this capture.

`medal-expected.json` freezes both systems' frequencies on matching rosters, all title/medal co-occurrences, and a hash of each match's full per-player medal candidates and displayed awards. `upstream-reference.json` stores separate output hashes from the pinned upstream function, checked against the independently implemented evaluator. Tests replay every analysis response and verify all reference hashes without requesting external data.

The baseline also records the application's `match-maximum-single` score labels and separate per-match label hashes. The pinned upstream reference continues to use its original per-team 90% rule. Application labels compare both teams and select one positive match maximum per dimension, resolving ties by analysis response order. The two-label display limit does not transfer an award to another player. Big Eater is included in the current 28-title baseline. After an intentional local rule change, `pnpm titles:history --update-expected` and `pnpm titles:compare --update-expected` refresh expected results offline without modifying response captures or upstream reference hashes.

```sh
pnpm titles:compare
pnpm titles:compare --capture
```

The first command is offline. The capture command refreshes analysis responses for the existing match corpus and updates the medal baseline; it also downloads the pinned source file to record its checksum. It does not refresh the original match corpus or regenerate independent upstream reference hashes. See [the comparison report](../../../../docs/title-medal-comparison.md) for the pinned rules, detailed counts, and validation method.

Development profiles created from `tests/fixtures/real` overlay these recorded match and analysis responses as cache entries after verifying both manifests and the source-corpus checksum. They do not insert extra match rows or modify either committed capture. Completed match detail and previous-match views can therefore display the two score labels plus two titles offline. Production installations retrieve analysis through the normal BATrace client; the fixture overlay is restricted to isolated development and smoke profiles. The upstream comparison retains its separate three-label limit.
