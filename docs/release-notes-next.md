# Area Glance Card — next release notes (draft)

> Draft notes for the patch after v0.4.0.

## Fixes

- **Colour styles are reliable again.** Light, Slate, Dark, dashboard theme, and Custom background now resolve through one authoritative appearance path for every card type, including Charts.
- Switching a named colour style no longer lets an old custom background or legacy theme field win over the new selection.
- In dashboard dark mode, cards now use a subtly lighter edge for clearer separation from the page background without changing their established surfaces.
- Shadow fine tuning now includes an optional colour. The default remains black; a low-opacity white setting can create a soft dark-dashboard glow.
- Raised shadows can now be offset horizontally and vertically; inner shadows intentionally retain their fixed inset treatment.
- Card appearance now includes shared **Corner rounding** control for bands, towers, camera feeds, and Charts. Leave it unset to retain the existing responsive default.
- Daily total Charts can show an optional continuous average line, with dashed/solid, colour, and thickness controls. Daily and column bars are now solid by default, with an optional bar-opacity control. Compact card-colour halos keep bar values and units legible when a lighter treatment is selected; the optional `AVG` header readout covers the displayed range while the main value remains today's total.
- Added a Card Lab regression session that renders Light, Slate, Dark, and a Slate Chart from preset-only YAML, guarding this behaviour going forward.

## Compatibility

- No YAML migration is required. Existing top-level `theme` and `background` settings remain supported as a legacy fallback.
