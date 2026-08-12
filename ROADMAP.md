# Area Glance Card roadmap

## Product boundary

**Area Glance Card turns the entities assigned to a Home Assistant area into one compact, dependable band of useful live information.**

It should feel effortless for a normal dashboard user: choose an area, get sensible suggestions, and make small edits in the visual editor. It should also reward a power user with carefully contained advanced controls when the sensible default is not enough.

The card is not intended to become a generic dashboard layout engine, a templating language, or an all-purpose entity card. New work should make area summaries more trustworthy, easier to configure, or more useful at a glance.

### Design principles

- Prefer Home Assistant metadata such as domain, device class, unit, area, and state class over entity-name guesses.
- Keep the first-run path preset-led; put complexity behind an intentional choice or an Advanced section.
- Keep the visual band compact, responsive, and consistent when several cards are stacked.
- Make automatic behaviour inspectable: users should be able to see what contributes to an aggregate and why.
- Preserve explicit control: a specific-entity or Custom combination slot may override automatic inference.
- Treat security language with care: report monitored entities and active conditions, never imply coverage the card cannot verify.

## Current baseline

- Area-led suggestions for room, media, battery, and whole-home cards, plus a system-wide Energy profile that reads the explicit live sources configured in Home Assistant's Energy Dashboard.
- Compact, stacked, and metrics-only layouts with theme-aware appearance controls.
- Automatic temperature, humidity, lights, live power, CO₂, PM2.5, VOC, AQI, motion, presence, doors, windows, and leak summaries.
- Strict measurement matching for automatic numeric area insights, with a narrow legacy fallback for classless CO₂ sensors.
- Header and status actions, plus contributor detail sheets for aggregates.
- Standard Home Assistant `hass-action` dispatch with touch-safe tap, hold, and double-tap recognition for insight segments.
- Cached area/domain entity discovery shared by the card and visual editor, so a card resolves its insights without repeatedly scanning the full Home Assistant state collection.
- Automatic blind summaries use Home Assistant cover device classes; blinds, shades, shutters, and curtains are included while garage and door covers remain separate.
- Aggregate insights and area-based header statuses support automatic exclusions, while keeping compatibility checks and contributor sheets truthful.
- An optional Attention insight reports unavailable entities and available updates for an area or the whole home.
- A Custom combination insight for power users who need separate main and supporting entities, an icon source, and state-to-colour rules.
- A whole-home Security profile with conservative alarm, door, window, and lock summaries; it prioritises active issues and never claims unverified coverage.

### Coverage audit

Automatic matching now covers the common area-summary signals with Home Assistant metadata rather than entity-name searches: temperature, humidity, power, COâ‚‚, particulate matter, VOC, AQI, lights, motion/presence, openings, leaks, recognised blind covers, locks, alarms, and update availability. Power accepts the official `power` device class and standard power units, retaining a narrow classless fallback for older integrations. Locks and update availability also accept their legacy binary-sensor device classes.

Broader domains such as climate and cameras remain intentionally available through **A specific entity** rather than as automatic aggregates. A dedicated, entity-led **Vacuum** insight shows robot-vacuum activity with a state-aware icon and colour, or its battery or fan speed; it is intentionally not guessed as an automatic room preset. A dedicated **Weather** insight is intentionally entity-led too: it provides a live condition icon plus selected current readings, but never guesses which weather provider a household prefers. Clock and Calendar date are self-contained utilities rather than area aggregates.

Known limits remain explicit: Attention counts affected **entities**, not deduplicated physical devices; and no automatic smoke, gas, CO, or generic-problem aggregate is suggested until its wording and coverage rules can be made as trustworthy as Security's existing signals.

Camera previews can be used individually or via the Cameras profile, which selects up to three feeds and keeps one lower-resolution feed per physical camera device where resolution metadata is available. It must never let native camera dimensions alter insight widths. More ambitious camera grids and automatic camera discovery rules remain deliberately out of scope until this constrained presentation has been proven reliable across Home Assistant layouts and the Card Lab.

## Roadmap

### Loading states (exploration)

**Goal:** Replace the plain loading message with a small, calm, recognisable Area Glance loading treatment that feels intentional while live data, history, or contributors are resolving.

