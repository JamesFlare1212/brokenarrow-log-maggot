# Maggot Index card design concepts

Status: **B — Horizontal scale** is approved and implemented in the production
[MaggotCard](../../../apps/web/src/features/players/MaggotCard.tsx). A and C remain
exploratory references. These previews use sample data and remain isolated from
application services.

The preview composes the repository's shadcn Card, Badge, Button, Separator, and
ToggleGroup primitives with Tailwind v4 utilities and the shared glass material.
The scale and ring use code-native SVG to visualize the existing 0–10 metric.
There are no new dependencies, custom card surfaces, or component stylesheets.
The standalone build omits application layout and font assets and leaves the
document background transparent for the inline preview host.

```sh
node docs/prototypes/maggot-card/build.mjs
```

Output: `.test-data/previews/maggot-card.html` (generated and ignored by Git).
Open it directly; no server is required.

## Placement in the player profile

```sh
node docs/prototypes/maggot-card/build.mjs --context
```

Output: `.test-data/previews/maggot-card-context.html`.

The contextual preview imports the production ProfileOverview, including its
Stats, ELO chart, PlayerPreferences, and highlight-unit table. The isolated build
substitutes only the MaggotCard module with the selected concept. Shared layout
variables come directly from the production foundations. No application source,
services, or saved preferences are changed by this preview.

Switch A/B/C, dark/light appearance, and 1152px/848px/390px profile widths.
The canvas scales to its host while preserving the production 52rem container
breakpoint and intrinsic sidebar sizing. Stats columns follow the simulated
window rather than the inline host's media query. Surrounding report data is
explicitly illustrative; the index card retains the supplied screenshot values.

With the 1152px simulated profile, the initial measured layout is:

| Concept | Sidebar width | Card height |
| ------- | ------------- | ----------- |
| A       | About 205px   | About 231px |
| B       | About 354px   | About 230px |
| C       | About 251px   | About 219px |

A's intrinsic width makes the sidebar unusually narrow. B's wider single-line
content reduces the unit table's available width. C sits between them and is
slightly shorter. At 848px and 390px, production layout stacks the analysis
section; all concepts then stretch across the sidebar's full row. These findings
include the sample-scope tooltip revision without any sidebar width adjustment.

The sample-scope caption lives in the information control beside the card title.
It uses the shared TooltipButton, supports hover and keyboard focus, and can be
pinned with a click or touch. Insufficient-sample details use the same control;
the visible status badge remains. The old caption footer, divider, and minimum
height reservation are removed, shortening each card by about 42px without a
layout shift when the explanation opens.

The contextual bundle is compressed inline to fit the preview host's size limit.
It remains self-contained and opens without a server or remote assets.

## Concepts

- **A — Numeric summary:** large index, separate MVP-rank and trend columns,
  and sample scope in the title tooltip. Its narrow intrinsic sidebar width needs
  review in the contextual layout.
- **B — Horizontal scale:** shows the index within the 0–10 range. Color boundaries
  match the existing 3.5 and 7 thresholds; the pointer represents a value, not
  calculation progress. This is the selected production design.
- **C — Radial summary:** a ring groups the score separately from rank and trend.
  The explicit lower-is-better caption remains visible because a fuller ring
  represents a higher index rather than better performance.

## Review interactions and data

- Switch between dark and light appearances.
- Compare the screenshot values, an illustrative low score, and insufficient
  samples across all three concepts simultaneously.
- Review at a 274px card width as well as the wider comparison layout.
- Hover or focus the title information control for sample scope; click or tap to
  pin the explanation, and press Escape to dismiss it.

The screenshot supplies index **7.5**, average MVP rank **3.6**, an **improving**
trend, and **12** eligible ranked matches. Other card scenarios are explicitly
illustrative. The standalone card comparison introduces no additional history.
The contextual page uses a labeled illustrative report for neighboring content.
Neither preview calls application services or changes saved preferences.

The [master design specification](../../../design-system/broken-arrow/MASTER.md)
defines the production adaptation. It retains localization, independent request
states, cached values during refresh, calculation progress, and retry behavior.
Production validation is separate from the original isolated preview checks below.

## Validation

- The standalone production bundle and prototype TypeScript checks pass.
- Nine browser checks pass: screenshot values, layout at 728px/390px/274px,
  low-score and insufficient-sample scenarios, light appearance, shared material,
  and runtime errors/transparent document foundations.
- Both desktop and narrow inline previews render without console messages.
- Changed-file formatting, the UI design guard, and `git diff --check` pass.
- Contextual validation covers nine concept/width combinations, correct two-column
  and stacked behavior, no card/page overflow, retained screenshot values, light
  appearance, production unit expansion/collapse, and absence of runtime errors.
- The sample-scope revision passes hover, keyboard-focus/Escape, click-to-pin,
  touch-to-pin, partial-sample details, unchanged card geometry while open, and
  nine contextual tooltip/layout combinations.
