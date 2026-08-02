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

- Area-led suggestions for room, media, energy, battery, and whole-home cards.
- Compact, stacked, and metrics-only layouts with theme-aware appearance controls.
- Automatic temperature, humidity, lights, live power, CO₂, PM2.5, VOC, AQI, motion, presence, doors, windows, and leak summaries.
- Strict measurement matching for automatic numeric area insights, with a narrow legacy fallback for classless CO₂ sensors.
- Header and status actions, plus contributor detail sheets for aggregates.
- Automatic blind summaries use Home Assistant cover device classes; blinds, shades, shutters, and curtains are included while garage and door covers remain separate.
- Aggregate insights and area-based header statuses support automatic exclusions, while keeping compatibility checks and contributor sheets truthful.
- An optional Attention insight reports unavailable entities and available updates for an area or the whole home.
- A Custom combination insight for power users who need separate main and supporting entities, an icon source, and state-to-colour rules.
- A whole-home Security profile with conservative alarm, door, window, and lock summaries; it prioritises active issues and never claims unverified coverage.

### Coverage audit

Automatic matching now covers the common area-summary signals with Home Assistant metadata rather than entity-name searches: temperature, humidity, power, COâ‚‚, particulate matter, VOC, AQI, lights, motion/presence, openings, leaks, recognised blind covers, locks, alarms, and update availability. Power accepts the official `power` device class and standard power units, retaining a narrow classless fallback for older integrations. Locks and update availability also accept their legacy binary-sensor device classes.

Broader domains such as climate and cameras remain intentionally available through **A specific entity** rather than as automatic aggregates. A dedicated, entity-led **Vacuum** insight shows robot-vacuum activity with a state-aware icon and colour, or its battery or fan speed; it is intentionally not guessed as an automatic room preset. A dedicated **Weather** insight is intentionally entity-led too: it provides a live condition icon plus selected current readings, but never guesses which weather provider a household prefers. Clock and Calendar date are self-contained utilities rather than area aggregates.

Known limits remain explicit: Attention counts affected **entities**, not deduplicated physical devices; and no automatic smoke, gas, CO, or generic-problem aggregate is suggested until its wording and coverage rules can be made as trustworthy as Security's existing signals.

## Roadmap

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
