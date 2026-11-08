# Glass card design audit

Date: 2026-10-27. Scope: the shared Electron/browser React interface for BARadar.
The [design system](../design-system/broken-arrow/MASTER.md) defines the current
standard; this record describes the component review and its verification.

## Source coverage

The inventory covers the renderer under `apps/web/src`, including shared
primitives, feature modules, stylesheets, Card construction sites, and full-size
card-choice groups. Retired feature surfaces have been removed from this scope.

The review covers Overview, Radar, Player Search and player details,
match archives and details, recordings and their settings, decks, bans, every
Settings category, development tools, and shared controls and overlays.

| Component family                                               | Result                                                                                              |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Dashboard metrics, rooms, and quick tools                      | Use the shared Card surface; stable roster height remains intact                                    |
| Player summary, preferences, and Maggot Index                  | Use shared Card/Stats composition; ELO changes retain semantic color preferences                    |
| Archive grid cards                                             | Removed the separate large-radius override; custom content spacing remains allowed                  |
| Recording, display configuration, deck, cache, and About cards | Use shared Card composition; media frames retain their framing surfaces                             |
| Appearance mode and ELO choices                                | Both use ToggleGroup `variant="card"` and `cardSurfaceClasses`                                      |
| Other toggles, inputs, slider, and switches                    | Retain control-specific variants; removed the hardcoded white slider thumb                          |
| Palette and mode previews                                      | Keep illustration-specific rendering; replaced hardcoded success/warning marks with semantic tokens |
| Tables and sticky headers                                      | Keep deliberate solid semantic fills for readable scrolling                                         |
| Dialogs, sheets, menus, tooltips, alerts, and toasts           | Keep their existing overlay/feedback surface roles, focus behavior, and readable semantic fills     |
| Navigation, titlebars, logo, and recorder canvas               | Retain their documented flat, brand, or media-specific surfaces                                     |

## Corrections

1. Rewrote the master specification around the actual glass tokens and shared
   primitives. Removed references to retired stylesheets, Font Awesome APIs,
   old graphite token names, large dark shadows, and superseded page geometry.
2. Migrated Appearance mode choices from the old solid `appearance` Toggle
   variant to the shared glass `card` variant. Removed the retired variant.
3. Removed the archive card's `--radius-3xl` override so its corners match the
   standard 14px Card radius.
4. Changed slider thumbs from `bg-white` to the semantic `bg-background` surface.
5. Changed the theme wireframe's success/warning marks from fixed colors to
   `--success` and `--warning`.
6. Updated architecture and documentation entry points, and included
   `design-system` in both formatting commands.
7. Added the repeatable `pnpm ui:check` guard to `pnpm check`.
8. Set reduced-motion transitions to zero rather than a small nonzero duration.
   Runtime checks found that pending transitions could retain earlier computed
   appearance values during rendering checks, including the 100% opacity case.

## Repeatable checks

Run `pnpm ui:check` for a concise result, or `pnpm ui:check --json` for the complete
source inventory. The guard parses JSX with the existing Prettier TypeScript
parser, inventories imported Card construction sites, checks direct surface
overrides and matching CSS selectors, rejects retired card-choice variants,
and validates local Markdown links in the root, `docs`, and `design-system`.

The static guard complements runtime and interaction checks. Solid table,
overlay, feedback, media, and illustration surfaces are intentional roles
listed in the master specification; matching a background declaration alone
does not make such a component a glass-card violation.

## Runtime evidence

A hidden Electron window loaded the isolated browser fixture interface and
switched to local demo data. Preference changes stayed in that demo scene.
Computed colors were composited over the actual workspace background before
calculating contrast.

| Check                                                   | Observed result                                              |
| ------------------------------------------------------- | ------------------------------------------------------------ |
| Six palettes × light/dark × 40%, 50%, and 100% opacity  | All 36 combinations passed                                   |
| Card and card-choice fill, radius, shadow, and backdrop | Matched across both card-choice groups                       |
| Card content opacity                                    | Remained fully opaque                                        |
| Opaque mode                                             | Blur disabled at 100% and restored below 100%                |
| Normal text contrast                                    | Minimum 14.73:1                                              |
| Muted text contrast                                     | Minimum 6.79:1                                               |
| Selected boundary contrast                              | Minimum 6.03:1                                               |
| Trusted keyboard navigation                             | Visible focus and focus ring passed                          |
| Reduced motion                                          | Transitions disabled and appearance values updated correctly |
| Responsive pages                                        | 13 routes at 1440px, 760px, and 375px: 39 checks passed      |
| Visible Card corners                                    | Consistent 14px radius on the inspected routes               |
| Page overflow                                           | None detected; table scrolling remains inside table surfaces |

The responsive routes are Overview, Radar, Player Search, Archives,
Recordings, Decks, Bans, Appearance, General, Connection, Automation, and Cache.
Archive and recording grids were opened so their individual cards were included.

## Archive toolbar follow-up

A preview annotation exposed overlap inside the archive toolbar. The earlier
page-boundary checks did not detect this internal collision. The inline switch's
FieldGroup retained inline-size containment while its width was automatic, so
it reserved 0px even though its label and switch occupied 124px.

Archive filter wrappers now use normal containment so their content contributes
to flex sizing. Filter and action groups stay within the available width and
wrap whole controls onto another row when needed. At the reported 780px toolbar
width, filters and actions occupy separate rows without collisions.

Follow-up runtime checks compared individual control bounds at 14 viewport
widths from 320px to 1440px, including sidebar and mobile breakpoints. All controls
remained inside the toolbar without overlap. Label clicks and Space activation
continued to toggle the filter. The design specification now records this
inline-field sizing requirement.

## Validation

- `pnpm check`: passed type checking, the UI design guard, 971 regression tests
  across 41 test files, and the web/server/desktop production builds.
- `pnpm format:check`: passed, including the design-system documentation.
- `pnpm smoke`: passed the isolated Electron initialization and window checks.
- `pnpm smoke:real`: passed with 454 offline recorded matches through the native
  bridge.
- The temporary fixture server used for runtime inspection was stopped after
  the checks. No live game data or application preferences were changed.

## Player loading layout follow-up

Date: 2026-10-30. Player details now render their final section structure while
profile, report, and Maggot Index requests are pending. Inline shadcn Skeleton
values replace the previous generic loading block. Combat preferences retain
their column, record tabs and table headers remain available, and cached values
stay visible during refresh. Missing data becomes an empty state only after its
request settles. The shared Skeleton uses a semantic foreground tint for visible
contrast on both light and dark cards.

A hidden Electron window rendered the actual profile components with controlled
offline fixture responses. The visual review covered 1440px dark Chinese,
1440px light English, 760px dark Chinese, and 375px light Chinese layouts. Each
scenario included initial loading, profile arrival, report arrival, completed
calculation, refresh, and recalculation. Section positions and widths remained
within 1px across the loading transitions. Dialog scrolling stayed contained,
refresh retained loaded values, and reduced-motion settings suppressed the
skeleton animation. No renderer errors were recorded.

Regression coverage exercises both response orders, pending encounter records,
copy availability, and the selected record tab during refresh. The offline UI
test waits for loaded rows because the table is now present before data arrives.

Validation for this follow-up: `pnpm check` passed type checking, the UI design
guard, 936 regression tests across 40 files, and production builds.
`pnpm format:check`, `pnpm smoke`, and `pnpm smoke:real` also passed; the real-data
smoke loaded 454 recorded matches offline. Initial test failures exposed two
outdated loading assertions and incomplete simulated pointer input for Radix
tabs. The assertions and input simulation were corrected, and the final full
test run passed without skipped tests.

## Cached preferences and encounter summary reservation

Date: 2026-10-30. A follow-up review of PR #16 reproduced two remaining layout
changes: cached profile preferences replaced the unit table and category list
with compact paragraphs before the full report arrived, and a nonempty encounter
response inserted its four-count summary above an existing table header.