- Keep the layout stable: a loading state must reserve the final card geometry so a finished card does not jump.
- Prefer a restrained motion/mark built from the existing visual language over a generic spinner; it must remain useful with reduced-motion preferences and never suggest that a live value is already known.
- Use one shared loading primitive across standard bands, charts, contributor sheets, and the visual-editor preview, with an explicit unavailable/error state remaining distinct from loading.
- Ensure the animation is lightweight, theme-aware, accessible, and bounded so a slow Home Assistant response does not become distracting.

### Visual style system (exploration)

**Goal:** Let a small named visual style do more useful work than changing a colour palette, while preserving Home Assistant's theme and explicit user choices.

- Future styles may define typography weight, icon policy, divider strength, radius, shadow, and emphasis behaviour—not merely background colour.
- A restrained **Precision** direction should use mostly monochrome icons and fine linework, reserving colour for status, warnings, and meaningful data emphasis.
- Explicit entity colours, threshold colours, and safety states must always override a visual style.
- Keep styles as a small named set backed by CSS variables; do not introduce arbitrary CSS controls.
- Implement this after the Chart profile, so the first chart establishes the shared visual primitives rather than two styling systems evolving independently.

### Mini Charts in insight slots

**Goal:** Let a normal insight slot show a small, useful visual history without becoming a second full Chart card or disturbing the compact band.

- Start with opt-in visuals for compatible numeric insights: a sparkline, compact columns/bars, and a simple current-versus-range treatment.
- Reuse the Chart profile's history/statistics adapter, caching, scale logic, formatting, and unavailable-history treatment rather than introducing another data path.
- Keep the surrounding layout stable: a Mini Chart lives entirely inside its existing insight slot, is cropped to that slot, and never claims width from neighbouring insights.
- Make the visual subordinate to the current value. At narrow widths, retain a truthful value or fall back calmly rather than rendering an illegible graph.
- Treat pie/donut displays as an intentionally narrow use case for discrete parts-of-a-whole aggregates such as lights on/off, rather than a generic chart type.
- Define clear data requirements and graceful fallbacks when Recorder/history is unavailable; no guessed history and no heavy per-card polling.
- Reuse Home Assistant’s own history/statistics APIs and formatting conventions where possible.

**Done when:** a user can enable a compact history treatment for one compatible insight, understand it at a glance, and stack several cards without visual instability or repeated history requests.

### Multi-entity chart aggregation

**Status:** Deferred until the dedicated multi-line chart has established the shared entity-selection, unit-compatibility, caching, and history-loading infrastructure.

**Goal:** Let a chart show one honest combined series from a small, explicitly selected set of compatible entities.

- Add an advanced **Show as** choice to a future multi-entity chart: separate lines or one combined value.
- Support only clear operations: mean, minimum, maximum, sum, and (if testing proves it worthwhile) median.
- Offer meaningful defaults without silently changing the result: mean for environmental readings, sum for compatible power readings, and require an explicit choice when the semantics are ambiguous.
- Require compatible measurement dimensions and display units. Never combine temperature with power, or unrelated concentration units.
- Align histories onto a shared time grid using a documented last-known-value rule, with a staleness limit so an old sensor cannot be presented as a current contributor.
- Make contributor membership inspectable and reuse the existing selected-entity and exclusion controls rather than creating a second membership model.
- Keep the first version deliberately small: direct selected entities only, one shared value axis, no area-history aggregation, no multi-axis charts, and no fabricated totals from live power readings.

**Done when:** a user can deliberately select several compatible sensors, choose a transparent aggregation, inspect contributors, and trust that gaps or stale readings are never hidden by the chart.

### Thermostat and climate support

**Goal:** Turn the existing generic Climate device display into a purposeful thermostat insight without guessing how a household controls heating.

- Support a selected `climate.*` entity with current temperature, target temperature, HVAC mode, and action/state-aware iconography.
- Offer a calm default summary, with optional choices for the primary reading rather than exposing every climate attribute at once.
- Consider safe quick controls only after the display works reliably: mode selection and target adjustment must use Home Assistant’s normal service/action patterns and respect unavailable entities.
- Do not infer a whole-home thermostat aggregate until the distinction between zones, rooms, and heating systems is communicated honestly.

