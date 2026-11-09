# BARadar UI design system

BARadar (断箭蛐工具) uses one React interface for Electron and the isolated browser
preview. This is the current design specification. It replaces the earlier flat
surface, Font Awesome, split-stylesheet, and oversized dark-shadow guidance.
The implementation files below are the source of token values and component APIs.

## Sources of truth

The implemented [match archive and detail specification](proposals/match-detail.md)
documents the approved redesign. Its isolated prototype remains a historical
design reference; application components are the source of current behavior.

| Concern                                                                   | Implementation                                                                                                                   |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Theme primitives, semantic colors, glass tokens, typography, radius scale | [index.css](../../apps/web/src/styles/index.css)                                                                                 |
| Browser/native foundations and shared layout variables                    | [layout.css](../../apps/web/src/styles/layout.css)                                                                               |
| Shared glass surface and Card composition                                 | [card.tsx](../../apps/web/src/components/ui/card.tsx)                                                                            |
| Shared content and floating glass material                                | [surfaces.ts](../../apps/web/src/lib/surfaces.ts)                                                                                |
| Card choices and compact toggles                                          | [toggle.tsx](../../apps/web/src/components/ui/toggle.tsx), [toggle-group.tsx](../../apps/web/src/components/ui/toggle-group.tsx) |
| Application Card, Dialog, Field, Stats, and action wrappers               | [ui.tsx](../../apps/web/src/components/ui.tsx)                                                                                   |
| Appearance resolution and native caption colors                           | [useAppearance.ts](../../apps/web/src/hooks/useAppearance.ts)                                                                    |
| Mode, opacity, ELO colors, and palette controls                           | [AppearanceSettings.tsx](../../apps/web/src/features/settings/AppearanceSettings.tsx)                                            |
| Valid preferences, palettes, and opacity limits                           | [rpc.ts](../../packages/contracts/src/rpc.ts)                                                                                    |
| Latest component audit and deliberate exceptions                          | [UI audit](../../docs/ui-audit.md)                                                                                               |

## Styling implementation

Use Tailwind CSS v4 utilities in React `className` values for layout, spacing,
typography, scrolling, and responsive behavior. Compose the existing shadcn
primitives and their variants; keep surface styling in the shared primitives.
Use `cn()` for conditional classes and preserve semantic color utilities such as
`text-muted-foreground`, `bg-card`, and `text-(--elo-increase)`.

Named containers use `@container/name` with container-query variants on their
contents. Use descendant and data-state variants for shared table structure and
component states. Class names such as `profile-unit-preview` and `session-layout`
may remain as stable interaction and audit hooks; ordinary visual rules belong
with the component's utility classes. Do not recreate a parallel component
stylesheet by wrapping old selectors in `@apply`.

Existing inclusive breakpoints use named Tailwind variants such as
`workspace-max-48:` and `viewport-max-767:`. Their `@custom-variant` definitions
in `styles/index.css` preserve the original `max-width` conditions and cascade
order. Tailwind's ordinary `max-[]` and `@max-[]` variants use an exclusive upper
bound; they are not equivalent replacements. Keep layout queries aligned with
shared row-budget variables, and inspect the exact boundary and adjacent widths,
including fractional container widths.

`styles/index.css` remains the source of shared theme and design tokens.
`styles/layout.css` contains browser foundations, authored scrollbars, Electron
caption geometry, shared asynchronous row-budget variables, forced-color
support, and reduced-motion safeguards. These rules have global, native, or
calculated behavior that benefits from a shared stylesheet. The development
panel retains its Shadow DOM host rules; the isolated recorder keeps its tiny
capture-document stylesheet.

When replacing an unlayered rule, verify the resulting shadcn state styles and
`cn()` merging. A font-size utility can remove a primitive's earlier line-height
utility; specify the intended line height when that happens. Prefer matching
state variants over increasing specificity. The application frame deliberately
uses important radius utilities to override the Sidebar primitive's inset state
while retaining the approved native workspace silhouette.

Custom dialog maximums must also supersede the primitive's responsive maximum.
For example, the profile uses `max-w-288 sm:max-w-288` to override the default
`sm:max-w-sm`. Validate actual portal widths and require the intended wide
two-column profile/scoreboard arrangement; accessible scrolling alone does not
prove that the desktop layout was preserved.

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
| Floating opacity    | `80% + 20% × glass opacity`; 90% by default                         | Same formula with the dark card color |
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

`glassMaterialClasses` in `lib/surfaces.ts` defines the shared shadow, blur, and
saturation. `cardSurfaceClasses` adds the content-card fill, border, and radius;
both `Card` and the Toggle `card` variant reuse it. Floating surfaces consume
`glassOverlaySurfaceClasses` from the same module. Keep material values shared.

The `--popover` semantic role aliases `--glass-overlay-surface`, derived from the
same card color with `80% + 20% × --glass-opacity` coverage. Thus the 40–100%
preference yields 88–100% floating coverage, with 90% at the default. This higher
coverage keeps text legible above arbitrary content while retaining the shared
glass material and continuous preference updates. Text and icons remain opaque.
At 100%, both content and floating surfaces become opaque and backdrop blur stops.

