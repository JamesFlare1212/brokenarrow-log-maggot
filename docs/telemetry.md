# Usage and diagnostic telemetry

## Consent and identity

Collection requires an online packaged desktop runtime and consent to disclosure
version 3. Old opt-ins must confirm the updated notice; saved refusals remain
closed without another prompt. Development, browser fixtures, smoke tests, offline
mode, and `BA_DISABLE_TELEMETRY=1` do not send events. Opt-out aborts requests and
purges the outbox, run marker, and update attempt. Starting offline preserves a
previously consented outbox for a later online launch.

The account identifier is `SHA-256("brokenarrow.desktop:account:" + accountId)`.
Only the numeric local account resolved by the log parser is used. Other roster
members and local persona names never become telemetry IDs. A random installation
UUID is stored locally; its namespaced SHA-256 hash identifies installations and
is the fallback before an account is known. Stable hashes are pseudonymous, not
an irreversible guarantee of anonymity. Account hashes can link usage across
launches and installations. Person profiles, aliases, cookies, browser trackers,
input contents, and session replay are not enabled.

`identity_source` distinguishes game accounts from installation fallbacks.
`identity_confidence` is `confirmed` after this launch's logs identify the account,
`cached` when reusing the previous account hash, or `installation` when no account
is known. Account-version and active-account analyses require confirmed identity;
installation-version and coverage views include cached and unidentified clients.
Queued events freeze their account, language, version, session, and capture time.
Operations spanning consent or account boundaries are excluded.

Every event contains `app`, `version`, `distribution`, `language`,
`installation_id`, `identity_source`, `identity_confidence`, `app_session_id`,
`platform`, `arch`, and `telemetry_schema`. The envelope includes a capture
timestamp, event UUID, public project token, and distinct ID. The receiver sees
the source IP and may add geographic properties under its project settings.
Administrative credentials are never distributed with the app.

## Native sessions and presence

`app_session_id` identifies an application run. PostHog's standard `$session_id`
is a UUIDv7 whose embedded timestamp matches session creation. It rotates on a
user change, clock rollback, 30 minutes without activity, or the 24-hour session
limit. Idle background events omit `$session_id`, so presence heartbeats do not
keep an interaction session alive indefinitely. Persisted events retain their
original session and timestamp; replay does not assign them to the new run.

`app_heartbeat` is emitted every minute and on window presence changes. Online
presence is an approximation based on the latest event per installation in the
last five minutes. `foreground` requires a focused, visible, non-minimized app
window. `active` additionally requires system idle time below 60 seconds. Only
these booleans are sent, never key or mouse details. A kill, disconnection, or
suspension ages out after five minutes. The dashboard is manually refreshed;
automatic page refresh has not been enabled.

## Delivery and recovery

The in-memory queue is bounded to 200 events. Installation observations, version
changes, updater states/results, exceptions, exception summaries, recovered exits,
and delivery summaries are critical. Up to 50 critical events are stored in local
SQLite for at most seven days; persisted properties are schema-validated before
replay. Pending data contains only the same curated fields as the network payload.
Under pressure, critical events can displace normal events; error samples can be
displaced by other critical events. Drops are counted.

Requests use Electron's network stack and PostHog's `/batch/` endpoint, with at
most 20 events per request and a three-second request timeout. Transient network
failures, HTTP 408/429, HTTP 5xx, and unconfirmed acknowledgements use finite
backoff retries. `Retry-After` is honored within bounded limits. Events make at
most five attempts in one run; exhausted critical events remain for a later
launch, while normal events are dropped. Permanent HTTP failures are dropped.
Event UUIDs remain unchanged across retries and restarts for ingestion deduplication.
HTTP success with `{"status":"Ok"}` confirms receipt, not downstream validity.

Shutdown attempts a bounded 1.5-second flush before closing the database. Remaining
critical events survive; unsent normal events are counted in a durable delivery
summary. Opt-out performs no flush and deletes pending data. Optional persistence
and analytics failures never enter the application's error UI.

A local run marker is opened after consent and closed during normal shutdown.
An open marker found on the next launch generates `previous_run_exit`, classified
as `exception` only if the main-process exception monitor recorded that cause.
Otherwise it is `unclean_exit`, which can also mean a kill or power loss. Fatal
errors persist their curated exception before the process exits when possible.
This is not a native crash-dump collection system.

