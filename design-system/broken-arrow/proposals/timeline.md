# Match timeline

Status: implemented in the match-detail Timeline tab, shared by archive pages and
contextual match dialogs.

[Production integration and validation](../../../docs/timeline.md) ·
[Standalone design reference](../../../docs/prototypes/timeline/README.md)

## Intent

Provide one readable path from match context to team trends, key intervals, and
underlying unit records. Reuse BARadar's quiet glass surfaces, neutral hierarchy,
semantic colors, tabular values, and shadcn primitives. Do not duplicate ba-dragon's
screen layout, moralizing event labels, or dense explanatory copy.

The logic reference is [ba-dragon](https://github.com/AlexanderHYu/ba-dragon),
particularly `src/shared/match/report.ts` and `moments.ts` at
`072dc9bc2d73ffc87000c1d3db4c0f9b4dcab549`. This prototype independently implements
selected aggregation and event rules using BARadar's existing recorded corpus.
No upstream UI or source implementation is copied.

## Composition

- Reuse the existing match-detail identity, duration, outcome, recording actions,
  and navigation. Do not duplicate the match header, breadcrumbs, or theme switch
  inside the Timeline tab.
- At desktop widths, the main trend and minute losses share one glass card;
  chronological key moments occupy the right column.
- Below 1100px of available component width, a 180px full-match overview replaces
  the detailed chart controls. Rounded value ticks and adaptive time labels keep
  narrow content readable. Application chrome and source warnings retain their
  own space; the standalone prototype's three-event viewport budget does not
  include that host chrome.
  Tapping a plotted time opens its five-minute detail directly; keyboard activation
  and the “细看” header action offer the same one-step inspection. The initial cursor is match end, without a
  preselected event. The overview header exposes minute data directly, without
  requiring chart expansion. Detail reveals the charts; the secondary loss
  chart remains collapsible. Larger touch targets remain intact.
  Selection stays in the event list, minimally revealing expanded content only
  when it would otherwise be clipped. Explicit five-minute inspection opens the
  detailed view and the secondary chart for loss events. Desktop retains its
  chart-footer summary, list-location link, and previous/next controls. In narrow
  overview mode the full chart scrolls normally. Selection expands evidence and the
  inspection action within the event row, without a separate sticky summary.
  Activate the same row again to clear the selection. Five-minute inspection
  restores the plots. Expanded narrow layouts keep one sticky navigation card
  above the plots, inside the scrollport below the workspace or dialog header. Its “返回概览” exit has the same name
  and top position for overview and event entry. Selection adds evidence,
  previous/next controls, and position to that card; clearing selection leaves its
  navigation intact. Player/team, event type, and relevant estimated loss remain
  in the inspector. Single-unit facts use inline label/value pairs to preserve
  that context without increasing the card height. Returning without a selection restores overview focus,
  while event inspection returns to the list anchor. The identity row says “所选” and shows the selected event's interval.
  Do not put the changing inspection time in that card: it belongs to the chart
  readout and scrubber, independently of retained event evidence. Paging changes the event and restores the whole
  inspector without returning to the list, retaining keyboard focus on the control.
  Restoration uses the non-sticky chart's flow position rather than repeatedly
  scrolling the sticky header. Account for scrollport padding in dialogs and keep
  all movement inside the host scroller. Card spacing follows the shared 16px
  content-gap token. This replaces the chart-footer context and duplicate in-list
  evidence; narrow application content remains scrollable without clipping controls. This
  preserves context in both directions without implying that locating a row also
  seeks time.
- Event marks occupy a reserved annotation band above the plot, enlarged when
  mixed category labels require multiple lines, and aligned to its time
  scale. Single marks show recorded unit short names or casualty counts, with
  solid blue and dashed yellow underlines identifying teams. Clusters expose
  each category's count (for example, “损失×2”, or separate “高光×1” and “侦察×1”
  lines), with choices opening above the plot. Font-measured widths determine
  collisions, and merging rechecks preceding groups. A separate visible rail
  caption or icon legend is unnecessary. Interval marks use their midpoint without
  implying an exact kill timestamp. Marker activation locates the event row;
  a calculated scroll offset keeps it below the sticky context.
- A selected event shades its interval and seeks its recorded start, explicitly
  identified in the readout; five-minute inspection centers the whole interval.
  Exact-second selection, cursor, slider, and field values agree. An interval
  starting on a minute boundary selects its following loss bucket and table
  sample, without moving the exact-second cursor. Hovering or selecting a loss
  bar or seeking from the minute table uses the explicitly inspected bucket,
  even when it ends at the event start. The selected event remains anchored; only explicit clearing, deselecting, or changing event filters
  removes its context. The loss chart separately labels its minute bucket.