Tooltip, rich Tooltip, Popover, dropdown and submenu, Dialog, AlertDialog, Sheet,
chart Tooltip, and Sonner toast all use this material. Use the shared 14px outer
radius; a screen-edge Sheet keeps flush corners against the viewport. Floating
outlines use the shared glass-border color through a 1px ring, preserving dialog
and table content budgets. Sonner's unlayered vendor shadow is explicitly
overridden by the shared Tailwind shadow utility. Do not restore inverse tooltip
fills, hardcoded light/dark panels, or feature-specific surface overrides.

Hover Tooltips keep their glass surface and content stationary. Do not fade,
scale, or slide a backdrop-filtered hint: animated hint layers can leave stale
pixels in neighboring glass cards. Preserve the existing delay, placement,
hoverable content and keyboard behavior. Rich Tooltips share the Popover surface
classes without its animation; pinned Popovers retain their existing motion.
Paint regressions must sample before hint visibility as well as after it.
Capture the viewport once per sample and compare the preview interior and lower
row/gap from that same image; record actual timing, scroll position, and hint
identity. Cover rapid re-entry and direct swatch movement at DPR 1 and 1.5.
Treat contradictory preview captures as an open diagnostic until compared with
the application's displayed desktop output; DOM bounds alone do not prove paint.

Dropdown submenus own their Radix Portal in the shared primitive. A backdrop
filter creates a containing block, so a submenu inside the scrolling parent
can have valid bounds while being clipped and unreachable. Keep the parent
scrollable and test actual pointer selection, ArrowLeft/ArrowRight navigation,
Escape, and focus return with `pnpm test:ui` at both opacity extremes.

The design guard checks static classes in direct attributes, `cn()` calls and
aliases, conditional/logical expressions, arrays, and object keys. It normalizes
Tailwind modifiers and rejects local fill, outline-color, radius, shadow, and
backdrop overrides. Runtime-generated classes and indirect variable values still
require code review and browser inspection; this is a static guard, not a
complete evaluator of feature styles.

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
  Each preview circle owns an isolated, paint-contained layer so its blurred,
  overscaled gradient cannot paint into neighboring glass cards. Keep selection
  indicators and keyboard focus on the outer ToggleGroupItem, outside that clip.

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

| Surface                                                                     | Treatment and reason                                                                                                        |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Dashboard, room, player summary, deck, recording, cache, and settings cards | Shared glass Card                                                                                                           |
| Archive grid cards                                                          | Shared glass Card; custom content density is allowed, a separate radius is not                                              |
| Appearance mode and ELO choices                                             | Shared glass Toggle `card` variant                                                                                          |
| Workspace, sidebar, and titlebar                                            | Flat semantic background; keep navigation and native caption controls legible                                               |
| Dialog, alert dialog, sheet, popover, dropdown, tooltip, chart hint, toast  | Shared raised glass material and semantic foreground; coverage follows the global glass preference with a readability floor |
| Data-table frames, sticky headers, and profile tables                       | Solid semantic surfaces, clear borders, and independent scrolling; rows must not bleed through sticky labels                |
| Alerts and selected list rows                                               | Semantic feedback or muted fills; these communicate state within the surrounding layout                                     |
| Inputs, sliders, switches, badges, and compact filters                      | Their shared control variants and semantic colors; do not add a glass layer to every control                                |
| Video frames, display previews, and the recorder canvas                     | Media-specific neutral or black fills preserve framing and playback contrast                                                |
| Theme wireframes and palette swatches                                       | Illustrations of palettes; decorative gradients and preview-specific edge effects are confined to these illustrations       |
| Approved logo                                                               | Preserve the supplied image colors and white background                                                                     |

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

Archive-card ELO changes use the shared Badge `value` variant: bare 18px bold
tabular figures with the map title's snug line height, with no pill, fill, border,
or extra padding. Align the map title and value on their first text baseline in
the CardHeader; the CardAction occupies only the title row. Match their loading
placeholder heights as well. Keep the localized accessible ELO-change label and
semantic increase/decrease color.
Status, result, player-title, and self badges retain their respective variants.

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

- Workspace pages share a visible title, a short localized purpose description,
  and a log-listening status Badge. Settings categories use the same heading scale
  and description spacing; their toolbar labels remain breadcrumbs rather than
  duplicate headings. Dedicated archive details own their heading and hide the
  workspace heading. Long status messages wrap inside the available width.
- Settings purpose descriptions appear once. Content Cards use specific section
  titles, and the navigation editor shares the workspace's localized panel labels.
  Workspace and Settings navigation retain a narrow active marker independently
  of hover and keyboard focus.
- Responsive teams and deck panels follow the workspace's available content width,
  including the space taken by an expanded sidebar. Stack below 48rem instead of
  relying only on the viewport. Room metadata uses the shared 12px secondary-text
  size; avoid nested `small` elements that shrink it again. Inline ban searches
  have a flexible basis so complete toolbar controls can wrap without collisions.
