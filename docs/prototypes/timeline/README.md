# Timeline UI prototype

An isolated, interactive BARadar design reference. Its build does not read/write
the installed application profile. The [production integration](../../timeline.md)
now lives in the match-detail Timeline tab, using typed RPC data and localized
application components rather than importing this prototype.

## Build and open

```sh
node docs/prototypes/timeline/build.mjs
```

Open `.test-data/previews/timeline.html` directly. The HTML contains its React,
shadcn, Recharts, Tailwind styles, and selected recorded match data. No server,
network request, external font, or media asset is needed. Generated previews and
screenshots stay in the ignored `.test-data/` directory. The outer gutter belongs
to the embedding host; the prototype intentionally adds no competing page shell
or side padding.

## Real data

- Match **9485138**, **Baltiisk**, October 31, 2026 at 12:35 (UTC+08:00).
- Official duration **22:19**, Alpha **3–0** Bravo, ten recorded players.
- Source: `tests/fixtures/batrace/offline/responses-044.json.gz`, record
  `match:9485138`. `source.mjs` verifies every consumed shard against the committed
  manifest before extracting data.
- The response has 401 sorties; 400 fall within the official duration. One
  post-duration spawn is excluded rather than moved onto the timeline.
- Unit names come from recorded player-analysis `highlightUnits`. Base prices and
  roles come from `packages/shared/src/titles/model.json`. Unknown names stay as
  unit IDs rather than being invented.
- Estimated spawn and loss prices are separately scaled to the player's official
  totals. Refunded sorties are excluded from the field-value proxy because their
  return timestamps are not available. This is **not** exact in-field strength or
  loadout pricing. The force readout states “非在场值 · 回收除外” without requiring
  an interaction; the detailed formula remains in the on-demand data note.
- The high-kill interval (Ka-50 Akula, 00:03–01:33, six kills), two drone deployment
  times, one rapid-death interval, and each team's peak-loss minute are derived
  from these records, not hand-authored sample events.

The build also writes `timeline-source.json` beside the preview for provenance.

## Design and interactions

See the [timeline proposal](../../../design-system/broken-arrow/proposals/timeline.md).
The UI uses the application's existing glass Card, ToggleGroup, Slider, Popover,
Dialog, Table, Empty, and Chart primitives. Shared changes are opt-in: a `filter`
toggle variant with checked accent/border and lighter hover, `TableRow`
`emphasis="current"` for the inspected minute, and Chart `labelTone="strong"` for
foreground axis labels. Existing defaults are unchanged. All ordinary component styles use
Tailwind utilities. `preview.css` contains standalone document foundations, native table scrollbars
mirroring the application, and reduced-motion handling only; the transparent outer page is suitable for inline
embedding.

