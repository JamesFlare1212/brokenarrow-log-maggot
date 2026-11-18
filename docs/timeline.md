# Match timeline integration

The **Timeline** tab is available in archive match details and contextual match
dialogs. The existing match identity, recording actions, navigation, theme, and
Chinese/English locale remain authoritative; the timeline does not duplicate an
application header or introduce a standalone route.

## Data path

1. `MatchDetails` mounts `MatchTimeline` only when the Timeline tab is active.
2. `matches.timeline({ fid, force })` reads the existing BATrace match endpoint/cache.
3. `buildMatchTimeline()` in `packages/shared/src/timeline` derives bounded data.
4. `TimelineView` renders the returned contract without fixture access or Node APIs.

The RPC returns availability, a reason when unavailable, source, capture/update
time, and the derived data. It does not persist a large timeline in match summaries,
mutate archive records, or issue extra player-analysis requests. The regular match
refresh action also refreshes an active timeline. Request generations and match
identity keys prevent a late reply from replacing another match's view.

A cached response remains usable with an explicit stale notice. Online request
failures remain errors with retry; they are not mislabeled as missing unit data.
Local-only records and known PvE matches do not request a remote timeline. Older
BATrace records with unit summaries but no timing fields show an unavailable
state rather than a zero-filled or reconstructed chart.

## Meaning and limits

- Force value is a proxy, not measured in-field strength. Unit base prices allocate
  each player's official deployment and loss totals separately. Refunded sorties
  with unknown return times are excluded from the curve.
- Difference is Alpha minus Bravo; net change covers the preceding 60 seconds.
- Curves retain second-resolution values and the actual final time. Minute losses
  represent `(previous boundary, boundary]`, including a short final bucket.
- Highlights describe sortie intervals and cumulative kills, not exact kill times.
  Recon identifies deployment only. Ranked loss peaks are not moral judgments.
- Unit names come from the bundled, checksum-provenanced name catalog in
  `packages/shared/src/timeline/unit-names.ts`. Roles/base prices reuse the existing
  title model. Unknown names remain unit IDs and unknown prices use a fallback
  estimate; no runtime fixture access is permitted.
- The parser validates teams, IDs, timestamps, metrics, and roster/record limits.
  Durations above 24 hours are unsupported instead of silently truncated. Series
  aggregation and loss-window selection avoid quadratic scans.

Regenerate name metadata from the committed recorded corpus with:

```sh
node packages/shared/scripts/generate-timeline-unit-names.mjs
```

## Presentation

`apps/web/src/features/timeline/TimelineView.tsx` accepts `TimelineData`, the host
scroll element, and an optional sticky inset. The archive titlebar and dialog
header are outside their scrollports, so neither adds a second top inset.
Layout follows component width, so an
archive page and a narrower dialog can use different presentations in the same
window. Card-to-card spacing uses the shared 16px content-gap token. Nested scroll
calculations account for dialog padding and keep archive navigation accessible.

The production component retains the prototype's chart modes, overview/detail
navigation, mouse/touch sampling, independently anchored events, filters, grouped
markers, evidence, and minute/record dialogs. A record without derived moments has
its own empty state, distinct from a filter with no matches. Minute-table browsing
does not change the current inspection until a time/row is activated.

The visual contract is documented in the
[design specification](../design-system/broken-arrow/proposals/timeline.md).
The [standalone prototype](prototypes/timeline/README.md) remains a historical
reference, not an application dependency. Recording playback remains a separate
match action; no recording alignment or fake replay controls are inferred.

## Validation

```sh
pnpm check
pnpm format:check
pnpm test:ui
pnpm smoke
pnpm smoke:real
```

Model tests cover the checksum-verified match 9485138, the recorded match corpus,
malformed/missing input, partial intervals, unknown units, and refund handling.
RPC tests cover cache, stale/offline behavior, validation, refresh errors, and no
extra analysis requests. Renderer tests cover lazy loading, availability, retry,
refresh, late replies, localization, filtering, and padded scroll geometry.
Browser regressions exercise the real application archive route in both locales
and minute navigation inside a match dialog. Real-data Electron smoke tests also
exercise the typed bridge, exact-time inspection, nested focus/scroll behavior,
and minimum-window containment against an isolated copied profile. The combined
real-data smoke suite has a 60-second process budget (normal startup smoke retains
30 seconds), and emits stage markers to diagnose a timeout.
