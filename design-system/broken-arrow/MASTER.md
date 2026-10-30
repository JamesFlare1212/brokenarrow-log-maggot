# BARadar UI design system

BARadar (断箭蛐工具) uses one React interface for Electron and the isolated browser
preview. This is the current design specification. It replaces the earlier flat
surface, Font Awesome, split-stylesheet, and oversized dark-shadow guidance.
The implementation files below are the source of token values and component APIs.

## Sources of truth

| Concern                                                                   | Implementation                                                                                                                   |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Theme primitives, semantic colors, glass tokens, typography, radius scale | [index.css](../../apps/web/src/styles/index.css)                                                                                 |
| Layout, responsive rules, scrollbars, reduced motion                      | [layout.css](../../apps/web/src/styles/layout.css)                                                                               |
| Shared glass surface and Card composition                                 | [card.tsx](../../apps/web/src/components/ui/card.tsx)                                                                            |
| Card choices and compact toggles                                          | [toggle.tsx](../../apps/web/src/components/ui/toggle.tsx), [toggle-group.tsx](../../apps/web/src/components/ui/toggle-group.tsx) |
| Application Card, Dialog, Field, Stats, and action wrappers               | [ui.tsx](../../apps/web/src/components/ui.tsx)                                                                                   |
| Appearance resolution and native caption colors                           | [useAppearance.ts](../../apps/web/src/hooks/useAppearance.ts)                                                                    |
| Mode, opacity, ELO colors, and palette controls                           | [AppearanceSettings.tsx](../../apps/web/src/features/settings/AppearanceSettings.tsx)                                            |
| Valid preferences, palettes, and opacity limits                           | [rpc.ts](../../packages/contracts/src/rpc.ts)                                                                                    |

## Visual direction

Use flat, theme-colored workspace and sidebar backgrounds with quiet glass cards
for persistent content. Cards have one uniform translucent fill, a fine border,
a small shadow, and a restrained backdrop blur. Text, icons, charts, and controls
remain fully opaque. Do not add gradients, sheen overlays, colored edge lighting,
or a second card solely to create padding around an existing card or option group.

Graphite is neutral in both light and dark modes. Other palettes tint the same
semantic roles. Success, warning, information, and error colors describe state;
selection and keyboard focus use the active theme's ring color.

## Tokens and glass parameters

The token chain is theme primitives (`--theme-*`), semantic roles (`--card`,
`--foreground`, `--ring`), and shared glass tokens. Components consume tokens;
feature pages arrange components without redefining their surface treatment.

| Token or property   | Light                                                               | Dark                                  |
| ------------------- | ------------------------------------------------------------------- | ------------------------------------- |
| Fill                | `color-mix(in srgb, var(--card) var(--glass-opacity), transparent)` | Same formula with the dark card color |
| Default opacity     | 50%                                                                 | 50%                                   |
| Border              | 1px; foreground mixed at 10%                                        | 1px; white at 8%                      |
| Backdrop blur       | 12px                                                                | 16px                                  |
| Backdrop saturation | 1.14                                                                | 1.08                                  |
| Outer shadow        | `0 1px 2px rgb(0 0 0 / 0.05)`                                       | `0 1px 2px rgb(0 0 0 / 0.16)`         |
| Card radius         | `--radius-xl`, currently 14px                                       | Same token                            |
| Card spacing        | 16px default; 12px for `size="sm"`                                  | Same sizes                            |

The base radius is `--radius: 0.625rem`; the radius scale lives in `@theme inline`.
Use component size variants rather than copying resolved pixel values into pages.
Use `--card-spacing` for a deliberate card density adjustment. Density changes do
not authorize a different border, radius, background, shadow, or blur.

Glass opacity ranges from 40% to 100% in 5% slider steps, with 50% as the default.
Previously saved integer values remain readable. `useAppearance` previews changes
and turns `--glass-blur` off at 100%, then restores the active mode's blur below
100%. Apply opacity to the mixed background color, never to the entire card.

## Shared Card and card choices

`cardSurfaceClasses` in `components/ui/card.tsx` defines the shared radius, border,
fill, foreground, shadow, blur, and saturation. Both `Card` and the Toggle
`card` variant reuse it. Keep these values in one place.

- Compose content cards with `CardHeader`, `CardTitle`, `CardDescription`,
  `CardAction`, `CardContent`, and `CardFooter` as needed. A visually hidden title
  is appropriate when the surrounding section already supplies the visible title.
- Use `size="sm"` for metrics. Layout classes may change width, grid placement,
  padding, or gaps. Do not override a card's surface with page-specific CSS.
- Use `ToggleGroup type="single" variant="card"` for full-size mutually exclusive
  card choices. Appearance mode and ELO color choices use this variant.
- A card choice keeps the glass fill during hover and selection. Hover may
  strengthen its neutral border. Selection uses `--appearance-selection`, an
  alias of `--ring` in Appearance. Focus adds the shared visible focus ring.
- Keep the border width constant between states. Expose selection through the
  primitive's radio/checked state; do not replace native interaction with a
  clickable `div` or nest buttons.
- Compact filters and view switches continue to use ordinary ToggleGroup
  variants. A two-option filter is not a glass content card.
- Palette-pair cards use the same glass surface. Their individual light/dark
  swatches show selection; selecting a pair must not change the theme mode.
  Keep Light/Dark labels and icons visible on every swatch, with selected rings
  and pressed state. Name the pair action in visible text and explain that the
  card background applies both palettes while each swatch changes only its mode.

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

<Card>
  <CardHeader>
    <CardTitle>Match summary</CardTitle>
  </CardHeader>
  <CardContent>{content}</CardContent>
</Card>;

<ToggleGroup type="single" variant="card" value={value} onValueChange={onChange}>
  <ToggleGroupItem value="first">First choice</ToggleGroupItem>
  <ToggleGroupItem value="second">Second choice</ToggleGroupItem>
