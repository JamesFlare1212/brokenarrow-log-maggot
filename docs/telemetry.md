# Anonymous usage and diagnostic telemetry

## Aptabase model

BARadar follows Aptabase's short-lived anonymous sessions and explicit event model.
No account hashes, installation/device identifiers, persistent user tags, run IDs,
event IDs, or update-attempt IDs are sent. Game-account detection is independent
of analytics, and account switches have no effect on the analytics session.

Aptabase Users retain the server's temporary anonymous counting semantics. They
are not game accounts, installations, or distinct people across days. Account-level
retention, cohorts, and unique monthly account counts are not reconstructed.
See [Aptabase's data and privacy documentation](https://aptabase.com/docs#data--privacy).

The main-process adapter posts to `https://aptabase.jamesflare.com/api/v0/events`
with public App Key `A-SH-7889591672` in the `App-Key` header. Administrative keys
never enter the app. React diagnostics use the existing validated IPC bridge.
The direct ingestion adapter preserves request cancellation for immediate opt-out.
It also avoids introducing the Electron SDK's second privileged-protocol
registration alongside BARadar's replay protocol: Electron allows that
registration only once before readiness.

## Consent and migration

Collection requires an online packaged desktop runtime and disclosure version 4
consent. Previous provider opt-ins require confirmation; saved refusals remain
disabled. Existing version 4 consent covers this reduced collection scope.
Development, fixtures, smoke tests, offline mode, and `BA_DISABLE_TELEMETRY=1`
send nothing.

Startup removes legacy `telemetryIdentity`, `telemetryInstallation`, and v1
outbox/run/update state, including in disabled/offline mode. Retired data is never
read for collection or replayed, even if optional cleanup fails. Already submitted
server data is unchanged.

Opt-out cancels requests, empties the memory queue, resets the anonymous session,
and removes pending update metadata. It does not flush before disabling. Optional
analytics/storage failures must not affect the application.

## Sessions and properties

The required `sessionId` is generated in memory using the Electron SDK's
epoch-seconds plus eight random digits format. It rotates after an hour without
events, clock rollback, a UTC date change, restart, or opt-out. Nothing persists
the session. Daily rotation additionally prevents a long-running desktop process
from bridging daily anonymous users.

Requests contain up to 20 objects with `eventName`, `timestamp`, `sessionId`,
`systemProps`, and `props`. System properties hold app/OS versions, locale,
engine/version, release mode, and adapter identifier `baradar-aptabase@2`.
Custom properties contain `distribution` and event-specific dimensions only.
Version and language are not duplicated as user properties.

Properties are flat strings and finite numbers, limited to 40-character keys
and 180-character strings. Feature/operation names and result categories are
explicitly selected. Raw RPC inputs, names, searches, local paths, account/player/
match identifiers, arbitrary objects, and nested exception objects are excluded.

## Events

- `app_started`: once when consent becomes available in a process.
- `app_first_open`: first consented local-profile observation. `kind` distinguishes
  `first_run` and `existing_profile`. It is not installer completion or a unique
  person/installation count. Resetting or copying a profile affects observations.
- `app_updated`: observed version change with `previous_version`, including
  manual replacement or downgrade.
- `match_started`: one live observed start while consented. Recovered logs,
  archives, repeated notifications, and pre-consent starts are excluded. Local
  match keys only suppress duplicates in memory and are never uploaded. Multiple
  assisted players can each observe the same battle.
- `feature_used`: selected page views and APM/recording start/stop transitions.
  Consecutive duplicate views are suppressed.
- `operation_completed`: selected operation, result, numeric duration, and bucket.
  Passive list reads are excluded.
- `app_heartbeat`: resource sample only while foreground and active, at most once
  per minute including focus changes. Hidden/idle apps emit no periodic presence.
  This is not a count of all online installations.
- `performance_sample`: service/UI-ready timings and aggregate long tasks. A
  per-window maximum is not a percentile of individual task durations.
- `app_error`, `exception_summary`: classified type/code/status, source, operation,
  level, code-location fingerprint, occurrence count, and public app positions.
  The fingerprint describes code, not users. Raw messages, full stacks, and paths
  are excluded. Repeats aggregate in memory; sum `occurrences` across both events.
- `update_state_changed`, `update_not_applied`, `update_attempt_result`: update
  stages/outcomes. Next-launch results use the new session and carry only
  source/target versions, stage, and outcome. No identifier links the sessions.
  Interrupted downloads are separate from install-stage failures.

Local `telemetryVersion` stores only version, kind, previous version, and reporting
status. Failed first-open observations can be attempted anew on a later consented
launch, without replaying an old envelope/session. Local `telemetry:update:v2`
stores only from/target versions and stage; extra correlation fields fail strict
validation. No run marker, unclean-exit recovery, or durable delivery summary remains.

## Delivery limits

At most 200 events queue in memory for five minutes, with three attempts per
event. Previous-UTC-date events are discarded. Requests time out after three
seconds. Network failures and HTTP 408/429/5xx may retry with bounded backoff and
`Retry-After`; permanent failures are dropped. HTTP 2xx acknowledges receipt,
normally with `{}`. Batch acknowledgements are not dashboard verification.

Shutdown allows a 1.5-second flush and discards the remainder. Crashes, restarts,
offline periods, and opt-out can lose events. Lost acknowledgements can duplicate
counts because Aptabase does not deduplicate these events. Totals are approximate;
no durable queue or persistent identifier is added to make them exact.

No PostHog-style profiles, source-map upload/symbolication, retention/cohort
reports, or release alerts are implemented. Local source maps remain for developer
debugging. Historical PostHog data was not imported. This refactor does not erase
previously submitted server-side pseudonymous properties.
