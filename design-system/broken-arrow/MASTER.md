# Broken Arrow UI design system

The desktop app and browser preview share one React interface. This document records the current visual and interaction rules. Keep it aligned with the implementation when changing navigation, settings, palettes or component states.

## Visual direction

Use a calm graphite workspace, subtle surface separation and restrained borders. Graphite uses neutral gray accents in both light and dark appearances. Green communicates successful or healthy states; it is not the graphite selection color. Other palettes use their own accent colors.

The settings reference is the T3 Code layout supplied for this project: a category sidebar, a dedicated content area, three appearance-mode previews and separate palette pairs. Keep the application's match data and workflows central to the design.

## Implementation sources

| Concern                                   | Source                                                                                                                                                           |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Palette values and semantic tokens        | [tokens.css](../../apps/web/src/styles/tokens.css)                                                                                                               |
| Application scrollbars                    | [scrollbars.css](../../apps/web/src/styles/scrollbars.css)                                                                                                       |
| Workspace, overview and responsive layout | [layout.css](../../apps/web/src/styles/layout.css)                                                                                                               |
| Shared buttons, cards and dialogs         | [components.css](../../apps/web/src/styles/components.css)                                                                                                       |
| Settings layout and palette controls      | [settings.css](../../apps/web/src/styles/settings.css)                                                                                                           |
| Navigation and page composition           | [App.tsx](../../apps/web/src/app/App.tsx)                                                                                                                        |
| Settings page and appearance controls     | [SettingsPage.tsx](../../apps/web/src/features/settings/SettingsPage.tsx), [AppearanceSettings.tsx](../../apps/web/src/features/settings/AppearanceSettings.tsx) |
| Resolved appearance and automatic saving  | [useAppearance.ts](../../apps/web/src/hooks/useAppearance.ts), [useSettingsAutosave.ts](../../apps/web/src/hooks/useSettingsAutosave.ts)                         |

## Workspace and navigation

The sidebar provides overview, 蛐雷达 (player radar), player search, APM, archives, recordings, decks and bans. About belongs in Settings → General. Configured navigation order remains authoritative. Existing configurations gain the radar entry after overview when that entry is available; an existing custom radar position is preserved. Remove the legacy About entry from saved navigation and collapsed-panel lists while preserving other preferences.

- Overview keeps the current-room and previous-match tools. The radar page at `#radar` provides an additional copy of those tools, not a replacement. Each destination retains its own current/previous view while navigating.
- The overview has four summary cards, the room roster, recording status, shortcuts and recent results. On wide screens, the roster spans three summary columns and the supporting tools occupy the fourth. The tool column must share both edges and width with the 房间玩家 summary above it; use the same four-column grid and 16px gap rather than a fixed sidebar width.
- All four summary cards share the same neutral surface, border and typography. The recent ELO card has no gradient, accent border or accent-colored value/icon.
- Optional APM follows the user's configuration. The full ban list belongs only on the dedicated bans page, even when an older configuration has `banCardVisible` enabled. Do not expose an overview ban-panel toggle.
- Visited screens retain local state and scroll position. Hash routes support direct links and browser history.
- Workspace and Settings use the shared `Sidebar`, `SidebarHeading`, `SidebarNavigation`, `SidebarItem` and `SidebarFooter` components from `components/Sidebar.tsx`, styled by `styles/sidebar.css`. Both sidebars use a 224px expanded width and a 76px icon rail, with shared tokens and the persisted `sidebarCollapsed` preference. Keep accessible names and hover titles for icon-only entries.
- Use Settings' compact layout throughout: 42px navigation rows, 5px gaps, neutral selected backgrounds and accent-colored selected icons. Navigation and footer labels are 14px bold (700); heading labels are 17px bold. Both sides share padding, heading spacing and footer placement. The workspace uses a plain brand icon and title without the former boxed logo, English subtitle or section label.
- Preserve workspace navigation landmarks and Settings tab semantics, roving focus and arrow/Home/End shortcuts. On small screens, workspace navigation opens in its existing dialog while Settings tabs form a horizontal scrollable row.

## Header and page hierarchy

The workspace topbar stays at the viewport top with a 56px minimum height and 8px vertical padding. Keep it above page content and below dialogs. The viewport-sized shell does not scroll: `.workspace-scroll` contains the main content and footer, starts immediately below the toolbar and owns workspace scrolling. Remember its scroll position independently for each route, including when returning from Settings.

Keep the collapse control, breadcrumb, service status and account control in the topbar. The brand mark stays in the sidebar. Do not repeat it beside the breadcrumb, add a topbar language selector, or restore the uppercase `BROKEN ARROW / …` eyebrow above the page title. Language selection belongs in Settings → General. The sidebar footer contains a content-sized settings entry and a round update button aligned to the right. The update button has a transparent resting background, a brighter hover background and an icon transition; respect reduced motion. It checks for updates, changes to a download action when available and shows progress while downloading.

