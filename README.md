# Area Glance Card

A compact, responsive Home Assistant summary card for an area, room, household, or system such as energy. It turns the repeated five-part bands in the reference dashboard into a real custom card—without asking people to maintain a grid of JavaScript templates.

## What is implemented

- A title/status section plus up to five metric cells, or a metrics-only band with up to five equal segments; dividers, rounded styling, light/dark variants, and narrow-screen layout are included.
- Preset-led metrics: Temperature, Humidity, Lights in area, Power, Battery, CO₂, Device state, and Custom.
- Entity formatting, units, battery threshold colours, unavailable hiding, and `area`-based light aggregation.
- Card and metric tap actions (`more-info`, navigate, toggle, call service, or none).
- A visual editor designed around “what should this show?” first. It reveals icon, label, colour, and unit overrides only in a per-metric fine-tuning section.
- A modular slot editor with Home Assistant's searchable entity and area pickers. Its starter profiles lightly infer whether an area is a room, media room, garage/battery, or energy space; every inference remains user-overridable.
- An Appearance section in the editor with theme, light, slate, charcoal, and custom-background choices, plus a drop-shadow toggle.
- HACS metadata, TypeScript/Lit source, and Card Lab presets/fixture guidance.

## Installation

### HACS

Add this repository as a **Dashboard** repository, download it, then add the HACS-provided resource if it was not added automatically.

### Manual

Build the release file with `npm install` and `npm run build`. Copy `area-glance-card.js` to `config/www`, add it as a JavaScript module resource, then use `custom:area-glance-card`.

## Quick start

```yaml
type: custom:area-glance-card
title: Living
area: living_room
status:
  entity: binary_sensor.living_room_motion
  active_text: Motion
  inactive_text: No motion
  show_last_changed: true
metrics:
  - preset: temperature
    entity: sensor.living_room_temperature
  - preset: lights
  - preset: power
    entity: sensor.living_room_power
  - preset: device
    entity: media_player.lounge
    label: TV
    icon: mdi:television
```

When an `area` is set on the card, the Lights preset uses it automatically. The area lookup follows an entity's area first, then its device's area, matching the way Home Assistant models area ownership.

## Configuration

| Key | Purpose |
| --- | --- |
| `title` / `area` | Give the band a title, or derive it from an area. At least one is required except for the `house` profile. |
| `status` | Optional `entity`, active/inactive text and colours, and `show_last_changed`. |
| `metrics` | One to five metric objects. Each starts with a `preset`. |
| `layout` | `header` (default) or `metrics-only`. The number of visible metric objects determines the remaining segments. |
| `height` | `compact` (default, original band density), `standard`, or `comfortable`. Icons, type, padding, and section grid rows scale together. |
| `profile` | Optional starter profile: `auto`, `room`, `media`, `battery`, `energy`, or `house`. `auto` applies light name-based inference only when populating slots in the editor. `house` scans the entire instance and leaves `area` blank. |
| `appearance` | Editor-led visual settings: `preset` (`theme`, `light`, `slate`, `charcoal`, or `custom`), optional `background`, and `shadow` (`true` by default). |
| `theme` | `auto` (default), `light`, or `dark`. |
| `background` | Legacy direct background colour/gradient. New configurations should use `appearance.background`. |
| `action` | Optional card action; metrics may override it. |

Metric overrides include `entity`, `area`, `label`, `icon`, `color`, `unit`, `decimals`, `hide_unavailable`, `hidden`, and the normal action keys. `lights` uses `area` (or the card `area`) and supports `domain` when a different domain should be counted.

The first release deliberately does not execute user-provided JavaScript templates. Presets cover the common live values safely and keep the editor understandable. More derived aggregates and declarative value/colour rules belong in a later, typed configuration addition rather than an unsafe template field.

## Development

```text
src/                    TypeScript/Lit source
area-glance-card.js     Generated release module
card-lab.json           Authoritative local preview presets
CARD_LAB.md             Local visual-review notes
```

Run `npm run check` followed by `npm run build`. Use the `area-glance-reference` Card Lab session to take a deterministic screenshot after adding the target in the Lab configuration.

## Technical decisions

- **Lit 3 + TypeScript + Rollup.** This follows the current community custom-card boilerplate pattern while producing one HACS-friendly browser module.
- **A dedicated editor, not the generic config form.** The card needs repeatable metric groups, sensible defaults, adding/removing cells, and progressive disclosure; a custom editor is clearer than a deeply nested generic schema.
- **Standard custom-card hooks.** The card supplies `setConfig`, `getConfigElement`, `getStubConfig`, `getCardSize`, `getGridOptions`, and a `window.customCards` registration for the picker and both dashboard layout systems.
- **Theme variables with optional reference palettes.** The default card inherits Home Assistant CSS variables. The editor adds a small set of intentionally opinionated reference palettes and a custom-colour escape hatch, rather than exposing an overwhelming list of style controls.
- **Registry-aware areas.** A real Home Assistant frontend exposes entity/device registries in the `hass` object. The card uses those when available and degrades harmlessly when a frontend/test harness does not expose them.

These decisions are based on the current [Home Assistant custom-card documentation](https://developers.home-assistant.io/docs/frontend/custom-ui/custom-card/), [sections sizing guidance](https://developers.home-assistant.io/blog/2024/11/06/custom-card-sections-support/), the [community boilerplate](https://github.com/custom-cards/boilerplate-card), and [HACS publishing guidance](https://hacs.xyz/docs/publish/start/).
