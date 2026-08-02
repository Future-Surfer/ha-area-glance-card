# Area Glance Card v0.2.0 — draft release notes

> Draft for the next release. This compares the current development build with v0.1.0.

## Highlights

- Much broader area-aware coverage: doors, windows, blinds, locks, leaks, presence, CO₂, PM2.5, VOC, AQI, weather, robot vacuums, clocks, calendar dates, Attention, and a conservative whole-home Security profile.
- Aggregates are now inspectable and controllable. Tap an aggregate to see its contributors; light sheets provide individual toggles and an all-lights control. Temperature and power sheets include summary statistics.
- More trustworthy membership controls: retain automatic discovery while excluding individual outliers, or explicitly choose a cross-area set of entities.
- New layouts: title above insights, insights only, and a compact one-column Insight tower, alongside the original title-beside-insights band.
- A much more capable visual editor with starter profiles, drag-to-reorder, duplicate, advanced aggregation, contributor membership, actions, display controls, and clearer entity/icon pickers.
- More flexible presentation: height, header alignment and line behaviour, optional area icon, card-wide text scales, and bold/regular/light text weights.
- The system-wide Energy profile now uses Home Assistant's configured Energy Dashboard sources for live grid flow, solar, battery flow, and battery charge, instead of entity-name inference.

## Improvements since v0.1.0

- Automatic matching now prioritises Home Assistant domains, device classes, and measurement units rather than broad name matching.
- Whole-home, Home battery, and Security profiles complement the standard area workflow; Energy is explicitly system-wide when no area is selected.
- Header statuses and insights support Home Assistant tap, hold, and double-tap actions.
- Numeric insights support aggregation selection, decimals, unit display/override, threshold colours, and inverted power direction.
- Explicit entity insights can use friendly entity labels; Custom combination supports separate main, supporting, icon, and colour-source entities.
- Cards and dense values adapt more gracefully to available width, including dynamic unit sizing and shared text scaling.
- Contributor sheets are now consistent across aggregates, scroll safely on small screens, and explain exactly what is included.

## Compatibility and notes

- Existing v0.1.0 configurations remain supported. The former `appearance.style: light` setting remains recognised and maps to the new light text weight.
- The optional area icon is off by default, so existing header proportions remain unchanged.
- Automatic matching remains conservative. Assign devices/entities to areas and use specific or selected-entity sources where a device is intentionally exceptional.
- Security reports only monitored entities it can identify; it does not claim complete home coverage.

## Upgrade

Update the card through HACS after the release is published. If you manage the resource manually, refresh the dashboard with a new cache-busting query string after replacing `area-glance-card.js`.