Workspace and Settings reuse `PageToolbar` and `SidebarToggle` from `components/PageToolbar.tsx`. The shared toolbar owns the 56px minimum height, 8px vertical padding, responsive horizontal padding, background, stacking and 24px bottom fade based on `--bg`. Neither page overrides toolbar dimensions or uses a hard bottom divider. The fade overlaps the header by 1px, with a 25px total height and a solid first 2px, to avoid a seam at fractional display scaling. It stops `--scrollbar-size` before the right edge so the scrollbar stays fully visible. It never intercepts pointer events and is omitted in forced-colors mode. Both independently scrolling content areas use 32px scroll padding so focused elements clear the fade.

The recordings page places its recording controls in a separate card above the library. Recording state belongs in that control card. Omit the page-heading log-listener status and the BATrace historical-data footer on this page so neither can be mistaken for recording activity.

Show the workspace historical-data footer only on Overview, Radar and Player Search. Omit the entire footer, including its health-check action, on Recordings, Ban Tracking, Decks, Match Archives and APM.

## Settings page and persistence

Settings opens as a full page, not a modal. The initial category is Appearance. A visible Back control returns to the previous workspace page; returning preserves that page's state. Short windows scroll the category list while keeping Back available.

| Category                   | Route                  | Content                                                                             |
| -------------------------- | ---------------------- | ----------------------------------------------------------------------------------- |
| 常规 / General             | `#settings/general`    | Interface language, About, version, update action, project links and import notices |
| 外观 / Appearance          | `#settings/appearance` | Theme mode and palette pairs                                                        |
| 游戏连接 / Game connection | `#settings/connection` | Log and deck folders, log detection, API health                                     |
| 自动化 / Automation        | `#settings/automation` | Automatic queries, input monitoring, ban polling, match sync, account linking       |
| 导航 / Navigation          | `#settings/navigation` | Sidebar page order                                                                  |
| 本机账号 / Local accounts  | `#settings/accounts`   | Detected accounts and account removal                                               |

- `#settings` resolves to Appearance. Category changes replace the current settings history entry, so Back returns to the workspace rather than stepping through categories.
- `#about`, `#settings/about` and `#settings/updates` redirect to General. About uses a compact card with a version/status row and a project-links row. Keep update actions beside the version, show recovery details only when needed, and omit the former large brand panel and feature introduction.
- General places the language label on the left and a compact 160px selector on the right. Omit the language and appearance autosave footnotes; the toolbar already displays save status.
- Changes apply immediately and save automatically. There are no Save or Cancel buttons. Changes to an inactive appearance's palette only update that mode's saved choice.
- Toggles, selects and palette controls save immediately. Folder text inputs debounce for 500ms; blur and Back flush pending input. Save requests run in order and submit changed fields, preserving newer input when an older response arrives.
- Show saving, saved and failed states. Keep failed changes available and offer Retry; do not report success before persistence completes. Back waits for pending saves and stays on settings if saving fails.
- Keep the seven categories as accessible tabs with arrow-key and Home/End navigation. Switching categories retains pending edits.

## Theme modes and palette pairs

Theme mode and palette selection are independent preferences. The only mode choices are **System, Light and Dark**. Only those three controls change `themeMode`; neither an individual swatch nor an entire palette card may change it.

Each of the six palettes contains a light and dark swatch. Store `lightTheme` and `darkTheme` independently: for example, light can use Forest while dark uses Violet. Explicit mode changes and operating-system changes in System mode use the palette saved for that appearance.

| Palette         | Palette key | Light `--accent` | Dark `--accent` |
| --------------- | ----------- | ---------------- | --------------- |
| 石墨 / Graphite | `dark`      | `#4b5563`        | `#c4ccd5`       |
| 青空 / Cyan     | `cyan`      | `#0d6e83`        | `#6ed7e8`       |
| 暖橙 / Orange   | `orange`    | `#b3430c`        | `#f4ae79`       |
| 紫夜 / Violet   | `violet`    | `#7040ae`        | `#bca1ff`       |
| 森林 / Forest   | `forest`    | `#247249`        | `#6edcab`       |
| 深海 / Ocean    | `ocean`     | `#196b9e`        | `#72d2fc`       |

- Clicking a card's name or empty area selects both palettes in that pair in one save. It preserves the current theme mode.
- Clicking a swatch changes only the corresponding light or dark palette. Choosing a light swatch while Dark is active must not switch the workspace to Light, and vice versa. System must remain System.
- Show selection with rings and checkmarks on the individual swatches. Do not add an accent border to a selected large card. Neutral card hover feedback and keyboard focus remain available.
- Keep card and swatch controls as separate buttons, without nested buttons. Each receives an accessible name; pressed states describe the pair and individual choices.
- The legacy `theme` field and seven old identifiers remain readable for compatibility. They do not represent seven current palette choices. Missing per-mode preferences fall back to the legacy palette; legacy `light` maps to Graphite.

