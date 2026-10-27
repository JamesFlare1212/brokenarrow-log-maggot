# Anonymous analytics

## Configuration

BARadar sends optional anonymous events to Aptabase from the Electron main process.
The ingestion URL is `https://aptabase.jamesflare.com/api/v0/events`, with public
App Key `A-SH-7889591672` in the `App-Key` header. The main-process adapter controls
request cancellation and batching. React diagnostics use the validated IPC bridge.

`analyticsEnabled` defaults to `false`. `analyticsChoiceSaved` records whether the
user has accepted or declined the consent dialog. Collection starts only after
an enabled choice is saved. Settings → General can change that choice at any time.

Collection requires a packaged online desktop runtime. Development, fixtures,
smoke tests, offline mode, and `BA_DISABLE_ANALYTICS=1` disable collection.
Opt-out cancels requests, empties pending events, resets the session, and clears
pending update metadata. Optional analytics/storage errors never interrupt the app.

## Anonymous sessions

Aptabase's required `sessionId` exists only in memory. It consists of epoch seconds
and eight random digits. A new session starts after an hour without events, clock
rollback, a UTC date boundary, process restart, or opt-out followed by opt-in.

Events contain app activity and diagnostic dimensions. Game accounts, player
names, searches, installation/device identifiers, and persistent user tags are
excluded. Game-account detection has no analytics hook. Aptabase's temporary
anonymous user counts are interpreted according to its
[data and privacy model](https://aptabase.com/docs#data--privacy).

## Event format

Each batch contains at most 20 objects with `eventName`, `timestamp`, `sessionId`,
`systemProps`, and `props`.

System properties hold app/OS versions, locale, engine/version, release mode,
and `sdkVersion = baradar-aptabase@<app version>`. Custom properties contain
`distribution` and explicit event dimensions: feature or operation names,
result categories, durations, and sanitized diagnostic fields.

Properties are flat strings and finite numbers, with 40-character keys and
180-character strings. Raw RPC inputs, free text, file paths, account/player/match
identifiers, and arbitrary objects are excluded.

## Events

- `app_started`: once after analytics becomes enabled in a process.
- `app_first_open`: first enabled observation of a local app profile.
- `app_updated`: observed app-version change with `previous_version`.
- `match_started`: a live match start while analytics is enabled. The local match
  key suppresses duplicate notifications in memory and is never uploaded.
- `feature_used`: page views and recording start/stop transitions.
- `operation_completed`: selected operation, result, numeric duration, and bucket.
- `resource_sample`: aggregate CPU/memory while foreground-active, at most once
  per minute including focus changes.
- `performance_sample`: service/UI startup timings and aggregated long tasks.
  Long-task collection requires a visible, focused renderer. Blur/hide clears
  the pending aggregate, and the main process checks foreground activity again.
- `app_error`, `error_summary`: classified type/code/status, source, operation,
  level, code-location fingerprint, count, and public app code positions. Messages,
  full stacks, and local paths are excluded. Sum `occurrences` across both events.
- `update_state_changed`: update status, target version, error category, and timing.
- `update_outcome`: source/target versions, stage, and outcome. Next-launch results
  belong to the new session. Interrupted downloads and install failures are
  separate categories.

## Local state

`analytics:appVersion` contains the observed version, optional previous version,
and acknowledgement flag. An unconfirmed first-open observation can be attempted
anew on a later launch with the new session and capture time.

`analytics:pendingUpdate` contains source/target versions and update stage.
`PendingUpdateStore.load()` and `save()` access only that record. The versions are
compared after a restart to report `applied`, `not_applied`, `other_version`, or
`interrupted`. Local records contain no correlation identifiers or event payloads.

## Delivery and counting

At most 200 events wait in memory for five minutes, with three delivery attempts
per event. Previous-UTC-date events are discarded. Requests time out after three
seconds. Network failures and HTTP 408/429/5xx may retry with bounded backoff and
`Retry-After`; permanent failures are dropped. HTTP 2xx acknowledges receipt.

Shutdown allows a 1.5-second flush and discards the remainder. Crashes, restarts,
offline periods, and opt-out can lose events. A lost acknowledgement can duplicate
an event. Counts and rates are approximate.

First-open events describe local profile observations; reinstalling or copying
a profile can affect counts. Match starts describe assisted players' observations;
several players may observe the same battle. Resource samples describe foreground
activity. Long-task summaries report per-window aggregates, not latency percentiles
of individual tasks. Anonymous user counts do not identify game accounts or measure
cross-day account retention.

## Build and CI

Production builds emit application bundles. The public App Key is part of the
application configuration and needs no CI secret. Validation and release workflows
run Electron smoke checks with `BA_SMOKE=1`; real-data checks also enable offline
mode. Fixture preparation saves analytics as disabled.