- Player Search presents current-room suggestions in a shared Card. Selecting a
  player focuses the report region and scrolls it into view in a narrow workspace.
  A visible Back to players action cancels pending report requests, preserves the
  search and results, and restores focus to the initiating player, including a
  remounted room suggestion. A cancelled response must not reopen the report.
  Suggestion buttons stay within their Card; long names wrap within a separate
  identity span and retain their complete accessible names.
- Recent-match tables retain every column at all widths. Keep match identity and
  its detail action visible in a sticky first column, and scroll secondary data
  inside a labeled, keyboard-focusable viewport. Bans also retain player identity
  while scrolling. Show a localized overflow hint only when a table is wider than
  its viewport. Custom scrollbar thumbs must reach 3:1 against their actual
  surface in both modes, including their unhovered state.
- `ReportMatchTable` owns recent-match column sizing for both embedded reports
  and profile statistics. Use intrinsic table layout with compact columns and
  container-relative minimums; reserve extra label space for English result and
  objective headings. Let the timestamp column absorb spare width. Keep numeric
  headers and values right-aligned with tabular figures, and center results.
  Do not add competing column-width or cell-padding rules in the profile wrapper.
  Loading skeletons fill their cells without imposing intrinsic pixel widths,
  preserving normal pending/loaded column geometry. Unusually large values may
  expand the table inside its existing scroller rather than overlap or truncate.
  At a 900px window, the ordinary recorded table fits all nine columns, including
  time, in the 800px profile viewport in both Chinese and English.
- On mobile, archive account/result filters live in a shadcn Popover. Keep Add
  match and the view/refresh controls visible outside it, preserve selected filters
  through dismissal and view changes, and restore trigger focus on dismissal.
  Narrow pagination uses an explicit current/total page count with Previous/Next;
  wider layouts show the complete calculated number/ellipsis sequence.
- Mobile navigation closes with a single Escape and restores the opener unless
  navigation has already moved focus to the destination. Avoid automatically
  opened tooltips on the drawer's initial close control, and do not mount hidden
  menu tooltips in mobile navigation.
- Overview has four equal summary columns, followed by a full-width room panel
  and the recent-results/tools grid. Summary details hide when their individual
  cards are too narrow; primary values stay on one line.
  Latest ELO and recent win rate use the current session's player ID, falling
  back to the persisted active account while the room is empty or the game is
  closed. Keep that account through idle session events, and replace it when a
  new local player ID is resolved. Never select an account from archive ordering
  or combine different accounts' results; missing personal data stays unknown.
  The fourth metric shows the recording library's file count with the Video
  icon. Load it independently from match statistics, refresh it on recording
  library events and save-folder changes, and distinguish loading or unavailable
  counts from a confirmed zero.
- Room panels reserve the standard responsive 5v5 height in empty, party, and
  match states. Pre-match parties reuse Alpha's presentation without modifying
  the underlying lobby member data. Keep player ELO and query results aligned.
- Overview and Radar retain their independent current/previous selection.
  Contextual match details and player details use the shared dialogs. The archive
  opens a dedicated workspace detail page at `#archive/match/{fid}` through a
  list action menu, a noninteractive row click, or a grid card click. List rows
  combine actions into one outlined control: Refresh acts directly, and its arrow
  opens View details, Open BATrace, and a separated Delete item. Keep pending and
  missing-ID actions disabled, preserve deletion confirmation, and restore the
  arrow's focus after returning from details. Preserve filters, sorting,
  pagination, and scroll position when returning.
- Archive list columns keep compact widths sized for their localized labels and
  values. Only the map column absorbs additional window width; the account column
  stays at 120px, truncates long names, and exposes their full text on hover.
  Derive the table's minimum width from its column sizes and keep horizontal
  scrolling within the table viewport. Loading and populated rows share widths.
- Match details share one content component between the page and dialog. Show
  identity/outcome, recording actions, a compact personal summary, and core,
  combat, and support tabs. Team tables use six columns with tabular numbers.
  Size numeric columns to their headers and values, leaving the remaining width
  for player names and awards instead of distributing extra space by percentage;
  place the local team first. Measure each team's rendered player/award heading
  and the maximum content width of every metric column, including cell padding.
  Use those independent intrinsic widths as flex bases: place teams side by side
  when their combined widths and gap fit, otherwise wrap into full-width rows.
  Recalculate after data, tab, locale, font and container changes. Cap detail
  content at 96rem, including inside the dialog, and keep table overflow inside
  its own scroller.
  Normalize rendered measurements to layout coordinates so a dialog's opening
  scale animation cannot underestimate the required column widths. Include
  Skeleton widths in pending-state measurement.
  Highlight the local participant without inferring identity from their name.
  Keep player names, titles and score-label badges on a single
  vertically centered line. Every collapsed player row has the same 2.75rem
  height, including players without awards. Identify the local participant with
  the existing row highlight; omit the redundant self badge. Bound unusually long names with
  ellipsis while retaining their full text for accessible naming and hover.
  Award collections never wrap in the scoreboard. Preserve the shared hover/focus
  explanations and click-to-pin popovers. Use the table's labeled horizontal
  scroller and visible overflow cue when the complete row exceeds the available
  width. Match dialogs may grow to 100rem so normal desktop data can fit both
  teams without unnecessary scrolling. Player disclosures contain every metric
  and the profile action; award interactions do not toggle the disclosure.
  Preserve unknown outcomes, observers, missing values, and saved ELO colors.