Implemented: three chart views, full-match/five-minute windows, pointer and keyboard
positioning, exact-second readouts, linked loss intervals, event selection,
player/type filters, recoverable empty state, bidirectional event/chart navigation,
previous/next events, record dialog, minute data table, data-method popover, and
light/dark themes. Loss columns sit at their interval midpoints rather than
straddling the next minute; the final partial interval remains visible when zoomed.
Plot selection uses Recharts' rendered plot geometry and data-snap inverse scale,
not a preceding mouse hover. Pointer capture-phase handlers sit above all SVG
layers, including the moving cursor. Hover and click now use the same inverse-scale
sample rather than separate tooltip rounding. Click confirmation stays pinned
through stationary events and tiny pointer jitter; leaving the plot preserves its
time and values. Intentional movement resumes preview. Mouse clicks and touch taps
select the same sample; panning/canceled gestures do not seek, and native vertical
scrolling and pinch zoom remain available.
Table headers stay pinned, with the visible row range, total count, native
scrollbar, and paired “查看上一段” / “查看下一段” controls. Each keeps its direction
and disables at its own boundary; returning to the top remains a separate action.
The controls wrap on narrow screens instead of overflowing. Minute data uses a calculated
six-row viewport, so initial and stepped views contain complete records, including
44px touch targets. The minute dialog title labels its interval as “当前定位”,
including the final 19-second bucket; the footer labels the visible row range as
“浏览”. Scrolling changes that browse range without implying that the inspected
interval moved. The time column identifies the interval end. The opening 00:00
sample is explicitly an opening snapshot, not an elapsed minute. A time action or row click closes the minute dialog, expands
the analysis, and seeks that exact minute-end sample. Keyboard activation uses
the time button. Focus transfers to the chart only after dialog dismissal;
Escape still returns to the table trigger. The existing event anchor and window
mode remain intact, with recentering when the selected time falls outside the window. Reference
captures retain native scrollbars and use explicit full-height canvases to avoid
Playwright full-page cropping during scrollbar-induced width reflow.
Interval selection starts at the recorded beginning, explicitly labeled as the
start, while five-minute inspection centers the interval. When a selected range
begins on a minute boundary, the loss readout and table target its following
minute, not the preceding bucket; second-resolution field values still use the
exact cursor time. Event selection is anchored independently of the inspected
timestamp; scrubbing never removes its return link. Both the overview and detailed plot have clickable,
keyboard-accessible event markers aligned with their time axis. Interval markers
use the interval midpoint, not an invented kill timestamp. Individual marks show
recorded unit short names or casualty counts, with solid blue or dashed yellow
underlines for teams. Clusters expose every category and its count before opening
(for example, “损失×2”, or separate “高光×1” and “侦察×1” lines). Their widths are
measured in the rendered font; clustering rechecks earlier groups after a merge
so wider labels cannot collide. A reserved 52px annotation band separates marks
from plotted values, without a redundant visible rail caption. Choices open
preferentially above the plot. Selecting a mark locates its row below the sticky context.
Player/type filters apply to both markers and the event list. A full-width 44px scrub surface and one-second
buttons support touch precision. Coarse-pointer screens show “轻点定位” instead
of the desktop keyboard hint; the keyboard controls remain available. Segmented radios use arrow-to-select behavior,
and chart axes use rounded steps with an explicit zero.

At stacked widths, the initial view prioritizes events: a 180px full-match overview
uses rounded value ticks and five time labels at 390px, while retaining at least
three complete events within an 844px viewport. A plot tap selects its exact time
and opens the surrounding five-minute detail directly. The keyboard-accessible
overview and its “细看” action also open five-minute detail in one step. The initial cursor is the actual match end, with
no event preselected. Minute data is directly available in the overview header,
without first expanding the charts. Detail reveals the charts and controls; the
secondary loss chart remains collapsible. An event's five-minute action restores
the full view, zooms to its neighborhood, and opens the loss chart for loss events. Minute data opens at, highlights, and reveals the current minute.
Light-theme loss bars retain high baseline opacity; selected bars add an outline
rather than relying on extensive dimming. On narrow screens, the complete overview
always stays in normal document flow. When an event is selected in overview mode,
a single-row summary after the filters offers its time, unit, inspection action,
and clear control. Only this small summary can stick; placing it after the filters
prevents it from covering them. Inline evidence omits a duplicate inspection action.
Selection minimally reveals a newly expanded row when needed, keeping late-event
headers and evidence on screen rather than jumping to the chart. Explicit
five-minute inspection restores the plots. List-location actions do not imply a time seek.
Checked filters have persistent checkmarks. Cluster category names match the
filters; individual marks identify the event itself. Neither requires an icon
legend or repeated category glyphs beside list unit names. Analytical axis labels, event times,
metadata, and minute data use 14px text. Essential secondary values, evidence
labels, table losses, and continuation status use an 80% foreground tone. The current minute has an accented row and
leading marker; dialog close controls are localized. In expanded narrow layouts,
a sticky navigation card always sits above the plots, with the same “返回概览”
exit in the same top position regardless of whether detail came from the overview
or an event. Without a selected event it remains a compact navigation strip;
with a selection it adds evidence, previous/next controls, and position. The
inspector retains player/team attribution, event type, and estimated loss where
applicable. Compact inline lifetime/kill/damage pairs make room for that context
without adding another row to the inspector. Returning
without a selection restores overview focus; event inspection returns to its list
anchor. Its identity row explicitly labels
“所选” and shows the event's own interval, never the changing cursor time. Current
inspection time belongs to the chart readout and scrubber, preventing an anchored
event's lifetime facts from being mistaken for facts at a different inspected second. Users can inspect successive events
without returning to the list; repeated keyboard paging retains button focus.
Chart restoration aligns from the non-sticky plot card, avoiding accumulated
sticky-position scroll drift. The context replaces both the chart-footer summary
and duplicate in-list evidence; selected plots and facts fit
in the initial 844px phone viewport. Filters affect events only; the team
curves remain global. Team-level peaks remain visible when the selected player's
units occur in their record list.

