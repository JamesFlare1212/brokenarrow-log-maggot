# State machine risk audit and fixes

Initial audit: 2026-11-10, baseline `f3e95b2c`, BARadar `4.5.9`.
The [workflow inventory](implicit-state-machines.md) supplies the workflow IDs.

The initial audit reproduced nine risk classes with eleven failing invariant
assertions. **All nine findings are now fixed in the working tree.** The original
scenarios and adjacent failure/cancellation cases run in the normal regression
suite. No expected-failure markers, skipped cases, or separate audit configuration
remain. Priorities below record the original impact, not measured incident rates.

## Resolution ledger

| ID    | Original priority | Original failure                                                                                | Resolution                                                                                                                                                                    |
| ----- | ----------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SM-01 | P1                | Retired recording cleanup overwrote a replacement's state.                                      | Retirement publishes before cleanup yields; old cleanup cannot subsequently publish error/idle into a newer capture.                                                          |
| SM-02 | P1                | A revoked finalizer published saved after abort returned.                                       | Finalization checks capture ownership after every await, shares one finalization promise, rejects further chunks, and removes a late committed file without invoking saved.   |
| SM-03 | P1                | A new match accepted the previous match's current-roster results.                               | Match start/end invalidates current-query ownership; acceptance also checks the captured match session ID and generation.                                                     |
| SM-04 | P1                | Delayed/concurrent account-switch reminders overwrote backup metadata or duplicated a reminder. | Backup publication and reminder evaluation share a queue, backup records carry a revision, and conditional commit/publication checks reject stale work.                       |
| SM-05 | P3                | The selected log disappeared while live remained true.                                          | Clearing watcher evidence resets live/recovering/error together; empty-directory and stopped states have no stale liveness.                                                   |
| SM-06 | P2                | Recording-stop failure skipped database disposal.                                               | Shutdown drains recording, client, and admitted tasks before closing SQL, then reports cleanup failures.                                                                      |
| SM-07 | P2                | Cross-device copy succeeded but failed source deletion made every retry a collision.            | A persistent verified-copy journal allows the operation's own copy to resume source deletion, including after reopening SQL. Unrelated/changed destinations remain protected. |
| SM-08 | P2                | An older save reply rolled back a newer config event in the draft.                              | Replies acknowledge patched fields only; per-field observation versions preserve newer event values, including a value that changes back to its original value.               |
| SM-09 | P2                | Leaving a recording-settings tab after save failure discarded edits and retry state.            | AppProvider owns one settings queue, staged directory text, and migration preference for the renderer session. Tab/modal teardown cannot discard that state.                  |

## Recording ownership: SM-01 and SM-02

[RecordingController](../apps/desktop/src/recordings/controller.ts) uses capture
object identity for continuation validity. A start generation protects discovery;
it does not replace the identity check during finalization, because another
start may legitimately wait for a stopping predecessor.

Failure and discard retire the current capture and publish its terminal state
before filesystem cleanup can yield. The cleanup continuation has no later
public state update. Finalization checks ownership after the write queue,
writer completion, stat, and rename, before invoking the host saved callback.
Cancellation errors from already-retired work cannot fail a replacement.

Each capture has one finalization promise. Repeated finish calls share it and
chunks are rejected after finish begins; tail chunks remain accepted during
graceful stopping before finalization begins. Destination timestamps are reserved
monotonically within the controller so an old finalizer's cleanup cannot remove
a replacement's file for the same match in the same millisecond.

Abort revokes publication. Pending kernel I/O can settle later; a rename that
finishes after revocation triggers best-effort removal of that capture's own
destination and no SQL/event callback. Automatic crash recovery of a part file
is still outside this contract.

The regression cases pause failure/discard cleanup, replace an aborted capture
during final rename, verify single finalization admission, and finalize the same
match twice with a frozen clock. Existing discovery/token/sequence and
stop-before-next-capture tests continue to run.

## Query context: SM-03

[Application.onLog/query](../apps/server/src/app.ts) invalidates the current
request on every match start/end, including recovered transitions. The active
predicate checks request ID, session generation, and match session ID.
Previous-match requests retain independent ownership. Shared HTTP work may
continue for another subscriber even when an obsolete current query is cancelled.

The regression deliberately starts the next match without a lobby/reset event
and retains the parser generation. The old request is rejected because its
business context changed, rather than depending on an unrelated reset.

## Backup and reminder transactions: SM-04

[DeckService](../apps/server/src/decks/service.ts) serializes the complete
previous-match backup plus metadata publication in one job. Its internal write
helper does not recursively acquire the same promise queue. Reminder evaluation
uses that queue and conditionally commits against the captured package revision
and legacy identity fields after I/O. Re-read reminder pairs are merged only
after confirming the pair is still new.

New package records receive a random local revision; imported records without a
revision remain supported through their existing owner/FID/time identity.
Directory changes and an invalid session predicate reject pending reminder work
before consuming its pair.

The [application](../apps/server/src/app.ts) also validates session generation,
account key, current match, and backup revision before presenting a reminder.
Publication retires reminders for the superseded archive even if the initiating
match already ended. A reminder for the newly published archive survives an
older completion. Reset clears an existing reminder.