## Tokens, typography and components

Graphite's key values are:

| Token           | Dark      | Light     |
| --------------- | --------- | --------- |
| `--bg`          | `#0d1114` | `#f0f3f8` |
| `--surface`     | `#141a1e` | `#ffffff` |
| `--surface-alt` | `#1c2328` | `#edf1f7` |
| `--text`        | `#edf1f3` | `#1c293d` |
| `--muted`       | `#a2adb5` | `#526278` |
| `--accent`      | `#c4ccd5` | `#4b5563` |
| `--on-accent`   | `#1b232c` | `#ffffff` |

Use semantic surface, border, accent, feedback and control-border tokens in components. Selection rings, checkmarks, primary actions and focus colors derive from `--accent`, with `--accent-soft` and `--accent-border` for supporting surfaces. Success, danger, warning and information tokens describe status independently of the chosen palette. Do not reintroduce mint as a default graphite accent or use success green for selection.

Use local Segoe UI and Microsoft YaHei fonts, tabular figures for numbers, and Cascadia Code or Consolas for identifiers. Use Lucide SVG icons consistently. Decorative icons are hidden from assistive technology; icon buttons receive contextual names. No remote font dependency.

Spacing uses 4/8px increments. Card radius is 14px and control radius is 8–9px. Short hover feedback uses 140ms; dialogs use 220ms. Respect reduced motion and avoid decorative animation.

Archive pagination uses the shared `components/Pagination.tsx` component: a muted record-range summary on the left and a compact previous/page-selector/next group on the right. Controls share a 34px height. Keep the page selector accessible without a stacked visible label, disable arrows at the boundaries, and allow the footer to wrap on narrow screens.

Ban tracking reuses the same pagination with 20 records per page. Limit its independently scrollable list to `min(560px, 60dvh)` so large ban datasets cannot stretch the card indefinitely; keep filters and pagination outside that list. Changing filters resets the page, changing pages resets the list scroll position, and refreshed results clamp the displayed page to the available range. Every record remains reachable, and profile actions and encounter badges remain available. Keep native keyboard scrolling, a visible focus outline and the shared scrollbar style.

Use a compact two-label sliding switch for the ban filter. Clicking anywhere toggles between all bans and encountered bans; Space and Enter also toggle it. Expose `role="switch"`, the encountered-bans label and `aria-checked`. Keep both labels visible and move one shared selection background between equal-width halves with a 220ms transform transition using `--ease-out`. Text colors use the 140ms transition. Keep keyboard focus visible and disable transitions when reduced motion is requested.

Ban rows use shared column widths for player, ELO, encounter state and timestamp so varying name lengths or missing encounter badges cannot move other columns. Left-align player names and encounter markers; right-align ELO values and timestamps with tabular numbers. At list widths of 640px or less, place the player on the first line, ELO and encounter state on the second, and the timestamp on the third. Keep long names readable by wrapping within their column.

### Scrollbars

Use the supplied narrow, rounded dark scrollbar reference throughout the shared React interface. Workspace content, sidebars, settings, dialog bodies, table wrappers, horizontal navigation and multiline inputs all use the global rules in `styles/scrollbars.css`. Workspace and Settings scrollbars begin below their toolbars. Do not add component-specific scrollbar colors or widths.

- Keep the track and the corner where horizontal and vertical bars meet transparent. Hide arrow buttons. Use a pill-shaped thumb without visible borders, shadows or accent colors.
- In Electron and Chromium, `--scrollbar-size` is 10px for both axes. A 1px transparent border leaves an 8px visible thumb; `--scrollbar-radius` is 999px. Track ends have 4px margins and the thumb has a 24px minimum length.
- Thumb colors derive from `--text`, so every palette follows the same rule. Dark mode uses 10% opacity at rest, 20% on thumb hover and 30% while dragging. Light mode uses 18%, 28% and 38% respectively. The resting thumb stays subtle, matching the reference, and interaction increases visibility without changing its size.
- Browsers without the Chromium scrollbar pseudo-elements use standard `scrollbar-width: thin` and the same thumb/transparent-track colors. Hovering or focusing the scroll container increases visibility in this fallback; exact dimensions and rounding remain browser-controlled. Keep standard scrollbar properties at `auto` in Chromium so they do not override its custom geometry.
- Preserve native wheel, trackpad, touch, keyboard and thumb dragging behavior. Scrollbar styling must not add nested scrolling or force scrollbars onto content that fits. Use `scrollbar-gutter: stable` in workspace content, settings and the recording dialog to prevent their content from shifting.
- In forced-colors mode, leave scrollbar rendering to the operating system. No custom scrollbar animations are required; reduced-motion preferences remain respected.