No playback controls are fabricated: the selected offline fixture does not supply
a playable recording. Production navigation, translated UI resources, alternate matches, and missing-source
states are implemented in the application counterpart. This single-match reference
does not provide recording alignment or persisted inspection preferences.

## Validation

```sh
pnpm exec tsc -p docs/prototypes/timeline/tsconfig.json
pnpm exec vitest run tests/timeline-prototype.test.ts
node docs/prototypes/timeline/build.mjs
node docs/prototypes/timeline/qa.mjs
pnpm check
pnpm format:check
pnpm smoke
```

The dedicated model suite contains 31 regressions; six additional tests cover the
shared filter, table-emphasis, and chart-label variants and their existing defaults. Browser QA covers:

- All chart modes and their units/formula, both themes, and 1280/728/390/360px widths.
- A 00:03–01:33 interval selects its exact 00:03 start, not a minute-end sample.
- Boundary-start intervals retain their own loss minute and table sample.
- One-tap access to minute data from the compact overview, without chart expansion.
- Chart arrow/PageUp/Home/End navigation, visible focus, named slider semantics,
  announcements, and the accessible minute table.
- Cold touch selection without hover, all three modes, mouse/touch parity,
  zoomed loss columns, the partial final minute, and native pan cancellation.
- Minute-table time buttons, row clicks/taps, keyboard activation, out-of-window
  seeking, exact final-time selection, and chart focus after dialog dismissal.
- Minute-bar pointer values, chart pointer selection, and the time slider.
- Event context while scrubbing, one-second adjustments, and actual touch taps.
- A retained Ka-50 interval at a 04:00 cursor, explicit selected-event identity,
  and chart restoration without seeking back to the event.
- Non-in-field and refund caveats visible in the force view before opening details.
- Matching hover/click time and values at fractional plot coordinates, click
  confirmation through pointer jitter, and unchanged values on pointer leave.
- Identically positioned/named detail exits from overview and event entry, including
  selection clearing and overview focus restoration.
- Arrow-key radio selection and rounded axes with an explicit zero.
- Record dialog content, Escape/focus return, sticky headings, and continuation.
- Mobile chart/event round trips, previous/next navigation, and 44px touch targets.
- Five-minute zoom, direct event inspection, and the final partial-minute boundary.
- 180px compact overview, five time labels, and one-step detail via plot touch,
  keyboard activation, and the header action; loss-chart expansion and minute-table reveal.
- Unit-specific labels, category counts, measured-label collision prevention, and
  keeping multiline annotations above plotted values.
- Post-animation sticky-header clipping and screenshot-sampled light loss-bar
  contrast above 3.2:1.
- Compact sticky context, chart restoration, checked-versus-hovered filters, and
  localized dialog close controls.
- Late-event expansion without filter occlusion, non-sticky full overview,
  single-row summary after filters, short-viewport scrolling, and inspection recovery.
- Keyboard marker navigation, self-labeling 14px marks without collisions,
  clustered choices, filtering, and time-window alignment.
- Mobile event paging in both directions, disabled boundaries, retained keyboard
  focus, no sticky-header occlusion, and chart restoration from the bottom of the list.
- Previous/next segment round trips, disabled boundaries, repeated clicks, a 3px
  end remainder, and return to top at desktop, 360px, and 390px/DPR 1.5.
- Explicit current-position titles versus browsed row ranges, final partial
  interval, opening snapshot, and coarse/fine-pointer hint wording.
- Patriot inspection retains HOKY, rapid-death classification, estimated loss, and
  lifetime, with the complete plots still visible in the phone viewport.
- Player/type filters, empty-state reset, and a long non-Latin player name.
- No horizontal overflow or browser runtime errors.

Screenshots and numeric results are written to `.test-data/previews/timeline-qa/`.
The shared opt-in primitives also receive an isolated Electron smoke check. The
separate application integration has its own RPC, browser, and real-data desktop
coverage; neither validation path changes the installed user profile.
