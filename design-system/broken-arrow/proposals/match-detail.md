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

- Render the map as ordinary text. Every row has a persistent `View details`
  button with a trailing chevron and an accessible name containing map and time.
- Clicking a noninteractive part of the row opens the same detail view. Preserve
  table semantics and a real button for keyboard access. Ignore text selections
  and clicks on menus, links, or other controls.
- Keep refresh, BATrace, and delete in the existing overflow menu. They must not
  trigger row navigation. Grid cards receive the same visible details action.
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

The name column stays consistent in all groups. Use shadcn Tabs for the metric
group. Show five players per team at a 44–46px base row height. Highlight the
local player with the theme's selected surface, a restrained leading marker,
and a visible `You` badge. Numeric columns are right aligned and tabular.

Keep award pills out of the base row. A small medal button exposes all award names
on hover/focus and opens the same inline expansion as the player disclosure.
Expanded content contains every original metric, before/after ELO where known,
player ID, awards, and a production link to the existing player profile dialog.
Close that dialog back to the same match and expanded player.

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