### Multi-area house navigator (exploration)

**Goal:** Evolve the simple promise of “choose an area, see its key insights” into an optional, calm whole-house view—without turning Area Glance into a dashboard generator.

- Start with an explicit, static multi-area mode: the user chooses a small set of areas and the card renders each as its familiar Area Glance row. In tower layout, those same areas can form a vertical series.
- Explore an optional area picker at the top (tabs or compact chips) that filters the view to one selected area when space is limited, especially on mobile.
- Preserve the existing area-aware rules for every row: automatic discovery, exclusions, selected-entity sets, actions, detail sheets, and unavailable handling must stay correct in that row’s area context.
- Keep selection deliberate. Initial configuration should ask users which areas to include and in what order; do not silently add every area in the home. An explicit “all areas” option can be considered later.
- Allow a shared starter profile across selected rooms first. Per-area overrides are useful, but should follow only if they can avoid a deeply nested, overwhelming editor.
- Reuse the same discovery and aggregation engine, with one area/entity index per Home Assistant update, so a whole-house view does not multiply scans of `hass.states`.
- Keep system-wide concepts honest: Energy, Security and Cameras should remain their own profiles initially rather than being mixed indistinguishably into room tabs.
- Validate the interaction in Card Lab before implementation: four-to-six room desktop stacks, narrow mobile tabs, tower series, missing area data, and mixed room capabilities.

**Not in scope for the first version:** automatic dashboard generation, floorplans, persisted global navigation state, or claiming that a selected set of rooms represents complete home coverage.

### Action insights (exploration)

**Goal:** Let an insight become a calm, obvious control when its main job is changing a simple entity state, without weakening the card's dependable read-only summaries.

- Add an opt-in **Action insight** for a deliberately small initial set of stateful entities: lights, switches, input booleans, fans, covers, locks, and any other domain only after its control semantics are clear and safe.
- Present its current state and a familiar toggle affordance in the segment itself. The visual state must update promptly, recover gracefully if a service call fails, and remain truthful for unavailable entities.
- Preserve existing tap, hold, and double-tap actions for ordinary insights. An Action insight owns its primary tap for the state change; any secondary action needs an explicit, discoverable treatment rather than an invisible gesture conflict.
- Make controls opt-in in the editor. Automatic area presets should remain informational unless a future preset can make the benefit and consequences of direct control unmistakable.
- Reuse Home Assistant's standard action/service patterns, confirmations where appropriate, contributor membership, and detail sheets. Never infer a safe aggregate control for a mixed group of entities.

**Done when:** a user can add one explicitly chosen toggleable entity, understand its present state at a glance, and change it confidently without compromising the behaviour of existing insights.

### Compact Pixel Cat visual profile (exploration)

**Goal:** Explore a small, expressive Pixel Cat-inspired presentation as a named visual profile, while keeping the standard Area Glance card calm and broadly useful.

- Review the existing Pixel Cat card/project before designing this mode; reuse only the visual ideas that fit Area Glance's compact, accessible, Home Assistant-native interaction model.
- Treat it as a bounded named styleâ€”icon treatment, type scale/weight, spacing, dividers, and state emphasisâ€”not a second card implementation or a collection of arbitrary CSS controls.
- Preserve explicit colours, threshold rules, accessibility contrast, and all existing layout behaviours. A user must be able to switch the style off without changing their entities or data model.
- Prototype it in Card Lab beside the default and Precision directions at narrow and standard dashboard widths before exposing it in the editor.

**Done when:** it feels like a coherent optional visual personality, not a novelty skin, and every existing card configuration renders and behaves identically apart from its intended presentation.

### Adaptive showcase stack

**Status:** Portable numeric area slots and the first maintained showcase YAML are implemented in the current development build. The showcase should grow with released features.

**Goal:** Maintain one dashboard-ready vertical-stack YAML example that demonstrates the real breadth of Area Glance while adapting safely to a user's own areas.

