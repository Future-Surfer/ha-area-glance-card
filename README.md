# Area Glance Card

**A compact Home Assistant card that turns an area, home system, camera set, or sensor history into a clear live summary.**

[![Open HACS repository on My Home Assistant](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=Future-Surfer&repository=ha-area-glance-card&category=plugin)

![Choose an area, get useful insights](docs/screenshots/area-to-insights.png)

Pick an area in the visual editor and Area Glance suggests the useful things already assigned to it. Keep the suggestions, swap them, or build a deliberate summary from selected entities.

## Start here

1. Install with HACS using the button above.
2. Add **Area Glance Card** to a dashboard and open its visual editor.
3. Choose **An area**, select a room, and leave the starter profile on **Auto**.

```yaml
type: custom:area-glance-card
area: living_room
```

If HACS has not added the resource, add it manually:

```yaml
url: /hacsfiles/ha-area-glance-card/area-glance-card.js
type: module
```

## What it can show

- **Areas and home activity:** temperature, humidity, lights, power, motion, presence, people home, doors, windows, blinds, locks, leaks, and alarms.
- **Air and devices:** CO₂, PM2.5, VOC, AQI, weather, media, robot vacuums, clocks, calendar dates, cameras, and custom combinations.
- **System profiles:** Whole home, Energy Dashboard, Home battery, Security, Cameras, and **Mini charts**—four editable Energy Dashboard trends demonstrating line, area, columns, and stepped history.
- **Chart history:** single or multi-series line/area history, columns, and daily totals from a recorded entity or compatible Energy Dashboard source.
- **Mini trends:** turn one direct numeric entity or compatible Energy Dashboard source into a compact line, area, or column trend inside a normal insight slot.

Matching favours Home Assistant domains, device classes, units, and Energy Dashboard configuration rather than loose entity-name matching.

## Layouts and charts

Choose a compact band, title-above layout, insight-only card, or a one-column Insight tower. Cards resize their visible insights automatically. Mini trends retain the usual slot label and action behaviour, adapt to every layout, and calmly fall back to the ordinary value when Recorder history is unavailable.

![Whole-home summary band](docs/screenshots/house-profile.png)

![One-column insight tower](docs/screenshots/insight-tower.png)

Chart cards keep one live summary alongside a deliberately restrained plot.

![Solar generation chart](docs/screenshots/solar-chart.png)

![Daily gas totals chart](docs/screenshots/daily-totals-chart.png)

![Multi-series temperature chart](docs/screenshots/multi-line-chart.png)

### Mini trends

For a compact visual cue rather than a numeric readout, set an ordinary insight to use the history of one direct entity (or a compatible Energy Dashboard source). It stays an insight: its label and configured actions remain in the usual place.

```yaml
type: custom:area-glance-card
title: Energy
metrics:
  - preset: power
    source: entity
    entity: sensor.grid_power
    label: Grid
    mini_chart:
      type: area # line, area, or columns
      range: 24h
      negative_color: var(--orange-color)
      comparison: today_yesterday # optional direct-source solar comparison
      line_thickness: 2.2 # optional, line/area trends only
      value_position: top_left # bottom_left, centre, top/bottom right
```

Numeric area and selected-entity insights can also use a bounded combined history. The trend reconstructs the same sum, average, minimum, maximum, or median across the included Recorder contributors; visual-only and categorical insights retain their ordinary presentation where a line would be misleading.

## Make it yours

Rearrange, duplicate, remove, or swap insights in the editor. Each area aggregate can automatically include new compatible devices; exclude an outlier while retaining that automatic discovery, or choose a precise group of entities instead.

Tap an aggregate to inspect its contributors. Lights offer individual and all-lights toggles; temperature and power show summary statistics. Any direct entity insight with a configured **Toggle** tap or hold action can optionally display as a compact toggle, while ordinary insights remain read-only. Choose one shared toggle colour in Card appearance, or override it for an individual insight. Energy and battery cards reveal the configured Energy Dashboard sources that drive each metric.

Appearance controls include height, background, raised or inset shadow, optional area icon, card-wide text sizing and weight, and default insight icon treatment. Individual insights can still override their own colour, label, icon, unit, decimals, aggregation, and actions.

## Portable showcase

[The maintained showcase stack](examples/showcase.yaml) is a living regression example for the main profiles, layouts, and appearance options. Its `area: 1`, `area: 2`, and `area: 3` values are portable showcase slots: they resolve to the first, second, and third real areas in the current Home Assistant instance, then use those actual areas for titles, suggestions, and aggregates.

For normal dashboard cards, use the regular area ID such as `area: living_room`. A missing showcase slot stays empty; it never falls back to an unrelated room or whole-home aggregate. Direct-entity actions, including **Display as toggle**, stay out of this portable YAML because no safe example can assume a light or switch entity ID in another installation; they are covered by dedicated Card Lab fixtures instead.

## Troubleshooting

For room-level suggestions, assign devices or entities to an area in Home Assistant. If an expected device is missing, check its area assignment and device class or unit, then use **A specific entity** or **Selected entities** for intentional exceptions.

Leave the area empty for whole-home aggregates. Energy without an area uses configured Energy Dashboard sources; it does not guess from entity names. Security reports only the monitored entities it can identify and does not claim complete home coverage.

## Development

Run `npm install`, `npm run check`, then `npm run build`. Commit the generated [area-glance-card.js](area-glance-card.js) with source changes. See the [architecture notes](docs/architecture.md) before extending automatic matching or actions.
