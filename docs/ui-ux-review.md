# UI and interaction review

Date: 2026-11-04. Scope: BARadar's shared browser/Electron renderer, including
all seven workspace pages, eight Settings categories, player reports, match
details, navigation, themes, and responsive layouts.

The [design system](../design-system/broken-arrow/MASTER.md) records the resulting
composition and interaction rules. No application data or personal preferences
are needed for this review: the browser uses the isolated fixture server and
its local Demo and Empty scenes.

## Review method

Each improvement round includes actual browser screenshots, interaction checks,
and a separate GPT 6 Astra review at maximum reasoning effort. The reviewer must
score UI, visual flow, responsive behavior, both appearances, interaction, and
cross-page consistency from 1 to 10, and identify concrete reasons for deductions.
The requested stopping threshold is 9/10, followed by an actual Electron run.

The shared preview loaded the application, but two screenshot requests failed
with `Preview automation snapshot timed out after 15000ms`. The inspection
therefore uses local Playwright with installed Chrome. Temporary harnesses,
screenshots, and detailed observations live in `.test-data/ui-review`.

## Round 1

- Added consistent visible page titles and purpose descriptions to workspace and
  Settings pages. Log-listening status is visible, and archive details retain
  their own heading.
- Changed team and deck stacking to follow the available workspace width,
  including the expanded sidebar. Removed double-shrinking of room metadata.
- Made the ban search flexible within its toolbar.
- Added a room-player suggestion Card and a Back to players action. Selection
  focuses the report; narrow layouts scroll to it. Returning preserves the query
  and results, cancels pending report responses, and restores initiating focus.
- Localized the Chinese glass-opacity label and updated its existing test.
- Fixed mobile navigation consuming the first Escape through an automatically
  opened tooltip, and restored focus to the opening control after dismissal.

Baseline evidence includes 15 routes at 1440×1000 dark, 900×800 light, and
375×812 light: 45 screenshots, with no recorded renderer exceptions.

The updated interface has 90 screenshots covering those three sizes in both
appearances. Additional browser checks cover 210 English route/theme/size
combinations at 320, 375, 760, 900, 1024, 1280, and 1920px. Page overflow and
ban-toolbar containment checks passed. Room selection, report return and focus,
search preservation, empty-search recovery, drawer dismissal, archive detail
navigation, explicit theme controls, and keyboard opacity changes passed.
No renderer exceptions were recorded.

The final Round 1 `pnpm check` passed 1054 regression tests in 43 files, the type
check, UI guard, and production builds. `pnpm format:check` and `git diff --check`
passed. An initial component test failed because it still searched for the old
English opacity label; the test now uses the localized label. A subsequent full
run exposed two update-tooltip regressions from applying the mobile tooltip rule
to desktop navigation. Narrowing that rule to mobile restored update details;
all tests passed in the final run.

The six palettes, both modes, and opacity at 40%, 50%, and 100% passed 36 actual
control combinations. Contrast against the composited Card background measured
at least 14.73:1 for primary text, 6.79:1 for muted text, and 6.03:1 for the ring.
Card content remained opaque, and blur was disabled at 100% opacity.

## Additional short-window inspection

Twenty page/size cases cover Archives, Bans, Recordings, and Connection at
900×600, 1280×720, 760×600, 375×667, and 320×568. Four additional Empty-scene
screenshots cover Overview, Archives, Decks, and Player Search at 320×568.
No page-wide horizontal overflow or renderer exception was recorded.

The 320×568 archive leaves about 110px for result cards after the heading,
filters, actions, and pagination. The reserved empty room also places its main
explanation below the initial short-phone viewport. These are follow-up visual
flow findings, rather than evidence of a sufficiently comfortable short layout.
The installed Electron window's supported minimum is 900×600; final native
verification remains pending until the independent browser review reaches 9/10.

## Round 2

GPT 6 Astra at maximum reasoning effort scored Round 1 at 8.2/10 after inspecting
39 screenshots, the code changes, and targeted browser interactions. Category
scores were 8.3 for hierarchy/flow, 8.6 for consistency, 8.7 for themes, 7.6 for
responsive behavior, and 7.8 for interaction/accessibility. The review identified
seven concrete issues; this round addresses all seven.

