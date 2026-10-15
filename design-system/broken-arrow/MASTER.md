# Broken Arrow UI design system

The desktop app and web preview share one React interface. The overview is a match workspace; player search, archives, recordings, decks, bans, APM and about each have a dedicated destination. Configured navigation order remains authoritative. Visited screens retain their local state and scroll position; hash routes support direct links and browser history.

## Visual direction

Use a calm graphite workspace with mint accents, subtle surface separation and restrained borders. Put live match information before supporting tools. The overview has four data summaries, a match roster, recording status, shortcuts and recent results. Optional APM and ban panels follow the user's configuration.

The verified `ui-ux-pro-max` Data-Dense Dashboard recommendation informs the hierarchy, data presentation and interaction states. The tactical palette and navigation structure are project decisions. Promotional layouts and 3D effects from unrelated search results are excluded.

## Tokens and components

- Source: `apps/web/src/styles/tokens.css`; seven existing theme identifiers are preserved.
- Graphite: background `#0d1114`, surface `#141a1e`, text `#edf1f3`, muted text `#a2adb5`, accent `#79e0c3`.
- Use semantic surface, border, accent, feedback and control-border tokens in components.
- Use local Segoe UI and Microsoft YaHei fonts; tabular figures for numbers and Cascadia Code or Consolas for identifiers. No remote font dependency.
- Use Lucide SVG icons consistently. Decorative icons are hidden from assistive technology; icon buttons receive contextual names.
- Spacing uses 4/8px increments. Card radius is 14px, control radius 8–9px. Short hover feedback uses 140ms; dialogs use 220ms. Respect reduced motion.

## Interaction

- One emphasized action per workflow. Destructive operations stay in menus or separate controls and retain existing confirmation behavior.
- Visible labels and associated helper text for inputs. Errors retain clear recovery actions. Empty states explain the next step.
- Deck selection uses labeled checkboxes rather than a modifier-dependent multi-select.
- Filters expose pressed state. Navigation exposes the current page. Dialogs retain the Radix focus trap, Escape dismissal and focus restoration.
- Keep historical BATrace information distinct from live room data. Missing statistics show a dash; never create substitute values. Win rate uses up to 12 completed win/loss matches for the current player and excludes restarted matches.

## Responsive behavior and accessibility

- Below 1180px, place the overview tools below the roster; below 800px, use an accessible navigation dialog.
- Below 600px, stack teams and feature columns, use two metric columns, and keep form inputs at 16px.
- Preserve document zoom, visible keyboard focus, a skip link, associated form help, and accessible names for repeated action menus.
- All seven themes are checked independently. Normal and supporting text and primary button pairs meet at least 4.5:1 contrast. Control boundaries use a separate contrast token.
- Reserve space for media, use local assets, and avoid decorative animation or external requests.

## Validation

Run `pnpm typecheck`, `pnpm test`, and `pnpm build`. Use the collaborative preview at `/?demo` for desktop and 375px checks, navigation, search, filters, theme previews and keyboard interaction. Browser preview data is explicitly marked as demonstration data; native desktop integration remains the source of local data.