Cached unit names and the cached category now fill their final table and list
slots. Metrics without a report retain shadcn Skeleton until the request settles;
missing metrics then use an em dash. Unit and category regions retain a minimum
of fifteen and seven rows of space respectively, including sparse, empty, and
failed results. Placeholder counts and minimum heights share the same row budgets.
Additional entries and wrapping names or values can grow beyond these minimums.
Unit columns and badge headers keep the same dimensions during loading.

Encounter records now render the four summary labels and value placeholders from
the start. Pending and loaded records share the same summary, table, headers,
column widths, and responsive grid. A confirmed empty result still uses the
existing empty state. The rules are recorded in the design system's
[asynchronous content specification](../design-system/broken-arrow/MASTER.md#asynchronous-content-and-reserved-space).

Regression coverage checks cached values while reports remain pending, successful
and failed reports in Chinese and English, both response orders for nonempty
encounters, and reports larger than the reserved row budgets. The existing tests
also cover empty encounters and refreshes that retain values and the active tab.

Hidden Electron windows measured 1440px, 760px, and 375px layouts with Chinese/light
and English/dark appearances and both response orders: twelve scenarios. Preference
region heights and the record section's offset below that region varied by at
most 1px; encounter header offsets and table column widths did not change. These
measurements isolate the preference region and encounter tab from unrelated
content above them, such as the ELO chart caption. No renderer errors or dialog
overflow were recorded. The initial combined harness run timed out after eight
scenarios; separate runs per width completed all twelve scenarios.

A separate 375px English/dark check loaded twenty units and nine categories with
long unit names and large numeric values. Both regions grew beyond their minimum
budgets, every entry remained available, and numeric cells and the dialog stayed
free of horizontal overflow.

Validation: `pnpm check` passed type checking, the UI design guard, 978 regression
tests across 42 files without skipped tests, and all production builds.
`pnpm format:check`, `pnpm smoke`, and `pnpm smoke:real` passed; the real-data smoke
loaded 454 recorded matches offline through the native bridge. `git diff --check`
also passed.

## Application-wide loading patterns

Date: 2026-10-30. The follow-up audit covered fourteen page groups and sixteen
views. Eleven groups needed changes; the fixed room layout, display-preview
frame, and unknown-layout startup fallback already used appropriate patterns.
The implementation now follows the shared
[asynchronous content specification](../design-system/broken-arrow/MASTER.md#asynchronous-content-and-reserved-space).

| Area                | Updated loading behavior                                                                                                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview            | Unknown metrics use value placeholders; three Item rows reserve recent matches. The known room count remains visible.                                                              |
| Player search       | Five Item rows reserve names, IDs, ratings, and actions inside the existing result scroll container.                                                                               |
| Player report       | The report shell, metrics, preferences, analysis, and detail sections mount immediately. Dependent analysis waits for the report; map details retain their collapsed presentation. |
| Match archive       | Eight-column Skeleton rows preserve the table header and alignment; grid placeholders use archive cards with team rosters. Unknown sample and pagination totals are placeholders.  |
| Ban tracking        | Five-column Skeleton rows replace the spanning generic loader.                                                                                                                     |
| Decks and backups   | Both file panels, paths, selection summaries, and disabled actions appear before discovery completes.                                                                              |
| Replay library      | Grid and list placeholders share the real thumbnail, title, metadata, and action slots. Unknown counts and storage sizes no longer display zero.                                   |
| Match details       | Summary labels and two five-player, twelve-column tables appear immediately with shared column widths.                                                                             |
| Replay playback     | A responsive 16:9 stage reserves space before metadata. Loading, retry, and failure feedback overlay that stage.                                                                   |
| Cache settings      | Three metrics and two category items remain mounted; values fill their existing slots.                                                                                             |
| Recognized accounts | An outlined Item reserves the account identity, summary, and action positions.                                                                                                     |

Shared row placeholders compose the existing shadcn Table, Item, and Skeleton
primitives. Standalone Spinner labels use the selected locale; decorative
spinners no longer create nested or duplicate loading announcements. Refreshes
retain available values and rows. A confirmed empty archive also remains empty
during a refresh and after a refresh failure instead of flashing placeholders.

The before/after comparison used the same offline development data and sixteen
views at 1440px, 760px, and 375px, with Chinese and English and both appearances:
96 scenarios. Every applicable refresh retained its data, pending table rows
matched their headers, and only the unknown-layout startup state retained the
generic loader. No unexpected RPC calls or renderer errors were recorded.
Thirty-three screenshots were captured on each side, including playback retry.
An additional column-width check found content-driven horizontal movement in
archive, ban, and recent-report tables. They now use fixed table layout with the
archive's existing column definitions and explicit rating, ID, and time widths.
Long player and map names can wrap inside their columns. All measured pending
and loaded column widths were identical in the final 96-scenario run.

The cache cleanup section previously shifted by 128.6px on desktop, 369.2px at
760px, and 410.2px or 431.2px on phones, depending on the locale. Its displacement
is now 0px in all six configurations. Replay-stage growth on initial load fell
from 417.3px on desktop and 196.1px at 760px to 0px. Retry previously added
143.1px, 164px, or 144.1px at the three widths; it now adds 0px. Deck-panel heights
and display-preview dimensions also stayed unchanged between waiting and loaded
states in this fixture set.

These measurements do not assert that every page has a fixed final height. The
report fixture has more recent results than its five-row initial budget: its
remaining growth is approximately 164px to 237px. Real rows, wrapping labels,
and larger result sets remain accessible and can exceed an initial reservation.
Reduced-motion emulation shortened Skeleton pulse duration from 2s to 0.00001s
without changing its background or radius.

Final validation: `pnpm check` passed type checking, the UI design guard, all
994 regression tests across 42 files without skipped tests, and production
builds. `pnpm smoke` and `pnpm smoke:real` passed; the latter loaded 454 recorded
matches offline through the native bridge. During development, a sandboxed
Vitest launch failed with `spawn EPERM`; the permitted elevated run succeeded.
Outdated generic-loader assertions and an assertion against a detached failed
search panel were corrected before the final passing run. A later full run hit
the real-corpus test's 10-second timeout and exposed an immediate assertion on
asynchronous analysis queueing. The assertion now waits for the queued state;
the final isolated `pnpm check` passed all 994 tests without changing the timeout.
One repeat Electron audit launch stalled before any scenario; a fresh isolated
profile completed the remaining run. Formatting and `git diff --check` also passed.

## Responsive navigation and compact preference follow-up

Date: 2026-11-05. The application-wide
[UI and interaction review](ui-ux-review.md) supersedes the earlier unconditional
fifteen-unit/seven-category reservation. The current design uses an adaptive unit
scrollport with a four-row minimum and a three-category preview, with explicit
access to every remaining entry. It also
retains match identity/actions at every width, strengthens authored scrollbars,
adds overflow hints, and unifies navigation state, labels, and compact pagination.
See that review record for iteration scores, screenshots, and current validation.

The subsequent screenshot-driven correction fills the height beside preferences
with additional real unit rows, removes the duplicate match-dialog toolbar, and
keeps player names and awards inline in equal-height collapsed rows. Shared notice, dialog and
navigation-label wrapping rules apply throughout the renderer. Its new browser,
native runtime and independent-review evidence are recorded separately from the
earlier passing round in the same review document.

The next whole-app Astra MAX review scored 8.8/10 and confirmed the inline rows
and compact unit footer. Its corrective pass combines Settings save owners,
stacks the recording-card action in narrow containers, strengthens information
badge contrast, and compacts settled empty Overview space. Fresh coverage includes
390 route cases, 28 state checks, and 72 composited contrast samples. The full
application check passes 1061 tests in 43 files; see the review record for current
smoke, formatting, independent scoring and native-runtime evidence.

The subsequent 8.9 review confirmed those fixes and found three further English
text-layout issues. Stable unit metric widths, container-aware room-summary rows,
and a consistent preview minimum now resolve them. The new localization pass adds
sibling text-intersection and ancestor-clipping checks to the 390-case matrix and
142 focused checks; see the same review record for current results and limits.

The final independent GPT-6 Astra MAX review reaches **9.1/10** and confirms those
three issues are resolved. The subsequent production Electron inspection passes
all 15 routes in both appearances at two native sizes: 60 route cases, four
additional English contexts, and the required report/dialog interactions with
496 recorded matches and zero renderer exceptions. The approved 44px scoreboard
rows and 28px unit footer remain intact. One nonblocking English storage-label
spacing issue remains. See the final section of the review record for evidence,
validation history, and the inspection's limits.

## Tailwind migration

Date: 2026-11-05. The existing Vite pipeline already uses Tailwind CSS v4. An
audit found approximately 3,100 lines of handwritten layout CSS, including
ordinary flex/grid structure, typography, spacing, table layouts, and responsive
rules. Those rules now live as Tailwind utilities beside their React markup.
The development panel's ordinary styling follows the same convention.

The small remaining stylesheets cover shared theme/calculated variables,
browser foundations, native Electron captions, scrollbars, Shadow DOM hosts,
forced colors, reduced motion, and the isolated recording document. Interaction
and audit class hooks remain available. The
[styling specification](../design-system/broken-arrow/MASTER.md#styling-implementation)
describes the boundary and the shadcn cascade considerations.

The main layout stylesheet decreased from **3,111 to 244 lines (92.2%)**; the
development stylesheet decreased from 60 to 20 lines. Theme definitions and the
isolated recorder stylesheet remain unchanged in this migration. This moves
ordinary styling into JSX utilities rather than retaining the old selectors with
`@apply` or introducing runtime styling infrastructure.

Migration evidence is isolated in `.test-data/css-migration`:

- The 180-case baseline covers all 15 pages, both languages and appearances, at
  1920, 900, and 320px. Rendered element structure and 54 computed properties
  match after migration. The only 24 property differences are widths of the live
  match-duration spans on Overview/Radar: elapsed text changed between captures,
  as confirmed by DOM inspection. Raw differences remain available separately
  from this classification.
- The refreshed all-page matrix passes 390 populated/empty route cases across
  both locales and appearances at 1920/1440/900/375/320px, with no detected text
  collisions, clipping, or renderer exceptions in its tested scopes.
- The focused run passes 142 grouped checks for unit headings, pending/loaded
  geometry, full data, keyboard scrolling, expansion/refresh, Copy controls, and
  recording preview states. Thirty additional real-data cases pass across five
  widths and both appearances, including 44px inline scoreboard rows, the 28px
  unit footer, one match-header Refresh action, and restored initiating focus.
- `gallery.html` was previewed and displayed inline with all 15 pages, both
  appearances, three representative widths, and a before/after switch.
- `pnpm check` passes **1061 tests in 43 files**, type checking, the UI guard,
  and all production builds, using the temporary supported
  `VITEST_MAX_WORKERS=2` setting and restoring the environment afterward.
- `pnpm format:check`, `git diff --check`, `pnpm smoke`, and `pnpm smoke:real`
  pass. Real-data smoke loads 496 matches and verifies native chrome, match
  navigation, disclosures, focus return, and responsive/contained tables.

The first full run passed 1055 tests and failed six assertions that expected
complete legacy class strings. The migration now removes duplicated status
utilities, uses the semantic destructive utility, and verifies status/ELO color
utilities and startup identity without requiring an entire class string. No
tests were skipped, added, or given longer timeouts. An initial formatter write
encountered a transient Windows file-open failure; the individual retry succeeded.
The separate independent review and production Electron inspection for this
migration are recorded when complete; earlier scores/native captures remain
historical evidence for their respective application versions.

### Independent migration findings and corrective pass

The independent Astra MAX migration review scored **8.2/10**, below the required
threshold. It found that the Dialog primitive's `sm:max-w-sm` overrode the
migrated desktop caps, reducing wide portals to 384px. It also reproduced a
1024px Overview where exclusive Tailwind layout queries disagreed with inclusive
row-budget queries, leaving 400px of unused roster space. The initial route-only
parity matrix excludes portals and exact breakpoint boundaries; its passing
measurements did not establish those aspects of parity. The original review and
evidence remain preserved in `.test-data/css-migration`.

The corrective pass supplies matching responsive maximums to profile, match,
recording, and replay dialogs. Named Tailwind `@custom-variant` definitions now
preserve all 16 original inclusive maximum-width conditions and their order.
Ordinary styling stays in JSX; no component selector stylesheet was restored.
At 1920px, the profile is again 1152px wide with 654px/436px analysis columns and
a 328px unit viewport. At the 1024px boundary, the room grid is one 676px column
and 776px tall inside the 889px layout, matching its ten-player reservation.

Fresh evidence lives in `.test-data/css-migration/fixes`:

- All 128 dialog cases pass: four portal types, eight viewport widths including
  639/640px and 767/768px, both languages, and both appearances. Actual width
  assertions use each dialog's intended cap; wide profiles must have two columns
  and a unit viewport of at least 320px.
- All 16 aliases match the original CSS queries in 74 checks, including exact
  endpoints and fractional container widths. Another 56 live Overview/Radar
  cases check grid columns, shared row budgets, padding, health visibility, and
  heading wrapping around 479/767px and the 1024px workspace boundary.
- The new route matrix passes 390 cases, the focused run passes 142 groups, and
  all 30 real-data cases pass with unconditional desktop portal and column
  assertions. No renderer exceptions were recorded.

The first fractional-width probe incorrectly compared native query evaluation
with a JavaScript numeric inequality. Chromium applies boundary rounding to the
original CSS query as well. The corrected probe compares against the unchanged
pre-migration CSS condition directly, checks integer endpoints independently,
and retains the fractional measurements. No application workaround was added.
Fresh `pnpm check` passes **1061 tests in 43 files**, type/UI checks, and all
production builds with the temporary supported two-worker setting restored
afterward. Formatting, diff whitespace, and both required smoke commands pass;
real smoke loads 496 recorded matches. The corrective gallery was previewed and
displayed inline. The next independent score and post-review production Electron
route inspection remain separate acceptance steps.

### Final migration acceptance

The fresh independent GPT-6 Astra MAX review scores the corrected migration
**9.2/10**, resolving P1/P2 and meeting the requested threshold. The report is
`.test-data/css-migration/fixes/astra-review.md`. No application edits followed
that passing review.

The production Electron renderer, sandboxed preload, and native SQLite service
then passed all **90 route cases**: all 15 pages in both appearances at requested
sizes 1920×1080, 1024×1000, and 900×600. Actual renderer sizes were 1920×1080,
1024×1000, and 900×601 under Windows scaling. Six additional English contexts
passed with explicit profile/match widths, profile/scoreboard column counts,
roster budget agreement, and report/room/preview text-bound checks. The scan
loaded **496 recorded matches**. Search return, expansion/refresh retention,
Enter/Escape drilldown, focus restoration, caption clearance, 44px player rows,
and the 28px unit footer passed with zero renderer exceptions. Six contact sheets
covering every native route case and individual wide profile, match, and 1024px
room captures were visually inspected.

The final native screenshot gallery was also previewed and displayed inline,
with every route and three English focus contexts selectable across both
appearances and all three native sizes.

The first native invocation completed the 90 layout cases and reached the
English interaction phase, then sampled the profile during its entrance animation
(1117.89px instead of its settled 1152px width). The harness now waits for root
dialog animations and two frames. A second interaction-only invocation passed
all six English contexts and the complete shared interaction sequence. This
readiness correction required no application edit. Both raw results and the
explicit combined provenance remain in
`.test-data/css-migration/fixes/electron/final-results.json` and its referenced
`layout-results.json` / `interaction-results.json` files. Both Electron instances
and the contact-sheet helper closed after inspection.

The final application check remains 1061 tests in 43 files, type/UI checks,
production builds, formatting, and both smoke commands as recorded above.
Completion changes only documentation/evidence. Packaged release artifacts,
recording hardware/codecs, and full screen-reader verification are outside this
acceptance. The previously acknowledged English storage-label spacing P3 remains
unchanged. No commit was created.

## Content-aware recent-match columns

Date: 2026-11-05. The new narrow-window screenshot shows excessive allocation
to Result and Destruction. Reproduction at 900px found an 800px profile viewport
containing a 1056px table. Result occupied 96px and Destruction 144px; a second
profile-specific width set also competed with the shared report rules.

`ReportMatchTable` now owns one column definition shared by embedded reports and
profile statistics. Intrinsic layout and container-relative minimums give short
results and numeric fields compact space, while English labels retain adequate
room. The timestamp absorbs remaining width. Numeric labels/values align right;
results align centrally. Profile wrappers no longer assign conflicting widths
or padding. Skeletons fill cells without imposing their own fixed widths, and
large values can grow the contained table. Sticky match identity, all nine
fields, keyboard scrolling, detail actions, and focus return remain available.

Current evidence is isolated in `.test-data/report-columns`:

- Sixteen baseline and 56 updated real-data table contexts cover both report
  placements, both languages/appearances, and 320–1920px. At 900px, the profile
  table fits its 800px viewport in both locales. Chinese Result is 64px and
  Destruction 88px, rather than 96px/144px. The embedded minimum falls from
  1048px to 744px in Chinese and 800px in English.
- Sixty-four focused checks cover equal pending/loaded widths, retained refresh
  geometry, unknown results, very large numeric values, a year-end timestamp,
  contained overflow, sticky identity,
  keyboard scrolling, drilldown, and focus return. No renderer exceptions or
  cell-content clipping were recorded. An initial harness assertion incorrectly
  demanded overflow even when the wide desktop fitted the stress data; it now
  requires that condition only at narrow widths. This needed no application fix.
- The refreshed whole-app matrix passes 390 route cases. The existing 142
  unit/header/preview groups also pass after removal of the broad report-table
  minimum, preserving the approved unit viewport/footer behavior.

The shared preview opened and rendered, but click and wait automation timed out
twice at the same selection step. The owned tab was closed and the established
local Chrome fallback completed the measurements. Final application validation,
independent Astra MAX score, and production Electron confirmation are recorded
after completion; preceding scores are historical results for their own versions.

Current `pnpm check` passes 1061 tests in 43 files, type/UI checks, and all
production builds with the supported temporary two-worker setting restored
afterward. Formatting, diff whitespace, and both desktop smoke commands pass;
real smoke loads 496 matches. The measured column-width comparisons and
before/after screenshots were previewed and displayed inline. These counts
predate the sidebar feature; its combined acceptance follows below.

## Resizable desktop sidebars

Date: 2026-11-05. Workspace and Settings now share a persisted sidebar width
between 200px and 400px, defaulting to 256px. The existing shadcn SidebarRail
provides pointer capture and a focusable vertical separator with localized
instructions and current/minimum/maximum values. Pointer movement previews
locally; only release writes the preference. Escape, pointer cancellation,
focus loss, collapse, mobile transitions, and viewport-width changes cancel a preview.
Keyboard steps, bounds, double-click reset, and Enter reset remain available.
Appearance settings adds the existing shadcn Slider and reset button, including
track-click adjustment without dragging.

The displayed maximum leaves 480px for the desktop workspace. A narrow window
temporarily clamps the display without changing the saved preference; widening
restores it. The mobile Sheet stays 288px wide and has no resize separator.
Overview metrics and optional toolbar status now respond to remaining workspace
width, while breadcrumbs preserve caption-button clearance. All new component
styling uses Tailwind utilities and semantic tokens; the only runtime style is
the existing shared sidebar-width custom property.

Evidence and the QA inventory live in `.test-data/sidebar-resize`. The combined
acceptance also includes the report-column changes described above. A fresh
GPT-6 Astra MAX review awarded **9.1/10**, meeting the requested threshold with
no P0–P2 findings. Application code stayed unchanged between that initial
sidebar/report review and its native acceptance.

Current browser validation passes 540 desktop route cases, 16 mobile drawer
cases, eight real-control interaction groups, and 64 resized-report groups,
without renderer exceptions. Four contact sheets cover all 15 pages in both
locales/appearances. The 288px mobile Sheet now explicitly overrides the
primitive's side-specific 75% width. The sidebar screenshot selector was
previewed and displayed inline.

`pnpm check` passes 1073 tests in 44 files, type/UI checks, and production builds.
The initial run's existing analytics-summary timing assertion failed once; its
seven-test rerun and the complete rerun pass without changing that subsystem.
Formatting, diff whitespace, `pnpm smoke`, and `pnpm smoke:real` pass. The latter
loads 496 matches. The evidence README records failed attempts and provenance.

The post-review production Electron run then passed **270 route cases**:
all 15 pages in both appearances, at 200/256/400px sidebar widths and requested
window sizes 1920×1080, 1024×1000, and 900×600. The last renderer height was
601px due to native scaling. Six additional English contexts and 14 report-table
contexts pass. All nine profile report fields fit at 900px; the Chinese Result
and Destruction columns retain the compact 64px/88px geometry. The approved
44px scoreboard rows, 28px unit footer, single Refresh action, expansion state,
keyboard drilldown, focus return, and native caption clearance remain intact.

Six native sidebar check groups verify pointer dragging without moving the
window, release-only persistence, renderer reload, shared Settings width,
track-click/reset, Escape cancellation, keyboard steps, and double-click reset.
The native 900px minimum was respected; a separate 120% Electron zoom diagnostic
verified clamping and restoration without replacing the preference. A further
close/relaunch check confirmed the saved and displayed width remained 336px
across two actual Electron processes. These runs used isolated real-data profiles,
loaded 496 matches, and reported zero renderer exceptions.

Six native contact sheets cover all 15 pages at 900px in both appearances and
all three sidebar widths; report/unit/room screenshots were also inspected.
The native screenshot selector was previewed and displayed inline. All owned
Electron and screenshot-helper instances closed after inspection. The initial
native harness requested 820px below the product minimum and timed out; it was
corrected without an application edit before the complete successful run.

Three nonblocking P3 observations from Astra remain documented: a height-only
resize does not cancel an active drag, the Appearance Slider thumb lacks its
help-text association, and intermediate English overview labels can stagger
metric values. That round met the >=9 threshold and ended after its native
inspection. Packaged release validation, recording hardware/codecs, and
complete screen-reader verification were not part of this acceptance. No commit
was created.

## Pointer-following sidebar hint

Date: 2026-11-05. The user clarified that the example screenshot illustrates
interaction rather than prescribing its appearance. The sidebar hint now uses
the shared original shadcn Radix Nova Tooltip's placement parameters to track
mouse movement. The shared Tooltip component, its default semantic colors,
typography, radius, arrow, and animations remain unchanged; the CLI upstream
diff confirms parity for that presentation. No dependency or handwritten CSS
was added.

Offsets derive from pointer coordinates relative to the rail. The primitive
retains collision handling with 12px viewport padding and its original
hoverable-content behavior. Keyboard focus uses the normal anchor, and the hint
continues to hide during dragging or when the rail is unavailable. The existing
sidebar range, persistence, keyboard controls, cancellation, and reset behavior
are preserved. Evidence and the QA inventory are in `.test-data/sidebar-tooltip`.
The browser pass covers all 15 routes, both locales/themes, and 200/400px sidebar
widths at 900×650px: 120 route contexts and six control groups pass without
renderer exceptions. Actual hover geometry tracks a 260px vertical and 3px
horizontal movement, remains contained near viewport edges, and keeps original
hoverable content, Tab/Escape, drag hiding, cancellation, and mobile removal.
The annotated screenshot selector was previewed and displayed inline.

Current `pnpm check` passes 1073 tests in 44 files, type/UI checks, and all
production builds. Formatting and diff whitespace pass. The evidence README
records the continuous-input and hover hit-test harness corrections. A fresh
Astra MAX review awarded **9.3/10**, meeting the requested threshold. The single
nonblocking P3 recommends a maintained portable browser regression scenario;
the current evidence script resolves Playwright through this machine's cache.
The preceding 9.1 score remains historical for the previous version.

Post-review production Electron inspection passes 120 tooltip contexts across
all 15 routes, both locales/themes, and 200/400px sidebars at a native 900×650px
renderer size. Actual mouse movement produces the expected 260px vertical and
3px horizontal displacement. Edge containment, native dragging without window
movement, release persistence, hover transfer, Tab/Escape and no document
overflow pass with zero renderer exceptions. Native Workspace/Settings hints
and keyboard screenshots were inspected; the native selector was previewed
and displayed inline.

A separate targeted Electron run passes six English contexts, 14 report-table
contexts, six sidebar groups, and all protected-layout interactions: nine-column
profile reports, 44px player rows, the 28px footer, adaptive unit/roster budgets,
single Refresh, caption clearance, disclosure retention, keyboard drilldown and
focus return. Its skipped historical 270-route matrix is not counted as new
coverage. Both runs use isolated profiles containing 496 matches and close
their Electron instances after inspection. The final manifest in
`.test-data/sidebar-tooltip/electron/final-results.json` records provenance and
verifies the application component hash still matches Astra's reviewed version.

That native acceptance recorded a narrow English Settings save-status wrap;
the following shared-glass audit adds the container-based header correction.
Application code stayed unchanged between the 9.3 review and its native
acceptance. Complete screen-reader, multi-monitor, and refresh-rate/performance
verification remained outside that round's acceptance.
No commit was created.

## Shared glass floating surfaces

Date: 2026-11-05. The user requested the application's glass-card design
language for Tooltip and other floating surfaces. This supersedes the earlier
exception that retained inverse Tooltips and opaque overlay fills.

The audit found separate treatments in eight families: Tooltip, Popover,
dropdown/submenu, Dialog, AlertDialog, Sheet, chart Tooltip, and Sonner toast.
Rich tooltips followed Popover, while mobile navigation overrode Sheet with a
flat fill and the development launcher used another surface. Shared primitives
now consume `glassOverlaySurfaceClasses` from `lib/surfaces.ts`, reusing the
Card material's fine outline, radius, shadow, blur, saturation, and theme color.
The `--popover` role aliases raised glass derived from the same card color.
Floating coverage follows `80% + 20% × glass opacity`, yielding 88–100% over
the supported preference range, for readable text above arbitrary content.
At 100%, surfaces are opaque and blur stops. Foreground remains fully opaque.
Ring outlines preserve existing dialog/table content widths. Sonner's vendor
shadow requires an important shared Tailwind utility; no component CSS or new
production dependency was added. The review fixes add `@playwright/test` as a
development dependency for maintained browser regression tests. Controls, feedback, native options, media, palette
illustrations, logo, and flat navigation/window chrome retain their own roles.

The audit also found glass opacity missing from the isolated browser service's
preference whitelist. Saving and broadcasts now include it. The design guard
now checks 25 floating-content sites as well as 38 Card sites and rejects local
surface overrides. It recognizes static `cn()`/conditional expressions,
Tailwind modifiers, and ring/outline colors. Fourteen targeted guard tests pass;
runtime classes and indirect variables still require source/browser review.
Settings headings now respond to remaining content width, keeping the save
status legible in narrow native layouts rather than wrapping above the toolbar.
The appearance helper text includes both cards and floating panels.

Evidence is isolated in `.test-data/glass-overlays`, with pre-change source
copies preserving earlier uncommitted work. The original baseline contains
20 records, but ten nominal dark captures are light-mode duplicates and are
invalidated in `before/validation.json`. Only ten light component baselines and
the separate actual-app sidebar baselines in both themes remain valid. Invalid
dark comparisons are removed from the corrected gallery; originals are retained
for provenance. The fresh `fixes/after` matrix covers 360 shared-component
contexts: ten variants, both themes, six palettes, and 40/50/100% opacity. Every
context asserts the applied mode, palette, color scheme, and preference.
Updated backgrounds resolve to the shared semantic role,
coverage and blur follow the applied preference, and foreground/muted contrast
measures at least 4.5:1 over black/white composites. These component fixtures
supplement actual application-page and flow checks. All 360 pass without
renderer exceptions, including real painted pointer access and click activation
in all 36 submenu contexts. The pre-review full application
check passed 1075 tests in 44 files, type/UI checks, and production builds, with
the temporary two-worker setting restored afterward. Final formatting, whitespace,
and both required smoke commands pass; real smoke loads 496 matches.

The completed browser evidence includes 540 desktop route contexts, 120 mobile
main-page contexts, 16 mobile drawers, and 120 actual hint contexts with six
interaction groups. All 15 routes appear in both languages/themes. Header checks
include simulated native caption reservation. Actual recorded-data flows add
24 records across both themes: service health, profile/match dialogs, actual chart
hints, rich award hover/pinning, copy notifications, archive menus, confirmation
cancellation and mobile navigation, including Sonner's Alt+T/list/Tab/close focus
sequence. Its vendor focus styles are replaced with visible semantic focus
utilities alongside the shared shadow. All completed browser passes have zero
renderer exceptions. Minimum measured foreground/muted contrast is 10.17:1 and
5.03:1 over the tested black/white composites. Matching Graphite screenshots
are available in the corrected before/after selector; fixture images are labeled
separately from actual application screenshots. Dark fixture scenes show only
the current effect and explain the invalid baseline. Four contact sheets cover all
15 pages in both locales/themes.

The first Astra MAX review scored 8.7/10: the new glass backdrop filter created
a containing block that clipped shared submenus inside the scrolling parent.
Bounds and focus checks alone had missed painted clipping. Submenus now own a
Radix Portal, retaining parent scrolling. The maintained `pnpm test:ui` suite
passes eight pointer/keyboard cases in both themes at 40%/100% opacity, covering
selection, ArrowLeft/ArrowRight, root Escape, and focus return. Reopening waits
for Radix focus and Presence transitions. The fresh material matrix includes
this fix and the final toast focus utilities.

The corrected-candidate `pnpm check` passes 1082 tests in 44 files, type/UI
checks, and all production builds, with the temporary two-worker setting
restored afterward. The eight Playwright browser regressions pass separately.
The fresh independent GPT-6 Astra MAX review scores **9.2/10**. All three
previous findings are resolved; the remaining P3 concerns maintained test-fixture
geometry/scroll coverage, not a confirmed application defect. The accepted
application source remained unchanged during the subsequent native inspection.

Post-review production Electron validation passes **270 route contexts**:
all 15 pages in both themes, at 1920/1024/900px windows with 200/256/400px sidebar
preferences. Six English deep-flow cases and 14 recent-match table checks pass.
Native titlebar containment, Settings save-status layout, sidebar pointer drag,
reload persistence, cancellation, keyboard bounds and reset pass. The approved
44px collapsed scoreboard rows, inline name/awards, 28px unit footer, adaptive
preview, compact report columns, single match Refresh, drilldown and focus return
remain intact.

A separate native flow pass records **28 passing checks** across both themes:
pointer-following Tooltip and edge containment, service Popover, profile/match
Dialog, chart hint, award hover/pinning, copy toast and keyboard focus, archive
menu, confirmation cancellation and mobile Sheet dismissal/focus return. The
375 CSS-pixel mobile diagnostic uses a 900px native window at 240% zoom without
changing the product minimum. The original clipboard text is restored and no
renderer exceptions are recorded. Initial harness assumptions about synchronous
focus return and exact fractional zoom geometry were corrected; no application
change was needed. The evidence README preserves these attempts and final logs.

Native contact sheets cover every page in both themes, with representative
full-resolution surfaces and protected layouts inspected. The native gallery
was previewed and shown inline. This validates a production build using the local
Electron runtime and isolated offline real data; packaged installer/update,
representative GPU performance, and multi-monitor behavior are outside this run.

## Sidebar rail brightness

Date: 2026-11-06. Pointer hover and dragging previously reused the bright
keyboard-focus line, creating an excessively strong full-height divider in dark
mode. The shared resize handle now keeps hover at 1px with `sidebar-border` and
uses a restrained 2px `sidebar-foreground/25` line during dragging. Keyboard focus
retains its high-contrast 2px `sidebar-ring`. The idle divider, full 16px hit area,
shadcn primitive, Tooltip, ARIA and resize behavior remain unchanged. The design
master records this state hierarchy.

The shared browser preview verifies all 15 routes in both themes at 1280×800:
30 hover contexts retain 1px lines, 16px hit areas, and contained page widths.
Both keyboard-focus colors remain intact. Actual pointer input records the new
dragging line and width adjustment/reset. `pnpm check` passes 1082 tests in
44 files, type/UI checks and production builds; `pnpm smoke` passes. Evidence and
the actual dark before/after screenshots are in `.test-data/sidebar-rail`.
The fresh combined Astra MAX review and post-review Electron inspection remain pending.

## Archive ELO value presentation

Date: 2026-11-06. Archive-card ELO changes now use the shared shadcn Badge `value`
variant. It removes the capsule border, radius and padding while increasing the
font from 12px to 14px. The 20px line height, semantic increase/decrease colors,
signed/neutral/missing values, localized accessible label and card navigation
are preserved. The other Badge variants retain their existing presentation.

The shared browser preview passes 12 current contexts across Chinese/English,
light/dark modes, and 375/900/1440px widths. Each context checks all 50 rendered
card values for style, containment, single-line height, accessible label and
separation from the map title. Actual value clicking still opens match details.
The actual before/after images, source snapshots and measurements are retained
in `.test-data/archive-elo`. The latest `pnpm check` passes 1082 tests in 44 files,
type/UI checks and all production builds; `pnpm smoke` passes. The sidebar-only
review is superseded by the expanded sidebar/ELO review; a fresh combined Astra
MAX score and subsequent production Electron inspection remain pending.

## Palette preview paint containment

Date: 2026-11-06. The user reported a hover artifact below the palette swatches.
Each ThemePreviewCircle now owns `isolate contain-paint`, confining its filtered,
overscaled gradient to the existing circular paint boundary. Shared glass Card
and Tooltip materials, palette colors, swatch size and outer selection/focus
indicators remain intact. Further live comparisons found that animated hints
could briefly blank the hovered card. Removing zoom alone, or animating only the
hint's contents, did not reliably resolve it. Stationary hints produced intact
sampled frames, but the subsequent 8.8 review found intermittent early shared-
preview blank captures. Removing motion alone therefore did not establish the
cause of every capture disturbance. Both Tooltip variants display without animation, preserving delay,
placement, arrow and hover/keyboard behavior. Popover surface/layout classes are
shared separately from motion; pinned Popovers remain unchanged.

The maintained test now covers twelve contexts: both modes at 40/50/100%
opacity, at DPR 1 and 1.5. Five trials per context exercise ordinary entry,
rapid re-entry, movement between the same card's swatches, movement to another
card, and movement to a selected card. Six full-viewport samples per trial start
before waiting for hint visibility. Actual capture intervals, hint identity,
scroll position, and grid geometry are recorded. Both pixel regions come from
the same frame. Stationary animation/opacity/transform and geometry are asserted
per hint identity; this allows the previous hint to finish closing during direct
movement. Verified dismissal and a final lower-row comparison complete each case.
The full browser run passes 20 tests, including eight submenu regressions.
All 732 pixel comparisons pass the 2/255 channel tolerance. Earlier validation
passed 1082 tests in 44 files, production builds, and desktop smoke; current
validation and detailed timing evidence are retained under
`.test-data/palette-hover/early`. The rich-panel parity test continues to compare
content and material/layout while allowing hover/pinned motion to differ.

The isolated pre-fix Electron diagnostic did not reproduce the exact reported
artifact. Its two completed baseline/containment groups retain identical lower
row pixels; those observations establish visual preservation rather than a
before/after native failure. A third temporary card-isolation probe timed out
and was never applied to source. Early shared-preview snapshots and recording
attempts include timing/scroll disturbances; the later recording was interrupted
by the T3 server restart. They are diagnostic evidence, not accepted proof of
the fix. Current evidence and limits are recorded in `.test-data/palette-hover`.
A fresh combined Astra MAX review and post-review native inspection remain
pending for the sidebar, ELO value, and palette changes together.

The 8.8 review's early-hover sampling gap is covered by the expanded maintained
suite: first samples begin 2–14.5ms after entry and rapid re-entry gaps measure
19–24.8ms. A fresh `pnpm check` again passes 1082 tests in 44 files and all
production builds; desktop smoke and all 20 browser tests pass. Independent
OS desktop crops, internal page captures, and compositor callbacks remain intact
in both project Electron 44.7.2 and an isolated 44.10.1 matching the shared host.
Each version contributes 62 non-baseline desktop crops, 62 page captures, and
66/68 compositor frames, with no changed pixels beyond the 2/255 tolerance.
Displayed/hidden/displayed diagnostics also remain intact. Fresh shared-preview
captures still occasionally omit a whole card, so the internal shared-host
cause remains unknown; no claim of universal capture-path correctness is made.
The complete evidence, unsuccessful diagnostic attempts, and coverage limits
are recorded in `.test-data/palette-hover/early/README.md`. The six application
files were not changed again in this evidence-focused iteration. A new review
and the post-gate production Electron matrix are still required.

## Final combined production Electron validation

Date: 2026-11-06. The fresh independent GPT-6 Astra MAX review scored 9.1/10,
closing the earlier P2 as a blocker to native inspection. The six application
files remained unchanged throughout the subsequent production Electron run.

The full matrix passes 270 contexts: all 15 routes, both themes, windows at
1920×1080 / 1024×1000 / 900×600, and preferred sidebar widths 200/256/400px.
Thirty additional English route contexts use actual sidebar/settings controls,
at 900×650 with a 400px sidebar. Six English density cases, fourteen report-table
cases, and eight sidebar lifecycle/header checks also pass. Native captions,
document and workspace overflow, and tested text/header geometry remain valid.
The 44px collapsed scoreboard rows, inline names/awards, 28px aligned unit footer,
dialog widths/columns, single Refresh, report return, expansion and focus
restoration are preserved.

Supplemental production checks verify both rail hover/focus states, pointer-
following hints, fifty bare 14px ELO values per theme and value activation.
Six palette contexts cover both modes at 40/50/100% opacity: thirty pointer
trials and 180 retained full viewport frames. All 768 region comparisons,
including idle controls, pass the unchanged 2/255 tolerance; maximum delta is
1/255. The first supplemental attempt captured an appearance-setting transition
in its idle baseline and stopped on eighteen low-delta corner pixels. Its
failure is retained. The completed rerun waits for that existing transition and
asserts two-frame idle stability before measuring hover; no application style
or tolerance was changed. Both completed native runs report zero renderer
exceptions and close their owned windows/processes.

The production renderer, sandboxed preload and SQLite service run in project
Electron 44.7.2 with isolated copies of the 496-match fixture. This acceptance
does not substitute for packaged-release or external-service validation. The
managed shared-preview anomaly remains unexplained and did not reproduce here.
Evidence and source/screenshot hashes are under
`.test-data/palette-hover/native-validation.json`, with the native report at
`.test-data/palette-hover/electron/README.md`. The native gallery includes all
fifteen pages in both themes. Existing 1082-test / 44-file checks, production
builds, twenty browser tests and desktop smoke remain valid for the unchanged
application source. No commit was made.

## Connection health-card layout

Date: 2026-11-06. The annotated API health Card previously retained a separate
activity-icon row, empty feedback region and full-width action below its copy.
It now uses the existing CardHeader/CardAction composition: title/description
on the left and a compact action on the right when its container reaches 30rem;
narrow cards stack the full-width action below. The activity icon appears once
inside the button and becomes the shared Spinner during a check. A localized
live status announces pending work, while failures use the shared Alert in
CardContent. The idle card reserves no empty status row. Shared glass material,
request handling, success feedback, retry and duplicate-request prevention are
preserved. Browser/state verification, a fresh Astra MAX review and subsequent
production Electron checks are recorded under `.test-data/connection-health`.

## Automation-card style and combined Settings review

Date: 2026-11-06. The user subsequently annotated the Automation Card. The
health-only review was cancelled before modifying the shared SettingsPage and
design documents; its evidence remains preserved. A new combined review covers
both cards.

The Automation Card now gives each existing option a short localized
description using FieldContent/FieldDescription. Equal grid rows keep wrapped
English labels consistent in height, and the title/description gap remains
tight. Fixed icons and nonshrinking Switch controls align vertically; inset
shared Separators begin at the text column and preserve the right gutter. Each
description can extend below the switch column in containers under 24rem, which
reduces unnecessary English wrapping without narrowing the control. Each
Switch references its description while retaining its existing ID, label,
checked value, autosave callback and keyboard behavior. The four descriptions
reflect the existing room-query, ban-sync, match-sync and multi-account encounter
behavior; no automation task or schedule is changed. The shared glass Card and
theme tokens remain intact. Combined evidence is stored under
`.test-data/settings-cards/round-1`.

## Cache categories and cleanup copy

Date: 2026-11-06. The user added annotations on both cache categories and the
cleanup Card, asking for shorter and more intuitive copy. The preceding
health/automation review was cancelled before changing shared translations and
design documents; its evidence is retained and a new expanded review is required.

Cache categories now use the shared small glass Card instead of a bare outlined
Item. Category name and content size lead, with a short description and separately
labeled entry/expired counts. Container queries stack the categories below
36rem of remaining width. Query data replaces the technical API-response label;
player summaries retain their six-hour expiry explanation. The size note is a
single sentence stating that cached content size is not disk usage.
The mobile overview's data-size metric spans the final row, preventing a value
such as `141.1 MB` from splitting its unit onto another line. Stats gains an
optional layout class; other consumers keep their existing defaults.

The cleanup Card uses the same compact header/action pattern as health checking.
Short copy explains online refetch and preserved local records; full preservation
details remain in the existing all-cache confirmation. Expired-only and all-cache
actions keep their modes, guards, disabled/busy behavior, confirmation/cancellation,
error handling and success counts. Existing cache tests are updated for the
shorter localized action names and labeled count definitions, without changing
the behavioral assertions. No storage, expiry or deletion logic changes.
Expanded evidence is stored under `.test-data/settings-cards/round-2`.

## General settings, About and navigation ordering

Date: 2026-11-06. The user added annotations on the navigation-order Card,
analytics/privacy Card and About Card. The preceding expanded review was
cancelled before changing their shared source; the new review must cover all
annotated Settings cards together.

Navigation now labels its Show and Order columns, uses compact equal-height
rows and a stable numeric gutter, and aligns inset Separators with page names.
Labels may wrap without shrinking the visibility Switch or either reorder
button. Visibility, save behavior, boundary guards, keyed animations and focus
after keyboard reordering remain intact.

The privacy Card replaces the two long always-visible paragraphs with a short
recipient summary and exclusion summary. The existing Switch keeps its full
accessible name, description references, explicit saved-choice flag and callback.
Both complete original disclosure paragraphs remain available through an
accessible Collapsible. First-launch consent still presents the full paragraphs
before either decision; no consent or analytics transport logic changes.

The About Card emphasizes version and app identity, gives update controls a
stable responsive row and aligns project links together. Narrow layouts stack
the update action at full width and use two equal project-link columns. Disabled
builds show a short explanation while the existing Tooltip retains its complete
text. Update status, progress, retry/download actions, errors, not-applied warnings
and match/recording installation guards remain present.

Current browser evidence, combined-candidate validation, screenshot comparisons,
and the independent Astra MAX review are recorded under
`.test-data/settings-cards/round-3`. The final production Electron matrix is a
separate acceptance stage after the combined candidate reaches at least 9/10;
earlier native results do not sign off these later Settings changes.

The first combined Astra MAX review scored 8.6/10 and reproduced two accessibility
gaps. Reordering into a list boundary disabled the focused control and lost the
keyboard position; it now transfers focus to the opposite enabled move button in
the same row, while intermediate moves retain the activated button. The concise
statistics label is now the prefix of its full accessible name in both languages.
The visible copy, original privacy disclosures, descriptions, setting callbacks,
native boundary disabling and shared material remain unchanged. Corrective
evidence and a fresh independent review belong under
`.test-data/settings-cards/round-4`.

The fresh Astra MAX review scored the corrected candidate **9.2/10** and closed
both P2 findings. Current production Electron acceptance then passed all **270
route combinations**: 15 routes, two appearances, native sizes 1920x1080,
1024x1000 and 900x600, and sidebar widths 200/256/400px. Six additional English
density cases and fourteen report-table measurements passed, including the
44px scoreboard rows, compact footer, dialog containment and focus restoration.
The as-launched window, native caption geometry, sidebar dragging/persistence,
keyboard adjustment, zoom clamping and Settings headers were checked as well.

Eight focused native Settings cases cover both languages, both appearances and
1440px/900px windows, including a 400px sidebar. Actual preload/service calls
verified privacy disclosure and restored consent, boundary reorder focus and the
next Enter, visibility, Automation switches, disabled updates and offline health
completion. Expired-only and all-cache cleanup each removed 33,513 entries from
separate fresh offline fixture copies. Cancellation preserved counts and focus;
successful cleanup preserved identical contents in nine original-data tables,
496 matches, two accounts, active account and configuration. Cache-enriched list
projections can change after cleanup; preservation checks compare stored rows.

No application source changed after the 9.2 review. The current application
validation remains 1084 tests in 44 files plus production builds, desktop smoke
and formatting. Native evidence, probe corrections, screenshot galleries and
coverage limits are documented in
`.test-data/settings-cards/round-4/native-acceptance.md`. All test Electron
instances were closed; user data and deleted skill files were preserved, and no
commit was created. This acceptance uses built production files in the local
Electron runtime, not an installer or packaged-release validation.

## Content-aware match layout, Switch geometry and breadcrumbs

Date: 2026-11-06. The user reported unused scoreboard space, an overly stretched
detail page, the redundant self badge, an off-center Switch thumb and stale,
nonfunctional parent breadcrumbs. The new candidate replaces the fixed 88rem
scoreboard breakpoint with measured column widths, including each player's
single-line name/awards and the widest header/value per metric. Independent team
flex bases fit side by side when possible and wrap otherwise. Detail content is
capped at 96rem to accommodate English metric/award text while limiting wide-screen
stretching. The existing 44px rows, truncation, disclosures and overflow cues remain.
The local row retains its highlight without the self badge.

The first candidate gave Switch default/small tracks symmetric 2px insets and
matching thumb translation; the corrective pass below restores upstream geometry.
Shared shadcn
breadcrumbs show archive match IDs and player report identity; parent links use
the original back callbacks for scroll/filter/focus restoration. Per-page
registration prevents hidden visited pages from replacing the visible trail.
Settings use the same primitives and retain their save/leave guard on workspace
return. Evidence and the fresh Astra MAX/native acceptance stages are tracked
under `.test-data/match-layout/round-1`; the prior 9.2 score applies only to the
earlier Settings candidate.

The new candidate's first Astra MAX review scored 8.8/10. Layout, self identity
and breadcrumbs passed; its sole P2 found that removing the Switch border hid
both track and focus under forced colors. The user's follow-up also prompted an
upstream comparison: the pre-request radix-nova root/thumb classes were identical
to the official registry, and ordinary DPR probes did not reproduce a meaningful
vertical center error. The 2px geometry rewrite was a visual adjustment rather
than an established root-cause repair. Ordinary Switch geometry is now restored
to upstream; only the shared forced-colors presentation is extended with system
surfaces, a contrasting thumb and actual outline-based focus. Disabled state uses
GrayText and a local thumb-color variable to avoid checked-selector precedence.
Corrective evidence, fresh review and subsequent native acceptance are recorded
under `.test-data/match-layout/round-2`.

The fresh round-2 GPT-6 Astra MAX review scored the corrected combined UI **9.3/10**
with no actionable defect. Production Electron acceptance then covered **270
route combinations**, all fifteen pages in both themes at three native sizes and
three sidebar widths, plus six English density cases and fourteen report-table
checks. Thirty focused match states verified content-based pairing/wrapping,
the 1536px cap, inline 44px rows and removed self badge. Four native breadcrumb
flows verified current labels, local-log identity, page scope, saved Settings
return, and preserved archive filters/scroll/opener focus.

Thirty-two native Switch states passed across both themes, both app/OS contrast
mismatches and zoom 1/1.25/1.5/2. Ordinary radix-nova geometry remains stock; a
meaningful vertical offset was not reproduced, and the original screenshot's
exact cause remains unproven. Declared 2px contrast-mode focus dimensions are
checked separately from Chromium's physical-pixel rounding. Final zoom captures
use `BrowserWindow.capturePage` because Playwright's page capture cropped the
zoomed frame; corrected native frames and pixel crops were inspected. Earlier
scroll-timeline, outline-assertion and capture failures remain documented.

The native real-data smoke initially failed its retired fixed-grid breakpoint
assertion. The smoke-only helper now compares actual team positions with their
content requirements/gap and verifies the width cap; no renderer or normal
desktop behavior changed after the 9.3 review. The final `pnpm check` passed
**1088 tests in 44 files** and production builds; both desktop smoke modes passed,
including all real-data match checks with 496 matches. Detailed native evidence,
the fifteen-page screenshot gallery, limitations and final review of this narrow
verification correction are tracked under `.test-data/match-layout/round-3`.
This is production-build acceptance in the local Electron runtime; Windows OS
contrast themes, actual screen-reader speech and packaged-release artifacts are
not claimed. All owned test applications were closed; real user profiles and
deleted skills remain untouched, and no commit was created.

The final independent GPT-6 Astra MAX review accepted the combined UI and native
evidence at **9.2/10**, with no P0–P2 findings. Its sole P3 is maintained-smoke
coverage: the 1800px smoke window does not make the width cap bind. Independent
1920px/2560px native evidence confirms the current 1536px cap works. This is a
nonblocking future regression-coverage improvement, not a current layout defect.
The requested score gate and production Electron stage are complete; the frozen
review candidate and evidence remain preserved under the round-3 directory.

## Centered waiting state and bounded name history

Date: 2026-11-07. The user found the Overview waiting message too high in its
reserved room Card and the profile name-history layout too crowded. SessionPanel
now retains the shared shadcn Empty's centered alignment instead of overriding
it with `justify-start`; the Radar-only top margin is removed. Existing actions,
room reservation and settled no-room compact behavior are retained.
The empty viewport uses a window-height budget with a 9.5rem floor and compact
padding in short windows, preventing a reserved two-team layout from centering
its prompt below the 600px first view, including a 400px sidebar in both languages.
The parent reservation and populated roster geometry remain unchanged.

Profile name history is immediately visible in a shared small glass Card with
its count. Names and last-seen dates use shadcn ItemGroup/Item composition. The
native focusable list is capped at 16rem, supports keyboard scrolling, wraps long
names inside min-width-zero content, and moves dates below names in narrow
containers. Current-name exclusion, record order, timestamps and omission of an
empty history are preserved. The underlying inline report does not supply name
history; its existing layout and dialog entry remain part of regression checks.

Evidence, long-name/250-alias scenarios, responsive/theme checks, independent
Astra MAX review and subsequent production Electron acceptance for this candidate
are tracked separately under `.test-data/session-empty/round-1`. Earlier accepted
scores and native runs do not sign off these new changes. No handwritten ordinary
component CSS, backend behavior, dependency or commit is introduced.

The fresh GPT-6 Astra MAX review accepted this candidate at **9.1/10**. Production
Electron acceptance then passed **120 all-page/theme/window/sidebar combinations**,
sixteen waiting states and twelve name-history contexts. Visibility checks use
the actual renderer/workspace intersection and include English at 900x600 with a
400px sidebar. Waiting prompts stay within that supported first view. Real Tab
navigation, Home/End, final-date visibility, Escape and trigger-focus return pass
with three real aliases and a separate 253-alias stress profile.

All fifteen routes were inspected in both themes through native contact sheets;
larger normal/short waiting and real/stress history frames were inspected as well.
There were zero renderer exceptions. One accepted P3 remains: the bottom history
focus outline can be slightly clipped in the short English stress dialog; names,
dates and keyboard access remain available. The native-helper P3 was corrected
without changing application code. The 320x600 English browser Overview still
requires page scrolling and is outside the native minimum. Evidence and the
remaining limits are recorded in
`.test-data/session-empty/round-1/native-acceptance.md`.

Current validation is **1088 passing tests in 44 files**, production builds,
format/UI checks and both desktop smoke modes, including 496 offline matches in
the final real-data smoke. No application/test code changed after the 9.1 review;
the requested review threshold and production Electron stage are complete.

## Name-history list preview and hover-only ELO chart

Date: 2026-11-07. The user requested a name-history list sample before applying
that layout and asked to remove the ELO chart's instructional footer and arrow-key
feature. The standalone list prototype is kept under
`.test-data/name-list-chart/round-1`; ProfileDialog is unchanged for this preview.

The chart previously enabled Recharts' accessibility layer, whose middleware
implements arrow-key navigation. The chart now explicitly disables that layer,
uses a nonfocusable labeled image, and retains pointer-hover match details.
The complete footer, empty placeholder and obsolete localized hint strings are
removed. Period summaries, baseline reference, gap handling and plot rendering
remain intact. The existing chart regression now verifies the removed keyboard
behavior. Fresh validation and independent review are tracked with this candidate.

The candidate received **9.5/10 from GPT-6 Astra at MAX**, with no blocking
findings. Focused production Electron acceptance then passed eight contexts
(Chinese/English, light/dark, minimum/normal windows) and 24 pointer samples using
the real preload, service and an isolated offline profile. Native screenshots
confirm unobstructed axes, contained hover details and the removed footer; the
chart's arrow-key behavior remains disabled. Settings save/return and dialog
Escape/focus return passed without renderer exceptions. The current run passed
**1088 tests in 44 files**, production builds, formatting/UI checks and
`pnpm smoke`; the nine targeted chart tests also passed. The name-history list
remains proposal-only. Evidence and limits are in
`.test-data/name-list-chart/round-1/native-acceptance.md`.
