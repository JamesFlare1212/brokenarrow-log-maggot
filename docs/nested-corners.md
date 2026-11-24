# Nested corner audit

This audit covers the application renderer, including controls shown in portals and the development Shadow DOM. The design rule applies to two **painted contours that follow the same edge**, not every parent and child with a `border-radius` declaration. Content in a padded section does not have to follow the section's outline.

## Measuring a pair

Use the rendered border boxes at the relevant corner, after layout and transitions. For example, at the top left the outer arc center is `(outer.left + R, outer.top + R)` and the inner center is `(inner.left + r, inner.top + r)`. With equal horizontal and vertical insets `g`, the centers coincide when `R = r + g`. Include borders in `g`. For a pill use its rendered end-cap radius (half the height), not the large computed CSS radius. A concentric external ring increases both the outer radius and the measured gap by its width; it does not move the center.

Use one derived radius for all four exposed corners of a standalone surface, even when only one end contains the inset control. If the result would be too large, reduce the inset or use the parent clip. Keep internal joins straight and viewport-attached edges flush. Preserve independent controls, default Card material, hit targets and keyboard focus. A wrapped or stacked layout must not retain an inset calculated for a different axis.

## Radius scale

At the default root font, use four primary values: 6px (SM), 8px (MD), 10px (LG) and 14px (XL). A frame radius is derived from its contents and inset, not another step in the scale.

| Composition                                | Inner radius + inset   | Outer radius |
| ------------------------------------------ | ---------------------- | ------------ |
| BATrace and DEV commands                   | 6px badge + 6px        | 12px         |
| Compact archive filter on a coarse pointer | 6px badge + 10px       | 16px         |
| Room player suggestion                     | 8px avatar + 6px       | 14px         |
| Development launcher                       | 12px action + 5px      | 17px         |
| BATrace status popover                     | 6px action + 10px      | 16px         |
| Stacked directory field                    | 7px action + 9px       | 16px         |
| Recording preview                          | 6px media + 10px       | 16px         |
| Timeline dialog                            | 6px close button + 8px | 14px         |

These nine compositions now use four outer sizes (12, 14, 16 and 17px) instead of five (16, 17, 18, 21 and 22px). A fixture sweep of seven main panels, eight settings tabs and one populated match detail at 1280px and 390px (32 route/viewport pairs) also found 7/9/11px in input groups and 19px around framed appearance previews. Keep geometric sizes derived: rounding a 13px search-result frame to 14px without changing its 5px inset would break alignment with the 8px action. Small marks (2px chart keys and 4px checkbox corners), flush edges, pills and circles should not add steps to the general control scale. The sweep samples rendered states; dormant, focus-only and portalled controls require separate source and interaction checks.

## Coverage

- Inspect shared React primitives and their consumers, primary and settings routes, shell, overlays, loading states, developer fixtures, renderer CSS, SVG shapes and the hidden recorder window. Native OS window framing, third-party icon paths and historical HTML design prototypes are not renderer-owned nested panels.
- Exercise the seven main panels, eight settings tabs and populated match detail with repository fixtures. The browser route sweep covered 47 route/scene combinations (captured, simulated and empty; no match-detail route in the empty scene). Its geometry inventory is a candidate list, not a count of defects. Open menus, dialogs, profiles, submenus and interactive control states separately.
- In appearance settings the outer choice now follows the preview: 10px + 9px = 19px. Only choices with a framed preview use this geometry. The palette spheres were already centered. In the wireframe illustration the composer and its two inset marks now share end-cap centers at both preview heights.
- Select, DropdownMenu, its portalled submenu and ContextMenu share a 12px frame derived from the 8px highlight and the 4px item gutter. They keep the existing row size, menu padding, glass outline, scroll behavior and focus management.
- InputGroup derives its framed edge from the group height and the actual inset action: an extra-small action has a 7px radius in an 11px standard frame, 13px large desktop frame, or 17px large touch frame. Edge insets agree on both axes; a block-start or block-end action establishes a 16px radius for the entire frame. Filled Tabs now use 11px around an 8px active tab with a 3px gutter. Line and navigation Tabs are unchanged.
- Player search uses a 13px Item around both 8px actions with a 5px inset. The result row and its loading placeholder retain their heights. Roster suggestions use an 8px rounded-square avatar and 6px inset; the image, fallback and outline inherit the avatar shape. The separate account avatar remains circular. In the session roster the full-row hover surface and the muted Item share a center even with their transparent borders and the button's padding-box fill.
- A recording preview uses a 6px media radius and a 10px inset, giving the entire Card a 16px radius. In a replay grid, the Card clips the flush thumbnail, the play target fills the tile even when the neighboring caption wraps, and the 6px duration badge sits 4px inside the 10px thumbnail bottom corners. In list view the thumbnail follows the height of wrapped metadata. Deck footers and direct edge images use a single Card clip instead of painting a second arc at the inner edge of the border.
- The shell account button follows its circular avatar. A badge inside a command has 6px corners rather than capsule ends; standalone badges can still be pills. Large filter buttons retain the 44px touch target around a 24px badge. The development launcher has two 12px inner actions. The BATrace popover and timeline dialogs retain their original control hit areas. Close buttons aligned in ordinary header rows do not opt into this treatment.
- Transparent wrappers are not visible frames. Neither sibling segments, individual chart bars, focus-only chart regions, independently positioned media overlays, nor buttons inside ordinary padded content need to share a center with the nearest card. Scrollbar thumbs, Avatar masks, Switch end caps, progress tracks and table-edge clips are evaluated at their actual painted bounds, not by comparing class names.

The [overlay and appearance](../tests/browser/surface-corners.spec.ts), [controls](../tests/browser/radius-controls.spec.ts), [shell](../tests/browser/shell-corners.spec.ts) and [feature surface](../tests/browser/feature-surface-corners.spec.ts) browser tests check the corresponding corners, including right and bottom edges. Coverage includes the default and minimum desktop viewport sizes, a narrower responsive layout, coarse-pointer controls, loading/filled rows, and keyboard and pointer highlights. See the [design system](../design-system/broken-arrow/MASTER.md) for shared surface policy.
