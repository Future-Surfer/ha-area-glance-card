# Area Glance Card

Area Glance turns the sensors and devices assigned to a Home Assistant area into one compact, live summary.

[![Open HACS repository on My Home Assistant](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=Future-Surfer&repository=ha-area-glance-card&category=plugin)

## How it works

![Choose an area, get automatic area insights](docs/screenshots/area-to-insights.png)

## Get started

1. Install from HACS with the button above (or add this repository as a **Dashboard** custom repository).
2. Add **Area Glance Card** to a dashboard and open its visual editor.
3. Leave **Starter profile** on **Auto**, then choose an area. Its useful metrics populate automatically.
4. Swap any slot, choose one specific entity instead, or adjust the card’s layout and appearance whenever you like.

The card aggregates compatible sensors in an area: median temperature and humidity, lights on/total, summed live power, CO₂, PM2.5, VOC, Air Quality Index, motion, presence, doors, windows and water leaks. Whole-home cards can show **People home** from Home Assistant's Home zone; room **Presence** is kept separate, so it never implies that someone is home.

Blinds are available as either an automatic area summary or a chosen entity. Automatic summaries include only covers Home Assistant identifies as a blind, shade, shutter, or curtain, so garage doors and door covers stay out of the count.

Need something more specific? Swap a slot to **A specific entity** and choose a media player, robot vacuum, weather, climate, battery sensor, or any other entity. The dedicated **Weather** insight uses a chosen Weather entity's live condition icon and can show its condition, temperature, feels-like temperature, humidity, or wind. **Clock** is available in digital or analogue form, while **Calendar date** adds today's date in a compact calendar tile without needing an entity. For a two-part result such as air quality, choose **Custom combination**: one entity supplies the main state, another can supply the smaller supporting value, and optional state-to-colour rules keep the icon meaningful.

When you want to go further, each insight's optional fine-tuning section keeps the advanced tools out of the initial setup: reorder or duplicate slots, choose what happens on tap, inspect aggregate contributors, pick an aggregation, add icon-colour thresholds, or polish the label and display. Numeric insights can use automatic precision or up to four decimal places; a Power insight can also reverse its direction when an integration reports import/export with the opposite sign.

Area summaries can also be tailored without losing their automatic behaviour. In **Customise included entities**, leave the default **All compatible except excluded** mode on and uncheck noise such as LED indicators; compatible devices added to the area later will still join automatically. **Only selected entities** is available when you deliberately want a fixed list.

The optional **Attention** insight checks an area (or the whole home) for unavailable entities and available Home Assistant updates. It reports only what it can see, and its contributor sheet shows the affected entities.

Choose **Title above insights** in the Header section for a wider stacked band, with left, centre, or right-aligned header text.

If HACS does not add the dashboard resource itself, add:

```yaml
url: /hacsfiles/ha-area-glance-card/area-glance-card.js
type: module
```

## YAML, if you prefer it

```yaml
type: custom:area-glance-card
area: living_room
```

The visual editor is the easiest way to refine this starter card. It can also switch a metric from its area aggregate to one chosen entity.

![Living-area example](docs/screenshots/living.png)

![Energy example](docs/screenshots/energy.png)

## Development

Run `npm install`, `npm run check`, then `npm run build`. Commit the generated [area-glance-card.js](area-glance-card.js) with source changes.