- Maintain `examples/showcase.yaml` covering the principal layouts, profiles, appearance choices, aggregate/detail behaviour, direct-entity examples, charts, and future Action insights where they are safe to demonstrate.
- Home Assistant area IDs are already unique. The portable example therefore uses numeric `area: 1`, `area: 2`, and so on as explicit showcase slots, resolving them from the current instance's stable sorted area IDs without inventing or persisting fake room IDs.
- Keep that resolution deterministic and visible: the same installation should resolve the same showcase slot consistently, a missing slot must produce a clear empty state rather than silently substituting an unrelated room, and real `area:` IDs must continue to work unchanged.
- The editor shows the resolved real area while preserving an unchanged numeric slot in YAML. Selecting a different area deliberately converts that configuration to the ordinary real area ID.
- Define eligibility conservatively: prefer areas with recognised, available entities so the showcase is useful, but retain their stable source ordering. Never select system-wide Energy, Security, Cameras, or Chart sources as if they were room areas.
- Make the showcase a living compatibility fixture in Card Lab. Each new top-level profile, layout, or appearance mode must either gain a showcase card or be explicitly recorded as intentionally omitted; run the stack against rich, sparse, and fewer-than-requested-area mock homes.

**Done when:** a user can paste one supported vertical stack into a dashboard, immediately see a representative set of cards based on their own installation, and maintainers have a clear test/checklist whenever the feature set grows.

### 1. Insight arranging workflow

**Status:** Implemented in the current development build.

**Goal:** Make it quick to tailor a suggested card without recreating its contents.

- Add drag-and-drop ordering in the visual editor, with accessible move-up/move-down controls as a fallback.
- Add **Duplicate insight** beside Remove.
- Preserve all existing metric configuration, actions, and advanced options when duplicating or moving.
- Keep the five-insight limit and show the resulting order in the live preview immediately.

**Done when:** a user can turn a suggested room card into their preferred order in a few deliberate interactions, without opening YAML.

### 2. Per-insight actions

**Status:** Implemented in the current development build.

**Goal:** Give each segment a predictable destination or behaviour.

- Surface tap, hold, and double-tap actions in each insight’s Advanced section.
- Support the familiar Home Assistant actions: show details, show aggregate contributors, navigate, toggle where applicable, call a service, and do nothing.
- Choose safe defaults: aggregate insights open their contributor sheet; explicit entities open more-info; actionless metrics remain informational.
- Offer a confirmation option for service actions that could have a meaningful real-world effect.

**Done when:** an insight’s visible content, configured action, and fallback behaviour are all clear in the editor and work consistently in Home Assistant.

### 3. Threshold colours for standard insights

**Status:** Implemented in the current development build.

**Goal:** Let ordinary slots communicate when a value needs attention without requiring Custom combination.

- Add optional value bands to suitable standard metrics: temperature, humidity, power, battery, CO₂, PM2.5, VOC, and AQI.
- Provide sensible editable starting bands where a broadly accepted interpretation exists; otherwise start empty rather than implying a universal health threshold.
- Let bands alter the icon colour first. Keep full-card alert styling restrained and optional.
- Apply thresholds only after units have been normalised or explicitly chosen.

**Done when:** a user can configure a useful green/amber/red signal from the visual editor, and the card never silently evaluates an incompatible unit.

### 4. Advanced aggregation and contributor transparency

**Status:** Implemented in the current development build.

**Goal:** Keep smart aggregation as the default while letting advanced users make it explicit.

- For compatible area measurements, offer Advanced aggregation choices: median, highest, lowest, sum, or one specific entity where meaningful.
- Show a concise editor summary such as “Using 2 compatible temperature sensors”.
- Make the contributor detail sheet identify every included entity and its current value.
- Never combine incompatible device classes or units; for example, VOC mass concentration and VOC parts remain separate.

**Done when:** automatic results are easy to trust, and a user can diagnose an unexpected value without leaving the card.

### 5. Entity-driven labels and display controls

**Status:** Implemented in the current development build.

**Goal:** Make an explicit entity slot feel polished without expanding the default editor flow.

