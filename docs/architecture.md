# 架构

职责划分参考 [T3 Code apps](https://github.com/pingdotgg/t3code/tree/main/apps)。

```text
apps/
  desktop/    Electron 窗口、preload、系统目录、验证、输入钩子、录制、视频协议
  server/     Node.js 业务、日志、HTTP 调度、分析、卡组、SQLite
  web/        React 功能模块、公共 UI、hooks、四语和主题
packages/
  contracts/  领域类型、Zod 请求验证、RPC 和事件协议
  shared/     归一化、合并、格式化、录像参数、蛆指数纯计算
tests/        算法、网络、生命周期、迁移、文件、录像、React
scripts/      开发、桌面冒烟、图标
```

server 是可注入平台接口的 Node 业务层，在 Electron 装配，不额外开放 HTTP 端口。真实 HTTP 使用 net.fetch，与验证窗口共享会话 cookie。web 不访问 Node、文件或 SQLite。

Player reports share one match table across search and profile views. Match ID and
time occupy the leading cell, followed by outcome, while every metric remains in
the document at narrow widths. A named, focusable outer viewport owns horizontal
scrolling; its Left/Right handler runs only when the viewport itself has focus.
Each match action references its visible time and outcome. Profile record tabs
adjust their local horizontal viewport when focus changes, preserving the full
label and space for its focus outline.

Snapshots and events share types and revisions; stale state and side effects
are rejected. Queries carry request IDs, context and generation, and reports
accept results for their current target/request. Maggot analysis has one global
owner and subscriptions return cleanup functions. Settings use a separate page
and preview local edits while persisting changed fields serially. Theme mode
and light/dark palettes remain separate, so choosing a palette does not change
the mode.

## Initialization recovery and event ownership

Initialization subscribes and immediately requests its bootstrap snapshot, replaying buffered
events only when their revisions are newer. A failed attempt releases its subscription
and buffer. Retry creates a fresh subscription/snapshot attempt; discarded replies and
events cannot update the recovered state. Synchronous invocation and subscription
failures use the same recovery surface.

The startup card retains its retry action and last error during another attempt. It
uses browser language until saved configuration is available, including document
language, title and loading text. A bounded scroll container keeps the action usable
at high zoom. On success, focus moves from an owned retry action to the visible
workspace/settings content only when the user has not focused another control.

## Cache operation ownership and expiry snapshots

Cache usage keeps its metric/category structure from the first read. Skeletons
occupy the eventual value line height; an initial failure uses unknown values.
The observation-status and category-count slots reserve their normal footprint,
and read diagnostics follow the cleanup card. Cleanup eligibility still depends
on a confirmed current snapshot; placeholders never imply zero cached entries.

The app provider owns the cache request lock, current statistics and the most recent
cleanup outcome. Cache-panel unmounts do not release an in-flight read, confirmation
or cleanup. A returning panel joins that operation and retains its result. Reads and
cleanups share one lock, preventing a navigation or visibility event from starting a
duplicate operation.

A rejected cleanup response has an uncertain outcome. The interface does not retry
the deletion or infer a removal count from differences between snapshots. Instead it
marks retained statistics unverified and reads them again. A failed reconciliation
keeps old counts labelled as a snapshot and blocks cleanup until a fresh read succeeds.
Successful reconciliation updates the counts while preserving the unknown removal
count. Confirmed removal counts remain visible across navigation and later reads.

CacheStats includes its observation time and nearest future expiry. API responses use
their inclusive expiry boundary; player snapshots use the existing strict age boundary
and exclude already-stale payloads from future deadlines. While Cache is visible, the
panel schedules a refresh at the next known expiry or after thirty seconds, whichever
comes first, and refreshes when the window returns to the foreground. Timers and visibility listeners are removed on
panel unmount; the operation itself remains owned by the app provider.

## Shared health checks and last-known service state

The app provider owns manual health-check progress, results and failed attempts for
both Connection settings and the workspace status popover. A concurrent activation
joins the existing operation. Navigating between these entry points preserves the
pending check or failure. Returned health results render directly even without an
event; newer health events take precedence over an older response.

The service result and request outcome remain distinct. A rejected check preserves
the latest known result and its timestamp, while the persistent status identifies
the failed attempt. Retrying clears the previous error and marks the request pending;
a completed probe displays its actual unknown/down/partial/ok state. Settings exposes
the same endpoint diagnostics through a shadcn Collapsible. The shared check action
retains its DOM identity and uses aria-disabled while busy.

At narrow workspace widths the health entry remains a compact status icon with its
complete accessible name and title. Shape and label distinguish checking, failed
attempts and the known service state. The same diagnostic popover remains available.

## Update attempts and installation guards

The app provider owns update actions and one notification identity shared by the
workspace footer and General settings. Starting a retry replaces its previous
failure immediately; progress, rejection and completion replace that same notice.
Authoritative update events can confirm a completed download even when its IPC
acknowledgement is lost. External-download feedback describes the browser request,
without claiming that a browser opened or an installer ran.

The desktop controller marks `installBlocked` when either installation activity
guard rejects an attempt. It preserves the downloaded version, clears obsolete
errors and releases the action for an explicit retry. This is the latest attempt's
result, not a permanent lock or an instruction to install automatically. The
renderer separately disables installation during an active match or recording.
Both entry points expose the current reason and next step; portable builds name
their action Open downloads and explain manual replacement after closing the app.

Update controls retain focus with aria-disabled while busy or blocked. Pointer
and keyboard presses capture the original action and availability, so releasing a
press after Download becomes Install cannot start installation. Sidebar feedback
uses a reserved, named scroll region associated with its action.
General settings reserves the status region and reveals its action row when focus
enters; detailed failures render below that row so they cannot displace its action.
Notification placement observes the focused control's ancestors so changes in status layout
also preserve the control's unobscured position.

## Roster query ownership and freshness

Current-room query identity includes the log generation, phase, lobby/match identity
and player/team membership. Both server completion guards and renderer state reject
results for an older room identity. A room transition clears its retained query rows.
Previous-match queries use the displayed match ID and player/team membership instead.

Every query publishes its source key and eligible pending player IDs before starting
lookups. Each completion settles one player without removing other same-room results.
The shared roster reducer drives service snapshots, development events and renderer
state; bootstrap restores in-flight progress after reload. Pending rows identify
retained values and their source time. Stale results disclose their cache flag and
timestamp, including the player action's accessible description. Team aggregates and
copied values preserve that freshness context.

Previous-match lists ignore superseded responses and errors. Both Overview and Radar
query a newly displayed previous match or changed membership. Per-request local
completion guards keep an older RPC from releasing a newer request's busy state.

## Bounded automatic player-query retry

An automatic current-room query can schedule one retry five seconds after its failed
results settle. Only failed eligible player IDs are queried again; successful rows
remain available. The room key and original request must still own the result, live
monitoring and automatic querying must still be enabled, and the service must remain
open. Unchanged room events do not restart the retry budget.

Manual current-room refresh cancels a scheduled retry, while previous-match queries
retain their independent context. Room changes, log reset/unavailability, disabling
automatic queries and shutdown cancel the scheduled operation. Retry timing is part
of roster snapshots and events, scoped to its request and room. The interface exposes
the one scheduled attempt, subsequent progress and the manual recovery action after
failure; it does not repeatedly query the same failed room indefinitely.

## Metric availability and provenance

Percentage formatting is shared across reports, profiles and roster summaries. Null
or non-finite percentages render as an em dash without a percent sign; a measured
zero renders as `0%`. Copied report summaries use the same formatter and omit empty
segments.

Basic player fallback preserves unavailable outcome counts as null. Only two known,
nonnegative integer win/loss counts define the sample and calculated win rate. An
explicit zero remains known. Total matches use their valid source count or a known
outcome sum; otherwise the total is also null. PlayerReport and MiniInfo carry these
nullable counts through snapshots, IPC and shared report state. The interface explains
incomplete outcomes and retains explicit detailed-analysis/profile refresh actions.

Roster display, team average and team copying resolve ELO from the same queried value
or match starting rating. A match-derived value is labelled Starting ELO in the row
and copied text; unavailable values remain an em dash. Overview selects the latest
completed personal match before reading its ELO. Missing ELO in that match does not
fall through to an older match, and a later detail update or explicit zero is accepted.

## Localized labels and count messages

Messages may be static templates or count-aware template functions. Resolve the
selected locale's template with numeric variables before interpolating its text.
English count messages choose singular nouns for one; other counts use plural
forms, and independent win/loss counts choose their forms separately. Chinese
units and supplied formatted counts remain intact.

Match details carry `warningCode: 'batrace-cache'` with the existing diagnostic
warning when the match client returns stale cached facts. The renderer localizes
that known warning and recognizes its earlier literal form for saved fixtures.
Other technical warnings keep their detail. Fresh API results clear old warning
metadata during normalization/persistence; older API data cannot reintroduce it.

Localize spectator and unknown team labels at the view boundary. Radar headings
and copy names, match headings/captions, archive groups and recording fallback
identities share the same helper. Alpha and Bravo remain recognizable identifiers.
Navigation settings display Overview for the stored `current` page, matching the
workspace label for visibility and both reorder actions.

## Single-selection controls and playback recovery

The shared ToggleGroup renders single-selection choices with Radix RadioGroup
and retains the existing segmented/card variants. Arrow navigation selects the
focused choice; plain focus does not. Radix owns direction, disabled-item skipping,
wrapping and Tab entry. A bounded follow-up after its deferred focus movement
checks the actual focused, unchecked radio, covering a keyup that arrives before
Radix's arrow-selection flag is consumed. New keys, pointer input, focus leaving
the group and unmount cancel that follow-up. Multiple-selection palette controls
continue to use Radix ToggleGroup and change only on activation.

Playback keeps its existing video node while a replacement URL is pending. Only a
successful response remounts the media; errors from the old source during that
request cannot become the new result. The dialog retains the last playback time,
selected rate and play/pause intent and applies them when new metadata arrives.
Desktop playback uses an explicit protocol lease for each open dialog. Active
leases survive the former two-hour URL boundary, are released after replacement
or unmount, and are cleared on document navigation, renderer destruction or crash.
Session generations reject and release late allocations from a discarded document.
The protocol bounds outstanding handles without evicting an active player; capacity
failures have localized recovery guidance. Legacy one-shot URLs retain their expiry.
StrictMode ref reattachment preserves the current source; detached media is stopped
and unloaded after checking that the node has not been reattached.
RecoveryAction owns a stable Retry/Refresh button through pending, failed and
successful requests. Busy activation is guarded without disabling its focus target;
completion preserves a later focus choice.

Fixture tools restore the committed scene control after a held switch, including
failure, and preserve a later focus choice. Dismissal removes the launcher for the
current preview and returns focus to the application; reloading restores the tools.
RadioGroup arrow handling within the tool shadow root uses its own active element,
because the document active element identifies the host. The shadow-root workaround
preserves direction, orientation, disabled options and wrap settings.

Missing native-bridge startup guidance is a localized, named and focused main
landmark with a level-one heading and alert. The recording bitrate slider exposes
its Mbps unit in both inline and dialog settings.

Forced-colors focus styles use the system Highlight color and an explicit outline.
The input-group wrapper receives the outline for its input, while embedded buttons
retain their individual indicator. These unlayered rules survive the primitive
shadow-ring reset without changing normal-color focus styles.

## Sidebar focus and navigation intent

SidebarProvider owns desktop shortcut scope and the mobile drawer opener. A desktop
collapse moves focus from an off-canvas item to its visible matching toggle before
the sidebar becomes inert. It leaves focus outside the sidebar untouched. Shortcut
handling respects an already handled event, ignores repeats and unrelated modifiers,
and does not let a containing provider handle a nested provider's controls.

Mobile dismissal restores the original opener, including a field that opened the
drawer with the shortcut. A quick reopen preserves that opener. Explicit navigation
instead targets the selected page or settings panel. Closing callbacks yield to a
newly focused control or another modal; a breakpoint change closes the mobile drawer
and uses the visible desktop toggle without changing the saved collapse preference.

Settings tabs use automatic arrow-key selection while the drawer remains open.
Pointer activation, Space and Enter commit the category and focus its panel after
closing. Escape/Close/backdrop dismissal returns to the opener. Reorder actions keep
their button with `aria-disabled` at the end positions and guard invalid moves.
Reordering preserves the actual focused node through DOM movement, and finishing an
animation scrolls only a control still focused inside the order list. Reduced-motion
and failed-save paths preserve focus independently of animation or persistence.

## Busy refresh focus

Decks uses one shared refresh action in a permanent toolbar. Loading placeholders
reuse the file-card composition, while read/operation alerts follow the lists and
actions. Directory discovery and loss retain the same toolbar button; failure
feedback cannot displace Back up all or the other existing file actions.
The 12rem file-list viewport also retains this geometry through successful
refreshes that grow or shrink the list; file contents scroll inside that viewport.

Every deck and backup row includes a named shadcn Popover trigger for its full
filename. Opening it leaves the checkbox selection unchanged, focuses a wrapping
reading target and returns to the trigger on Escape. Backup and restore reviews
continue to use the selected file identities.

Disabled tooltip anchors are pointer-only wrappers. The actual disabled button
retains its name, disabled/busy state and any distinct explanation through
`aria-describedby`; the generic wrapper does not add a keyboard stop. Existing
guarded `aria-disabled` actions retain their own focus and semantics.

All four copy entry points use `useClipboard`: match ID, team summary, player
menu and report summary. A missing interface or method receives localized
unavailable feedback. Synchronous access/write failures and rejected writes
receive localized failure feedback with the diagnostic. Success is reported only
after the write resolves. Copy guards still reject unavailable report/team data.

Deck, cache and radar controls expose temporary unavailability with `aria-disabled`
and guard activation, preserving the same native button while work is pending.
Pending, failure and result changes keep the owned action within the scroll
viewport without taking focus from a control selected in the meantime.

Cache cleanup keeps its action focused when resulting counts reach zero; guards
reject cleanup without available entries. All-cache cleanup retains confirmation,
cancel behavior and the existing operation lock. The stats refresh also observes
that lock. Radar refresh and the current/previous toggle retain focus while queries
run; empty-roster and duplicate-query guards still reject unavailable requests.

Notifications use the viewport side with more space around the focused control.
The existing Sonner layer moves by its bottom offset, preserving its list/item
identity and timers rather than replacing the layer when placement changes.
Their maximum height follows that available space, and long notifications scroll
inside their focusable Sonner item. Focus, scroll and resize update placement;
focusing the notification itself freezes its position for reading and dismissal.
Close controls stay inside the scrolling item. This keeps error feedback from
covering the action whose failure it reports without moving keyboard focus.

## Verified log monitoring

LogWatcher marks its source non-live on read failure, retains the last parsed
room for inspection and keeps the failure until the entire read and close
succeed. An accessible empty directory clears its obsolete error and reports a
waiting state. Successful checks include `checkedAt`; `checking` prevents
automatic capture from observing a partially read session. Concurrent
`logs.refresh` calls join the current inspection. A generation change waits for
the obsolete inspection before reading the newest configured directory.

Enabling auto-record persists the preference, then checks the log source before
starting capture. Automatic starts occur after complete source inspection and
session debounce, with a per-session attempt guard. Known failures, historical
recovery, stale files and in-flight reads cannot initiate capture. An unchanged
source does not automatically retry a failed capture; explicit retry remains
available. A source reset carries its previous match and saves an active capture
through the existing stop protocol instead of discarding it. The recording
controller accepts that match only when its session identity matches, retaining
late match IDs without attributing another room's metadata.
After capture saving settles, the application reconciles the latest checked
session again so a queued next match can start without requiring another log line.

AppProvider owns monitoring retry state across page and settings navigation.
Workspace and settings toolbars share a fixed-width status control with a
viewport-constrained shadcn popover, scrollable details and fixed recovery
actions. It distinguishes source failure, empty folders, historical recovery,
stale files and active monitoring, exposes the last successful check and links
to Connection settings. Radar labels retained room data as last known, and
recording controls explain why a saved preference is waiting. Detecting the
already configured path explicitly rechecks it rather than silently doing no
work or claiming that an obsolete error is active.

## Player search ownership and identity

`usePlayerSearch` accepts a different submitted query while a previous request
is pending. It suppresses duplicate submission of the current query and uses
request generations to reject obsolete successes and failures. The successful
query and its payload share one stored value, so retained rows cannot receive
another request's query label. Clearing invalidates all outstanding renderer
results. It does not cancel backend work.

The search field remains editable and focusable while busy. Submitting edited
text replaces the active query; the pending button stays focusable and guards
duplicate activation. Retained result buttons and menus follow the same usable
policy and explicitly identify their previous query. Service errors identify
their submitted query separately from field validation. Retrying restores that
query and focuses the input before beginning the request.

Player search keeps a results region mounted beside/before the report in both
responsive layouts. Its bounded list, query-summary and feedback footprints
prevent async diagnostics from moving retained targets. Room suggestions stay
in a user-controlled Collapsible above the form, with a persistent trigger/count
and a fixed 12rem open viewport. Background room changes cannot expand it or move
the query controls. The diagnostic reading region scrolls independently of Retry.
Each explicit player selection captures its actual button and advances a focus
version, so selecting the same player again still reveals the report heading.
Report completions do not advance that version. Returning restores the available
captured button or falls back to the input.

Result names and report headings wrap unbroken names. Room suggestions display
the full player ID before selection, and each player-action menu includes its
ID in the accessible name. Shared spinners default to decorative icons; an
explicit accessible label gives an informative spinner its status role. Loading
text and surrounding busy controls retain their localized meanings.

## Player report availability and refresh ownership

Player recovery controls use the shared shadcn-based `RecoveryAction`. Once focused
or activated, the same button survives pending requests, subsequent failures and
successful recovery; it becomes a scoped refresh action after success. Busy actions
expose `aria-disabled` and `aria-busy` and reject repeated activation. State changes
scroll only the currently focused action into view, with room for its focus outline;
they do not move focus after the user leaves it. Player identity and local encounter
scope reset recovery ownership without remounting record tabs or their selection.
The profile header refresh follows the same busy
focus policy so it remains usable as the next Tab destination.

Search reports keep a keyed content container and report-status component while
the first report is unavailable and after it arrives. Adding the loaded header and
statistics preserves the existing recovery button instead of replacing its subtree.

The renderer owns player reports once per player in `usePlayerReports`, shared by
search and profile views. Ordinary readers join the current request; a forced
refresh supersedes an older ordinary request. Response identity and generation
checks exclude another player or an older request. Successful profile refreshes
therefore update the already mounted search report without reselection.

Report failures retain the previous summary and independently available match/map
sections with their source timestamps. A cached response with the same or an older
timestamp cannot clear a failed refresh, including timestamp ties or clock skew.
The UI names the failed report or local-profile source and provides a scoped retry.
An incoming basic or partial report preserves earlier detailed sections separately,
qualifying them rather than merging their age with the new summary.

`PlayerReport.detailAvailability` distinguishes missing analysis sections from
successful empty arrays. Profile tabs show an unavailable count until their source
is obtained. Loading, source failure, basic fallback, previous records and genuine
empty results have separate states. Basic fallback includes the analysis diagnostic,
while useful player statistics remain visible. Returning to a profile waits for its
current local profile and shared report requests before restoring nested focus.

`playerAnalysisSections` validates analysis structure, counts, match identities and
map identities. Online incomplete legacy cache entries are removed only for their
own analysis key. Invalid network JSON shapes are never cached as success; useful
partial responses expose available sections but are not reused as complete cache
entries. Recorded partial responses remain explicitly stale and section-qualified
offline. The regression suite validates every successful recorded analysis response.

The client assigns ownership to each started cache-key request. Superseded requests
cannot overwrite or delete a newer cache entry; their results are marked stale.
Only a current pending request can satisfy a new reader, and all active requests
remain tracked for shutdown. Analyzer report requests also deduplicate per player
and give an active forced refresh priority. Only the current report can write a
player snapshot, so late detailed, basic or partial results cannot regress it.

Maggot request failures retain the last successful score, samples and completion
timestamp. The visible result is labelled as the previous calculation while pending
or failed. A failed cache entry cannot suppress an ordinary retry through its normal
five-minute success TTL. Successful recalculation replaces the qualified old result
in every mounted view of that player.

## Encounter provenance and committed invalidation

Search results are stored in `search_players` and `search_names`, independently
from game observations. Their fetched times and aliases support useful local
fallback after cache expiry, cleanup and restart. Network, cached, stale and late
search responses never mark a player encountered, change a game encounter time,
or qualify that player for a new-ban alert.

`game_observations` records encounter evidence independently from the compatibility
`players.observed` flag. `Database.observe` records real session or log observations.
API match details and synchronization observe participants only when a known
local account is present, or an existing log/legacy match supplies that context.
An API match without a recorded start/end time has unknown encounter time;
its HTTP fetch time is not substituted. Removing a saved match does not erase
the fact that its players were encountered.

The transactional `encounterEvidence:v1` upgrade reconstructs evidence from
log/legacy matches, stored matches with an account participant, legacy encounter
records and explicit imported encountered-ban declarations. Original player
rows, names and their raw dates remain unchanged. Unsupported older observations
remain searchable and visible in All bans with an unverified qualifier; they do
not appear in encountered-only results or supply profile encounter dates.
Profiles explain the qualification while preserving known aliases. Unread alerts
without supported evidence are excluded, and their complete original inbox is
retained as `banAlertsBeforeEncounterEvidence` before the upgrade commits.
Historical lobby-only observations without durable supporting records may be
legitimate, but their origin cannot be reconstructed reliably and stays qualified.

Application compares the current ban snapshot after a session observation commits
and before publishing match changes. A changed snapshot emits the authoritative
`bans` event with an empty newly-banned list; unchanged snapshots are suppressed.
This covers live and recovering logs, archive callbacks, match detail/sync, and
reviewed history restoration without triggering another remote synchronization.
History restoration and portable fixture imports reconstruct observation evidence
within their transactions. The bans page keeps its current local filters and
reloads on the event. A failed reload explicitly qualifies retained data; an
empty failed read does not claim that no encounters exist. Its inline retry
focuses the stable list viewport before the loading state replaces the action.

## Durable ban alert delivery

`Bootstrap.banSync` and `banSync` events expose the authoritative synchronization
attempt, phase, last attempt, last success and error. Each attempt has a UUID;
the status is persisted in `app_state`. Bans, unread alerts and the success
timestamp commit in one transaction. A failed synchronization retains previous
records and the previous successful timestamp. An interrupted persisted attempt
becomes a recoverable error on restart. Desktop notification failures do not
invalidate committed data. Manual and background callers share one in-flight
request, assigned before its first status event.

The background cycle starts enabled ban and match jobs independently and waits
for both. A failure or pending ban fetch does not prevent the match job from
starting or publishing saved matches. Each failed job reports its own error.

The bans page reads a complete local snapshot and applies encountered-player
and search filters locally. Filter changes issue no additional list request;
an old synchronization response cannot restore a previous filter. The request
generation still rejects older local reload responses. Read failures retain
the last loaded snapshot with persistent qualification and a local retry.
Remote retry ownership lives in AppProvider across navigation; a correlated
success event reconciles a lost response without concealing later failures.

`Database.saveBans` stores each newly encountered ban batch in `app_state` in
the same SQLite transaction as the ban records. Batches have independent UUIDs,
frozen player identities and FIFO insertion order. Existing ban updates do not
create another batch. `Bootstrap.banAlerts` and each `bans` event carry the
authoritative unread inbox, so an event already included in a startup snapshot
can be filtered by revision without losing its notification. Unread batches
survive application restarts.

`bans.acknowledgeAlerts` removes only the supplied batch IDs and emits a revised
`banAlerts` snapshot. The operation is idempotent and never removes the ban
records. A failed persistence transaction retains the batch; retrying a response
lost after a successful commit is also safe. Renderer acknowledgement ownership
outlives the review popover and prevents duplicate requests for the same batch.

AppProvider automatically presents only the oldest unread batch, after privacy
consent, when no modal, settings page or tracked overlay is active. Existing
shadcn dialog, confirmation, sheet, popover and menu roots register their actual
open lifetime through `OverlayActivityContext`. The header inbox can acknowledge
queued alerts without changing modal routes or unmounting the active profile,
recording form, confirmation or video. Batches already in the modal stack are
excluded from that queued count. Closing an investigation leaves its originating
unacknowledged alert available; acknowledging it advances to the next batch.
Explicit nested-route Back behavior remains separate from automatic delivery.

## Settings drafts and recovery

AppProvider owns the general autosave hook, recording-settings state and the
automatic-recording preference operation. Recording directory text, migration
intent, failed patches and the latest migration result outlive either form.
Directory text stays separate from queued patches until blur or an explicit
flush; confirmation or deliberate discard clears that raw draft. Unmounting a
form does not destroy its pending promise or error.

`flushPending` handles new or in-flight edits while leaving an existing failure
untouched. Passive field blur and route cleanup use that path. Explicit Retry,
recording Test/Close and the guarded Settings Back action can flush failed work.
The aggregate Back operation also waits for automatic-recording preference
settlement, while discard waits for writers before clearing their drafts.
Scope-specific recovery leaves other owners unchanged.

The combined status prioritizes unconfirmed, error, saving, pending and saved across all
owners, independently of the selected category. Settings, the workspace toolbar
and recording-dialog header use `SettingsSaveIndicator`. Its existing shadcn
popover has a scope selector, a named focusable scroll region and a fixed action
footer within the available viewport. Save errors do not insert page banners
or take focus from an active control. Pending recovery rejects duplicates;
completion moves focus from its initiating action to the retained detail region,
and Escape returns to the trigger. Independently moved focus is preserved.
History navigation retains workspace feedback while the same owners settle.

`config.read` reads persisted public settings and publishes the same configuration
with its new event revision, without writing SQLite or reapplying side effects.
AppProvider tracks a configuration-specific revision independently of unrelated
events. Autosave uses this read after a rejected update acknowledgement and
accepts only a snapshot at least as recent as its confirmed configuration. Matching
submitted fields complete the save without another update; newer local patches
remain queued. A failed confirmation read exposes an unconfirmed outcome, and
explicit retry rereads before deciding whether to write. A later matching config
event can confirm the outcome. Discard forgets local edits while retaining any
unconfirmed persisted-state warning; it does not reverse an applied preference.
Preparation failures remain known failures before an update is attempted.

SQLite 使用 WAL、外键、索引、prepared statements、事务。对局、名单和账号视角分表；删除不使用玩家名构造路径。缓存保留时间和 stale 标记。

Each database connection reuses its prepared statements and releases them on close.
Encounter queries load match payloads and account views in batches. Each returned
encounter carries its account ID and name. Combined mode returns a row for each
account represented in the stored views or roster, with independently projected
relation and outcome; its summary counts account views. Imported records without
an owner stay available, explicitly unattributed, in combined mode. Single-account
mode excludes those records and reports their count. Legacy deduplication considers
both the match and known account, retaining other accounts' evidence.

`matches.detail` accepts an optional account ID. Database projection reads that
account's stored view and the current roster without persisting a different owner.
Tracker applies the requested perspective to fresh, cached, stale and local fallback
results, including forced refresh. An account with neither a stored view nor roster
evidence fails explicitly. Archive list/grid actions, added-match details, Overview
and encounter links carry their displayed account into the route. The detail dialog
identifies the selected account and offers an existing shadcn native select, including
the saved archive perspective. Changing this selection never creates a local account.

`matches.detail` also accepts bounded `local:` and `legacy:` stored references.
Control characters and line separators are rejected at the RPC boundary. These
references reread SQLite and apply the same account projection and local awards;
they never query BATrace, rewrite history or publish a match-change event. Forced
refresh remains a local reread. A missing key returns `LOCAL_MATCH_UNAVAILABLE`.
The renderer localizes that result and explicitly qualifies any retained last-read
details. Online-only additions and player/account identifiers remain numeric.

Local detail headers identify the view without placing a long key beside header
controls. The full reference is visible in the body and associated description.
An external match action is available only for a validated numeric destination,
including a numeric ID already known by a record opened through its local key.
Local reread retains its focused control and rejects concurrent activation.

Encounter rows expose their complete match reference beside the map. The action's
name includes both, and its description identifies account, relation, outcome and
end time. Unknown end times are explicit, so unfinished same-map records remain
distinguishable. A named region owns horizontal scrolling, including its arrow-key
handler and the existing modal scroll snapshot. Its table primitive leaves that
single owner in control; unchanged local-detail returns restore the same row and
account context.

Overview queries personal metrics and recent rows with the current session account
ID, independently from the all-account archive count. Unknown identity is an explicit
state with access to the archive. Scoped response ownership prevents old account rows,
errors and metrics from appearing after a switch. Profiles send the session account
and association setting explicitly, refresh on either change and committed account
membership changes, and exclude late results from another scope.

ProfileDialog owns the controlled Radix Tabs context across the shared dialog's
portal. Its persistent banner renders ProfileRecordNavigation separately from
the body panels; ordinary ProfileRecords consumers retain the inline navigation.
Equal grid tracks keep tab bounds independent of asynchronously arriving counts.
Header copy remains mounted and unavailable until its report exists. The compact
title retains the full accessible identity, and a named, keyboard-scrollable body
region exposes the complete visual identity without expanding the header.

The profile's identity, summary and recovery slots have stable bounds. Its
PlayerReportStatus variant places recovery before dynamic feedback, while other
consumers retain the existing order. ProfileBody uses React's pre-mutation snapshot
and post-update lifecycle to compensate the nearest body/horizontal viewport for
a visible focused or pressed control, or a reading line while the dialog owns
focus. Disconnected targets and changed focus cancel compensation. Pointer-up,
pointer-cancel and unmount clear press tracking. Historical alias text wraps inside
the accordion rather than expanding its clipped content horizontally.

Overview archive snapshots carry the renderer's match revision; personal snapshots
also carry the account ID and account-metadata context revision. A committed history
event invalidates old rows and metrics immediately, before a replacement request
can finish. Failed reads retain explicit unavailable/retry state without exposing
actionable deleted records. Global and personal requests recover independently,
and late responses cannot replace a newer revision. Retiring the focused row or
retry control reveals and focuses the account-context status when focus was not
moved elsewhere.

The responsive Overview shortcut grid precedes account context, metrics, room
rosters and recent results. New spectators, previous-match details and list loading
outcomes change content below the controls, preserving their pointer targets. The
recording-status row keeps its fixed summary and bounded diagnostic Popover.

Application publishes deduplicated `accounts` events containing the account list and
committed active identity after session persistence and account-affecting history
operations. Settings and archive options invalidate pending list reads before accepting
that authoritative snapshot. Renderer revisions distinguish list timestamps/counts
from meaningful identity or membership changes, avoiding profile reloads for every
unchanged heartbeat. Deleting local history does not switch the game account; later
log identification can recreate it and updates the open settings page.

日志读取 64 KiB、StringDecoder、逐批让出循环。历史恢复不触发过去的录像、输入统计和卡组备份；新鲜进行中会话可以从当前时点恢复。

日志支持新旧大厅和名单格式，跨批次保留原始时间戳与历史半行的来源。无 FID 对局按日志来源和开局位置生成稳定身份，重复恢复不会新增档案。延迟网络时长优先按连接或 FID 关联，无法区分的事件不写入新局。

Historical archives use a separate LogParser and recursively scan `.log` and `.txt` files at startup, after directory changes, every 30 seconds, and on manual refresh. Scans do not follow symbolic links or change the live session, recording, or deck state. SQLite checkpoints track file identity, size, and modification time; matches and checkpoints commit in one transaction. Unchanged files are skipped and failed scans can retry. Matches without end events keep an unknown end time. Deletion markers prevent rescans from restoring removed matches. Queries return the full archive, with 50 matches per page and page navigation in the UI.

Database startup removes retired input-statistics tables and the obsolete collection setting. Saved navigation filters retired pages while preserving other preferences.

The archive separates its displayed account snapshot from the latest background
query. Match revisions update availability and queue a replacement; explicit
Refresh or a completed user action applies it. A request generation and the
current account ref reject older responses and prevent late actions from
reinstating another account. An explicit apply intent carries forward when a
newer background request supersedes that refresh. Account changes invalidate
the displayed snapshot, and removed selected accounts reconcile to All accounts.
Sorting is shared by both views and described in priority order. Stored page
state is reconciled after result shrinkage; pagination restores focus if its
focused control disappears. Add success retains the returned identity for a
direct detail action, independently of the current filters. Canceled deletion
is distinct from failure and does not trigger a list refresh.

List rows and grid cards render the same per-match action factory, including
account-scoped refresh, external navigation and reviewed history deletion.
Availability and deletion guards use the latest refs in both views. Grid summaries
retain the textual result, a machine-readable date (end time, then start time),
duration and explicit unknown states without fetching detail data.

Overview metric descriptions wrap or move below their values in small containers;
the recent win/loss sample remains visible alongside its percentage. Appearance
swatches always name Light and Dark, and the palette section explains individual,
pair-button and card-background scope. Pair actions keep the selected theme mode.
Destructive badges use a dedicated semantic text token mixed 80% from the state
color and 20% from the current foreground, keeping their translucent fill separate.
The shared Badge wrapper forwards accessible attributes to its shadcn primitive.

The shared dialog accepts an explicit opener for local dialogs that stay mounted
while closed. Its focus handler reads the current ref, retains the outer opener
through nested route dialogs and skips disconnected or disabled targets before
falling back to the workspace. Nested routes also capture serializable source action
keys and body/table scroll positions. Profile tabs and match account selection are
kept in their routes. Returning waits for the relevant profile, match and recording
links to settle, restores the original action and makes it visible, while suppressing
automatic tooltip opening. Trusted keyboard or pointer input during the wait cancels
late focus restoration. If the source disappeared, the active tab or dialog receives
focus and a visible status explains the changed context. Native workflow checks
exercise these paths with the production renderer and real IPC; controlled response
data remains separate from actual network or screen-reader evidence.

玩家报告区分总场次、已知胜负样本和最近一场指标；未知胜负不进入胜率分母。蛆指数校验双方各五名唯一玩家，同分共享平均名次；重试失败也计入报告请求数。刷新贯通报告与调查，兜底档案同样刷新并保存快照。对局先保存近期列表再补全详情，较旧 API 数据只能补缺。自定义局仅依据明确胜方字段判胜负，不使用摧毁分猜测。

录制有独立 token、sender、sequence 和写盘队列；逐片等待确认，停止等待尾片与落盘。时长取真实经过时间。播放器用短期 token 和 Range，不整文件跨 IPC。

Deck archives validate paths, extensions, CRCs, boundaries and capacity.
Compression and extraction use the asynchronous worker pool. Writes stage complete
bytes before publishing them; manual backup creation never replaces an existing
archive, while the managed previous-match archive can rotate intentionally.

Manual deck writes carry the directory originally displayed by the renderer.
Restore first creates a short-lived, single-use plan that records the archive
digest, destination identity and current target digests. The renderer presents
its full replacement scope before submitting the plan token. Execution rejects
changed sources or targets and creates a separate recovery archive before any
replacement. Partial deletion and restoration return completed, failed and
unattempted filenames; the renderer retains those outcomes and refreshes its list.
Automatic match-start backups retain one directory snapshot through enumeration,
file reads, archive creation and account attribution.

Shared shadcn primitives and the application Button, Card, Dialog, Menu, Field,
Toggle, Badge, and Stats wrappers centralize interaction rules. Radix manages
portals, keyboard behavior, and dialog focus restoration. Theme and glass tokens
live in `apps/web/src/styles/index.css`; layout, scrollbars, and responsive rules
live in `apps/web/src/styles/layout.css`. Card and full-size card choices share
`cardSurfaceClasses` rather than copying surface styles into feature pages. See
the [UI design system](../design-system/broken-arrow/MASTER.md) for the current
rules and deliberate exceptions.

## Optional anonymous analytics

The main process sends explicit Aptabase events after the user saves an enabled
analytics choice. Collection includes startup/first-open/version observations,
live match starts, selected feature results and durations, classified errors,
update outcomes, and foreground-active performance samples.

`analyticsEnabled` defaults to false; `analyticsChoiceSaved` records the consent
dialog decision. Development, fixtures, smoke tests, offline mode, and
`BA_DISABLE_ANALYTICS=1` disable collection.

The first-run dialog associates a concise Radix description with its full
keyboard-scrollable explanation. Its fixed footer keeps both choices visible
and initially focuses Decline. Busy choices use guarded `aria-disabled` controls
so focus survives pending and failed saves. A reserved footer row keeps the concise
save status visible. Failures are revealed at the top of the body, and View save
details transfers focus there without moving the choices. An attempted choice remains open
until that requested value is confirmed, including when an acknowledgement is
lost or the user reverses a failed choice. The shared autosave confirmation path
recovers an applied value without repeating a configuration write.

A random session exists only in memory and rotates after an idle hour, clock
rollback, UTC date change, restart, or opt-out. Game-account detection is independent
of analytics. App/OS versions and locale use Aptabase system properties; event
dimensions contain explicit feature names, results, durations, and public code positions.

At most 200 events queue in memory for five minutes, with three delivery attempts
and 20 events per request. Opt-out cancels requests and empties the queue. Shutdown
allows a bounded flush and discards the remainder. Resource samples require
foreground activity; long-task aggregates are also cleared on blur/hide.

Local app-version markers and pending update versions/stage support first-open,
version-change, and update-outcome events. `analytics:appVersion` and
`analytics:pendingUpdate` contain no session or user identifier. The update store
exposes only `load()` and `save()`.

See [anonymous analytics](analytics.md) for event definitions and counting limits.

## Reviewed account and match deletion

`accounts.planDelete` and `matches.planDelete` capture account records, match
contents, participant rows, account views and deletion versions. The returned
plan lists removed and retained matches, affected accounts and the recovery
filename. Plans are bounded to eight entries, expire after ten minutes and are
consumed once by the corresponding delete RPC. Scope fingerprints are checked
again after backup I/O inside the same SQLite transaction as deletion.

The history service writes a create-only JSON recovery file under the isolated
profile's `HistoryBackups` directory before changing records. Failure prevents
deletion; a rolled-back deletion removes the unused file. The committed registry
stores its SHA-256 version and remains available through `history.backups` after
restart. Recovery copies contain affected local account and match information
and remain on disk until the user removes them, as stated before confirmation.

`history.restore` checks the registered content version, original deletion
versions, missing identities and required account views before one atomic
restore. Account recovery recreates its original views on retained shared matches
without overwriting newer match facts. Recreated identities and later deletions
require another review rather than replacement. Restored entries remain listed
as restored and cannot execute twice.

Database deletion advances persisted account and match versions and records log/API deletion
markers. The tracker checks versions across network awaits, including failed
requests and analysis, so requests started before deletion cannot recreate it.
Automatic sync respects markers; deliberate Add clears the applicable markers
and advances the version. A sync interrupted by a history mutation discards its
older pending snapshot. The account UI uses request generations and match
revisions to reconcile concurrent results.

Account settings renders full wrapping names and contextual Delete names containing
the account name and ID. A completed deletion filters its confirmed target before
the following read, while authoritative account events invalidate older requests.
The deletion outcome and list-read failure remain separate. Account and recording
Refresh buttons retain focus and expose `aria-disabled`/`aria-busy` during reads;
their handlers guard duplicate requests. Account Retry transfers focus to the
persistent Refresh button before its transient error control disappears.

Local account, ban and recording reads distinguish unknown, failed, retained and
confirmed-empty state. Retained recording/account data is explicitly qualified
after a failed refresh. Recording directory changes invalidate the previous
directory's snapshot, count and storage. Local retries only reread the relevant
list: they do not synchronize bans, change recording preferences or repeat an
account deletion.

BansPanel separates the displayed order from the latest read snapshot. Background
reads reconcile encounter time, encountered state and observation qualification for
known IDs immediately, while queuing new identities, names, ratings and ordering.
A retained encountered-ID order appends newly eligible known members. View updates
adopts the authoritative order and resets the page; an explicit local reread also
applies its result. A generation guard excludes older responses, while a shared
apply intent survives a superseding background read. Filtering continues to use the
displayed source and current encounter facts. Pagination space and row borders stay
consistent across background changes.

SessionPanel uses useRosterSlots to retain committed per-team positions within a
room/match scope. Departed or transferred slots remain explicitly unavailable;
current players alone supply counts, averages, copy output and queries. New players
append, same-team rejoining reuses the ID, and Arrange roster explicitly compacts
vacancies. Scope changes reset the layout. Pointer activation captures the source
scope and slot key and rejects a click delivered after that context changed.

RosterIdentity composes the existing Radix Popover and named reading region. It
retains the complete source name, ID, team, statistics, freshness/membership qualification and
diagnostic, independently of later profile names. The profile trigger names the ID
and team and references the status text. Compact error summaries translate known
transport/parser/analysis failures without hiding their original diagnostic.
Stable row/status geometry and batch feedback after the grid preserve targets
through independent query events; ID, analysis and status text use an explicit
12px floor.

## Reviewed recording deletion

`config.update` saves auto-record preferences without stopping a current
capture. Enabling may start a live match from the current point; startup failure
is emitted as a separate capture outcome and does not reject the committed
preference. Existing starting/recording/stopping captures are preserved on
re-enable. The shared recording-preference hook serializes control changes and
keeps requested state, preference errors and subsequent capture-operation errors
separate across entry points.

`replays.stop` checks the reviewed capture session identity before invoking
the recording port and waits for completion. `replays.retry` accepts only an
enabled, failed capture with a monitored live match that has not ended and no
watcher error; overlapping retry requests are rejected. UI review offers Cancel,
finish-current and stop-now, and retry copy explicitly limits recovery to new
footage from now.

The controller reports structured start/capture/save failure and whether temporary
data was discarded. Failed cleanup or metadata callbacks after the finalized
video exists produce a saved-video warning instead of a lost-video error. That
warning identifies the saved filename and triggers library reconciliation. A
stale failure cannot overwrite a newer capture generation. Actual capture-source
and screen-reader behavior remain separate from controlled controller/IPC evidence.

Each capture freezes its requested audio sources independently of later settings
changes. The recorder reports system and microphone states separately through
the sandboxed preload, including source-specific gaps retained after recovery.
The controller validates source reports against the frozen request, checks the
sender and capture token, and prevents later reports from clearing an earlier
gap. Completion retains the final source snapshot beside the saved filename in
the current recording state; it is not a persisted per-file audio assessment.

Source monitoring observes ended/mute/unmute events and polls readyState,
enabled and mixer availability every 250 ms. A script-triggered track stop does
not fire ended, so polling is necessary; see the
[Media Capture and Streams specification](https://www.w3.org/TR/mediacapture-streams/#dom-mediastreamtrack-stop).
A source is reported as track available, not as confirmed audible content.

One mixed output track remains attached to MediaRecorder while missing inputs
are replaced. A zero-valued constant source clocks silent frames before inputs
become available. `replays.retryAudio` binds to the current capture token and
reconnects only affected requested sources, preserving video and healthy inputs.
The controller serializes retry, exposes pending state and a 30-second unconfirmed
deadline, and cancels it on stop, abort or capture failure. The recorder releases
late-granted streams after cancellation. Audio off requests neither input while
retaining the microphone preference; both settings forms explain that dependency
through a description associated with the switch.

`displays.preview` returns requested ID, effective source identity/label, selection
kind, thumbnail and display choices from one enumeration. Native display aliases
remain distinct from canonical capture IDs. Display preview and capture startup
share `selectDisplay`: an available explicit selection wins, then the display
nearest the pointer, then the first capturable source. Startup exposes its actual
target in RecordingState so a missing saved selection cannot silently masquerade
as an explicitly selected screen. This target is frozen for that capture.

The renderer's preview hook serializes refreshes per target and schedules the next
poll after settlement. Changing target invalidates its earlier response and image
while retaining last-known choices for further selection. Requested-ID validation
rejects a mislabelled response. Snapshot, enumeration error and image-decode error
remain separate from recording-test state; unsuccessful refreshes retain the
earlier enumeration error. Each successful snapshot reconciles choices in place
without changing the saved preference. The frame and caption have stable geometry;
long metadata scrolls locally and Refresh remains mounted and focusable while its
duplicate activations are blocked.
The settings toolbar exposes its save state and keeps all summaries on one
line, avoiding header-height changes when an overlapping display save completes.

Recording migration shares the file-operation queue with deletion. It copies
completed recordings into a private destination staging directory using exclusive
file creation, flushes writes and verifies SHA-256 content. Publication also uses
create-only operations, with an exclusive-copy fallback for filesystems without
hard links. Every source identity, directory, source membership and destination
digest is rechecked before the configured folder and initial outcome commit in
one SQLite transaction. Originals are removed only after the complete verified
destination library is selected. A later cleanup failure leaves an extra source
copy while the selected library remains complete.

Pre-cutover failures preserve all originals and roll back only still-owned target
copies. Changed targets are preserved and explicitly reported. The persisted
result identifies source, destination, selected library, verified copies,
remaining originals/copies and per-file failures. Both recording settings and the
library expose this result after discard, navigation or restart. Failed migration
does not persist the requested folder; retry or another destination starts from
the intact source. The application rejects overlapping folder changes and active
capture, and checks capture again before cutover. Shutdown awaits the tracked
migration request before closing SQLite.

`replays.list` returns the captured directory together with its recordings so a
list cannot silently become a command against a different configured folder.
`replays.planDelete` and `replays.planClean` freeze a directory, complete file
list, file identities and cleanup cutoff. Generated filenames provide recording
timestamps; older filenames fall back to explicitly labeled modification time.
Plans are bounded to eight entries, expire after ten minutes and execute once
through `replays.delete` or `replays.clean` with the returned token.

The file service serializes reviewed deletion and moves, rejects a changed
directory or directory identity before mutation, and checks each file identity.
Newly completed recordings are outside an existing plan. Per-file results report
completed, failed and already-absent names while continuing through the reviewed
scope. Metadata deletion precedes unlink; a metadata failure preserves the file,
and an unlink failure attempts to restore its previous metadata. Both deletion
handlers emit a library event after partial results, and the renderer refreshes
after all outcomes while retaining the result's original directory.

Automatic library updates preserve existing order and append new recordings;
manual Refresh sorts by recording time. Match dialogs independently load and
retry associated recordings, and update links after library or directory events.

## Temporary QUIC workaround

Added on 2026-10-16: the Electron main process calls
`app.commandLine.appendSwitch('disable-quic')` before the app becomes ready. This is a
temporary mitigation for observed BATrace HTTP/3 requests stalling after the QUIC
handshake, not a confirmed fix for the underlying network or Chromium issue. See
[Cloudflare's HTTP/3 troubleshooting guidance](https://developers.cloudflare.com/speed/optimization/protocol/troubleshooting/protocol-troubleshooting/#chrome-stalls-or-fails-only-on-http3).

The switch disables QUIC/HTTP/3 throughout the desktop application's Chromium network
sessions, including `net.fetch`. HTTPS continues over HTTP/2 or HTTP/1.1 with normal
DNS resolution, proxy handling and certificate validation. Request scheduling,
retries and health-check timing are separate concerns.

Revisit this workaround after Electron/Chromium updates or a confirmed network fix.
Remove the startup switch only after repeated BATrace requests succeed over verified
HTTP/3 using normal DNS, with the VPN both enabled and disabled. Capture a Chromium
NetLog to confirm HTTP/3 response headers arrive rather than silently falling back
to TCP, and compare against a TCP baseline. Run `pnpm check`, `pnpm format:check`,
`pnpm smoke` and `pnpm smoke:real` when removing the workaround.