- Mode labels use `PvE` in both Chinese and English for recognized cooperative
  scenarios, using the existing mode Badge in lists and details. PvE match details
  and refresh use local log evidence. Show an unknown outcome when the log has no
  explicit winner; a PvE mode label does not imply a victory or defeat.
- Old matches without an online ID remain viewable as local log details. Their
  list action is `View`, and grid cards and detail-menu items stay interactive.
  Identify the source with a `Local log` Badge and a shared informational Alert;
  label missing modes and outcomes `Not recorded` and numeric metrics with an em
  dash. Present logged total points and the deck in the personal summary. Keep
  local record identifiers out of the visible UI, disable remote-only actions,
  and preserve navigation, filters, scrolling, and initiating-button focus.
- While a lazy dialog module loads, announce loading through an out-of-flow
  screen-reader status. Keep the underlying workspace geometry unchanged until
  the dialog portal mounts; do not add loading columns to the application shell.
- Player refresh is an icon action in the dialog header immediately before
  Close. It stays available while the content scrolls and refreshes the profile
  and report together.
- Match dialogs use the same single header action area for Refresh and Close.
  Do not repeat the page's sticky toolbar inside the dialog body. Archive detail
  pages retain their Back, Previous, Next and Refresh toolbar. Cached-service
  warnings use the shared localized Alert and may wrap across multiple lines.
- Player details keep their final layout during the initial load: metadata,
  four metric cards, the ELO trend, highlight units beside the preferences and
  Maggot Index column, and record tabs with table headers or map cards. Use
  shadcn Skeleton inside the values, preference rows, tab counts, table cells,
  and map cards that are still pending. Do not insert a generic loading block
  above the metrics or expand the index into the preference column.
  The shared Skeleton uses foreground at 10% opacity so placeholders remain
  visible on both light and dark cards. Reserve the dialog's scrollbar gutter
  and use the same table column widths in loading and loaded states.
  Keep Copy visible and disabled until a report is available. Empty preferences
  retain their card and show an explicit empty state.
- The ELO trend uses the shared glass Card and shadcn Chart (Recharts). Plot up to
  30 recorded post-match ratings from oldest to newest with a 200px plot, adaptive
  axis labels, a smooth line, and a uniform 8% area fill. Keep the line opaque;
  do not add a gradient or a separate chart surface. The header shows the latest
  post-match ELO and its change from the first match's pre-match rating. Use the
  saved ELO increase/decrease colors for the line and signed change, or `--chart-1`
  when neutral or unknown. A dashed reference line marks that starting rating.
  Mouse hover exposes match ID, time, rating, and per-match change. Disable this
  chart's Recharts accessibility layer and do not add an arrow-key navigation
  target or instructional footer. Retain its image label and textual summary,
  and disable chart animation.
  Unknown ratings remain gaps, single samples remain visible as dots, and missing
  endpoints produce an unknown summary instead of reconstructed values. Initial
  loading and empty states reserve the same plot height; refresh retains the
  current plot. Localize captions and tooltip labels in Chinese and English.
- Player details and query reports share the same preference display. Preview the
  first four highlight units and three categories in source order; explicit Show
  all actions expose every remaining entry without a fixed data limit. Keep
  expansion for the same player during refresh. Highlight units use a shared glass Card and shadcn Table
  with unit name, damage, deployment count, and ROI columns. Category preferences
  use the shared Progress component with one-decimal percentages and total
  deployment investment. Keep zero values distinct from unavailable values,
  which use an em dash. Use tabular numbers and theme tokens; unit names wrap,
  narrow containers stack the cards, and any table overflow stays inside its
  scroll container. Loading placeholders retain the same headers and columns.
- Profile and report requests resolve independently. Replace only the placeholders
  supplied by each response; show empty states only after that request settles.
  Refreshes retain existing values and the active record tab. The Maggot Index
  keeps its score and summary in place while progress appears in its header badge
  and a reserved track below the sample caption. Loading and loaded content share
  the same responsive grids and reduced-motion behavior.