- Recent-match tables retain match identity, result, date, and detail actions at
  every width. Identity remains visible in a sticky first column while secondary
  data scrolls. Pointer and keyboard drill-down preserve focus and scroll on return.
- Room-player suggestions constrain and wrap long Chinese and Latin names.
- Scrollbar thumbs use stronger semantic colors. Overflowing tables show an
  inline hint and expose labeled keyboard-focusable scroll regions. Ban tracking
  keeps the player's identity visible during horizontal scrolling.
- Preferences preview four unit rows and three categories with independent Show
  all actions. Every entry remains accessible; refresh preserves expansion. The
  smaller preview replaces the unconditional fifteen-unit/seven-category space
  budget. Long wrapping content may grow beyond its minimum.
- Settings descriptions appear once, section titles identify their content, and
  navigation labels share the same mapping as the workspace sidebar.
- Both navigation systems retain a small active marker independently of hover.
- Compact pagination shows the current page and total explicitly. Larger
  containers retain the full calculated number/ellipsis sequence.
- Mobile archive filters move into a shadcn Popover, with Add match, view, and
  refresh actions kept visible. At 320×568 the toolbar shrank from about 195px
  to 76px. Empty room explanations align toward the top of their reserved area.

Targeted browser checks cover long names and match drill-down at 320, 375, 900,
and 1440px; identity/result/date availability; pointer and keyboard detail opening;
focus/scroll restoration; preview expansion and collapse; compact filters;
pagination's first, middle, and last pages; and active-versus-hover navigation.
The unhovered scrollbar contrast measured 4.04:1 in light mode and 5.75:1 in dark
mode against the Ban tracker's actual surface. The controlled four-row pending
and loaded previews had identical geometry. Larger wrapping names may grow;
this does not assert that arbitrary content has a fixed height.

The 90 route screenshots were refreshed. Targeted screenshots hide only the
development-tools launcher so it does not obscure product pagination; it is not
part of the production interface. Synthetic long-name and twenty-unit/nine-category
fixtures are explicitly separated from ordinary Demo screenshots in the temporary
capture directory. Full validation and the second independent score follow.

Round 2 validation: `pnpm check` passed 1055 tests in 43 files, type checking,
the UI guard, and web/server/desktop production builds. `pnpm format:check` and
`git diff --check` passed. The earlier full run exposed one recorded-service UI
assertion that expected every preference immediately; it now opens Show all,
checks every real value, and verifies expansion survives the service refresh.
The targeted 14 browser groups and the rerun of 210 English route/theme/size
checks passed without renderer exceptions. The second independent score and
native Electron verification are pending.

An additional six browser cases exercise match details from an actively selected
search result, at 375, 900, and 1440px in both appearances. Pointer and keyboard
opening preserved the query, selected result, initiating focus, and workspace
scroll on return. No renderer exceptions were recorded in this follow-up.

The four README screenshots were recaptured from a separate recorded-data fixture
profile so capture preferences do not affect the active review server. They show
the actual 496-match archive and recorded player report, rather than synthetic
stress data. Captions now match the idle Overview and compact preference previews.
The capture completed without renderer exceptions, and its temporary server was
stopped afterward.

## Independent result and Electron verification

GPT 6 Astra at maximum reasoning effort scored Round 2 **9.1/10**, meeting the
requested 9/10 stopping threshold. It inspected 44 screenshots spanning every
workspace page and Settings category, reviewed the current implementation, and
passed 11 independent Chrome check groups. All seven Round 1 findings were
resolved. Category scores were 9.0 for hierarchy/flow, 9.3 for consistency, 9.4
for themes, 8.9 for responsive behavior, and 8.9 for interaction/accessibility.
No further application changes were made after that passing review.

Three Low/P3 suggestions remain as optional polish: give the Connection path
editor more room at 320–375px, expose the compact filter count as an accessible
description, and show dates directly on archive cards. These did not block the
reviewer's passing score. The design inventory was corrected to list all eight
Settings categories.

