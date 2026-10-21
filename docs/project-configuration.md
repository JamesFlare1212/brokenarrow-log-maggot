# Project configuration

Edit the root `app.config.json` to change service defaults. These values are validated
on service startup and bundled into the server and Electron builds. Rebuild and
restart after editing; installed applications use the values from their build.
No separate configuration file needs to be shipped beside the executable.

Application preferences such as language, appearance, folders, and recording options
continue to live in SQLite and use the existing Settings screen.

## Network

- `requestOffsetMs`: maximum random delay in milliseconds before each actual HTTP
  attempt. The default `300` selects an independent integer from `0` through `300`,
  inclusive. Set it to `0` to disable the delay. This applies to normal requests,
  health probes, retries, and API-to-page fallbacks. It spreads concurrent starts
  without waiting for earlier responses or imposing a concurrency cap.
- `requestTimeoutMs`: HTTP timeout, starting after the offset delay.
- `maxAttempts`: maximum HTTP attempts per endpoint. A page fallback has its own
  attempt budget.
- `retryDelayMs`: minimum delay before retrying a failed request. A numeric
  `Retry-After` response header can extend this delay; the next attempt also gets
  a new random offset.

Fresh cache hits and offline reads never wait or draw a random offset. Requests for
the same cache key and refresh mode share one in-flight operation, including its
delay. Closing the client or aborting a request cancels its offset and retry waits.
Random offsets reduce simultaneous starts; they do not guarantee a minimum gap
between requests or limit the total number of in-flight requests.

## Cache

- `ttlMs`: cache freshness durations in milliseconds for player information and
  analysis, recent player matches, match facts and analysis, player search, bans,
  and migrated unit data.
- `maxApiEntries`: maximum retained API responses during normal writes.
- `maxPlayerSnapshots`: maximum retained player summaries during normal writes.

Player summaries use the player TTL consistently for freshness, statistics, and
expired-cache cleanup. Legacy cache migration uses the same endpoint TTLs.
Recorded offline fixtures retain their capture-specific lifetimes and bypass
production eviction where required by their fixture loader.

## Background tasks and queries

- `archiveScanIntervalMs`: local log archive rescan interval.
- `syncIntervalMs`: background ban and match synchronization interval.
- `healthProbeIntervalMs`: BATrace health probe interval.
- `maxRoomPlayers`: maximum unique, eligible players in a room query. Players are
  still queried concurrently and published individually as results arrive.

Durations and offsets must be integer milliseconds supported by Node timers.
Timeouts, TTLs, background intervals, counts, and limits must be positive; offsets
and retry delays may be zero. Room queries accept at most 100 players, matching the
RPC roster limit. Unknown keys are rejected to catch misspellings.