- Map performance uses the shared `MapPerformanceGrid` in player records and
  report details. Arrange small glass Cards in a responsive grid with 12px gaps
  and a 16rem minimum column width that shrinks to fit narrow containers. Sort
  maps by match count descending without changing the report data. Each card has
  a wrapping map name, match count, shadcn Progress track, and labeled win rate,
  average K/D, and average destruction value. Preserve one decimal for win rates;
  abbreviate destruction values of at least 1,000 with `k` and expose the full
  value on hover. Use upstream map averages, never the latest match's statistics.
  Missing metrics show an em dash; a missing win rate has an empty track with no
  announced numeric value. Win rates above 50% use success, 50% information,
  40% to below 50% warning, and below 40% destructive tokens. These colors are
  independent of ELO preferences. Initial loading uses the same card composition
  with six skeleton cards, and refreshes retain the populated grid.
- ELO color options sit directly under their section heading. Do not restore
  the removed explanatory paragraph or an additional wrapper card.
- Quick tools keep their actions without an extra visible heading.
- Archive opens in grid view by default, with a toggle for list view. Preserve
  the selected view when returning from match details. Filters and actions wrap
  as complete controls when space is limited.
  Inline FieldGroup wrappers must use content sizing rather than inline-size
  containment, which would collapse their intrinsic width and overlap neighbors.
- Settings categories are Appearance, General, Connection, Automation, Cache,
  Recording, Navigation, and Local accounts.
  Use existing section headings, Field composition, shared actions, and automatic
  saving. Do not recreate Settings as a modal.
- Workspace and Settings reuse Sidebar and PageToolbar. Keep native caption
  space, the header separator, accessible navigation, and route scroll state.
  Sidebar footers reserve 16px of bottom padding so update actions sit clear
  of the window edge.
- Desktop sidebars share a persisted 200–400px width, defaulting to 256px.
  Compose the existing shadcn SidebarRail as a focusable vertical separator.
  Its edge follows the pointer without a width transition and saves once on
  release. Escape, pointer cancellation, focus loss, collapse, or a viewport-width
  change cancels the preview. Double-click or Enter restores the default;
  Left/Right moves 16px, Shift moves 64px, and Home/End selects the limits.
  Keep the idle divider at 1px with `sidebar-border/60`; pointer hover stays 1px
  and uses `sidebar-border`. Dragging uses a restrained 2px
  `sidebar-foreground/25` line. Reserve the high-contrast 2px `sidebar-ring` line
  for keyboard focus. Preserve the full 16px hit area, localized instructions,
  and ARIA range values. Appearance settings provides a labeled shadcn Slider with track-click
  adjustment and a reset action as an alternative to dragging.
  Reserve at least 480px for the desktop workspace by temporarily clamping the
  displayed width without overwriting the preference. Widening the window
  restores that preference. Mobile navigation retains its 288px Sheet and omits
  the resize handle. Apply responsiveness to the remaining content container:
  compact overview metrics below 36rem and hide the optional toolbar health
  indicator below 48rem; protect native caption space and route breadcrumbs.
- Sidebar resize hints follow the mouse using the existing shadcn Tooltip's
  native placement offsets and collision handling. Use the shared raised-glass
  surface, semantic foreground, compact typography, themed arrow, and original
  hoverable-content behavior. Position hover hints beside the pointer
  with a small gap and 12px viewport collision padding; keyboard focus uses the
  normal control anchor. Hide the hint while dragging and when the rail is
  unavailable. Reference screenshots communicate intent, not custom styling.
- Available updates in both sidebar footers use the localized "New version
  available" label, a persistent neutral fill, and a notification dot. Use the
  shared SidebarMenuButton `notification` variant: mix sidebar foreground into
  the sidebar surface at 6%, increasing to 10% on hover or press. Keep the
  foreground opaque with medium weight; add no outline, colored feedback, or
  animation. The shared SidebarMenuBadge `dot` variant remains visible at the
  icon's upper-right corner when collapsed. Preserve the theme focus ring and
  version tooltip. Download failures retain this availability cue for retry;
  downloading and installation use their existing status controls. General
  settings keeps explicit download, retry, and portable download-page actions.

Use container queries when available space depends on a panel, not the viewport.
At the existing narrow breakpoints, metrics and teams may stack. Controls may
wrap instead of overflowing. Preserve keyboard access, scrollable long content,
dialog close controls, and readable table headers.

### Asynchronous content and reserved space

Recording settings retain the shared Card, FieldGroup, Field and shadcn Slider
composition. Keep resolution and frame rate separate from the quality score.
The quality slider ranges from 1 to 51 and defaults to 20; its associated helper
text explains that lower values improve quality and increase file size, with
16–23 as suggested starting values. Preserve keyboard adjustment, visible focus,
automatic saving and `aria-describedby` on the quality control. Show the automatic
AV1 → HEVC → H.264 order before recording and the selected codec while recording
or saving. Hardware-preferred encoders are attempted first; software AV1 is the
final fallback. Explain that MP4 file size varies with content instead of presenting
a fixed-duration size estimate. The recording library continues to play old
WebM files. Parameter sources and limitations live in
[the recording specification](../../docs/recording.md).

