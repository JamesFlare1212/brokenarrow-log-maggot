# Historical single-match title coverage

The 2026-10-19 audit covers the local application's 458 historical matches. There are 129 unique FIDs; 114 have complete BATrace responses, covering 1,140 player appearances. BATrace could not provide complete data for 15 FIDs. The other 329 history records have no FID and cannot be looked up. No unavailable match is treated as a zero-title match.

Across the 114 complete matches, **all 28 titles qualified and all 28 were awarded at least once**. There were 624 qualifying player-title occurrences and 595 final awards. The local player (`75402`) qualified for 17 distinct titles, with 89 qualifying occurrences and 84 final awards.

The following counts use the current production thresholds and ranking. A candidate meets a title's conditions before the two-title-per-player limit. An award remains after that limit. Counts are player-title occurrences, not unique players; the Deserter and Lone Hero titles can have multiple recipients in one match. Local counts refer to each match's recorded local player. All 114 evaluated matches have a known winning team.

| Title ID     | English label      | Candidates | Awards | Matches with award | Local candidates | Local awards |
| ------------ | ------------------ | ---------: | -----: | -----------------: | ---------------: | -----------: |
| carry        | Carry              |        114 |    108 |                108 |               23 |           23 |
| blame        | Scapegoat          |         83 |     80 |                 80 |                3 |            3 |
| deserter     | Deserter           |         40 |     40 |                 32 |                0 |            0 |
| tryhard      | Could Not Carry    |         14 |     10 |                 10 |                3 |            2 |
| passenger    | Passenger          |         21 |     21 |                 21 |                2 |            2 |
| lonewolf     | Lone Hero          |         20 |     18 |                 17 |                6 |            6 |
| reaper       | Reaper             |          5 |      5 |                  5 |                0 |            0 |
| untouched    | Survivor           |         14 |     14 |                 14 |                2 |            2 |
| landlord     | Landlord           |          4 |      4 |                  4 |                0 |            0 |
| artygod      | Artillery Doctrine |          1 |      1 |                  1 |                0 |            0 |
| bandit       | Bandit             |         11 |     11 |                 11 |                0 |            0 |
| canteen      | Team Supplier      |         18 |     18 |                 18 |                4 |            4 |
| weightlifter | Heavy Lifter       |          8 |      8 |                  8 |                0 |            0 |
| killsteal    | Kill Stealer       |          9 |      9 |                  9 |                0 |            0 |
| demolition   | Demolition Crew    |         24 |     23 |                 23 |                3 |            3 |
| courier      | Courier            |          4 |      3 |                  3 |                0 |            0 |
| refund       | Refund Specialist  |         18 |     18 |                 18 |                5 |            5 |
| backstabbed  | Backstabbed        |          6 |      6 |                  6 |                1 |            1 |
| glutton      | Big Eater          |        110 |     99 |                 99 |               25 |           22 |
| atm          | Feeder             |         13 |     13 |                 13 |                2 |            2 |
| scraper      | Scratch Damage     |         11 |     11 |                 11 |                0 |            0 |
| boxed        | Instant Casualty   |         19 |     18 |                 18 |                2 |            1 |
| camper       | Camper             |          8 |      8 |                  8 |                0 |            0 |
| convoy       | Captured Convoy    |          7 |      7 |                  7 |                0 |            0 |
| freeloader   | Freeloader         |         22 |     22 |                 22 |                4 |            4 |
| spender      | Big Spender        |          8 |      8 |                  8 |                2 |            2 |
| traitor      | Traitor            |          5 |      5 |                  5 |                1 |            1 |
| crash        | Air Crash          |          7 |      7 |                  7 |                1 |            1 |

Artillery Doctrine is the rarest observed title, awarded once. Landlord was awarded four times, and Courier three times. The display limit removed 29 qualifying occurrences: Carry 6, Scapegoat 3, Could Not Carry 4, Lone Hero 2, Demolition Crew 1, Courier 1, Instant Casualty 1, and Big Eater 11.

Big Eater uses `SupplyPointsConsumed`: the highest positive supply-resource consumption among active players in a completed match lasting at least eight minutes. Ties retain the first player in the match response. It is a neutral title and shares the existing two-title limit. Its frequency prior is one candidate per eligible match, so it does not receive an artificial rarity bonus based on an uncalibrated supply threshold. Summary-only matches require known supply consumption for every participant before this title can be inferred. This corpus has 110 eligible matches for the new title.

The unavailable FIDs are `8106580`, `8139212`, `8171947`, `8229301`, `8230787`, `8230870`, `8246211`, `8246287`, `8246410`, `8246897`, `8418787`, `8531466`, `8580242`, `9203063`, and `9216737`. Each API lookup returned 404; each dashboard fallback returned an incomplete match response. Their recorded responses remain in the fixture for regression coverage.

See the [corpus README](../tests/fixtures/batrace/history/README.md) for storage details, offline replay, and capture commands. `pnpm titles:history` reproduces these frequencies and checks the frozen baseline without network requests. `pnpm test` automatically includes the corpus regression tests.

The same 114 matches are also evaluated against the upstream six-dimension medal rules in the [title and medal comparison](title-medal-comparison.md). `pnpm titles:compare` verifies that comparison using recorded BATrace analysis responses.
