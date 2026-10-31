# Match detail interactive prototype

Status: approved design reference. The production implementation now lives in
`apps/web/src/features/matches/MatchDetails.tsx`; this sample-data prototype stays
isolated from the application.

The prototype imports the repository's shadcn Button, Badge, Card, Table, Tabs,
ToggleGroup, Separator, and Tooltip components. It uses application theme tokens
and Lucide icons. The build omits application-shell layout and font assets so the
generated HTML can be opened offline or embedded directly in the thread.

```sh
node docs/prototypes/match-detail/build.mjs
```

Output: `.test-data/previews/match-detail.html` (generated, ignored by Git).
Open the HTML directly; no server is required.

## Review interactions

- Start with match details. Choose the back button to inspect the archive entry.
- Open a match with its explicit details button or a noninteractive part of the
  archive row. Selecting text does not navigate.
- Filter the six example records by result; navigate between example matches.
- Switch between core, combat, and support columns.
- Expand a player for all statistics, the player identifier, and every award.
- Switch the preview between light and dark appearances.
- Replay and external-link buttons announce their intended destination without
  accessing a video, service, or native application.

## Data provenance

The first match ID, map, date, duration, local account name, ELO change, and
Bravo player statistics come from the supplied screenshots. Alpha, its player
identifiers, personal summary, and ratings are illustrative. Subsequent match
summaries use the visible archive values but illustrative IDs. Their details
reuse the sample roster. Labels explicitly identify the preview as sample data,
not a complete historical report.

The prototype demonstrates layout and navigation only. The production view handles
loading and failed requests, real playback, player profile navigation, archive
scroll restoration, localization, and the saved ELO color preference. Record
deletion remains available in the archive's existing overflow menu.

## Original proposal validation

- The standalone production bundle builds successfully with Vite.
- TypeScript passes for the prototype and its imported UI components.
- Nine DOM interaction scenarios pass: initial roster, tabs and arrow keys,
  player expansion, row navigation, keyboard entry, filtered previous/next and
  return focus, theme switching, action feedback, and runtime/markup checks.
- Changed source and design documentation pass Prettier and `git diff --check`.
- The preview is visually inspected at desktop, inline-thread, and narrow widths.

These checks describe the original isolated proposal. The production application
is covered separately by `pnpm check`, `pnpm format:check`, `pnpm smoke`, and
`pnpm smoke:real`; the real-data smoke exercises detail navigation, player
expansion, responsive scoreboards, and return focus.

See the [design proposal](../../../design-system/broken-arrow/proposals/match-detail.md)
for rationale, production behavior, and acceptance criteria.