The Settings header combines global and recording-specific save status while
Recording is active. Errors take precedence over saving or pending work, and
saved appears only after both owners settle successfully. Preserve the failed
owner's Retry and Discard controls. Within recording containers up to 28rem,
place the test-recording action below the title and full-width description so
English labels and busy/focus states remain contained.

Recording preview frames keep a 13rem minimum and 19rem maximum height across
disabled, idle, waiting, saving, error and available-image states. Prefer the
16:9 ratio above the minimum and contain the image without distortion. The shared
Empty title and full helper text must fit inside the frame at narrow widths.

Keep roster space reserved for a populated room or a known room awaiting player
details. On Overview, a settled no-room
state uses a compact waiting message so available history stays near the top;
restore the normal reservation when a room arrives. Radar retains its focused
roster workspace.

Center SessionPanel's waiting icon and message within the available space below
its actions. Preserve the shared Empty alignment and symmetric padding instead
of forcing top alignment or adding a Radar-only top margin. Keep populated-room
reservation and Overview's settled no-room compact behavior unchanged.
Limit the empty viewport to `max(9.5rem, 100svh - 28rem)` while retaining the parent
roster reservation. The height budget accounts for the caption, page header,
metrics and actions in a 900px window with a 400px sidebar. Reduce empty-state
vertical padding to 1rem below 44rem viewport height so the centered prompt fits
the 600px native minimum in both languages without changing populated rosters.

Show player name history immediately in a shared small glass Card without a
separate heading or count band. Keep its region and list accessibly named.
Use an ItemGroup of names and last-seen dates, with a keyboard-focusable native
scroll viewport capped at 16rem. Compose compact rows with ItemSeparator dividers
and localized Previous name / Last used column labels. Align names left and dates
right in wide history containers; move dates below names and hide column labels
below 24rem. Long names wrap within a min-width-zero column. Keep the focus outline
inside the scroll viewport and all aliases available through scrolling without
allowing a large history to stretch the dialog. Use the existing shared glass Card
and default transparent Item variant without separate row cards or hover actions.
Make the list content and dividers span the Card width with no outer content
padding. Reuse TableHead's shared height, weight and foreground classes for the
column labels; match the adjacent match table's 12px header text, 40px height,
vertical padding and 8px/12px responsive horizontal padding.

Within SessionPanel containers up to 24rem, keep team identity and role on the
first summary line and Average ELO on the second, with Copy spanning both lines.
Reserve a 2.75rem team header in the same layout scope that calculates roster
space. Allow room-summary text to wrap without intersecting ratings or controls.
This does not change the approved inline match-scoreboard player rows.

Keep the same section shells, labels, table headers, column widths, and responsive
grids while requests are waiting, partially available, or complete. Replace values
inside their final slots with shadcn Skeleton. A cache response must fill those
slots without changing a table or preference list into a short text paragraph.
Keep cached names visible; leave unavailable metrics as placeholders until their
request settles, then use an em dash for missing metrics. Never infer zero values
or numeric category percentages from a cached name.

Use the existing shadcn components and semantic tokens for every known content
shape. Shared row placeholders and localized loading announcements live in
`apps/web/src/components/LoadingState.tsx`.

- Metrics keep their labels and value line heights; only unknown values and
  dependent descriptions use Skeleton. Keep independently available values,
  such as the current room count, visible.
- Tables keep their headers, column definitions, alignment, and scroll container.
  Render a Skeleton cell in each visible column of each pending row. A single
  spanning cell with generic blocks is reserved for a settled empty state, not
  the initial request. Match details reserve both five-player team tables.
- Lists and grids use Item or the actual Card composition, including the final
  title, metadata, action, and thumbnail slots. Initial budgets are three recent
  matches, five search/table rows, six archive/replay cards, four deck file rows
  per panel, and one recognized-account row. Budgets do not cap real results.
- Media owns a responsive frame before a URL, thumbnail, or metadata arrives.
  Replay playback reserves a 16:9 stage with a 12rem minimum and a 65svh maximum;
  loading, retry, and failure feedback overlay this frame. Keep the video and
  playback-speed controls in place during retries. Display previews retain their
  existing frame and Skeleton.

Unknown sample counts, pagination totals, file counts, and storage sizes use a
placeholder rather than a fabricated zero. A confirmed zero or empty state may
appear only after the corresponding request settles. Disable actions that need
unknown data. Mount report metrics, preferences, analysis, and detail section
shells while the report is pending; start dependent analysis after it arrives.
Preserve the existing collapsed detail sections.

Background refreshes retain existing rows, values, selected views, filters, and
scroll positions. Show progress on the initiating control without replacing
available content with Skeleton. Retain those values if a refresh fails and show
the error with its recovery action. Initial failures and confirmed empty results
must end the loading state.

Provide one localized status announcement for each request and mark decorative
spinners and placeholder rows as hidden from assistive technology. Standalone
Spinner labels use the current locale. Skeleton animation uses the shared
reduced-motion rules. The generic Spinner-and-block fallback is suitable for
startup or lazy modules whose content shape is not available yet.

