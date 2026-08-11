# Area Glance Card

**Choose an area and get a compact, live summary of the things that matter there.**

[![Open HACS repository on My Home Assistant](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=Future-Surfer&repository=ha-area-glance-card&category=plugin)

![Choose an area, get useful insights](docs/screenshots/area-to-insights.png)

## Get started

1. Install with HACS using the button above.
2. Add **Area Glance Card** to a dashboard and open its visual editor.
3. Choose **An area**, select a room, and leave the starter profile on **Auto**.

The card suggests compatible, live insights from Home Assistant's area metadata. Rearrange, remove, duplicate, or swap any insight afterwards.

```yaml
type: custom:area-glance-card
area: living_room
```

## Portable showcase

[The maintained showcase stack](examples/showcase.yaml) demonstrates the principal layouts, profiles, and appearance options in one vertical stack. Its `area: 1`, `area: 2`, and `area: 3` entries are portable showcase slots: they resolve to the first, second, and third real areas on the current Home Assistant installation, then use those actual areas for titles, suggestions, and aggregates.

For ordinary dashboard cards, continue to use your normal Home Assistant area ID such as `area: living_room`. A missing showcase slot stays empty; it never falls back to an unrelated room or whole-home aggregate.

If HACS has not added the dashboard resource, add it manually:

```yaml
url: /hacsfiles/ha-area-glance-card/area-glance-card.js
type: module
```

## Supported insights

- **Comfort & air:** temperature, humidity, CO₂, PM2.5, VOC, AQI, weather.
- **Home activity:** lights, power, battery, motion, presence, people home, doors, windows, blinds, locks, leaks, alarms, and Attention.
- **Devices & utilities:** media or other chosen devices, robot vacuums, cameras (including full-slot previews), clocks, calendar date, and Custom combinations.
- **Profiles:** automatic area, Whole home, Energy Dashboard, Home battery, Security, and Cameras (up to three cropped previews, one per camera device).

## Smart defaults, room by room

For areas, automatic suggestions include temperature, humidity, lights, live power, CO₂, PM2.5, VOC, AQI, motion, presence, doors, windows, blinds, locks, leaks, and Attention (unavailable entities or updates). Matching favours Home Assistant domains, device classes, and units—not loose entity-name matching.

You can also start with **Whole home**, **Energy**, **Home battery**, **Security**, or **Cameras**. The Cameras profile selects up to three cropped previews—one per device where possible—without affecting neighbouring insight widths.

With no area selected, **Energy** reads the live grid, solar, battery flow, and battery charge sources configured in Home Assistant's Energy Dashboard—never guessed from entity names. If Energy Dashboard is not configured, replace those slots with your own entity insights. Security is deliberately conservative: it reports the monitored alarm, doors, windows, and locks without claiming coverage the card cannot verify.

Dedicated entity-led insights are available for:

- Weather with a live condition icon and a selected reading.
- Robot vacuums with state, battery, or fan-speed display.
- Digital or analogue clocks and a calendar-date tile.
- A Custom combination: main value, optional supporting value, icon source, and state-based colours.

```yaml
# A deliberate group, independent of Home Assistant area membership
type: custom:area-glance-card
title: Air quality
metrics:
  - preset: custom
    entity: sensor.office_co2
    label_mode: entity
```

## Details when you need them

Area aggregates include compatible new devices automatically. Use **Exclude entities from this area** to remove noise such as an always-on LED, while future compatible devices continue to be included. Use **Selected entities** when you want a deliberate cross-area group instead.

Tap an aggregate to inspect exactly which entities contribute. Light aggregates include individual and all-lights toggles; numeric temperature and power aggregates show useful summary statistics. The same aggregate membership controls are available for area-based header statuses.

## Make it yours

Choose **Title beside insights** (the compact band), **Title above insights**, **Insight tower**, or **Insights only**. Stacked headers can align left, centre, or right. Cards resize their visible insights automatically.

Appearance controls cover height, theme-aware colour style, background, shadow, optional area icon, shared text weight (bold, regular, or light), and card-wide title, status, value, and label size adjustments.

Every header and insight supports Home Assistant tap, hold, and double-tap actions. Fine tuning includes aggregation choice, threshold colours, label source, decimal precision, unit display/override, icon and label visibility, and power-direction inversion.

![Automatic Living-area summary](docs/screenshots/living.png)

![Energy Dashboard summary](docs/screenshots/energy.png)

## Troubleshooting

Assign devices or entities to an area in Home Assistant for room-level suggestions. Leave the area blank for a whole-home aggregate, then use **Exclude entities from this home** to remove an outlier.

If an expected device is missing, check its area assignment and device class/unit first. Choose **A specific entity** or **Selected entities** when it is intentionally exceptional. The contributor sheet is the quickest way to see what an aggregate currently includes.

## Development

Run `npm install`, `npm run check`, then `npm run build`. Commit the generated [area-glance-card.js](area-glance-card.js) with source changes. See [architecture notes](docs/architecture.md) before extending automatic matching or actions.
