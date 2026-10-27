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
