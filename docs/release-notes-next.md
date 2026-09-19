# Area Glance Card — next release notes (draft)

> Add only completed, user-visible changes after v0.4.2. Keep the final GitHub release concise and group behaviour changes under Highlights, Fixes, and Compatibility.

## Highlights

- **Mini Chart comparison:** direct line and area insights can now overlay today in orange with yesterday in grey on a shared 24-hour axis—particularly useful for solar generation.
- **Mini Charts profile:** a new top-level starter profile introduces compact history with four editable Energy Dashboard trends: signed grid line, solar area, battery-flow columns, and stepped battery charge.
- **Mini trends:** compatible direct numeric entities and Energy Dashboard sources can now render a compact line, area, or column history inside a normal insight slot. They retain the normal label and action model, work across band, stacked, insight-only, and tower layouts, and fall back calmly to the ordinary value when history is unavailable.
- **Aggregate Mini Charts:** numeric area and selected-entity insights can now reconstruct a compact historical aggregate from their included Recorder contributors, respecting existing exclusions and sum/average/min/max/median settings.
- **Signal Mini Charts:** lights and recognised area signals can now show a bounded active/open-count trend, while visual-only and categorical insights retain their honest standard presentation.
- **Current-value mini charts:** Mini Charts can show their current value as a protected overlay, below the trend, or not at all. The overlay is the responsive default and retains a continuous graph behind a subtle card-colour halo.
- **Mini Chart refinement:** Line and area trends gain an adjustable stroke width, while overlay values can be placed at the five clear positions around the plot and now follow the shared **Insight values** text-size control.

## Fixes and refinements

- **Longer Mini Chart ranges:** 7–30 day trends now automatically request Recorder statistics instead of sparse or expensive raw state history. Advanced users can still explicitly choose either data source.
- **Dynamic insight labels:** a direct-entity insight can now use its current entity value as its label when that is the clearest compact description.
- **Mini Chart label legibility:** compact trend labels now use the ordinary shared label scale without an extra container-query cap, while retaining the normal long-label fitting and ellipsis behaviour.

## Compatibility

- _Record any migration, retained legacy behaviour, or intentional configuration change here._

## Release checklist

- [ ] Confirm version and release scope.
- [ ] Refresh screenshots where a visual change needs illustrating.
- [ ] Run final type/build checks, Card Lab regression sessions, and a Home Assistant smoke test.
