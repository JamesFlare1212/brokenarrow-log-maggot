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