The renderer includes the displayed `packageRevision` in `decks.switch` requests.
The application rejects a restore targeting a different visible reminder, and
the deck queue rechecks that revision when deployment starts. Imported metadata
without a UUID receives a stable legacy identity derived from its package facts.

Regressions pause directory discovery before replacing backup metadata, issue
concurrent evaluations, revoke session ownership mid-evaluation, and return an
old evaluated reminder after the application account changes.

## Watcher and shutdown terminal states: SM-05 and SM-06

[LogWatcher.clear](../apps/server/src/logs/watcher.ts) resets file evidence and
live/recovering/error together. A selected file's liveness is calculated after
the reset for that file. An empty successful directory poll clears an earlier
error; a failed poll cannot retain a previous live flag.

[Application.stopInternal](../apps/server/src/app.ts) closes admission, stops
timers/readers, aborts networking, and waits for recording/client disposal and
all admitted tasks to settle. SQL closes after that drain even when recording
stop fails. A failure is returned only after cleanup; repeated stop calls observe
the same terminal result without closing the database twice. RPC/background
errors retain their existing reporting instead of becoming new shutdown errors.

The regressions verify stopped/empty watcher flags, disposal after a recording
error, repeated stop, and an admitted report that must complete before SQL closes
while recording disposal fails. Desktop process exit can release OS handles,
but the service's own disposal contract no longer depends on that fallback.

## Partial recording migration: SM-07

[ReplayFiles.move](../apps/server/src/replays/files.ts) serializes migrations.
The application validates the source directory when a queued migration actually
starts, so another migration cannot redirect configuration using a stale source.

Same-volume moves retain the existing rename path. After EXDEV, copying remains
exclusive. The implementation verifies regular-file identity, stable metadata,
equal sizes, and SHA-256 contents using bounded streams. Before source unlink,
it persists a `replayMove:` record keyed by canonical source/destination paths.
The record stores source/destination fingerprints and the verified digest.

If source deletion fails, retry accepts that existing destination only when the
journal and both current files still agree. It then removes the source and clears
the journal. The same recovery works after closing/reopening SQL. A destination
without the operation's journal remains a collision even if bytes match.
Changed source/destination bytes or identity remain errors; no unrelated target
is deleted or overwritten to make retry succeed.

This is recovery of a verified copy awaiting source deletion. A process crash
between copying and journal publication can still leave an unclaimed destination
that requires reconciliation; the implementation conservatively reports a
collision. Concurrent game capture and moving its configured directory remain
a separate integration scenario from the nine reproduced findings.

## Settings lifetime and freshness: SM-08 and SM-09

[useSettingsAutosave](../apps/web/src/hooks/useSettingsAutosave.ts) tracks incoming
config observations per field. A reply merges only acknowledged patch fields
whose observation version has not advanced since dispatch. Other fields retain
the latest confirmed value. Local edits made during the request remain overrides.
The same-field regression includes a newer value changing back to its original
value, so comparing only the final value with the dispatch value is insufficient.

[AppProvider](../apps/web/src/app/state.tsx) owns the single queue used by ordinary
and [recording settings](../apps/web/src/features/replays/RecordingSettings.tsx).
The migration checkbox preference also survives tab/modal replacement within
that provider's lifetime.

Directory text is held separately from automatically eligible patches. Slider
debounce saves and in-flight save loops drain only eligible fields; they neither
persist directory text nor run its migration preparation. Blur, return, test
recording, or tab teardown explicitly promotes the held draft and flushes it.
Directory controls remain editable during saves of unrelated fields so those
saves cannot force blur and accidentally promote incomplete text.
A staged field can carry preparation work, such as moving recordings before
saving the new directory. Preparation accompanies a failed patch on retry and
is discarded with that patch. Updating a preparation callback never writes a
value captured by an old render into the draft.

A failed save preserves its patch, preview, and recovery controls across tab
changes. Retry/discard acts on the same shared owner. Recording displays the
shared error inside its content; other settings display it in the page error
area, avoiding duplicate recovery controls.

The UI tests retain their shadcn Tabs, Card, Field, Slider, and Dialog interaction
contracts. The [design system](../design-system/broken-arrow/MASTER.md) records
the shared save-status and edit-lifetime rule.

## PR review follow-up

The review of commit `78afe329` identified two additional P2 boundary cases:

- [Directory debounce feedback](https://github.com/JamesFlare1212/brokenarrow-log-maggot/pull/31#discussion_r4526585553):
  the initial shared queue let a slider timer flush an incomplete directory and
  potentially move recordings there. A controlled 250 ms test reproduced a patch
  containing both FPS and the partial directory. Separate held/eligible maps and
  per-field busy state now preserve the explicit directory commit boundary.
- [Superseded reminder feedback](https://github.com/JamesFlare1212/brokenarrow-log-maggot/pull/31#discussion_r4526585565):
  the initial completion guard used active match identity, leaving the old reminder
  visible if that match ended before its backup committed. An actual ZIP/SQL test
  reproduced that state. Invalidation now follows the published archive revision;
  a newer reminder is retained and stale restore inputs are rejected.

The follow-up regressions also cover directory edits during an in-flight save,
focus-safe input admission, the displayed client revision, queued stale restores,
and successful legacy restores. Both original review reproductions failed before
their fixes and pass as ordinary regressions afterward.

## Regression commands and coverage

The promoted cases and adjacent guards live in:

- [state-machine-regressions.test.ts](../tests/state-machine-regressions.test.ts):
  recording ownership, query invalidation, backup/reminder state, watcher flags,
  shutdown drain, and verified-copy recovery/collision protection.
- [settings-state-regressions.test.tsx](../tests/settings-state-regressions.test.tsx):
  event/reply freshness, staged preparation, discard, and failed-edit retention.

```powershell
pnpm exec vitest run tests/state-machine-regressions.test.ts tests/settings-state-regressions.test.tsx
pnpm check
pnpm format:check
pnpm smoke
pnpm smoke:real
```

These files match the normal Vitest configuration and run in CI through the
existing checks. A future change must satisfy their ordinary assertions; there
is no manual red suite to overlook.

The controlled tests use mocked Electron windows/bridge calls, actual temporary
files, real ZIP operations, and SQL. They do not capture a screen or contact a
remote service. Temporary cleanup verifies resolved path containment.

| Inventory workflows | Regression coverage and boundary                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| L01-L04             | Lifecycle, startup/event ordering, failure drain, and config freshness.                                         |
| G01-G08             | Log formats, UTF-8/recovery provenance, archive checkpoints, and complete watcher reset.                        |
| N01-N12             | Request sharing/cache/retry/fallback, explicit query replacement, and match-identity changes without reset.     |
| R01-R06             | Startup cancellation, token/sequence ownership, tail writes, retired cleanup/finalization, and playback leases. |
| U01-U03             | Deferred install RPC, install admission/recovery, persistent install record, and failure-safe service disposal. |
| D01-D10             | SQL/legacy migration, source precedence/tombstones, queued reminder commits, and verified-copy deletion retry.  |
| A01-A07             | Existing consent, session rotation, delivery retry/TTL, version/update outcomes, and diagnostics tests.         |
| F01-F16             | Existing navigation/focus/request tests plus shared queue freshness and failed-edit survival.                   |

The initial audit's remaining static concerns are not additional reproduced
findings: automatic-query/resumed-capture keys still define a one-attempt policy
for unchanged input, and capture/directory migration needs explicit integration
testing if its concurrency contract is extended. Existing request generations
protect straightforward stale-thumbnail replacement/unmount. Native GPU driver
timing, power loss, and every possible interleaving are not exhaustively covered.

## Development review rules

1. Record the owner of each asynchronous continuation and validate it before
   publication, persistence, or callbacks. Admission checks alone do not revoke
   a call already in progress.
2. Review the state vector: enum, token, generation, pending work, and handles.
   Test impossible combinations such as idle-with-active-capture or no-file-but-live.
3. Distinguish graceful stop, discard, transport cancellation, and finalizer
   publication. Define the file owner and completion contract at each boundary.
4. Invalidate business context when it changes even if a lower-level reset event
   is absent. Include old success, old failure, and old cleanup after replacement.
5. Serialize read-modify-write operations spanning I/O or use a conditional
   commit. Individually synchronous SQL statements do not make a workflow atomic.
6. Model partial success and its next retry explicitly. Verify ownership before
   adopting an existing file, and preserve collision protection.
7. Keep failed edits in an owner that survives the promised navigation lifetime.
   Apply one freshness rule across all settings writers and responses.
8. Inject failures after progress: after copy/rename, during cleanup, after another
   owner starts, and during unmount. Final screenshots or file existence cannot
   establish consistency by themselves.

## Validation

The original baseline had 1,090 passing normal tests while all eleven audit
assertions failed. The initial repair added 25 ordinary regressions. After the
PR review follow-up, the two state-machine regression files contain 32 passing
tests, with an additional client-reminder identity test in the main UI suite.

- `pnpm check`: passed type checking, UI design checks, 47 test files with
  1,127 passing tests, and web/server/desktop production builds.
- `pnpm format:check`: passed.
- `pnpm test:ui`: passed all 30 browser interaction tests.
- `pnpm smoke`: passed Electron service, sandboxed preload, renderer, and
  integrated window-chrome checks.
- `pnpm smoke:real`: passed with 496 offline real matches and match-navigation,
  local-detail, focus, and responsive-scoreboard checks.
- Local documentation targets/line bounds and `git diff --check`: passed.

The earlier recording-controller repair also passed `pnpm smoke:recording`
with synthetic AV1, verified quantizers, acknowledged writes, playback, and seeking.
That encoder/controller check was not repeated for the PR review follow-up.

The targeted existing regression run initially caught a directory preparation
effect re-staging an old render value during the repair. Preparation registration
now updates only the queued callback; the corrected UI run and full suite passed.
Synthetic media tests do not measure game performance or validate every GPU driver.