The built production application was then launched through the installed Electron
executable with its sandboxed preload and native service, using an isolated copy
of the recorded corpus. The normal visible window opened at approximately
1280×850; Windows reported 1281×851 under the current display scaling. Its
configured minimum remained 900×600. The renderer used the built file entry,
without a Vite URL or development bridge.

- Sixty native layout cases passed: all 15 routes, both appearances, requested
  window sizes 1440×1000 and 900×600. Page and workspace overflow checks passed.
- All 496 recorded matches loaded after explicitly completing the archive scan.
- Native report return retained the query and initiating focus. Expanded unit and
  category lists retained every recorded entry after a real service refresh.
- Enter opened report match details and Escape restored the initiating action.
  Match disclosures and native dialog clearance below the caption area passed.
- Native screenshots were inspected for the minimum-size Overview, archive,
  profile dialog, report action, and dark Appearance screen. No renderer
  exceptions were recorded. These renderer captures exclude OS-painted caption
  buttons; the separate native chrome smoke verifies their reserved geometry.
- `pnpm smoke` passed SQLite/preload/React initialization and native chrome checks.
- `pnpm smoke:real` passed with 496 matches, including match navigation,
  disclosures, focus return, local records, responsive scoreboards, fixed archive
  columns, and contained scrolling.

The manual harness initially needed an explicit Electron executable path,
completion of the background archive scan, and correction of an outdated action
label. Its first complete layout pass reached all sixty cases before the stale
label stopped the interaction phase. After correcting the harness, an interaction
run passed the remaining checks without repeating the layout matrix. These were
harness/readiness failures; they required no application change after the 9.1 score.
The combined evidence is recorded in `.test-data/ui-review/electron/final-results.json`.

The latest full application check passed **1055 regression tests in 43 files**,
without skipped tests, plus type checking, the UI guard, and production builds.
Selected earlier test runs intentionally excluded unrelated cases; their counts
are not added to the full-suite total. Formatting, local documentation links, and
diff whitespace checks also passed. Packaged installer/update artifacts, actual
screen-reader speech, and recording hardware were outside this UI verification;
no packaged-release or hardware-recording result is claimed.

## Screenshot-driven corrective follow-up

Date: 2026-11-05. The new annotated screenshots identify unused height beneath
the unit preview, a duplicate dark toolbar floating over match-dialog content,
and award rows that wrap back to the disclosure arrow. This follow-up also audits
all seven workspace routes and all eight Settings categories. The earlier 9.1
score and validation above are historical results for the previous iteration.

- The unit card stretches to the adjacent preferences/Maggot column. All actual
  units remain in a keyboard-scrollable viewport; its four-row minimum grows into
  the available height. Explicit expansion and refresh retention remain available.
- Match-dialog Refresh moves into the existing header beside Close. The body no
  longer repeats the standalone page toolbar; archive navigation retains it.
- Player names and awards share a single line in equal-height scoreboard rows.
  This replaces the initial two-line implementation after the user's clarification
  on 2026-11-05. Long names use bounded ellipsis with full accessible text, and
  complete award collections remain available through contained table scrolling.
  Individual badges retain full accessible names and hover/focus/pinned details.
- Shared notices, ordinary and confirmation dialogs, search-result names and
  navigation-order labels accommodate multiline text and long unbroken strings.
- Mobile Connection paths use a full input row with actions below. Archive cards
  show dates, and compact filters expose their active count accessibly.

The shared preview again timed out while capturing a populated player dialog.
The existing local Chrome fallback was reused. Evidence and the route/control
inventory live in `.test-data/ui-followup`, separate from earlier review rounds.

Current browser evidence includes all 15 routes in both appearances at 1920,
1440, 900, 375 and 320px in Chinese, plus every route at 900 and 375px in English
and in an empty Chinese scene: 270 route/state/size/theme scenarios. Both initial
viewports and the actual scroll container's bottom are captured when applicable.
Text-bearing controls and titles are checked separately from page overflow.

