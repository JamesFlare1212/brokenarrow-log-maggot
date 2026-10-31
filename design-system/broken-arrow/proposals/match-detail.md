# Match archive and detail redesign

Status: approved and implemented on 2026-10-30. Archive navigation uses the
workspace detail page; contextual entry points retain the shared dialog.
Both use [MatchDetails](../../../apps/web/src/features/matches/MatchDetails.tsx)
and [MatchScoreboard](../../../apps/web/src/features/matches/MatchScoreboard.tsx).

## Problem and direction

The previous archive hid its primary action inside the map name. Match details
displayed twelve columns at once, allowed award labels to increase row heights,
and put the second team far below the initial viewport. Metadata and secondary
actions competed with the result and player performance.

Use an explicit archive action and a detail page within the existing workspace.
Keep the sidebar and titlebar. Replace the archive content region with details
and provide a visible back action. Keep detail navigation separate from player
profile dialogs and replay overlays.

## Archive entry

- Default to grid view. Keep the grid/list toggle available and preserve the
  selected view when returning from match details within the same workspace.
- Render the map as ordinary text in list view. Every row has a persistent `View details`
  button with a trailing chevron and an accessible name containing map and time.
- Clicking a noninteractive part of the row opens the same detail view. Preserve
  table semantics and a real button for keyboard access. Ignore text selections
  and clicks on menus, links, or other controls.
- Keep refresh, BATrace, and delete in the existing overflow menu. They must not
  trigger row navigation.
- Grid cards open details when clicking their noninteractive content, without a
  separate footer button. Use a native, text-styled button in the map heading for
  keyboard entry and focus restoration. Keep player-profile buttons independent
  and ignore text selections. Cards without a match ID do not open details.
- Restore account/result filters, sort order, pagination, scroll position, and
  initiating-button focus when returning. Previous/next follows that filtered
  and sorted sequence, including correct disabled boundaries.

## Detail hierarchy

1. Navigation: back to archive and previous/next match.
2. Identity: map title, match ID, mode, duration, and date.
3. Outcome: a text/icon result badge, signed ELO change, and account/team.
4. Actions: watch replay as the main action, open in BATrace as a secondary one;
   retain refresh in the header.
5. Personal summary: destruction value, losses value, D/L, and objectives.
6. Scoreboard: local team first, opponent second, aligned columns and clear team
   headers. Do not assume Alpha is always local or that ELO implies victory.

Use source outcome and team membership in production. The preview uses synthetic
Alpha details and demonstrates won/lost states. Unknown outcomes, draws,
unassigned players, observers, and missing local records must retain their actual
semantics. Hide the personal summary if no local participant can be identified.

## Scoreboard and progressive disclosure

| Group   | Visible numeric columns                               |
| ------- | ----------------------------------------------------- |
| Core    | Destruction, losses, D/L, objectives, ELO change      |
| Combat  | Kills, damage dealt, damage received, D/L, ELO change |
| Support | Supply, experience, medals, objectives, ELO change    |

Keep the name column first in all groups and give it the remaining table width.
Size numeric columns to their unwrapped headers and values instead of assigning
percentages of the table. Preserve space for player names and award badges as
the window grows. Use shadcn Tabs for the metric group. Show five players per
team at a 44–46px base row height. Highlight the local player with the theme's
selected surface, a restrained leading marker, and a visible `You` badge.
Numeric columns are right aligned and tabular.

Show colored award badges beside each player name using the same `MatchAwards`
component as Radar. Keep both title and score-label groups visible, with the same
colors, limits, hover/focus explanations, and click-to-pin popovers. Let badges
wrap within the player column and allow row heights to grow when needed. Award
interactions remain independent of the player disclosure.

Expanded content contains every original metric, before/after ELO where known,
player ID, and a production link to the existing player profile dialog. Keep
award badges in the player heading without duplicating them in the expansion.
Close the profile dialog back to the same match and expanded player.

Derive team totals only when inputs are complete. Preserve missing values as an
em dash and genuine zeroes as zero. Explain that D/L is destruction divided by
losses; handle missing and zero denominators without inventing a finite ratio.
Use `eloChangeClass` and the saved ELO color preference in production,
independently of result badge colors.

## Surfaces and responsiveness

Reuse the existing shadcn components and semantic tokens. The personal summary
uses the shared glass Card; the scoreboard uses the solid data-table surface
role. Avoid nested cards around each team and decorative map imagery that
displaces the table. Keep the existing font and radius scale.

At desktop sizes use the workspace width, capped at a readable 1280px content
measure. At content widths of at least 1180px, place both teams side by side for
direct comparison. Below that threshold, stack the teams. Wrap metadata/actions
and preserve readable statistics through a contained horizontal table scroller.
Do not shrink type to fit all twelve original columns. In production, use
container queries for this breakpoint and sticky headers within the workspace
scroll context.

The detail-page scroll viewport fills the workspace below the titlebar, with its
vertical scrollbar at the window's right edge. Keep page gutters inside that
viewport and apply the readable width limit to the detail content only. Preserve
the sticky detail toolbar and the archive's independent scroll position. Apply
vertical gutters to the inner detail content, not the scroll viewport, so the
toolbar sticks directly below the titlebar without exposing content above it.
Verify the toolbar and scrollbar at intermediate and bottom scroll positions.

## Integration and validation

- One detail-content component serves archive navigation and existing contextual
  match dialogs. Browser Back returns to the archive, and direct detail links
  select the archive workspace. Previous/next replaces the current detail history
  entry and follows the full filtered/sorted sequence across pagination boundaries.
- Preserve all choices when multiple recordings exist; show an explicit empty
  recording state. Refresh retains content and the selected tab.
- Reserve sections and table geometry with shadcn Skeleton while loading;
  distinguish initial failure, stale cached content, and unavailable fields.
- Localize new labels in Chinese and English. Keep the brand BARadar / 断箭蛐工具.
- Verify keyboard entry, tab arrow keys, disclosure state, profile round trips,
  back/forward focus, long names, narrow windows, both appearances, and reduced
  motion. Never put a button inside another button.
- Run `pnpm check`, `pnpm format:check`, and `pnpm smoke` for the eventual
  application implementation; include `pnpm smoke:real` when real-data routing
  or rendering changes. The prototype's validation is separate from application
  regression and desktop checks.

The [prototype source](../../../docs/prototypes/match-detail/README.md) is isolated
from application routes and uses clearly labeled sample data.
