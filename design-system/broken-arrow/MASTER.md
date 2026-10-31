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
| Layout, responsive rules, scrollbars, reduced motion                      | [layout.css](../../apps/web/src/styles/layout.css)                                                                               |
| Shared glass surface and Card composition                                 | [card.tsx](../../apps/web/src/components/ui/card.tsx)                                                                            |
| Card choices and compact toggles                                          | [toggle.tsx](../../apps/web/src/components/ui/toggle.tsx), [toggle-group.tsx](../../apps/web/src/components/ui/toggle-group.tsx) |
| Application Card, Dialog, Field, Stats, and action wrappers               | [ui.tsx](../../apps/web/src/components/ui.tsx)                                                                                   |
| Appearance resolution and native caption colors                           | [useAppearance.ts](../../apps/web/src/hooks/useAppearance.ts)                                                                    |
| Mode, opacity, ELO colors, and palette controls                           | [AppearanceSettings.tsx](../../apps/web/src/features/settings/AppearanceSettings.tsx)                                            |
| Valid preferences, palettes, and opacity limits                           | [rpc.ts](../../packages/contracts/src/rpc.ts)                                                                                    |
| Latest component audit and deliberate exceptions                          | [UI audit](../../docs/ui-audit.md)                                                                                               |

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
  Contextual match details and player details use the shared dialogs. The archive
  opens a dedicated workspace detail page at `#archive/match/{fid}` through an
  explicit details button or a noninteractive row click. Preserve filters,
  sorting, pagination, scroll position, and opener focus when returning.
- Match details share one content component between the page and dialog. Show
  identity/outcome, recording actions, a compact personal summary, and core,
  combat, and support tabs. Team tables use six columns with tabular numbers;
  place the local team first, show both teams side by side at a 73.75rem content
  width, and stack below it. Keep table overflow inside its own scroller.
  Highlight the local participant without inferring identity from their name.
  Player disclosures contain every metric and existing award explanations;
  a compact medal button provides access without increasing base row height.
  Preserve unknown outcomes, observers, missing values, and saved ELO colors.
- While a lazy dialog module loads, announce loading through an out-of-flow
  screen-reader status. Keep the underlying workspace geometry unchanged until
  the dialog portal mounts; do not add loading columns to the application shell.
- Player refresh is an icon action in the dialog header immediately before
  Close. It stays available while the content scrolls and refreshes the profile
  and report together.
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
  Hover and arrow-key navigation expose match ID, time, rating, and per-match
  change. Keep a visible keyboard focus ring and disable chart animation.
  Unknown ratings remain gaps, single samples remain visible as dots, and missing
  endpoints produce an unknown summary instead of reconstructed values. Initial
  loading and empty states reserve the same plot height; refresh retains the
  current plot. Localize captions and tooltip labels in Chinese and English.
- Player details and query reports share the same preference display. Show every
  highlight unit and category returned by BATrace in source order without a
  fixed item limit. Highlight units use a shared glass Card and shadcn Table
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
- Archive filters and actions wrap as complete controls when space is limited.
  Inline FieldGroup wrappers must use content sizing rather than inline-size
  containment, which would collapse their intrinsic width and overlap neighbors.
- Settings categories are Appearance, General, Connection, Automation, and Cache.
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

### Asynchronous content and reserved space

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

Player preferences reserve a minimum of fifteen unit rows and seven category rows
in every state, including sparse, empty, and failed reports. The reservation counts
also drive the initial placeholder rows, and shared CSS row sizes and gaps drive
the minimum heights. These are space budgets, not item limits: additional entries
and wrapping names grow naturally and remain available. Do not show extra skeletons
or fabricated rows after loading. Reserve header space for badges and use the same
column definitions for placeholders and loaded cells.

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

Maintain accessible labels, visible focus, radio/pressed/busy state, disabled
behavior, and Radix focus trapping and restoration. Normal readable text should
meet 4.5:1 contrast against its composited background; essential focus and
selection boundaries should meet 3:1. Check glass against the actual underlying
surface in both appearances. Decorative card borders do not replace the focus
indicator or a control's accessible state.

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