Thirty real-data browser cases exercise player 75402 and matches 9216783 and
9202915 at all five widths in both appearances. At wide sizes, the unit viewport
grows from 197px to 288px and the card bottoms align. All 15 recorded units remain
available. Keyboard scrolling, expansion/collapse, refresh retention, the single
match header action, award alignment, and focus return pass without renderer
exceptions.

Fourteen targeted stress groups pass, covering long Chinese/Latin suggestions,
report match identity and return focus, twenty-unit/nine-category expansion,
pending/loaded geometry, filters, pagination and keyboard table scrolling.
Thirty additional state checks cover long error messages and recovery in archive,
replays, decks, bans and cache; search failure/retry; mobile path editing; narrow
English navigation reorder/return; and confirmation cancellation/focus return.
No renderer exceptions were recorded. A raw scroll-width check flagged the
Settings tabs' decorative pseudo-elements; text-range checks and screenshots
distinguish those from clipped labels.

Current validation: `pnpm check` passes **1055 tests in 43 files**, type checking,
the UI guard and all production builds. The selected component run passes 200
tests; this is a subset of the full count. `pnpm format:check`, `git diff --check`,
`pnpm smoke`, and `pnpm smoke:real` pass. Real-data smoke loads 496 matches and
verifies native chrome, detail navigation, local records and responsive tables.
The two old unit-preview assertions were updated to check every row remains in
the adaptive viewport and that expand/collapse changes its state.

The first automated recording-page bottom capture was taken before Chrome
finished repainting the scrolled glass Card. A separate DOM/hit-test and settled
capture confirmed the Sound controls were present and operable. The matrix now
applies the development-launcher mask once before capture and waits after scroll;
settled bottom captures replace the ambiguous artifact. No product code changed
to hide this discrepancy.

The user clarified that names and titles must share one line and player rows
must remain equal in height. The review of the superseded two-line version was
cancelled. Scoreboard rows now keep a 2.75rem height with inline names and awards;
match dialogs use more desktop width and keep any remaining overflow inside the
team table. The unit hint and expansion action now share a compact 1.75rem footer
instead of occupying two separate rows. New browser, repository, native and Astra
evidence for these two corrections is recorded under `.test-data/ui-followup/inline`.
The revised layout passes 30 real player/match cases at five widths and both
appearances. All ten collapsed player rows measure 44px, with a 28px name/award
line. The unit footer measures 28px and its controls remain inline; the wide
profile viewport now uses 328px of the adjacent card's height. Both themes' real
1920px scoreboard captures fit every numeric column without horizontal overflow.
Twenty synthetic combinations cover long Chinese/Latin names, multiple awards,
both locales and themes at five widths. All three metric groups retain uniform
rows. Keyboard scrolling, independent award popovers, disclosure expand/collapse
and the compact footer pass without renderer exceptions.

The final isolated `pnpm check` passes 1055 tests in 43 files, type checking, the
UI guard and production builds. An earlier concurrent run hit the existing real
corpus scan's 10-second timeout (1054 passed, one timed out); its timeout and
application logic were not changed. Browser jobs completed before the passing
isolated rerun. The responsive native smoke expectation was updated from 1180px
to 1408px to match the wider inline-row two-team breakpoint. Formatting and diff
whitespace checks pass. Fresh `pnpm smoke` and `pnpm smoke:real` both pass, including
496 recorded matches, native chrome and the updated responsive detail layout.
Production Electron route inspection and the new independent Astra MAX score
follow after completion.

## Independent 8.8 review and corrective pass

The next GPT-6 Astra MAX review scored the whole application 8.8/10. It confirmed
the inline equal-height scoreboard and compact footer at 9.4/10 each, and the
single match header action at 9.3/10. Its new P2 findings were a false saved status
on Recording after a global save failure, a clipped English test-recording action
at 320px, and 4.22:1 information-award contrast on the light self row. A P3 finding
identified the settled empty Overview's oversized roster reservation.

The corrective pass combines both save owners with error/saving/pending priority,
places the recording action below the description in narrow containers, darkens
the shared light information token, and compacts only the settled no-room Overview.
The approved inline scoreboard and one-row unit footer remain intact. Six new
UI regressions exercise global failure across Recording navigation, retry and
discard in both locales, in-flight global saving, and recording-owned failures.
The targeted run passes all six; its 171 excluded tests are not counted as passed.