- Let an insight use the selected entity’s friendly name as its label, with a manual override.
- Add concise display controls where they are useful: decimal precision, unit visibility/override, label visibility, and icon visibility.
- Keep these controls in Advanced options and retain the current preset defaults.
- Ensure labels truncate gracefully and do not cause stacked bands to lose alignment.

**Done when:** a user can make a chosen device or sensor read naturally in a segment without YAML or unnecessary layout tuning.

### 6. Whole-home Security profile

**Status:** Implemented in the current development build.

**Goal:** Add a compact, dependable security overview alongside Whole home, Energy, and Home battery without turning Area Glance into a security dashboard.

- Add **Security** as a first-choice profile. It is whole-home by default; an area remains optional for a focused entry-point view.
- Suggest only broadly reliable defaults: alarm state, monitored doors, monitored windows, and locks. Use Home Assistant domains and device classes rather than names.
- Prioritise attention in the header: an alarm trigger first, then open doors/windows or unlocked locks. With no active issue, say **All monitored openings closed** rather than claiming the whole home is secure.
- Keep the default segments predictable: **Alarm**, **Doors**, **Windows**, and **Locks**. Smoke/CO, leaks, garage doors, motion, and a selected camera are optional swaps, not assumed coverage.
- Reuse contributor sheets for aggregate segments so tapping Doors or Windows shows precisely which monitored entities are included.
- Support camera navigation or a selected-camera state as an optional segment. Do not put a live camera feed in the compact default band.
- Consider a small static camera thumbnail only as a separately enabled, stacked-layout enhancement after the core profile is proven useful.

**Done when:** a user can choose Security and receive a truthful, useful whole-home summary without manually identifying every sensor; active conditions are obvious, and the card never overstates what it is monitoring.

### 7. Prescribed expanded layouts

**Status:** Insight tower implemented with the card's existing five-insight limit; grid remains awaiting a visual prototype.

**Goal:** Let Area Glance become a larger, still legible summary card without becoming a generic dashboard-layout system.

- Keep the existing compact band as the default and retain its five-insight limit.
- Add one opt-in **Insight grid** layout: a header above a responsive grid of equal-size insight tiles. It may support two to eight insights, with a small, deliberate column choice rather than per-tile placement.
- The opt-in **Insight tower** layout is designed for a single Home Assistant dashboard column: a header followed by vertically arranged, compact insight rows. It favours scanability over dense metric text and reuses the existing five-insight limit.
- Both variants should reuse the existing presets, aggregate membership, contributor sheets, actions, appearance settings, and header alignment. No separate metric model or templating language is needed.
- Validate both layouts in Card Lab at a narrow phone width, one standard dashboard column, and a wide desktop span before exposing them in the editor.

**Done when:** a user can select one clearly named expanded layout and get a coherent card immediately, while the default editor and default band remain as simple as today.

## Documentation and release work

Refresh the README alongside the first release containing the roadmap work:

- Lead with the one-line core promise and the “choose an area” workflow.
- Keep installation and the visual-editor path short and current.
- Add one compact example each for an automatic area card, a specific-entity slot, and Custom combination.
- Document aggregate matching at a high level: Home Assistant metadata is preferred; contributors are inspectable.
- Update screenshots only when they reflect the released card exactly.
- Keep the README lean; detailed implementation history belongs in release notes, not the front page.

## Explicitly deferred

These are deliberately outside the current roadmap unless a clear area-summary use case emerges:

- General-purpose templates or JavaScript expressions in card configuration.
- Arbitrary custom CSS fields beyond supported theme variables and appearance options.
- Saved/shareable layout libraries, arbitrary grid placement, and broad dashboard templating.
- Rich media artwork, vacuum controls, or climate controls as default segment types.
- Always-on camera feeds or live video inside the compact band; cameras should initially open a dedicated view instead.
- Low-priority responsive hiding, special alert-card treatments, and arbitrary fallback messages.
- An exhaustive list of every Home Assistant sensor device class.

## Delivery discipline

Each roadmap item should include:

1. A card-lab scenario for the happy path and at least one misleading or unavailable-data case.
2. Type checking, production build, and visual review at desktop and narrow widths.
3. A Home Assistant smoke test before release.
4. A concise README/release-note update only after the implementation has landed.