### Control states

| Control                  | Resting state                                           | Hover                                                                   | Selected or focused state                                       |
| ------------------------ | ------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------- |
| Sidebar collapse control | Transparent background and border                       | Surface highlight, no border highlight                                  | Visible keyboard focus                                          |
| Settings entry           | Transparent background and border                       | Same background treatment as other sidebar entries, no border highlight | Visible keyboard focus                                          |
| Ban player action        | Transparent background and border                       | Surface highlight matching sidebar hover, no border highlight           | Visible keyboard focus; no persistent selected background       |
| Previous-match action    | No visible border                                       | Background highlight, no accent border                                  | Expose pressed state; preserve keyboard focus                   |
| Recording widget action  | Soft accent background, accent text, transparent border | Background highlight, no accent border                                  | Visible keyboard focus                                          |
| Palette card             | Subtle neutral border                                   | Neutral surface/border feedback                                         | Selection lives on its swatches; no selected-card accent border |
| Palette swatch           | Light or dark color preview                             | Clear hover feedback                                                    | Accent ring and checkmark; expose pressed state                 |

Use `button-borderless` for the specified shared buttons. The settings Back control follows the sidebar Settings entry: transparent at rest, surface highlight on hover, and no resting or hover border. Do not remove keyboard focus outlines to achieve a borderless resting or hover state. Keep one emphasized action per workflow; destructive operations retain their existing confirmation behavior.

Inputs need visible labels and associated helper text. Errors offer recovery actions, and empty states explain the next step. Deck selection uses labeled checkboxes. Filters expose pressed state and navigation exposes the current page. Radix dialogs retain focus trapping, Escape dismissal and focus restoration; settings itself does not use that dialog workflow.

Keep historical BATrace information distinct from live room data. Missing statistics show a dash; never create substitute values. Win rate uses up to 12 completed win/loss matches for the current player and excludes restarted matches.

## Responsive behavior and accessibility

- At 1180px and below, place overview tools below the roster, with the recording and shortcut cards side by side where space permits.
- At 800px and below, workspace navigation uses an accessible dialog rather than the desktop sidebar.
- At 720px and below, settings categories form a horizontally scrollable row, with Back above it. Hide the desktop collapse control in this layout.
- At 600px and below, stack teams and supporting tool cards, use two overview metric columns, and keep form inputs at 16px.
- At 420px and below, palette pairs use two columns; the three theme-mode previews remain together in one row.
- Preserve document zoom, visible keyboard focus, a skip link, associated form help and accessible names for repeated action menus. Sticky headers must not obscure focused controls.
- Check all twelve light/dark palette variants independently. Target at least 4.5:1 contrast for normal text and primary button text, with a separate contrast token for control boundaries.
- Reserve space for media and use local assets. Keep loading, empty, disabled and error states legible in both appearances.

## Validation

For implementation changes, run `pnpm typecheck`, `pnpm test` and `pnpm build`. Use `pnpm dev:web` with the collaborative preview at `http://127.0.0.1:5174/`. Browser previews use isolated real test fixtures; native desktop integration remains the source of local data.

Check the following when changing visual behavior:

1. Desktop overview tool edges align with the 房间玩家 metric at normal and wide widths.
2. Overview and radar both retain room analysis; the full ban list appears only on its dedicated page.
3. Workspace and Settings headers remain at the top while their content scrolls below them. The soft fade has no seam at the header boundary, never covers the scrollbar and leaves controls usable. Workspace routes retain their own scroll positions, including after visiting Settings.
4. Both sidebar layouts collapse, retain names and tooltips, and remember the preference after reload.
5. Settings opens directly, supports linked categories and returns to the previous workspace page with its state intact.
6. Individual swatches and whole-card selection never change Light, Dark or System mode. Switching modes applies each saved palette.
7. Graphite rings, checkmarks and primary controls use neutral gray in both appearances; green is reserved for appropriate status feedback.
8. Automatic saving handles quick changes, pending text on Back, delayed responses, failures and Retry without losing newer input.
9. Keyboard navigation, focused controls and dialogs work at 375px portrait, a short landscape viewport and desktop sizes, with reduced motion enabled.
10. Document, sidebar, settings, dialog, table and horizontal scrollbars share the same geometry and theme tokens. Check resting, hover and drag states in light and dark appearances, retain native scrolling, and use operating-system scrollbars in forced-colors mode.

For documentation-only changes, check Markdown formatting, local links and agreement with the source files above; application tests do not need to be rerun.