Fresh evidence lives in `.test-data/ui-followup/astra-fixes`. The route matrix now
covers all 15 pages at 1920/1440/900/375/320px in both locales and appearances,
plus empty Chinese scenes at 900/375/320px: 390 scenarios without measured text
clipping or renderer exceptions. Twenty-eight state checks pass, including global
and recording save recovery, recording-button focus/busy containment, and the
empty-to-populated Overview transition. At 375px, the empty session region is
245.5px rather than its prior 889px reservation; Recent matches starts at about
667px in the controlled populated-history scene. The populated room still reserves
889px at the same narrow size. A known room awaiting its roster also retains the
reserved layout rather than being treated as a settled no-room state.

Information awards in actual match 9216783 pass 72 contrast checks: six palettes,
both appearances, ordinary/self rows, and resting/hover/focus states. The minimum
is 4.99:1; the default light self row is 5.02:1. A live shared-preview inspection
also confirms the complete English test-recording label at 320px. Updated full
validation, independent score and production Electron inspection follow.

This pass's final `pnpm check` passes **1061 tests in 43 files**, including the six
new save-status regressions, plus type checking, UI guard and all production
builds. The real-data Overview documentation screenshot now shows the compact
waiting state and reachable history. Fresh `pnpm format:check`, `git diff --check`,
`pnpm smoke`, and `pnpm smoke:real` pass; real smoke loads 496 matches. The current
gallery displays the four corrective changes and all 15 pages in both locales
and themes at representative widths. Independent scoring and native route
evidence are recorded below as they complete.

The final recheck with default concurrency hit the same real-corpus scan's
10-second limit: 1060 tests passed and one timed out. The machine exposes 16
workers. Re-running `pnpm check` with the temporary supported
`VITEST_MAX_WORKERS=2` environment setting passes all 1061 tests in 43 files,
without skipping tests or changing the timeout or test assertions. The environment
setting was restored afterward. Formatting, builds and both smoke commands then
pass on the final code. The failed default-concurrency run is preserved in
`.test-data/ui-followup/astra-check-default-workers-timeout.log`.

## English label collision follow-up

The following independent Astra MAX review scored 8.9/10. It confirmed F1–F4
resolved, retained the approved inline scoreboard/footer scores, and identified
F5–F7: overlapping English unit headings, room role/rating collisions at 320px,
and a vertically cropped Recordings preview helper. Its report correctly
distinguishes those visible defects from the previous narrower zero-clipping
counter.

Unit metric columns now reserve stable localized label space inside the existing
scrollport. Narrow SessionPanel summaries use separate team/role and rating lines,
with a shared 44px header budget and Copy spanning both lines. Preview media keeps
a 208px minimum across placeholder and available-image states; the image remains
contained. The approved single-line scoreboard and compact unit footer remain.

Evidence is isolated in `.test-data/ui-followup/localization`. The refreshed
390-case all-page matrix checks neighboring table-header, team-summary and Card
header text rectangles, plus ancestor clipping of visible labels and Empty copy.
These selected checks find no collisions or clipping; they are not a universal
accessibility claim. All 15 routes retain both locale/theme coverage and settled
bottom captures.

The focused run passes 142 grouped checks without renderer exceptions: 20
size/locale/theme combinations cover both room routes, embedded and dialog unit
tables, pending/loaded column widths, all 15 real unit entries, horizontal keyboard
scrolling when necessary, independent expansion/refresh, a 28px footer, and
focus/hit-testing of Copy controls. Each combination also checks six preview
states, with two additional available-image cases. All preview content fits;
320px available-image and placeholder frames both measure 208px. English metric
columns measure 128px each with a positive gap between the translated headings.
Fresh required validation, display evidence, independent rescore and the final
production Electron route inspection follow as they complete.