Player preferences reserve a minimum unit viewport equivalent to four rows and
preview three category rows in pending, sparse, empty, and failed states. The unit
card stretches beside the preferences and Maggot Index column; its viewport uses
the resulting height to show additional real rows. Render all available units in
the scrollport, with visible overflow guidance and keyboard scrolling. On stacked
layouts, keep the bounded compact viewport. Show all removes the viewport bound;
Show less restores it. Category expansion remains independent. These counts also
drive initial placeholders, and shared CSS row sizes and gaps drive the minimum
heights. Reserve the action row so Show all does not insert extra height when a
request settles. Refreshes retain available values and expansion for the same
player. Wrapping long names and values may grow naturally beyond the minimum;
preserve access to all content. Do not show extra skeletons or fabricated rows
after loading. Reserve header space for badges and use the same column definitions
for placeholders and loaded cells.

The unit viewport has one compact footer row: a short overflow hint on the left
and Show all/Show less on the right. Keep them aligned at every width; avoid
repeating the expand instruction in a separate hint line above the button.

Keep unit metric columns stable while loading and loaded: 8rem each for damage
and deployments, 4.5rem for ROI, and at least 10rem for unit identity including
padding. The resulting 30.5rem table minimum belongs inside its horizontal
scrollport. Verify actual localized header text ranges and neighboring labels;
page-width and element self-overflow checks alone cannot establish readability.

Shared Alerts and dialog/confirmation titles wrap long unbroken names and paths.
Navigation-order labels may use multiple lines beside their stable numeric gutter
without shrinking switches or reorder actions. At mobile widths, the Connection
log path occupies its own full input row, with Select and Detect below it. Archive
cards show their match date and compact filter controls expose the active count
as an accessible description.

The Connection health-check Card places its title and description beside a
compact CardAction when the card's content width reaches 30rem. Narrower cards
stack the full-width action below the copy. Keep its activity icon in the action,
with a shared Spinner while pending; do not reserve an empty icon/feedback row.
Announce pending work through the localized live status and show failed checks
in the shared Alert below the header. Preserve the shared glass Card material,
keyboard activation, disabled/busy state, retry and duplicate-request guard.

Automation options use the shared FieldGroup, horizontal Field, FieldContent,
FieldLabel, FieldDescription and Switch inside the glass Card. Keep their rows
equal in height within the group, including when English copy wraps on narrow
screens. Use a tight title/description gap, a fixed icon gutter and aligned
switches. Inset shared Separators to the text column and retain the right
content gutter. Below 24rem of card content width, place descriptions beneath
the label and switch columns so they can use the remaining row width. Short
localized descriptions explain each option and are linked
to the switch with `aria-describedby`; labels remain clickable and controls
retain keyboard activation and autosave behavior. Do not add a second surface
or a status pill for each option.

Cache categories use small glass Cards with the category name and content size
on the first row, a short description below, and separate labeled entry/expired
counts. Stack categories when the usage container is narrower than 36rem;
switch to two columns only when the remaining content width permits it. Keep
the size and both counts in stable Skeleton slots while loading. Explain that
content size is not disk usage without a technical paragraph.
In the two-column mobile overview, let the data-size metric span the final row
so its value and unit remain on one line. Use the shared Stats layout hook;
other Stats consumers retain their default grid.

Cache cleanup follows the compact CardHeader/CardAction pattern. Short copy
states that removed data must be fetched online again and that local records
are kept; the existing confirmation retains the full preserved-data list.
Actions sit beside the copy above 40rem of container content width, otherwise
stack at full width. Keep expired-only cleanup distinct from clearing both
categories, retain confirmation and cancellation, and never infer reclaimed
disk space from the content-size metric.

General settings present optional analytics as a short recipient summary,
an explicit exclusion summary, and the existing Switch. Keep the full original
usage and privacy disclosures in an accessible Collapsible, and display both
full paragraphs before the first consent decision. Opening details must not
change consent. The short visible Switch label retains the full accessible name
and references both visible summaries. The header action occupies a stable
8rem column above 32rem of Card width and stacks below it; do not let the
FieldGroup's inline-size containment collapse the action.

Navigation ordering uses compact rows with a stable numeric gutter, wrapped
page labels, and nonshrinking visibility/reorder controls. The header names the
Show and Order columns; inset Separators align with the page names. Keep rows
at least 50px tall and equal within each rendered list. Preserve focus on the
activated move button after intermediate reorders. At either boundary, transfer
focus to the opposite enabled move button in the same row so the next keyboard
action remains usable. Keep the unavailable direction natively disabled and
retain the existing boundary guards. Visible setting labels must be contained in
their accessible names; place the short statistics label before its fuller meaning.

The About Card emphasizes the current version and app identity. Update controls
and project links align beside their copy above 32rem of Card width and stack
below it. Narrow update actions fill their row, including the Tooltip wrapper;
project links use two equal columns. Use concise disabled-build copy while
retaining the complete explanation in the existing Tooltip. Preserve update
progress, errors, retry and download links, not-applied warnings, and installation
guards during a match or recording. Use the shared glass material throughout.

