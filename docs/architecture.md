# Architecture notes

Area Glance is deliberately a compact area-summary card, not a generic layout or templating engine. The source is organised around that boundary:

- `src/area-glance-card.ts` owns the card and visual editor: configuration, rendering, and the local contributor sheets.
- `src/area-index.ts` builds one cached area/domain index for a Home Assistant state/registry snapshot. Both the card and editor use it, avoiding repeated full-state scans while resolving several insights.
- `src/actions.ts` sends the standard `hass-action` event. The card recognises tap, hold, and double-tap gestures; Home Assistant executes standard actions.
- `src/presets.ts` and `src/types.ts` keep the public configuration model and preset defaults separate from rendering.

Automatic matching remains intentionally conservative. It uses domains, device classes, and units first; name matching exists only as a narrow compatibility fallback for older integrations that do not expose the required metadata. The editor’s contributor lists are built from the same matching rules as the displayed aggregate.

## Change guide

- Add a new automatic insight by extending the preset and its matching rule together, then add a Card Lab session for the positive and negative cases.
- Add a new Home Assistant action by relying on the standard action configuration rather than adding another local execution path.
- Keep card-wide visual changes in the card stylesheet; preserve the preset-led editor flow before exposing advanced options.
