# Area Glance Card — next release notes (draft)

> Draft release notes for the release after v0.3.0. v0.3.0 focused on camera feeds and tower-layout refinements; this release adds the dedicated Chart profile and appearance polish.

## Highlights

### New: Chart profile

- Added **Chart** as a top-level card purpose. It is a dedicated, responsive header-and-plot card rather than a metric-slot variation.
- Supported chart forms:
  - **Line (single entity)** with a filled area by default; switch to an unfilled line in Fine tuning.
  - **Line (multiple entities)** for up to three selected compatible sensors, with per-line colours, an optional compact legend, and overlap or non-negative stacked display.
  - **Columns** for live power and signed interval readings, with hourly aggregation choices.
  - **Daily totals** for total-increasing energy, water, gas, and monetary sensors.
- Charts use Home Assistant Recorder history and long-term statistics where appropriate, keep the latest live value in the header, and show a calm unavailable-history state instead of inventing data.
- Energy Dashboard sources are used where they can be resolved honestly: solar, grid import/export, battery charge, and battery flow. A direct entity remains immediately selectable for every chart.
- Chart controls include custom history duration, data-source preference, unit/decimal overrides, fixed Y-axis minimum/maximum, and appropriate display colours.
- Signed line and column charts reserve orange for values below zero / export by default. Daily totals highlight the incomplete current day in orange and use a darker weekend tone.
- Daily-total charts can show compact per-day values when space allows, with responsive weekday/date labels.
- Chart headers reuse Area Glance title fitting and can sit beside or above the plot, matching the card's existing layout and typography model.
- Tapping a multi-line chart now opens the familiar contributor sheet, listing the entities represented by its lines.

## Appearance and polish

- Added portable **showcase area slots**: YAML can use `area: 1`, `area: 2`, and so on to resolve the matching numbered area on each Home Assistant installation. The card then uses that real area's name, devices, suggestions, aggregate rules, and actions; the editor shows the resolved area without rewriting the portable shorthand.
- Added an opt-in **Sunken** card shadow, alongside the existing raised shadow and no-shadow options.
- Shadow opacity and spread can now be adjusted from the visual editor, with a reset to the documented defaults.
- Added an opt-in **Show insight icons** appearance setting. Turn it off for a quieter, value-led band; ordinary insight values and labels gain modest extra emphasis.
- Added **Insight icon colours**: keep the current preset colours, or use black or grey as a card-wide default while preserving any explicit per-insight colour, threshold, or state rule.
- Chart-only text-size controls are now grouped with the existing card-wide typography controls, keeping the editor consistent while allowing axis and bar-label refinement.
- Single- and multi-line charts can add faint horizontal, vertical, or two-axis guides that align to their visible labels and sit behind the plotted data.
- Daily-total charts can optionally mark calendar week boundaries, with Monday- or Sunday-starting weeks to match the household's convention.
- Daily-total charts can also add faint horizontal guides at their value-axis labels, independently of week dividers.

## Fixes and reliability work

- The Cameras profile now discovers feeds after Home Assistant has supplied
  live state, avoiding a blank placeholder on a fresh dashboard load.
- Portable numeric area slots now receive the same initial, area-aware
  suggestions as a newly chosen area in the visual editor, while any metrics
  explicitly written in YAML remain untouched.
- Chart history loading now avoids replacing a valid Energy Dashboard source with a temporary generic suggestion while configuration is still loading.
- Chart requests are cached by their source and display settings, stale responses are ignored, and live state updates can refresh the visible latest value without a full history reload.
- Chart geometry follows the final plot size so SVG labels are not distorted as Home Assistant Sections layouts settle.
- Refined chart axis and daily-bar labelling for narrow layouts, including calmer label density and aligned day labels.

## Compatibility and notes

- Existing v0.3.0 cards remain supported and retain their normal layout, icon, and shadow appearance.
- Insight icons remain on unless `appearance.show_insight_icons: false` is chosen.
- With `appearance.insight_icon_color` absent, existing preset and dynamic icon colours are unchanged.
- Existing `appearance.shadow: false` configurations remain supported and map to **No shadow**. New `appearance.shadow_style` takes precedence when present.
- Existing string `area:` IDs are unchanged. Numeric `area:` values are reserved for portable showcase slots and resolve against the current installation's sorted area IDs; a missing slot stays empty rather than becoming a whole-home aggregate.
- Camera previews, analogue clocks, and calendar tiles retain their dedicated visual treatment when ordinary insight icons are hidden, so those slots do not lose their primary content.
- The legacy `chart.type: area` configuration remains recognised. New single-entity line charts use the filled-area presentation by default; set `chart.show_area: false` for an unfilled line.
- Charts are deliberately single-source except for the explicit multi-line mode. They do not aggregate history for an area or fabricate totals from a live power sensor.
- Automatic Energy Dashboard selection depends on the sources exposed by the user's Energy Dashboard setup. Users can always select a direct entity instead.

## Upgrade notes

- No YAML migration is required.
- HACS users can update normally. For manual installations, replace `area-glance-card.js` and refresh the resource with a new cache-busting query string.
