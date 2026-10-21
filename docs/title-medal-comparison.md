# Historical title and medal comparison

This comparison applies the current titles, the pinned upstream tags, and the application's score-label rule to the same 114 complete matches and 1,140 player appearances from the [historical title corpus](title-history.md). All 114 matching BATrace analysis responses were captured successfully. The 15 unavailable FIDs and 329 history records without a FID remain outside this comparison.

The upstream implementation is pinned to [Zawinzala/Broken-Arrow-Maggot, commit f4e1d5b2cfca6944227381d973b38b4782699533](https://github.com/Zawinzala/Broken-Arrow-Maggot/blob/f4e1d5b2cfca6944227381d973b38b4782699533/index.html#L269). Its README describes an older nine-medal system; the current `index.html` implements six score-based tags. The comparison uses the current code, rather than reconstructing the older README's rules.

## Rules and scope

The upstream tags use `mvpRanking[].breakdown` from `/api/analysis/match`, with the dimensions `destruction`, `damage`, `dlRatio`, `efficiency`, `objectives`, and `supply`. For each team and dimension, the maximum must be positive. Every player scoring at least 90% of that team maximum qualifies. Multiple teammates can qualify. Candidates are sorted by their dimension score, with definition order breaking score ties; only the first three are displayed on each match row. These are analysis scores, rather than raw damage or supply totals. See [the team-relative rule](https://github.com/Zawinzala/Broken-Arrow-Maggot/blob/f4e1d5b2cfca6944227381d973b38b4782699533/index.html#L606) and [the three-tag display limit](https://github.com/Zawinzala/Broken-Arrow-Maggot/blob/f4e1d5b2cfca6944227381d973b38b4782699533/index.html#L765).

The application's score labels compare both teams together and select one player per dimension with the positive match maximum. Equal maxima are resolved by the first player in the analysis response, before any per-player display limit. At most two score labels are displayed per player. Awards hidden by that limit are not reassigned to another player. This intentionally differs from the upstream team-relative 90% rule and its three-label display limit.

The current 28-title system uses match statistics, calibrated thresholds, outcome and absence rules, and a two-title display limit. It usually chooses one outstanding eligible player per numeric category. Big Eater adds the highest positive supply-resource consumption among active players in matches lasting at least eight minutes. The comparison counts all qualifying occurrences separately from final displayed awards. It evaluates each historical match individually, rather than applying the upstream page's selection of a player's last 12 matches or its aggregate top-two profile stickers. These custom labels do not replace the game's `Medals` field.

## Results

| System                           | Triggered kinds | Candidate occurrences | Displayed awards | Player appearances with awards | Local candidates | Local awards |
| -------------------------------- | --------------: | --------------------: | ---------------: | -----------------------------: | ---------------: | -----------: |
| Current single-match titles      |         28 / 28 |                   624 |              595 |           472 / 1,140 (41.40%) |               89 |           84 |
| Upstream score tags              |           6 / 6 |                 1,638 |            1,467 |           778 / 1,140 (68.25%) |              233 |          203 |
| Application global-winner labels |           6 / 6 |                   681 |              579 |           415 / 1,140 (36.40%) |              105 |           91 |

Local counts use each historical match's recorded local player (`75402`). All six upstream tag kinds occurred for this player.

| Upstream tag     | Dimension   | Candidates | Displayed | Matches with display | Local candidates | Local displayed |
| ---------------- | ----------- | ---------: | --------: | -------------------: | ---------------: | --------------: |
| Master Destroyer | destruction |        268 |       251 |                  114 |               55 |              51 |
| Firepower        | damage      |        265 |       238 |                  114 |               55 |              51 |
| Survivor         | dlRatio     |        262 |       221 |                  114 |               38 |              31 |
| Efficient        | efficiency  |        275 |       244 |                  111 |               37 |              28 |
| Objective Expert | objectives  |        334 |       309 |                  114 |               15 |              15 |
| Logistics        | supply      |        234 |       204 |                  109 |               33 |              27 |

The upstream tags appear more often in this corpus because they reward proximity to each team's best score in six dimensions. The current titles identify narrower statistical or behavioral cases and also include negative and neutral outcomes. A similar display name does not make two rules equivalent.

The application's current names and single-global-winner frequencies are:

| Application label | Dimension   | Candidates | Displayed | Matches with display | Local candidates | Local displayed |
| ----------------- | ----------- | ---------: | --------: | -------------------: | ---------------: | --------------: |
| Kill Leader       | destruction |        114 |       114 |                  114 |               25 |              25 |
| Firepower         | damage      |        114 |       114 |                  114 |               29 |              29 |
| Survivor          | dlRatio     |        114 |        97 |                   97 |               18 |              14 |
| Efficient         | efficiency  |        114 |        73 |                   73 |               11 |               6 |
| Objective Expert  | objectives  |        114 |        89 |                   89 |                4 |               2 |
| Team Supplier     | supply      |        111 |        92 |                   92 |               18 |              15 |

The following examples count appearances where the **same player in the same match** received both final displayed awards; they are illustrative comparisons rather than semantic mappings:

| Existing title | Upstream tag     | Existing title awards | Upstream tag awards | Both displayed |
| -------------- | ---------------- | --------------------: | ------------------: | -------------: |
| Reaper         | Master Destroyer |                     5 |                 251 |              5 |
| Scratch Damage | Firepower        |                    11 |                 238 |              2 |
| Survivor       | Survivor         |                    14 |                 221 |             14 |
| Kill Stealer   | Efficient        |                     9 |                 244 |              7 |
| Landlord       | Objective Expert |                     4 |                 309 |              4 |
| Team Supplier  | Logistics        |                    18 |                 204 |             16 |

The machine-readable baseline contains every title/tag pair's candidate and display co-occurrence counts, not just these examples.

## Replay and validation

```sh
pnpm titles:compare
pnpm titles:compare --capture
pnpm check
```

The first command verifies the saved response checksums, the source title-corpus checksum, and frozen results entirely offline. `--capture` requests analysis for the existing match corpus using the production BATrace client and saves complete response bodies plus parsed data. It also records the pinned upstream source checksum. It does not update the match corpus; refresh that separately with `pnpm titles:history --capture` when needed, then recapture analyses.

`analyses.json.gz`, `medal-manifest.json`, and `medal-expected.json` retain responses, provenance, frequency counts, overlap counts, and per-match award hashes. `upstream-reference.json` contains independent golden hashes produced by running the pinned upstream `formatNewMatchData` function and its original dimension definitions against all 114 captured analyses. The independently implemented evaluator matched all 1,140 player outputs, including qualifying tag order, scores, and the displayed top three. No upstream application source is bundled with the comparison implementation.

The comparison baseline also includes separate application global-winner counts and per-match label hashes. Each dimension has at most one candidate per compared match. To refresh expected results after an intentional local rule change, run `pnpm titles:history --update-expected` and `pnpm titles:compare --update-expected`. These commands use recorded responses and do not change the captures or the upstream reference hashes.

Normal regression tests verify these reference outputs and replay each recorded HTTP response through the production client without networking. Missing, mismatched, or incomplete analysis rosters are excluded from both sides of the comparison. Updating the upstream revision requires reviewing its rules and regenerating the upstream reference hashes; updating only the local evaluator's baseline does not establish upstream equivalence.

## Title-condition tooltips

Every existing title badge now shows its conditions and current calibrated threshold together with the match's evidence. Numeric rules also explain the eligible player pool and selection rule. The two-title limit is explicit. Formula-based rules such as Landlord and Demolition Crew retain the small tie-breaking terms used by the evaluator. Net-exchange rules do not inherit the eight-minute minimum used by numeric titles.

Mouse hover, visible keyboard focus, and click-to-pin share the same tooltip content. Escape dismisses it. Conditions are localized in Chinese and English; threshold values are read directly from the production engine's calibration rather than copied into translations.

## Integrated score-label display

Completed-match details and the previous-match views in the overview and radar display score labels and titles beside the player name. Each player has two independent limits: at most two score labels and at most two titles. Each score dimension selects exactly one positive maximum across both teams, using analysis response order to break ties. The tooltip describes this rule and explains that the display limit does not pass an award to a runner-up. Its match evidence shows recorded combat quantities rather than the normalized 0–100 selection score. The game's original medal count remains a separate statistic. Persisted labels from the older 90% or per-team application rules are recomputed from analysis. Without analysis, only labels marked `match-maximum-single` can be reused; older rule versions are withheld.

| Score label      | Recorded evidence                                                                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Kill Leader      | Destruction value (`DestructionScore`) and units killed (`Destruction`).                                                                                                                                                       |
| Firepower        | Damage dealt and damage received (`DamageDealt`, `DamageReceived`).                                                                                                                                                            |
| Survivor         | Destruction value, loss value (`LossesScore`), and their value exchange ratio. Zero losses with positive destruction show infinity; zero divided by zero stays unknown.                                                        |
| Efficient        | Spawned value (`TotalSpawnedUnitScore`), refunded value (`TotalRefundedUnitScore`), destruction value, and the analysis economy response's `roi` shown as a percentage. No ROI formula is inferred when that field is missing. |
| Objective Expert | The number of objectives captured (`ObjectivesCaptured`).                                                                                                                                                                      |
| Team Supplier    | Supply points consumed by allies (`SupplyPointsConsumedByAllies`). Big Eater separately measures the player's own `SupplyPointsConsumed`.                                                                                      |

The backend attaches these values to each awarded label so saved and offline matches retain their evidence. Complete protobuf match payloads may omit zero-valued scalars; ID-only rosters do not establish zero. Missing individual values appear as a dash, and entirely unavailable evidence is explicitly marked as unrecorded. Normalized scores are never substituted for missing combat values. The comparison baseline also hashes this attached evidence without changing award selection or upstream reference results.

Match detail loads analysis through the production client's cache and HTTP transport. Explicit detail refresh refreshes both match facts and analysis. Historical lists backfill score labels from existing analysis cache without issuing bulk requests. Opening the previous-match view requests richer detail; missing analysis does not remove match facts or titles. Live matches display neither completed-match score labels nor titles. Match ID, participant IDs, teams, completion, and duration must agree before labels are attached.

The overview and radar player cards omit the decorative letter avatar and the visible score-group caption. Both award groups are direct siblings of the player name in a single compact line. Player names and individual award labels use an ellipsis when they exceed the available width. Full names and explanations remain available through hover, keyboard focus, and click-to-pin. The name and badges share the available identity width without expanding the fixed player column or overwriting the ELO column.

The CSS custom property `--match-award-max-width` can set a tighter per-label limit, such as `90px`; its default is the available group width. `--match-player-name-max-width` controls the name's share when awards are present, defaulting to 40%. These are layout customizations rather than additional application preferences. Narrow and long-text cases retain operable full-text disclosure.

Isolated `pnpm dev`, `pnpm dev:web`, and real-data smoke profiles also load the checksum-verified match and analysis cache captures. They retain the original 454-match history and do not add archive rows for the extra cached responses. This allows developers to exercise the integrated labels offline without updating the frozen GameLogs snapshot or changing the local application's database.
