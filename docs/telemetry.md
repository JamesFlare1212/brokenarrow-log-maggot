# Usage and diagnostic telemetry

## Aptabase integration

BARadar sends explicit events to `https://aptabase.jamesflare.com/api/v0/events`
with the public App Key `A-SH-7889591672` in the `App-Key` header. This is a
self-hosted key; it cannot select a cloud region automatically. Administrative
credentials never enter the application.

Electron's main process owns collection through the existing telemetry service.
React components report allowlisted diagnostics through the existing validated
IPC bridge. No browser analytics provider or extra renderer transport is needed.

The official Electron SDK fits desktop applications better than the React SDK:
it can collect main-process events and obtains native app/OS/Electron versions.
The React SDK provides a provider/hook for browser components and requires an
explicit app version. Both require explicit event calls. BARadar uses the
[Aptabase ingestion protocol](https://github.com/aptabase/aptabase/blob/main/src/Features/Ingestion/EventsController.cs)
directly because the current Electron SDK does not expose request cancellation,
HTTP failure results, persisted timestamps, or a durable retry queue. Retaining
those controls preserves immediate opt-out and existing recovery behavior.

## Consent and identity

Collection requires an online packaged desktop runtime and consent to disclosure
version 4. Previous opt-ins must confirm the new provider before any events are
sent. Saved refusals remain disabled without another prompt. Development, browser
fixtures, smoke tests, offline mode, and `BA_DISABLE_TELEMETRY=1` do not send events.
Opt-out aborts requests and purges the outbox, run marker, and update attempt.
Starting offline preserves a previously consented outbox for a later online launch.
Legacy provider envelopes fail the new schema and are never forwarded to Aptabase.

`identity_hash` is `SHA-256("brokenarrow.desktop:account:" + accountId)` when the
log parser identifies the numeric local account. Other roster members and local
persona names never become telemetry IDs. A random installation UUID is stored
locally; its namespaced SHA-256 hash identifies installations and is the fallback
before an account is known. Stable hashes are pseudonymous and can link usage
across launches and installations. No person profiles, aliases, cookies, browser
trackers, input contents, or session replay are enabled.

`identity_source` distinguishes game accounts from installation fallbacks.
`identity_confidence` is `confirmed` after this launch's logs identify the account,
`cached` when reusing the previous account hash, or `installation` when unknown.
Queued events freeze identity, language, version, session, and capture time.
Operations spanning consent or account boundaries are excluded. These hashes are
custom properties; they do not override Aptabase's native anonymous user counts.

## Envelope, sessions, and presence

Requests contain an array of `{ eventName, timestamp, sessionId, systemProps, props }`.
`systemProps` includes release mode, OS/version, locale, app version, engine/version,
and the honest adapter identifier `baradar-aptabase@1`. `props` contains only flat
strings and finite numbers; booleans become 0/1 and absent values are omitted.
Property names stay within 40 characters and strings within 180 characters.

Every event has `event_id`, `identity_hash`, `app`, `version`, `distribution`,
`language`, `installation_id`, `identity_source`, `identity_confidence`,
`app_session_id`, `platform`, `arch`, and `telemetry_schema = 4`. The receiver sees
the source IP and may derive geographic properties.

`app_session_id` identifies an application run. `session_id` is an interaction
UUIDv7 that rotates on account changes, clock rollback, 30 minutes without
activity, or the 24-hour limit. Aptabase's required `sessionId` uses that UUID, including for installation events
before the first explicit action. Idle events omit the custom `session_id` and
retain the current native session. Persisted events retain their
original native session and timestamp. Native sessions include background
presence and can therefore differ from explicit interaction sessions; use the
custom property for interaction analysis.

`app_heartbeat` is emitted every minute and on window presence changes. Online
presence is approximated by the latest event per installation in five minutes.
`foreground = 1` requires a focused, visible, non-minimized window; `active = 1`
also requires system idle time below 60 seconds. Key and mouse details are never
sent. Killing, disconnecting, or suspending the app eventually ages out presence.

## Delivery and recovery

The queue holds at most 200 events. Up to 50 critical events are stored in SQLite
for at most 23 hours. The shorter retention leaves delivery margin under
[Aptabase's 24-hour event age limit](https://github.com/aptabase/aptabase/blob/main/src/Features/Ingestion/EventBody.cs).
Persisted envelopes and critical properties are validated before replay, including
capture age, installation ownership, schema version, and public error locations.
Critical events can displace normal events; error samples can be displaced by
other critical events. Drops are counted.

Requests use Electron's network stack, at most 20 events per batch (Aptabase's
limit is 25), and a three-second timeout. Transient network failures, HTTP 408/429,
and HTTP 5xx use bounded backoff, honoring `Retry-After`. Events make at most five
attempts per run. Exhausted critical events remain until a later launch or expiry;
normal events and permanent HTTP failures are dropped. Any HTTP 2xx acknowledges
receipt; Aptabase normally returns `{}`. The batch endpoint may discard invalid
events without failing the request, so an acknowledgement is not proof that an
event appears in the dashboard.

`event_id` remains stable across retries and restarts. Aptabase does not provide
PostHog-style ingestion deduplication by this ID. A lost acknowledgement can cause
duplicates; exports or downstream queries must deduplicate by `event_id` when
exact totals are required. Built-in dashboard event totals may include retries.

Shutdown attempts a bounded 1.5-second flush before SQLite closes. Remaining
critical events survive; unsent normal events contribute to a durable delivery
summary. Opt-out performs no flush. Analytics and optional persistence failures
never enter the application's error UI.

A consented local run marker records normal shutdown. An open marker on restart
generates `previous_run_exit`, classified as `exception` only when a fatal error
was recorded; otherwise it is `unclean_exit`, which may also mean power loss or
a kill. Native crash dumps are not collected.

Update transitions share a persisted `update_attempt_id`. A later launch reports
`applied`, `not_applied`, `other_version`, or `interrupted`; observed failures
report `failed`. Interrupted downloads are separate from installation failures.
`app_updated` also observes manual replacements and downgrades.

## Event reference

- `app_installed`: first execution or version observation. `kind` is `first_run`,
  `existing_profile`, or `version_change`; changes include `previous_version`.
  Local observation UUIDs are persisted before sending. This counts first runs,
  not installer completions, and recreating/copying a profile affects counts.
- `app_started`: startup after consent becomes available in a launch.
- `user_identified`: a changed account or confirmation of a cached account.
- `match_started`: one live match start observed while the application is running
  with telemetry consent. Loading-battle and GameRoom notifications share the
  parser's local match session; repeated room notifications and metadata updates
  do not add events. Startup recovery, log rereads, archive scans, and matches
  started before consent are excluded. No match identifiers, map, roster, or deck
  details are sent. Starts are critical events with durable retry and stable UUIDs.
- `app_heartbeat`: presence, main-process CPU/RSS/heap, aggregate renderer CPU/RSS
  and process count, timer lag, buffered events, and delivery counters. CPU is
  measured relative to one logical core and can exceed 100% with multiple threads
  or renderer processes. Timer lag can reflect sleep or suspension.
- `app_updated`: the first observed execution of a different app version.
- `update_state_changed`, `update_attempt_result`, `update_not_applied`: update
  funnel states, restart-confirmed results, and the updater's legacy failure marker.
- `operation_completed`: allowlisted user actions with operation, success/failure,
  numeric duration, and duration bucket. Passive list reads and background scans
  do not create feature usage. RPC inputs and outputs are never forwarded.
- `feature_used`: allowlisted page views and APM/recording start/stop transitions.
  Duplicate renders and progress-only state updates are suppressed.
- `app_error`: curated type, code, HTTP status, source, operation, fingerprint,
  occurrence count, and app code positions. Fingerprints include sanitized code
  positions. Raw messages, names, account IDs, URLs, full stacks, and local paths
  are excluded. Renderer and server frames retain only known module basenames or
  public hashed chunk names and line/column numbers, without local paths.
- `exception_summary`: counts repeated occurrences of a classified error during
  the reporting window. Sum `occurrences` across this and `app_error` to count
  repeats; do not treat sampled event rows as total errors.
- `performance_sample`: service startup and UI-ready timings, or complete
  per-window renderer long-task aggregates. UI-ready waits for the real app
  bootstrap marker and two rendering frames. Long-task aggregates contain count,
  total duration, longest task, total blocking time above 50 ms, and window length.
  Per-window maxima are not individual-task latency percentiles.
- `previous_run_exit`: a recovered open run marker with the previous run/version
  and qualified exit reason.
- `delivery_summary`: durable end-of-run counters, including unsent normal events.
  Retry counters count retry requests, not merely scheduled retries.

## Diagnostics and metric limits

`app_error` and `exception_summary` are ordinary Aptabase events with flat
`error_type`, `error_code`, `http_status`, `source`, `operation`, `error_level`,
`error_fingerprint`, `occurrences`, and up to eight `error_frame_N` strings in
`basename:line:column` form. Repeated errors are aggregated by sanitized location
and identity. There are no nested exception objects or raw messages/stacks.

Builds still generate local source maps. The former PostHog CLI, source-map
injection/upload, dashboard definition, and CI credentials are removed. This
integration does not configure native exception grouping, source-map symbolication,
SQL dashboards, cohorts, or release alerts in Aptabase. Historical PostHog data
is not copied.

For downstream analyses, count distinct installation hashes for first executions,
distinct `event_id` values for assisted match starts, and distinct
`update_attempt_id` results for update outcomes. Sum `occurrences` across error
and summary events. Compare the latest confirmed account/version or the latest
installation/version separately. Presence is independent of explicit feature
activity. Heartbeats include resources and cumulative delivery counters; take
per-run maxima before summing those counters. Native Aptabase users and sessions
use Aptabase's own semantics and are not game-account counts.

These metrics cover consenting clients only. First executions are not installer
downloads, match starts are not globally unique battles or completed matches,
background presence is not foreground interaction, and missing data does not
prove the absence of errors.
