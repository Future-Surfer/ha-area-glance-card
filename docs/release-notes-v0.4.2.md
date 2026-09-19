# Area Glance Card v0.4.2 — release notes

## Highlights

- **Simpler action-led toggles.** Pick **Toggle this entity** in an insight's tap or hold action, then optionally choose **Display as toggle**. The switch is a presentation of that existing action, so the same option works wherever a direct entity can use a Toggle action. Controls show a clear pending state while Home Assistant confirms a command. Set one shared toggle colour in Card appearance, or override it per insight. Existing `inline_control: toggle` configurations remain supported; the retired automatic cover/lock button variants fall back to ordinary insight display.
- **Stepped continuous charts.** Single-line, multi-line overlap, period-comparison, and period-overlay charts can hold each reading until its next recorded change—useful for targets, tariffs, occupancy, and other discrete values.
- **More capable chart summaries.** Charts can surface the current reading automatically, or show the first, last, minimum, maximum, or average plotted value in their header or legend.
- **More trustworthy accumulating-source charts.** Period comparisons and overlays use Home Assistant Recorder's adjusted total statistic for energy, water, gas, and cost sources. This prevents a resettable source reading `0` from collapsing an in-progress month to a zero-value trace.

## Reliability

- Fixed a touch-gesture race where a standard insight's browser compatibility click could escape the card's tap recogniser and issue a second **toggle** action. A normal tap now emits one action; hold and double-tap behaviour remain unchanged. Thanks to @hunstad for reporting this in #2.
- Fixed an editor refresh issue where an insight's **What should this show?** selector could retain a previous insight type after the surrounding insight had changed or been reordered.
- Fixed aggregate detail sheets with long contributor lists shrinking the **Total / Average / Peak** strip until its calculated values were clipped.
- Cumulative overlay histories keep Recorder statistics separate from raw live states, avoiding incorrect endpoint values while an accumulating source is between resets.
- Cumulative charts fail calmly when Recorder does not provide the adjusted statistic requested, rather than falling back to a potentially resettable raw state.
- Card Lab coverage now includes deterministic chart failures/delays, Recorder-compatible statistic fixtures, and dense mixed-unit aggregate-statistic sheets.

## Compatibility

- No YAML migration is required.
- Existing charts retain their straight-line rendering. Set `chart.line_style: stepped` when a held-value trace is more truthful.
- The optional `chart.summary_statistic` setting defaults to the existing automatic current-reading behaviour.
- Existing `confirmation` YAML is harmlessly ignored; the optional confirmation prompt has been removed.