</ToggleGroup>;
```

Use the application Card wrapper when collapsible headings or standard panel
actions are required. A list row inside a card uses `Item`, a separator, or plain
layout. A collection may contain separate cards for independently meaningful
items, such as recordings; do not add redundant glass wrappers around controls.

## Surface hierarchy and deliberate exceptions

| Surface                                                                     | Treatment and reason                                                                                                  |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Dashboard, room, player summary, deck, recording, cache, and settings cards | Shared glass Card                                                                                                     |
| Archive grid cards                                                          | Shared glass Card; custom content density is allowed, a separate radius is not                                        |
| Appearance mode and ELO choices                                             | Shared glass Toggle `card` variant                                                                                    |
| Workspace, sidebar, and titlebar                                            | Flat semantic background; keep navigation and native caption controls legible                                         |
| Dialog, alert dialog, sheet, popover, dropdown, tooltip, toast              | Existing overlay primitives and readable semantic fills; do not apply the adjustable content-card opacity             |
| Data-table frames, sticky headers, and profile tables                       | Solid semantic surfaces, clear borders, and independent scrolling; rows must not bleed through sticky labels          |
| Alerts and selected list rows                                               | Semantic feedback or muted fills; these communicate state within the surrounding layout                               |
| Inputs, sliders, switches, badges, and compact filters                      | Their shared control variants and semantic colors; do not add a glass layer to every control                          |
| Video frames, display previews, and the recorder canvas                     | Media-specific neutral or black fills preserve framing and playback contrast                                          |
| Theme wireframes and palette swatches                                       | Illustrations of palettes; decorative gradients and preview-specific edge effects are confined to these illustrations |
| Approved logo                                                               | Preserve the supplied image colors and white background                                                               |

An exception belongs to a surface role, not to a feature page. A new content card
must not opt out simply because another surface is solid. Add a justified role
here before introducing a new surface treatment.

## Appearance and semantic color

Theme mode is System, Light, or Dark. Each mode uses its saved palette from the
six palette pairs. Palette selection and mode selection are independent. Automatic
saving, live preview, Back navigation, and native caption colors must remain in
sync with the active preferences.

Use `--background`, `--foreground`, `--muted-foreground`, `--border`, `--input`,
`--primary`, `--ring`, and feedback tokens. Do not introduce raw page colors or
per-card light/dark overrides. Native select options use system Canvas colors;
overlay scrims and media canvases keep their purpose-specific treatment.

ELO changes use `eloChangeClass` with `--elo-increase` and `--elo-decrease`.
Positive changes include a plus sign, zero is neutral, and unavailable values
show an em dash. The saved green-up/red-up preference applies independently of
the result of the match. Feedback success/error colors retain their own meaning.

## Typography, icons, and motion

Use bundled Geist Variable with Segoe UI and Microsoft YaHei fallbacks. Body and
control typography follows the shared shadcn components; use tabular figures for
numerical comparisons. Keep long names and labels within their layout bounds.

Use `lucide-react` icons or the shared `Icon` adapter. Components own control icon
sizes; meaningful standalone graphics may specify contextual sizes. Decorative
icons use `aria-hidden`; icon-only controls need localized accessible names and
tooltips. Use `data-icon` for leading/trailing button icons.

Pending actions show a spinner or `animate-spin`, expose busy state, and reject
duplicate activation. Do not tie application state to animation completion.
The global reduced-motion rules preserve status, set transitions to zero, and
minimize animation duration. No Font Awesome package, icon-font stylesheet, or remote font is
required by the current interface.

## Composition and stable layout

- Overview has four equal summary columns, followed by a full-width room panel
  and the recent-results/tools grid. Summary details hide when their individual
  cards are too narrow; primary values stay on one line.
- Room panels reserve the standard responsive 5v5 height in empty, party, and
  match states. Pre-match parties reuse Alpha's presentation without modifying
  the underlying lobby member data. Keep player ELO and query results aligned.
- Overview and Radar retain their independent current/previous selection.
  Full match details and player details use the shared dialogs.
- Player refresh is an icon action in the dialog header immediately before
  Close. It stays available while the content scrolls and refreshes the profile
  and report together.
- Player report tables keep match ID, time and outcome at the leading edge and
  preserve every metric at all widths. Use one named, keyboard-focusable scroll
  region with a visible horizontal-scroll hint. Associate each detail button with
  its visible time and outcome. Never hide match actions through container queries.
  Profile record tabs reveal the complete focused label within their local scroll
  area, including its focus outline, without scrolling the surrounding dialog.
- ELO color options sit directly under their section heading. Do not restore
  the removed explanatory paragraph or an additional wrapper card.
- Quick tools keep their actions without an extra visible heading.
  Place the responsive shortcut/recording grid first in Overview, before account
  context, metrics, room rosters and recent results. Those asynchronous sections
  must not move a shortcut or recording-settings target during pointer press/release.
  Keep the recording summary at a fixed
  height and show capture, audio and display diagnostics in the existing shadcn
  Popover pattern. Error arrival, growth and clearing must not change the page
  height or move a shortcut during pointer press/release. A warning remains
  visible in the status label/icon and its live status; full details remain
  available through the named recording-status trigger.
- Archive filters and actions wrap as complete controls when space is limited.
  Inline FieldGroup wrappers must use content sizing rather than inline-size
  containment, which would collapse their intrinsic width and overlap neighbors.
- Settings categories are Appearance, General, Connection, Automation, Cache,
  Recording, Navigation, and Accounts.
  Use existing section headings, Field composition, shared actions, and automatic
  saving. Do not recreate Settings as a modal.
- Workspace and Settings reuse Sidebar and PageToolbar. Keep native caption
  space, the header separator, accessible navigation, and route scroll state.
  Sidebar footers reserve 16px of bottom padding so update actions sit clear
  of the window edge.

Use container queries when available space depends on a panel, not the viewport.
At the existing narrow breakpoints, metrics and teams may stack. Controls may
wrap instead of overflowing. Preserve keyboard access, scrollable long content,
dialog close controls, and readable table headers.

## Update feedback and guarded actions

Keep workspace-footer and General-settings update actions consistent. Portable
builds use Open downloads and explain downloading a new version, closing the app
and replacing it manually. Installed builds expose Retry download after failure
and Retry installation after an activity guard rejects an attempt.

Show the reason and next step beside a blocked action, without requiring hover.
Associate the visible status with the button through aria-describedby. Reserve
the sidebar feedback height, wrap diagnostic text and keep its named region
keyboard scrollable. Its primary status must remain readable in expanded desktop
sidebars and mobile drawers; closed or collapsed sidebars remain unavailable.
General settings also reserves its status region's height and keeps detailed
failures below the action row. Entering that row reveals its complete summary at
high zoom without replacing the focused action or shifting it as status changes.

Use aria-disabled to preserve the focused update control during work and known
activity blockers. Keep pointer events available so press intent can be recorded.
A press that began unavailable, or began with a different action, cannot activate
a newly available installation on release. Share pending state and reject duplicate
requests across both entry points. Never retry installation automatically.

Use one notification identity for an update attempt and its retries, replacing
obsolete errors with current progress and completion. Keep the focused control
clear of the notification even when status text changes its position. Preserve
full error details in the associated, scrollable feedback surface.

## Log monitoring and retained room information

Expose monitoring state visibly on every workspace page and settings category.
Reserve a fixed-width toolbar control so an error does not insert a banner or
move existing controls. Its status distinguishes an unreadable source, an
accessible empty folder, stale logs, historical reading and normal monitoring.
At narrow widths, hide the secondary product breadcrumb and keep the current
page and monitoring control readable on one toolbar row.
Use the existing compact save-status presentation in narrow Settings toolbars,
preserving its full accessible name and review popover; retain the text summary
at wider widths.
Preserve a polite accessible status as well as the visible summary. Announce
only the summary, so periodic detail timestamps do not repeat the whole
recovery panel through the live region. Retained
Radar information must say that it is the last known room when the source fails
or becomes stale. Explain that a saved auto-record preference waits for verified
logs and does not imply that capture has started.

Use the existing shadcn Popover for monitoring details: a named keyboard focus
target, vertically scrollable paths and errors, and stable footer actions for
Check again, Connection settings and Close. Retry ownership survives navigation;
guard duplicate activation without removing its focused button. Completion keeps
a meaningful focus target, and Escape returns to the status control. Rechecking
an accessible empty directory clears an obsolete access error; detecting the same
configured path reports its actual monitoring state.

Unreadable logs retain the current capture rather than discarding it. If the
verified source changes or disappears, save existing capture before considering
a new automatic start. New capture waits until the complete source has been
checked, preserving the current match identity. Source recovery must not turn a
known capture failure into an unbounded automatic retry.

## Settings save and recovery

Overview archive snapshots belong to the match revision that produced them.
Personal snapshots additionally belong to their account and account-metadata
context. Immediately withdraw invalidated rows and metrics before starting a
replacement read; a failed read must show unavailable statistics and retry instead
of actionable deleted records. Keep global and personal failures independent, and
reject late responses from older revisions. If invalidation or recovery removes
the focused history control, reveal and focus the account-context status unless
the user has already moved focus elsewhere. Only a confirmed empty snapshot may
show an empty archive or a zero count.

Long diagnostic paths must wrap within their local reading region. Complete
messages must remain available without horizontal clipping, including at 200%
zoom. Startup recovery and save-review details support keyboard scrolling to the
end and back to their actions. Overview recording details use a named, focusable
Popover region with a stable Close action; closing restores the status trigger,
and removing a focused diagnostic action transfers focus to the detail region.
Keep the same capture/audio/display recovery content used on the recording page.

Application-level owners retain general settings, recording drafts, migration
intent and automatic-recording preference outcomes across category changes,
workspace navigation and modal interruptions. Keep raw directory text separate
from scheduled writes; commit it on blur or an explicit flush, and clear it only
after confirmation or deliberate discard. A failed write must retain its exact
draft and recovery state after the form unmounts.

The save summary reflects every owner, prioritizing an unconfirmed outcome,
then errors, saving, pending edits and saved state. Reuse the same summary in Settings, the
workspace toolbar and recording-dialog header. Keep toolbar summaries on one
line in every state. Do not insert save failures above active page controls.

Use the existing shadcn Popover for save review: one explicit scope selector,
a named keyboard-scrollable detail region and a fixed action footer. Constrain
the panel to the available viewport. Long failures and changing status text must
not move Retry or Discard. Opening details preserves the underlying draft;
pending actions reject repeated activation and completion retains a meaningful
focus target before Escape restores the summary trigger.

Passive blur or unmount may flush new pending edits, but must not retry a failed
write. Retry is an explicit action. Discard operates on the selected scope and
must preserve independent failed edits and already-completed migration results.
The guarded Settings Back action waits for outstanding writes and offers Retry,
Keep editing or Discard after failure. History navigation retains pending/error
feedback in the workspace rather than reporting completion early.

After a rejected write acknowledgement, read the persisted configuration before
offering another write. If its versioned snapshot confirms the submitted fields,
finish successfully without repeating the mutation. Preserve newer pending edits
and reject older confirmation snapshots. If that read also fails, label the
outcome unconfirmed. Explicit retry first rereads the current configuration;
discarding local edits never rolls back a choice already applied by the service.
Passive blur or navigation must not retry an unconfirmed operation.

First-run analytics consent uses a fixed-height shadcn Dialog with an associated
concise description and a named keyboard-scrollable explanation. Keep both
choices in a fixed footer outside that scroll region. Initially focus the visible
Decline control. Preserve both controls' positions and the initiating focus through
saving, failure and retry; busy controls remain focusable and reject duplicates.
Keep a concise save status visible in a reserved footer row. Failure details are
revealed at the start of the scrollable body; an explicit View save details action
focuses that region without moving the choice controls.
All explanatory paragraphs remain available before either choice. Keep consent
open until the requested choice is confirmed; a different previously stored
choice does not complete a failed reversal. Retain the option to choose the
opposite value after failure, and preserve the final choice across reopening.

Directory suggestions belong to the field revision and discard generation that
started them. Manual edits, a newer request for that field, any application-scope
discard and Settings unmount invalidate older detection or picker responses,
including their failures. Invalidate at the start of discard, before awaiting an
active save. Independent field edits do not invalidate each other. Keep the
focused action mounted with a stable name, busy state and guarded repeat input.

Separate finding a log folder, confirming its saved path and verifying monitoring.
Before save confirmation, identify the path as unsaved; after a rejected save,
provide nearby failure guidance. Retry reconciles that message with the confirmed
path and actual watcher directory/status. Discard removes the suggestion feedback
and its input description. Do not report an old watcher's status for a new path.

The deck-folder input contains only the explicit draft. Empty means automatic
discovery; show the automatic candidate and its found/missing state in associated
helper text. A missing candidate is explanatory information rather than an input
value. Clearing and typing a replacement must never reinsert or concatenate the
candidate. Recheck automatic discovery after clearing a confirmed explicit path.

## Player search requests, identities and loading

An edited search can be submitted while another query is pending. The newest
submission owns the result, error and completion state; clearing invalidates
older renderer results. Duplicate activation of the current query is suppressed
without removing focus from the submit control. Name the active query, and
identify the previous query when retaining its results. Keep both its result
buttons and action menus usable under the same policy.

Service errors belong to the submitted search, independently from input
validation. A retry restores the failed query and moves focus to the visible
search field. The form hint remains the input's description after a service
error. Full errors and retained-query context remain available in the result
area. Keep room suggestions in a user-controlled Collapsible above the form. Its
trigger/count remain mounted; opening reserves a 12rem scrollable choice area,
including when the room empties. Incoming room changes cannot expand it or move
the query controls. Keep the results card
mounted in empty, pending, failed and completed states. The 30rem result card
reserves a 4rem scrollable query summary and a 7.5rem feedback area; the result
list scrolls independently. Long diagnostics scroll separately from the visible
Retry action. These footprints keep retained result targets and the report's
leading edge stable when response content changes.

Explicit player activation, including selecting the same player again, focuses
and reveals the visible report heading. A persistent return action restores the
originating room/result button, falling back to the search field if unavailable.
Later report results or failures preserve a newer focus choice.

Wrap full names in search results and report headings, including long unbroken
names. Show each room suggestion's complete ID and include the ID in every
player-action menu's accessible name. Preserve the full accessible name and
copied report data. Spinners beside localized loading text are decorative;
informative standalone spinners require a localized accessible label.

## Busy refresh actions

Keep deck, cache and radar actions mounted and focusable while busy. Expose their
unavailable and busy state and reject duplicate activation in the handler. Preserve
cache cleanup focus when counts reach zero; the unavailable action remains in the
tab sequence so the user can reach Refresh and review the resulting counts. Keep
one shared deck refresh entry point in a permanent toolbar above all directory
states. Keep its DOM identity and position through cold reads, missing directories,
failure and rediscovery. Use the deck cards' loading footprint for initial reads;
put asynchronous alerts and operation feedback after the lists and actions.
Deck file lists keep a 12rem scrollable viewport as files arrive or disappear,
so successful refreshes cannot move the existing operation controls either.
Every deck and backup row provides a named full-filename disclosure independent
of its selection checkbox. Use a shadcn Popover with wrapping text, viewport
bounds and a focusable reading target. Pointer and keyboard activation reveal the
complete identity before selection; Escape restores its trigger. Keep the selected
identities in backup and restore reviews.
Completing work must not take focus from a control the user chose in the meantime.

Error notifications must not cover the focused action. Choose the viewport side
with room around that control and bound the notification to that space. Keep long
messages scrollable with the keyboard and the close control inside their bounds.
Do not reposition a notification while the user focuses its contents.

Copy actions report localized unavailability when the clipboard interface or
write method is absent, and localized failure when access or writing throws or
rejects. Include the available diagnostic and a retry cue; show success only
after a completed write. Match, team, player-menu and report copying share this
behavior while retaining their existing data-availability guards.

Disabled tooltip wrappers support pointer hints without entering the tab order.
Expose the button's own name, disabled/busy state and any additional explanation
through its accessible description. Guarded `aria-disabled` actions keep their
native button and keyboard focus.

## Player report availability and recovery

Preserve the actual recovery button through loading, repeated failure, partial
results and success. After engagement, retain it as the corresponding analysis,
encounter or Maggot refresh action. Busy controls stay focusable, expose busy and
unavailable semantics, and guard duplicate activation. Keep the focused button and
its outline inside the nearest scroll viewport as content changes. If the user
leaves it, completing the request must not move focus or scroll back to it. Reset
engagement when the player or local encounter scope changes; retain the selected
record tab during account-scope changes. Keep the search report
content mounted when its first successful result adds a header and statistics.

Player search and profiles share one report per player. A successful refresh in
details updates the search report when the user returns. Preserve the last result
on failure, identify its source and timestamp, and distinguish a failed refresh
from a new successful result. A response from an older request or another player
must never replace the current view. Timestamp ties are insufficient evidence of
fresh recovery after a failure.

Profile dialogs keep their compact, single-line title, header actions and record
navigation outside the scrolling body. An always-present, named identity region
shows the complete current name, ID and differing launch name. It wraps text and
supports keyboard scrolling within a fixed-height area; the compact title alone
must not be the only way to discover identity. Historical names wrap within the
accordion, preserving their suffixes and dates at high zoom.

Keep record tabs in equal-width tracks independent of arriving counts. Horizontal
scrolling reveals the active tab at narrow widths. Preserve the selected panel
and scroll it into view when a user activates its tab. Reserve the summary and
recovery-action space above changing feedback. Loading/error content follows the
profile recovery controls, so another request cannot remove content above a
pressed retry. Before independent sections update, preserve the viewport position
of a visible focused/pressed body control or the current reading line; do not
restore it after the user changes focus.

Identify basic-data fallback and unavailable analysis explicitly. Keep usable
summary statistics and prior detailed sections, with their separate source times.
Show an unknown count for unavailable records, not zero. Pending requests and
failed sources have loading/retry states; only successfully obtained empty sections
use the empty-result messages. Match and map sections can have independent
availability. Retry for missing analysis requests fresh detailed data.

Keep prior Maggot scores and samples visible through failed recalculation, labelled
as the previous result with its completion time. Show the error and retry alongside
that result. Success replaces it across profiles and search. Failure cannot leave
a successful-cache TTL blocking ordinary recovery.

Returning to a profile waits for the current local profile and report requests,
including when cached report rows are already visible. Restore focus only after
the source action is confirmed in the resulting view. If it disappeared, use the
active tab or dialog and explain the changed context; intervening user input still
cancels delayed focus restoration.

## Startup and automatic-query recovery

A failed startup shows an explanation, diagnostic text and a keyboard-accessible
Retry startup action. Preserve that action's identity and label through pending and
repeated failure states, retaining the previous error with an explicit label. Bound
the recovery card to the viewport and allow its content to scroll at high zoom. Use
browser language before configuration loads, then restore the saved language. Return
focus to visible app content after an owned retry succeeds; do not reclaim moved focus.

Failed automatic room queries identify the affected count and one retry scheduled
five seconds later. Keep manual Refresh players available during that wait; it cancels
the scheduled attempt. Show retry progress while preserving successful players, then
keep an explicit manual recovery cue if failures remain. Cancellation and room changes
must not leave an obsolete scheduled-retry cue. Preserve singular/plural English copy.

## Cache cleanup outcomes and statistics freshness

Retain cache operation progress, errors and confirmed removal counts across settings
navigation. Keep the action label and DOM identity stable while pending, expose busy
and unavailable states, and prevent duplicate reads or cleanups. All-cache cleanup
continues to require confirmation.

An unsuccessful cleanup response does not establish whether deletion occurred. Explain
that the outcome and removal count are unknown, then reload statistics without
repeating deletion. If that read fails, label retained counts as an outdated snapshot
and require Refresh before another cleanup. After successful reconciliation, display
current counts while preserving the unconfirmed removal count. Do not claim zero
removed entries for a lost response.

Show the observation time alongside cache statistics. Schedule a refresh at the next
known expiry or after thirty seconds, whichever comes first, and on window return. Update
cleanup eligibility from the new snapshot, preserving strict snapshot-age boundaries
and inclusive API expiry. Stop automatic retries after a failed statistics read and
keep the explicit Refresh action available.
Render cache statistics, both category summaries and the size explanation from
the first frame. Use shadcn Skeleton values while reading, and unknown values
after an initial failure. Reserve the observation-status and count footprints
without inventing zero counts. Place read failures after the cleanup card, keeping
its controls predictable through cold loading, retained reads, failure and retry.

## Connection check feedback

Show the actual health result next to the Connection check action: unknown, available,
partially available or unavailable. Include the result time and an expandable list of
endpoint diagnostics. Do not substitute a generic completion toast for service state.

A failed request retains the last known result and check time, while the persistent
workspace trigger identifies the failed attempt. Display the attempt time, error and
retry action in both entry points. Pending and failed states survive navigation, and
duplicate activations join the same operation. A newer health event cannot be replaced
by an older returned result.

Keep the check action above dynamic result/error content, retain its label and DOM
identity, and expose aria-busy plus aria-disabled while pending. At narrow widths keep
the workspace trigger as an icon with a complete accessible name and title. Distinct
shapes identify checking, failure and health state; color is supplementary. The
diagnostic popover remains operable at high zoom.

## Radar query progress and freshness

Clear queried values when the current room identity changes, including a repeated
player in a different room. In a refresh of the same roster, retain completed values
while marking the players still awaiting results and showing batch progress in a
status region. Keep the existing refresh action focused and busy until completion.

Show stale cache timestamps and retained-result timestamps as readable wrapping text
on the player card; reference that text from the player action's accessible
description. Identify team averages that include cached or pending retained values,
and include freshness labels in copied ratings. Match-starting ELO remains explicitly
labelled. These hints remain available when the user scrolls at high zoom.

Overview and Radar apply the same previous-match response guard and automatically
query a changed displayed match. Keep their existing independent view selection.

Live roster slots retain their position within a team for the current room/match.
An arrival appends a new slot; a departure or transfer leaves an explicitly
unavailable slot, with no current rating and no contribution to counts, averages
or copied members. Rejoining the same team reuses the player's slot. Arrange roster
removes vacancies only after the user's explicit action. A new room/match scope
resets slots and cancels a held profile activation from the old scope.

Keep roster rows and their status space stable while data loads or fails. Put
batch feedback after the grid. Use 12px metadata and reserve two wrapping status
lines; full identity, statistics, qualification and diagnostics remain available in a bounded,
keyboard-scrollable Popover. Its visible trigger is separate from opening a
profile. Preserve the roster name even when the profile has a newer name. Each
profile action includes the complete player ID and team, so same-name players are
distinct. Show localized failure/retry explanations and keep technical details,
including HTTP status, in the identity reading area.

## Unknown metrics and copied values

Use an em dash for unavailable percentages, including category/map values and copied
summaries. Append `%` only to an available measurement; preserve `0%` as a measured
zero. Do not infer zero wins or losses from an absent field. If either outcome count
is missing, show the rate and sample as unknown, explain the incomplete totals and
keep an explicit refresh action available. Preserve valid complete and zero-count
controls.

Copied team ratings must agree with the values displayed for the same players.
Identify match-starting ELO when it supplies a fallback, and keep an unavailable ELO
unknown. Team averages require every included rating. Overview's latest ELO belongs
to the latest completed match; show an unavailable value when that match has no ELO,
rather than silently substituting an older rating.

## Localized names and counts

Visible labels and accessible names use the selected language consistently. The
Chinese glass control is “玻璃不透明度”; higher values still mean a more opaque
surface, and its slider keeps the same percentage value. Keep BATrace and other
product names intact in localized cache warnings. Preserve unrelated diagnostic
details and remove obsolete cache warnings after fresh data becomes available.

Use singular English count forms for one and plural forms for zero or multiple
items. Treat wins and losses independently. Apply these rules to search results,
account matches, cache entries/removals, player groups and other count messages;
retain the original Chinese units and readable number formatting.

Spectator and unknown-team headings, captions, copy names and recording fallbacks
must agree across Radar, match details, archive cards and recording lists. Preserve
Alpha/Bravo identifiers. Navigation preferences must name Overview consistently
with the workspace; the stored page key remains `current`.

## Single-selection and playback controls

Single-selection segmented controls expose radio semantics. Direction keys move
focus and apply the option together, including reverse and wrap navigation. Tab
returns to the selected option. Space on the selected option keeps it selected.
Use the shared RadioGroup-backed ToggleGroup for filters, view modes, playback
speed, theme mode and ELO colors; preserve its existing default, outline and card
appearance. Palette mode swatches remain independent toggle buttons.

Keep the playback recovery action focusable and stable while obtaining a new URL.
Show one current loading/error result, ignore obsolete source errors during the
request, and retain a meaningful Refresh action after recovery if the user has
engaged it. Restore playback position, speed and play/pause state when media can
be decoded again. A failed request retains its retry action and a new error;
completing a request must not take focus from a control the user subsequently chose.

An open playback dialog retains access across long pauses and viewing sessions.
Release its access when the dialog closes or its document ends. Resource limits
must explain recovery without invalidating another active player.

Fixture tools offer a compact launcher with a visible dismissal control and an
accessible explanation that reloading restores it. After scene switching, restore
the committed option when focus was lost; preserve a deliberate later focus move.
After dismissal, return focus to the application. Single-selection keyboard
behavior also applies inside the development tool shadow boundary.

Startup failures expose a named main landmark, heading, alert and localized
recovery guidance. Sliders announce the displayed unit along with their current
value; recording bitrate uses Mbps in both settings presentations.

In system forced colors, keyboard focus uses a two-pixel system Highlight outline
with a two-pixel offset, independent of shadow rings. An input-group control marks
its enclosing group; embedded action buttons retain their own outline as well.

## Sidebar navigation and settings order

Collapsing an off-canvas sidebar must move its focused item to the visible toggle
for that sidebar. Preserve focus elsewhere. Scope shortcuts to their provider,
respect handled events, and reject held-key repeats and unrelated modifier chords.

Record the drawer's actual opener, preserve it through a quick reopen, and return
there after Close, Escape or an exposed backdrop click. After explicit navigation,
focus the selected page or category content instead. Closing and resize callbacks
must not take focus from another control or modal chosen in the meantime.

Keep the settings drawer open during arrow-key category browsing, including wrapping
and Home/End. Pointer activation, Space and Enter commit the focused category. Keep
the moved navigation row's action available in the tab sequence at an order boundary,
expose its unavailable direction and reject further movement in that direction.
Buttons with `aria-disabled` mute their icons without dimming the focus outline.
Preserve focus through actual row movement, animation, reduced motion and saving;
leave room for the focused control's outline in scroll viewports.

## Account perspectives and nested navigation

Overview personal metrics and recent matches share one explicitly named account
and full ID. Label the archive count as covering all accounts. An unidentified
current account needs its own explanation and an archive action, rather than an
empty-history claim. Hide the prior account's rows and metrics immediately on a
switch and reject late responses from another account.
Keep the win/loss sample visible with the percentage at supported widths and
zooms. Wrap descriptions or place them below the value rather than hiding them.

Carry the displayed account ID from archive list/grid and encounter links into
match details, including refresh and local fallback. Identify the current detail
perspective and allow an explicit choice of stored accounts or the saved archive
view. A participant without a stored account remains a read-only perspective;
viewing it cannot create a local identity. Do not substitute another account when
the requested perspective lacks roster or saved-view evidence.

Combined encounters identify the owning account and full ID on every row. A shared
game may appear for multiple accounts; explain that summaries count account views.
Keep imported records without an owner explicitly unattributed in combined mode;
single-account mode explains their exclusion. Refresh an open profile when the
session account, association setting or committed account membership changes.
Never display an older scope's result or error under the new account.

Returning from a nested dialog preserves the profile tab, match account choice,
source action and body/table scroll. Wait for the source data and recording links
to settle before restoring focus, and make the restored action visible. Cancel
delayed focus restoration if the user continues with keyboard or pointer input.
Programmatic return focus must not automatically open a tooltip. If the source
action disappeared, focus the current tab or dialog and explain the changed context
with a visible status. This applies to alert → profile, match → profile/replay and
profile → match paths.

## Encounter identity and locally saved details

Show the complete match reference beside each encounter map, including when its
end time or result is unknown. Wrap long references within a readable identity
column; retain their full text. Name each detail action with its map and reference,
and associate account, relation, outcome and end-time context. Distinguish a missing
end time explicitly. Keep the native table semantics and a visible horizontal
scroll hint. One named, focusable region owns horizontal scrolling; Left/Right
acts on that region without intercepting keys from its child actions.

Opening a local or migrated record displays the facts saved on this device.
Identify the local view and last record update, and label its action Reload local
record. The full key belongs in the scrollable body and associated description,
where it cannot overlap header controls. Reload keeps focus, prevents duplicate
work and never starts an online query. Missing records show a localized recovery
message; retained last-read details must be qualified visibly.

Offer Open BATrace only for a known numeric online destination. A local lookup key
may already have such an ID in its stored record; use that ID without turning a
local reload into an online request. Keep the selected account, encounter tab and
available source action when returning, including the region's real scroll state.

## Encounter evidence and legacy observations

Online lookup history is independent from encounters. Search, cached results,
late responses and viewing an unrelated remote match cannot create encounter
times or a claim that the player was met. Retain useful names and lookup aliases
for later local search. Distinguish an unknown encounter time from the absence
of encounter evidence; never display the HTTP fetch time as a game encounter.

Older observations without supporting match or log records remain available
with an explicit unverified qualifier. Keep them in All bans and preserve their
original metadata, while excluding them from the encountered filter and new-ban
alerts. Explain the qualification in profiles and retain known aliases. A new
genuine observation removes the qualification and updates the current filtered
list without a filter toggle or remote sync. Keep positive new-ban notifications
for players with actual encounter evidence.

Publish committed local changes and preserve the selected filter and query.
When reloading fails, distinguish retained records or an unknown source from an
empty result. Keep recovery available, and move inline retry focus to the stable
list before replacing the action with loading content. Use the existing status
popover for persistent failure details and local reload actions. Legacy
qualifications must remain readable with keyboard scrolling at supported zooms.

## Deferred ban alerts

The bans toolbar reserves a fixed-width synchronization summary using the
existing Button and Popover primitives. Keep its geometry stable across idle,
pending, successful, failed and local-read states. Retain the remote outcome
and successful timestamp across navigation and application restarts. A local
read failure must identify retained records or an unknown source; provide a
local reload separately from remote synchronization. Put full error details
in a named scrollable body with reachable footer actions. Announce the short
summary separately from the popover so timestamps and details are not repeatedly
announced. Keep synchronization buttons focusable while busy and suppress
duplicate activation.

Search and encountered-player filters apply immediately to the complete local
ban snapshot, including during synchronization and failed reloads. Distinguish
an empty saved source, no encountered players and no query matches. Clearing a
query returns focus to its input; switching an empty encountered filter returns
focus to All bans. Initial read failure offers a local retry and does not assert
that the source is empty. Measure fully fitting rows when adapting page size,
preserve the focused or first visible record as an anchor, and move a focused
current-page link to the new current page after resizing. Explicit navigation
and filter changes still reset list scrolling.

All synchronization entry points queue new rows and ordering changes behind the persistent View
updates action instead of replacing a pointer target. Applying updates or explicitly
rereading the local list adopts the latest order. Preserve a user's reread intent
when a newer background read supersedes it, and reject late older results.
Known players' encounter facts still update immediately. Newly eligible encountered
rows append after the existing filtered order until updates are applied; they do
not push an existing target downward. Reserve encounter-time and pagination space,
and keep the final-row border consistent as a second row arrives. The sync detail
Popover identifies the displayed order's read time and any waiting update.

Persist unread alert batches separately from the current dialog route. A new
notification must not replace an investigation, recording form, playing video,
confirmation or other active overlay. Defer automatic presentation until the
workspace is available and the privacy choice has been saved. Preserve FIFO
order; closing or acknowledging one batch must never consume another batch.

Reserve a fixed-size inbox control in workspace and dialog headers. Show its
unread count without moving existing controls. Use the existing shadcn Popover
to read and acknowledge a queued batch in place while the underlying task stays
mounted. Keep details keyboard-scrollable and actions in a fixed footer.
Acknowledgement failures retain the batch and offer an explicit retry. Repeated
activation during a pending request must not consume a later batch. After
completion, preserve a meaningful focus target and return focus to the header
control when review closes, including inside destructive confirmations.

Alert rows use a flexible identity column and an intrinsic action column. Wrap
full names and show each player's complete ID beside the ban status. Investigation
actions include the name and ID in their accessible names and reference the
visible identity. Use the existing shadcn Button directly here: the full identity
is already visible, and an automatically generated long tooltip can obscure
other actions during keyboard traversal. Keep all focused actions fully visible
inside the vertical dialog scroller at supported zoom levels.

Notification review preserves the active video's position, selected speed and
playing or paused state. Keep the video stage and speed controls from shrinking
into each other; the surrounding dialog body owns vertical scrolling at high zoom.

## File-operation decisions

Auto-record preferences and capture outcomes are separate. Disabling automatic
recording preserves the current capture by default. When capture is active, the
shared control reviews its map and match ID before offering Cancel, disable
future recordings while finishing this capture, or disable and stop this capture
now. Explain the unrecorded remainder and the possibility of no saved footage
when capture is still starting. Bind Stop to the reviewed capture identity and
reject a changed capture. Re-enabling must preserve a capture already allowed to
finish. All recording/settings entry points share pending and error state;
pending switches show the requested value and reject duplicate activation.

A saved preference must remain saved when capture startup or saving fails. Show
capture failure independently in recording settings, the library page and Overview.
Distinguish startup, capture/save failure, discarded temporary data and a finalized
video with incomplete cleanup or metadata. Explain that preference retry cannot
recover footage. An explicit Restart from now action is available only for a live,
still-running match without a watcher error; it cannot restore missed footage.
Do not label a failed response as proof that a preference or stop never happened.

Account and archived-match deletion identify every affected account, the complete
removed and retained match lists, and the local recovery path before confirmation.
Use a single-use reviewed scope and reject changed account membership, views or
match contents before mutation. Prevent overlapping destructive actions and ignore
stale account-list responses. Account rows accept committed account snapshots as well
as match revisions, including first identification and rediscovery after deletion.
Explain that deleting local history does not change the game account and logs can
recreate an identified account.

Account names wrap completely inside their row, including unbroken names with a
shared prefix. Keep the account ID visible and include the complete name and ID
in each Delete button's accessible name. The reviewed confirmation describes the
same target; Cancel and Escape return to the corresponding surviving control.

An unread account, ban or recording list is unknown until a successful read.
Show loading or a local read error instead of confirmed-empty copy or a zero
count. A failed same-context refresh may retain the last confirmed list with an
explicit stale-read explanation. A changed recording directory withdraws the old
rows and totals. Offer read-only recovery independently of ban synchronization,
recording preferences and deletion. Keep account and recording Refresh controls
focusable while busy, reject repeated activation, and move account Retry focus
to the persistent Refresh control before clearing its error. A confirmed account
deletion removes that row even if the subsequent list read fails; read failure
must not invite another deletion of the completed target.

Save a complete local recovery copy before deletion and stop if it cannot be
saved. Explain that the copy includes local account and match information and
remains until the user removes it. Expose recovery from both account settings and
the archive, including after restart. Restore original account views while
preserving newer retained match facts; reject recreated identities, later
deletions and changed recovery files. Keep failed restore feedback
visible without discarding the recovery entry.
After recovery disables its completed action, focus its result so keyboard
navigation remains inside the recovery dialog.

Deletion must remain effective after older network requests finish. Automatic
sync and log imports honor deletion markers; a deliberate Add or recovery action
may restore the record. Capture the initiating control before asynchronous scope
loading and return focus to it after cancellation once controls become enabled.

Manual deck backups preserve existing archives. Suggest an unused name and reject
collisions at the file write, including when the listing became stale. The
automatic previous-match archive remains an explicitly managed rotating backup.

Backup dialogs identify whether all or selected decks are included and expose
the complete submitted file list. Validate backup names with a persistent,
localized field error. Keep the submitted name and contents fixed while saving;
show the pending state and prevent dismissal until the operation finishes.
After failure, retain the draft and selected files so the user can correct the
name or retry. A dismissed dialog must never imply an in-progress write stopped.

Before restoring a deck archive, show its source, destination, complete file
list and existing files that will be replaced. Bind confirmation to that archive
version and the reviewed destination contents. Reject a changed directory,
archive or target before continuing. Save the replaced files in a separate
recovery archive before writing any replacement, and identify that archive in
the result so users can restore their earlier decks.

After a partial file operation, keep completed, failed and unattempted filenames
visible and refresh the actual list on both success and failure. Reconcile
selections against the refreshed files, clear them on directory changes, and
preserve unrelated valid selections. Pending operations disable conflicting
file choices and folder actions instead of silently ignoring enabled controls.

Account-switch notices refer to the backup's directory, version and account
ownership. Clear or reject notices after another account switch or automatic
backup; account-switch restore uses the same reviewed restore confirmation.

Shared confirmations keep Cancel and Confirm visible within the viewport,
including at high zoom. Put long headings, explanations and targets in a named,
keyboard-focusable scroll region. Associate the target details with the dialog
description while preserving the primitive's own description reference and safe
initial Cancel focus.

Recording deletion and cleanup first show the actual directory, complete target
list, count and date basis. Generated filenames supply the recording timestamp;
legacy files explicitly use file modification time. Execute a short-lived,
single-use reviewed plan and reject directory or file identity changes. Files
completed after review are excluded. Serialize destructive operations and disable
conflicting controls until their results settle.

Report completed, failed and already-absent recordings separately. Preserve a
recording when its metadata cannot be deleted, restore metadata after an unlink
failure, and refresh the actual library after every outcome. Keep the result's
original directory visible even if the current directory has changed.

Automatic recording-library updates retain the order of existing recordings and
append new items. Manual Refresh explicitly restores timestamp order. Playback
and action names identify the map, uploader, precise timestamp and file. Match
details distinguish recordings by timestamp and duration, refresh their links on
library changes, and expose recording-list errors with an independent Retry.
Opening recording setup never enables capture by itself. Recording failures use
an explicit failed status in the library and overview.

Display preview responses identify the requested display, effective source,
selection policy and currently available choices together. Automatic preview and
capture share the pointer-first selection policy; explain that it is evaluated
again when the next capture starts. Keep an unavailable saved ID visible as an
unavailable choice until the user explicitly selects Automatic or another source.
Recognize saved native display aliases without rewriting the preference. Expose
the actual fallback source when recording starts, separately from next-capture
settings.

Hide an old target's image immediately on a display change. Keep earlier choices
available during the request, reject stale or incorrectly labelled responses and
poll serially after requests settle. Retain an enumeration error until a display
refresh succeeds, independently of recording-test errors. Put the error and
Refresh beside the selector; retain Refresh focus while it is busy.

Use a fixed 16:9 preview frame with contained, uncropped images. Reserve the
caption footprint and keep long status/error text in its named scroll region,
with Refresh in a stable footer. Top-align adjacent sliders. Loading, portrait
images, errors and device-list updates must not move an active slider or its
original pointer target at supported widths and zooms.
Toolbar save summaries stay on one line so a pending-to-saved response
cannot resize the header while a preview or slider interaction is in flight.
The automatic option in both languages describes the preferred screen under the
pointer; its adjacent policy states that the next capture resolves the selection
at start. Do not imply that automatic mode locates the game window.

Recording audio feedback distinguishes requested system and microphone inputs.
Show each source as not requested, connecting, track available, unavailable,
interrupted or ended. A live mixed output never proves both inputs are present.
Retain each source's earlier gap after recovery and identify the saved file when
the completed capture had missing audio. Track availability does not guarantee
audible content. Use the shared feedback in Recording, Overview and both settings
forms; avoid a redundant settings action inside the settings form itself.

Retry missing audio reconnects only affected requested sources while video and
healthy inputs continue. Keep one encoded audio track so reconnecting inputs
does not restart the encoder or discard the video. Bind retry to the current
capture, show its pending state across entry points, reject duplicate requests
and explain an unconfirmed timeout. State that earlier missing audio cannot be
restored, including after a successful reconnection.

Audio off disables system and microphone capture while retaining the microphone
preference. Put the effective behavior and preference-restoration explanation
beside the disabled microphone switch and associate it with the switch's
description. Changes apply to the next capture; show the active capture's
effective source state separately.

## Accessibility and validation

Recording folder migration preserves the complete original library until every
completed recording is copied, verified and the destination is selected. Existing
destination files are never replaced. Failed staging or cutover keeps originals
available; a source-cleanup failure keeps the complete destination selected and
reports extra old copies. Reject migration while capture is starting, recording
or saving and recheck before selecting the destination.

Persist the migration outcome and show it in both settings and the recording
library, including after Discard or restart. Identify source, destination and the
library selected when the operation ended. Use the shared shadcn accordion to
expose complete verified/retained filenames and per-file reasons. Explain that
Discard only abandons settings and does not remove leftover copies. A failed
migration offers Retry and another folder without silently hiding originals.
Successful folder saving and incomplete old-copy cleanup remain separate outcomes.

Archive background events queue a new snapshot without changing the displayed
order, page or connected row controls. Reserve the update badge's width and show
a persistent explanation that Refresh applies pending changes. Immediately
disable actions for records absent from the latest snapshot. Account changes
clear the previous account's rows while loading; failures offer an explicit retry.
Late action completions refresh the currently selected account. Removing the
selected account resets the selector and query together to All accounts.

Both archive views expose the primary sort and its direction, plus an ordered
summary of every active sort. Table headers show precedence and describe the
same summary for keyboard users. Persist a clamped page when results shrink;
restore focus to the current page or results viewport if pagination disappears.
Keep results scrollable when wrapped controls consume the available height.
Grid summaries show explicit result text, a labeled date and duration. Prefer the
end time, fall back to the start time, and name unknown time/duration explicitly.
Use a machine-readable `time` element for known dates. Both views share the same
discoverable per-match menu and reviewed deletion flow; unavailable rows retain
the latest availability guard. Keep the ELO delta separate from the result cue.

After adding a match, identify it and offer a direct Open action even if filters
or pagination hide its row. Keep those filters unchanged. Numeric validation
belongs to the input; service failures belong to separate retryable feedback.
Archive Add explicitly retains its initiating button for every dismissal path.
Detail dialogs retain the original available match button across background
events and nested navigation, with a visible workspace fallback if it is gone
or disabled.

Maintain accessible labels, visible focus, radio/pressed/busy state, disabled
behavior, and Radix focus trapping and restoration. Normal readable text should
meet 4.5:1 contrast against its composited background; essential focus and
selection boundaries should meet 3:1. Check glass against the actual underlying
surface in both appearances. Decorative card borders do not replace the focus
indicator or a control's accessible state.
Destructive badges consume `--destructive-text`, an 80% destructive / 20% foreground
OKLab mix, independently of their fill. Check the actual composited interior of
archive loss and service-unavailable badges in every palette, mode and opacity;
retain textual status cues and the other health-state colors.

Unrelated watcher, session and configuration updates must preserve existing
table controls, their focus and any open action menu. Keep context callbacks
used by memoized table-cell renderers stable instead of replacing those React
component types on every background event. Verify the same connected control
and menu through actual scheduled watcher polls, without an intervening list
reload.

Verify all six palettes in light and dark modes, opacity at 40%, 50%, and 100%,
hover/selected/focus states, a narrow viewport, long labels, and reduced motion.
Use native scrollbars with the shared layout rules; forced-colors mode keeps
operating-system rendering.

Run `pnpm check`, `pnpm format:check`, and `pnpm smoke` for implementation changes.
`pnpm check` includes `pnpm ui:check`, which inventories Card usage, rejects
feature-level surface overrides and retired card-choice variants, and checks
local documentation links. `pnpm ui:check --json` prints the detailed inventory.
Run `pnpm smoke:real` when actual fixture-backed rendering or data behavior is
affected. `pnpm format:check` includes this design-system directory. Check local
documentation links and keep the audit record current when changing the rules.
