# Area Glance Card — next release notes (draft)

> Working draft for the release after v0.4.1. Keep this concise; move only tested, user-visible changes into the final GitHub release.

## Highlights

- **Stepped continuous charts.** Single-line, multi-line overlap, period-comparison, and period-overlay charts can now hold each reading until its next recorded change—useful for targets, tariffs, occupancy, and other discrete values.
- **More capable chart summaries.** Charts can surface the current reading automatically, or show the first, last, minimum, maximum, or average plotted value in their header or legend.
- **More trustworthy accumulating-source charts.** Period comparisons and overlays now use Home Assistant Recorder's adjusted total statistic for energy, water, gas, and cost sources. This prevents a resettable source reading `0` from collapsing an in-progress month to a zero-value trace.

## Reliability

- Cumulative overlay histories keep Recorder statistics separate from raw live states, avoiding incorrect endpoint values while an accumulating source is between resets.
- Cumulative charts now fail calmly when Recorder does not provide the adjusted statistic requested, rather than falling back to a potentially resettable raw state.
- Chart history is now exercised in Card Lab with deterministic delayed, unavailable, failed, and malformed-Recorder responses, alongside the normal chart matrix.

## Compatibility

- No YAML migration is required.
- Existing charts retain their straight-line rendering. Set `chart.line_style: stepped` when a held-value trace is more truthful.
- The optional `chart.summary_statistic` setting defaults to the existing automatic current-reading behaviour.

## Still to add before release

- [ ] Add only completed, tested features from the next development phase.
- [ ] Confirm whether this becomes a patch or minor release once that scope is known.
- [ ] Refresh screenshots and run the final Card Lab / Home Assistant smoke test.