Update availability, download, verified download, and install transitions carry
one `update_attempt_id`. The attempt is persisted before installation shuts down
the app. A later launch reports `update_attempt_result`: `applied`, `not_applied`,
`other_version`, or `interrupted`. Downloads interrupted before installation are
not counted as installation failures. Observed failures report `failed` with the
stage. Results have stable UUIDs and are enqueued durably before the attempt is
marked complete. `app_updated` separately observes any version change, including
manual replacements and downgrades.

## Event reference

- `app_installed`: first execution or version observation. `kind` is `first_run`,
  `existing_profile`, or `version_change`; changes include `previous_version`.
  Local observation UUIDs are persisted before sending. This counts first runs,
  not installer completions, and recreating/copying a profile affects counts.
- `app_started`: startup after consent becomes available in a launch.
- `user_identified`: a changed account or confirmation of a cached account.
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
- `$exception`: curated type, code, HTTP status, source, operation, fingerprint,
  occurrence count, and app code positions. Fingerprints include sanitized code
  positions. Raw messages, names, account IDs, URLs, full stacks, and local paths
  are excluded. Renderer and server frames retain only known module basenames or
  public hashed chunk names, line/column numbers, and valid chunk IDs.
- `exception_summary`: counts repeated occurrences of a classified error during
  the reporting window. Sum `occurrences` across this and `$exception` to count
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

## Source maps and release context

Web, server, and desktop production builds emit source maps. The fixed-version
PostHog CLI checks/injects chunk and release metadata when credentials are
configured. Renderer diagnostics retain the injected `_posthogChunkIds` and
`_posthogReleaseId` references without forwarding the local paths used to resolve
them. Exception events use native JavaScript frame platforms and `$release_id`.

The release workflow uploads symbols using `pnpm posthog:sourcemaps` after the
build. Set the repository secret `POSTHOG_CLI_API_KEY` to a dedicated key scoped
to project 1 with `error_tracking:write` and `organization:read`. The workflow
sets host `https://posthog.jamesflare.com` and project ID `1`. That secret is used
only by build/upload scripts, not by Electron or the renderer. Without it, local
builds validate map structure and CI explicitly warns that injection/upload was
skipped. Source-map uploading has not been validated until a real upload succeeds.

## Metric definitions

The [PostHog dashboard](https://posthog.jamesflare.com/project/1/dashboard/2)
contains versioned metric definitions maintained in
[posthog-dashboard.json](posthog-dashboard.json). Every production query filters
`properties.app = 'brokenarrow.desktop'` and excludes `properties.validation`.
Live integration checks use synthetic identities and the validation marker.
Account version share, installation version share, and identity coverage use
native PostHog pie charts with percentage labels and totals. Their SQL queries
retain the latest state per account or installation before counting each slice.

- Online/foreground/active users: latest presence per installation in five minutes,
  then distinct identities. This avoids double-counting an installation fallback
  and a subsequently recognized account from one machine.
- Account version share: last confirmed version per account active in seven days;
  each account is counted once. Installation version share covers all installations.
- Identity coverage: last confidence state per installation, including cached IDs.
- Update success: distinct attempt results, limited to install-stage results when
  calculating installation success. `interrupted` downloads are shown separately.
- Error totals: sum classified occurrence counts; affected users are distinct IDs.
- Resource usage: main and renderer resources are separate views. Renderer samples
  include all renderer processes belonging to the app, including recording windows.
- Delivery health: maximum cumulative counters per run before summing, using
  heartbeats and durable end-of-run summaries.
- Daily/weekly active accounts: confirmed accounts performing an explicit feature
  view or operation. Background presence alone does not make an account active.
- Day-1/day-7 return usage: exact-day returns relative to the first observed feature
  use, with eligible cohort counts shown. The available history begins when this
  instrumentation is deployed; it is not necessarily the user's first-ever use.
- Release health: versions with at least 20 operations and more than 5% failures
  are flagged. This is an operational threshold, not a significance test. The
  matching PostHog alert evaluates the guarded numeric column per version.
  It is enabled with an empty subscriber list for on-site monitoring; no email
  or external notification destination has been configured.

These metrics cover consenting, online clients. There is no claim that the first
execution count equals total installer downloads, that presence means foreground
interaction, or that missing data proves the absence of errors.