The localization pass's `pnpm check` passes **1061 tests in 43 files** with the
temporary supported two-worker setting, plus type checking, UI guard and all
production builds. The worker environment is restored afterward. Formatting,
diff whitespace, `pnpm smoke` and `pnpm smoke:real` pass; real smoke loads 496
matches. The three corrections and fresh all-page screenshots were previewed and
displayed inline. The native harness includes English report/profile, populated
previous-room and preview text bounds at both native sizes and themes, as well
as the 60-case all-route matrix.

## Final independent score and production Electron inspection

The final GPT-6 Astra review at maximum reasoning effort scores the whole
application **9.1/10**, meeting the requested stopping threshold. It confirms
F5–F7 are resolved and retains the approved inline scoreboard and compact unit
footer. The independent report is preserved at
`.test-data/ui-followup/localization/astra-review.md`; its pending-native statement
describes the state at review time, before the inspection below. One nonblocking
P3 remains: the English recording-library description lacks a separator between
`Storage used` and its value. No further application changes followed the passing
review.

The production application was then launched in Electron with the built file
renderer, sandboxed preload, native SQLite service, and an isolated recorded-data
profile. Offline mode and disabled updates kept the inspection independent of
live services. It used neither Vite nor the browser fixture bridge.

- All **60 native route cases passed**: every one of the 15 routes in both
  appearances at requested window sizes 1920×1080 and 900×600. The actual renderer
  sizes were 1920×1080 and 900×601; the extra pixel at minimum size comes from
  Windows display scaling. No page overflow or measured text collision/clipping
  was recorded in the tested scopes.
- Four additional English contexts passed, covering both sizes and appearances:
  report/profile unit headings, populated previous-room summaries, and recording
  preview text bounds.
- The completed archive scan loaded **496 recorded matches**. Search/report return
  preserved the query and initiating focus. Profile expansion and real service
  refresh retained every recorded unit and category.
- Scoreboard rows remained **44px**, the unit footer remained **28px**, and match
  dialogs retained one header Refresh action without an internal toolbar. Enter
  opened match details, Escape restored focus, disclosures worked, and dialogs
  cleared the native caption area.
- All four route contact sheets were visually inspected, covering every native
  case. Individual minimum-size English unit and populated room captures were
  also inspected. There were **zero renderer exceptions** and the final harness
  recorded `interactionsPassed: true`.

The visible launch window measured 1281×851 inside the available 2560×1392 work
area, with its configured minimum unchanged at 900×600. The owned Electron
application and screenshot helper closed after inspection. Renderer screenshots
exclude OS-painted caption buttons; the separate native chrome smoke covers
their reserved geometry.

Current native results and captures are in
`.test-data/ui-followup/localization/electron/results.json` and its sibling PNGs;
the run log is `.test-data/ui-followup/localization-electron.log`. These results
supersede the earlier native captures for the final uncommitted application.
The final application validation remains **1061 tests in 43 files**, type/UI
checks, production builds, formatting, and both required smoke commands, as
recorded above. Documentation-only completion does not require rerunning that
matrix. Packaged installer/update validation, hardware recording, and actual
screen-reader speech remain outside this review. No commit was created.

## Tailwind implementation follow-up

The subsequent request audits handwritten CSS and migrates ordinary styling to
the existing Tailwind CSS v4 pipeline. The
[migration audit](ui-audit.md#tailwind-migration) records the 3,111-to-244-line
layout stylesheet reduction, retained browser/native foundations, 180-case
computed-style comparison, 390 refreshed route cases, 142 focused checks,
30 real-data cases, and the current 1061-test validation. The approved inline
scoreboard and compact footer remain intact. This is a new implementation
iteration; the independent score and native inspection above describe the
preceding version, not a new review of the migration.

The migration's independent reviews subsequently scored **8.2 then 9.2/10**.
The corrective pass restored responsive dialog caps and inclusive breakpoint
behavior, adding explicit portal and boundary assertions. After the passing
9.2 Astra MAX review, production Electron passed 90 native route cases and six
English contexts with 496 matches and zero renderer exceptions. The full
[migration audit](ui-audit.md#final-migration-acceptance) records the exact scope,
normal-motion harness readiness correction, combined run provenance, final
validation, and limits. The approved 44px inline scoreboard and 28px footer
remain intact. No application changes or commits followed that passing review.
