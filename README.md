# Area Glance Card

Area Glance turns the entities assigned to a Home Assistant area into a compact, dependable live summary.

[![Open HACS repository on My Home Assistant](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=Future-Surfer&repository=ha-area-glance-card&category=plugin)

![Choose an area, get useful insights](docs/screenshots/area-to-insights.png)

## Start with an area

1. Install with HACS using the button above.
2. Add **Area Glance Card** and open its visual editor.
3. Choose **An area** and select your room. Leave **Starter profile** on Auto.

The card suggests useful, live insights using Home Assistant's area metadata. Swap, remove, reorder, or duplicate any insight afterwards.

```yaml
type: custom:area-glance-card
area: living_room
```

Three useful starting points are just as small:

```yaml
# Whole-home energy summary
type: custom:area-glance-card
profile: energy

# One explicit entity, without automatic matching
type: custom:area-glance-card
title: Air quality
metrics:
  - preset: custom
    entity: sensor.office_co2
    label_mode: entity
```

## What it can show

Automatic area insights include temperature, humidity, lights on/total, summed power, CO₂, PM2.5, VOC, AQI, motion, room presence, doors, windows, blinds, locks, leaks, and Attention (unavailable entities or available updates). Area matching prefers Home Assistant domains, device classes, and units—not just names.

Choose **Whole home**, **Energy**, **Home battery**, or **Security** instead of an area when that suits the card better. Security is deliberately conservative: it reports the alarm, monitored doors and windows, and locks without claiming unverified coverage.

For an individual device, choose a specific entity. Dedicated options are available for:

- Weather: live condition icon, temperature, feels-like temperature, humidity, or wind.
- Robot vacuum: activity, battery level, or fan speed with state-aware icon colours.
- Clock: digital or analogue.
- Calendar date: a compact live date tile.
- Custom combination: a main entity, optional supporting entity, optional icon source, and state-to-colour rules.

## Make an aggregate trustworthy

Area insights include compatible newly added devices automatically. Open **Exclude entities from this area** to remove noise such as always-on LEDs; the next compatible device will still be included by default. You can instead choose **Selected entities** for a deliberate cross-area group.

Numeric groups support sum, average, median, highest, and lowest aggregation. Tap an aggregate to see its contributors. The same automatic-exclusion model is available for area-based header statuses, including the Security header.

## Layout, interaction, and appearance

Choose the format that fits the dashboard:

- **Title beside insights** — the compact default band.
- **Title above insights** — a wider stacked band with left, centre, or right header alignment.
- **Insight tower** — compact vertical rows for one dashboard column.
- **Insights only** — no header.

Every insight can have tap, hold, and double-tap actions. Fine tuning also provides threshold colours, labels from the entity name or a custom label, decimal precision, unit controls, icon/label visibility, power-direction inversion, and card-wide text-size controls.

![Living-area example](docs/screenshots/living.png)

![Energy example](docs/screenshots/energy.png)

## Installation note

HACS normally adds the dashboard resource. If it does not, add this resource manually:

```yaml
url: /hacsfiles/ha-area-glance-card/area-glance-card.js
type: module
```

## Automatic matching and troubleshooting

Automatic insights use Home Assistant domains, device classes, and measurement units before considering an entity name. Assign devices or entities to an area in Home Assistant for room-level summaries. Leave the area blank for a whole-home aggregate, then use **Exclude entities from this home** to remove a known outlier.

If an expected entity is absent, first check that it is assigned to the intended area and exposes the expected device class/unit. Choose **A specific entity** or **Selected entities** when that device is intentionally exceptional. An aggregate’s contributor sheet shows exactly what is currently included.

## Development

Run `npm install`, `npm run check`, then `npm run build`. Commit the generated [area-glance-card.js](area-glance-card.js) with source changes. See [architecture notes](docs/architecture.md) before extending automatic matching or actions.