- Each moment uses the same aligned timestamp column, unit/player hierarchy, and
  right-aligned value. Selection reveals only relevant evidence, inline on desktop
  or beside the inspected plots in expanded narrow layouts. Long
  death lists open in a bounded, scrollable shared Dialog with sticky column
  headings, the visible row range and total, native scrollbars, and an outlined
  “查看上一段” / “查看下一段” navigation. Both retain their direction and disable at
  their respective boundaries; a separate control returns to the top. Narrow
  footers wrap these controls without overflow. Minute tables use
  grouped team headers with separate field-value and loss columns, and reveal the
  current minute automatically. The title explicitly labels the interval as
  “当前定位”, independently of the footer's “浏览” row range. Paging does not seek.
  The time column names the interval end, and the 00:00 opening snapshot is labeled
  separately. Time buttons and row clicks/taps close the table
  and seek the corresponding minute-end sample, revealing the plots and moving
  keyboard focus there after dismissal. An out-of-window seek recenters the
  existing window without discarding the selected event. A calculated six-row
  native viewport measures the rendered time actions and avoids clipped initial
  records; continuation steps align to full rows. Recalculate
  sticky body clipping after the shared
  Dialog's opening scale animation to prevent header/row overlap.

## Data meaning

- Field value is a proxy: cumulative estimated spawn value minus estimated loss
  value, excluding refunded sorties with unknown return times. The force view's
  secondary readout states “非在场值 · 回收除外” upfront, replacing its redundant
  inline advantage value; the dedicated difference view retains that calculation.
  The estimate label opens the full method, and chart descriptions preserve the
  limitations for assistive technology.
- Unlike the reference's minute-only main trend, the draft uses second-resolution
  snapshots from recorded spawn/death times. This prevents event cursors from
  implying that a later minute-end sample is the selected instant.
- Difference means **Alpha minus Bravo**, with a visible formula and zero baseline.
- Net change means **the previous 60 seconds**, not whole-match advantage.
- Loss columns represent minute totals at interval midpoints; the last interval
  is only 19 seconds. A five-minute window enlarges short intervals without
  changing the source values. Both charts share the window and selection, and the
  selected loss minute is emphasized. The accessible minute table offers a
  non-visual and non-hover alternative.
- High-kill events describe sortie intervals, not precise kill moments or victims.
  Recon events identify deployment only, without claiming subsequent causation.
- Peaks are ranked loss minutes, not assertions of an exceptional collapse. Rapid
  deaths use role-dependent thresholds and estimated prices, disclosed in the
  method note and prototype documentation.
- Player and event-type filters affect markers and the moment list, not the
  global curves.

## Accessibility and scope

Team curves use both color and line style. Loss bars keep at least 90% opacity;
selection adds an outline. Browser QA samples their rendered light-theme contrast
against the actual card surface rather than relying only on token values. Chart controls have descriptive names,
visible keyboard focus, second/minute navigation, and spoken value summaries.
Plot clicks and touch taps use the rendered Recharts inverse data scale, not
cached hover state. Hover preview uses that same inverse scale, avoiding separate
tooltip rounding. A click pins its time and values through stationary events and
tiny pointer jitter; deliberate movement resumes preview, and leaving restores
the pinned sample. Capture-phase handling above SVG layers prevents cursor lines
from intercepting later taps. Pans and canceled gestures do not seek; vertical
scrolling and pinch zoom remain native. The full-width scrub surface has a 44px
minimum touch height and explicit one-second adjustment controls. Coarse-pointer
screens show the concise “轻点定位” hint rather than desktop arrow-key wording;
keyboard support is unchanged. Segmented radio groups select on arrow navigation; signed
chart scales use rounded ticks including a labeled zero.
The time slider, event buttons, dialogs, tables, and filters use semantic controls.
The event-type selector uses the same line tabs as the match detail views: a
text-width underline marks the selection without a checkmark or pill. Timeline
actions, segmented options, and dialog close buttons use their shared control
sizes. Plot markers keep larger hit targets on coarse pointers. The player filter uses the shared Select with a glass listbox, team
groups, the standard desktop trigger height, and a 44px touch target. Cluster category labels match the filters, while
individual marks identify the event directly. The chart’s Toggle `filter`
variant retains its checked accent fill, border, and checkmark;
existing variants remain unchanged. Essential axis labels, timestamps, event
metadata, and minute data use 14px text with compact column padding. Essential
secondary values, evidence labels, table losses, and continuation status use 80%
foreground. Category glyphs are not repeated beside unit names.
Chart axes
opt into the shared foreground label tone for clear numerical reading. The shared
`TableRow` `current` emphasis uses an accented selected row and a leading marker;
its default treatment remains unchanged. Portal close controls use the active
Chinese/English locale. Filtered empty results retain a clear reset action;
records without derived moments instead explain that charts remain available. Theme tokens carry both light and dark
rendering, and reduced motion is respected.

The application uses existing match routes and app-level theme/locale preferences.
Timeline requests have real loading, error/retry, unavailable, and stale-data
states, with no substitute chart when timing data is absent. Inspection state is
local to the mounted view. Recording playback remains a separate match action;
no replay availability, time alignment, or video seek is inferred from unit data.