When encounter data is pending, render all four summary labels with value
placeholders above the table from the start. The summary uses the same grid,
spacing, and value line height as the loaded counts. Keep the same table and
header mounted when nonempty records arrive. A confirmed empty result may replace
the pending summary and table with the established empty state.

Check both response orders, cached partial responses, missing metrics, failed
reports, empty and nonempty encounters, and refreshes that retain data. Runtime
layout checks compare section positions and the table header's offset from its tab
panel at desktop and narrow widths. Element presence alone does not verify layout
stability. Large reports or long names may exceed their reserved budget; verify
that this growth stays inside the dialog and preserves access to every value.
For application-wide reviews, use the same data and pending/loaded/refresh phases
at 1440px, 760px, and 375px in Chinese and English, with both appearances. Compare
known section positions and media dimensions separately from natural growth due
to unknown result counts; do not hide real results to obtain a zero-height delta.

## Accessibility and validation

Workspace breadcrumbs use the shared shadcn primitives and the current page's
registered detail location. Online archive details include the match ID; local
logs use the local-log label without exposing internal storage IDs. Player reports
include the selected name/ID. Parent links invoke the existing back action to
retain filters, scroll and opener focus. Root links navigate to Overview, and
inactive visited pages must not supply the visible trail. Settings use the same
primitives; returning to the workspace retains the existing save/leave guard and
disables duplicate parent activation while the save is pending.
Allow the current segment to truncate in constrained titlebars, preserving its
complete accessible text and the available parent action.

The shared Switch retains upstream radix-nova geometry: a 32x18.4px default track
with a 16px thumb and a 24x14px small track with a 12px thumb. Preserve its border,
state translation, hit area, keyboard semantics and ordinary-theme focus/invalid
states. Compare against upstream before attributing a screenshot's optical offset
to the primitive; do not replace its geometry without establishing the cause.
In forced-colors mode, use system ButtonFace/Highlight surfaces, a contrasting
ButtonText/HighlightText thumb, GrayText for disabled controls and a real outline
for the boundary and keyboard focus. Limit forced-color adjustment to the control
and use system colors throughout that exception. A local thumb-color variable
resolves checked/disabled precedence without competing descendant selectors.
Keep state and focus feedback immediate in that mode by disabling control transitions.
Verify both sizes, states, focus and disabled presentation in ordinary themes
and forced colors; emulation does not substitute for native OS-theme coverage.

Maintain accessible labels, visible focus, radio/pressed/busy state, disabled
behavior, and Radix focus trapping and restoration. Normal readable text should
meet 4.5:1 contrast against its composited background; essential focus and
selection boundaries should meet 3:1. Check glass against the actual underlying
surface in both appearances. Decorative card borders do not replace the focus
indicator or a control's accessible state.

Information badges must also meet 4.5:1 on the highlighted self row, including
hover and keyboard focus. Use the shared information token instead of page-level
color overrides; check the badge fill composited over the actual row surface.

Verify all six palettes in light and dark modes, opacity at 40%, 50%, and 100%,
hover/selected/focus states, a narrow viewport, long labels, and reduced motion.
Use shared scrollbar tokens for both native scroll regions and shadcn ScrollArea:
an 8px rail with 2px inset on each side produces a 4px visible thumb in Chromium
and Electron, for both axes. Preserve foreground-derived thumb contrast and
hover/active feedback, transparent tracks, stable reserved gutters where needed,
and the thin native fallback in other engines. Native scrollbars retain
operating-system rendering in forced-colors mode; ScrollArea thumbs use CanvasText.

Run `pnpm check`, `pnpm format:check`, and `pnpm smoke` for implementation changes.
`pnpm check` includes `pnpm ui:check`, which inventories Card usage, rejects
feature-level surface overrides and retired card-choice variants, and checks
local documentation links. `pnpm ui:check --json` prints the detailed inventory.
Both validation and Windows release CI use `pnpm check` and `pnpm format:check`
and run `pnpm test:ui` with Playwright Chromium. For local browser interaction
validation, install Chromium with `pnpm exec playwright install chromium` and
run `pnpm test:ui`; browser tests are separate from `pnpm check`. Failed browser
runs upload `.test-data/playwright/` artifacts in both workflows.
Run `pnpm smoke:real` when actual fixture-backed rendering or data behavior is
affected. `pnpm format:check` includes this design-system directory. Check local
documentation links and keep the audit record current when changing the rules.
Native scoreboard smoke must compare actual team positions with their combined
content requirements and gap, and verify the detail width cap. Do not assert a
retired fixed viewport breakpoint or assume the layout is a CSS grid.
At fractional Electron zoom, capture the full frame through `BrowserWindow.capturePage`
before normalizing to renderer CSS pixels. Inspect declared focus dimensions and
their device-pixel rasterization separately; computed outline widths and offsets
can be rounded to physical pixels without changing the declared 2px treatment.
