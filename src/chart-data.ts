import type { ChartConfig, ChartType, EntityState, HassLike } from "./types";

export interface ChartPoint { time: number; value: number; }
export interface ChartHistory { points: ChartPoint[]; unit?: string; sourceEntity?: string; }
export interface MultiChartHistory { entity: string; points: ChartPoint[]; unit?: string; }
export interface ComparisonChartHistory {
  current: ChartHistory;
  previous: ChartHistory;
  currentStart: number;
  currentEnd: number;
  previousStart: number;
  previousEnd: number;
  mode: "live" | "cumulative";
}

/** Equivalent calendar periods, oldest first, each mapped later onto one axis. */
export interface OverlayChartHistory {
  series: { points: ChartPoint[]; start: number; end: number; index: number }[];
  unit?: string;
  sourceEntity?: string;
  currentStart: number;
  currentEnd: number;
  mode: "live" | "cumulative";
}

type ChartDataStrategy = "raw" | "statistics";
type StatisticType = "mean" | "min" | "max" | "state" | "sum";

/**
 * A dashboard commonly mounts several chart cards together. Keep both settled
 * results and in-flight requests briefly shared, rather than making Recorder
 * serve the same history window once per card.
 */
const HISTORY_CACHE_TTL = 60_000;
const historyCache = new Map<string, { expiresAt: number; value?: ChartHistory; pending?: Promise<ChartHistory> }>();
const comparisonHistoryCache = new Map<string, { expiresAt: number; value?: ComparisonChartHistory; pending?: Promise<ComparisonChartHistory> }>();
const overlayHistoryCache = new Map<string, { expiresAt: number; value?: OverlayChartHistory; pending?: Promise<OverlayChartHistory> }>();
const hassInstanceIds = new WeakMap<object, number>();
let nextHassInstanceId = 1;

const hassInstanceKey = (hass: HassLike): number => {
  // HA replaces the `hass` wrapper on state updates, but its API functions are
  // stable for the frontend session and make a useful instance identity.
  const identity = (hass.callApi ?? hass.callWS ?? hass) as object;
  let id = hassInstanceIds.get(identity);
  if (!id) { id = nextHassInstanceId++; hassInstanceIds.set(identity, id); }
  return id;
};

export const rangeMilliseconds = (range: ChartConfig["range"], type: ChartType, hoursToShow?: number): number => {
  const configuredHours = Number(hoursToShow);
  if (Number.isFinite(configuredHours) && configuredHours > 0) return configuredHours * 3_600_000;
  const value = range ?? (type === "daily_totals" ? "7d" : "24h");
  return ({ "6h": 6, "24h": 24, "48h": 48, "7d": 168, "14d": 336, "30d": 720 }[value] ?? 24) * 3_600_000;
};

const numeric = (value: unknown): number | undefined => {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
};

const timestamp = (value: unknown): number | undefined => {
  const parsed = typeof value === "number" ? value : Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : undefined;
};

const normalisePoints = (points: ChartPoint[]): ChartPoint[] => points
  .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value))
  .sort((left, right) => left.time - right.time)
  .filter((point, index, values) => !index || point.time !== values[index - 1].time || point.value !== values[index - 1].value);

const historyPath = (start: Date, end: Date, entities: string[]) =>
  `history/period/${start.toISOString()}?filter_entity_id=${encodeURIComponent(entities.join(","))}&end_time=${encodeURIComponent(end.toISOString())}&minimal_response=true&no_attributes=true`;

const rawHistory = async (hass: HassLike, entityId: string, start: Date, end: Date): Promise<ChartPoint[]> => {
  if (!hass.callApi) return [];
  const result = await hass.callApi<unknown>("GET", historyPath(start, end, [entityId]));
  const rows = Array.isArray(result) ? (Array.isArray(result[0]) ? result[0] : result) : [];
  return normalisePoints(rows.map((row: any) => {
    const value = numeric(row?.state);
    const time = timestamp(row?.last_changed ?? row?.last_updated);
    return value === undefined || time === undefined ? undefined : { time, value };
  }).filter((point): point is ChartPoint => Boolean(point)).filter((point) => point.time >= start.getTime() && point.time <= end.getTime()));
};

const statisticsHistory = async (hass: HassLike, entityId: string, start: Date, end: Date, period: "hour" | "day", statistic: StatisticType): Promise<ChartPoint[]> => {
  if (!hass.callWS) return [];
  const response = await hass.callWS<unknown>({
    type: "recorder/statistics_during_period",
    start_time: start.toISOString(), end_time: end.toISOString(), statistic_ids: [entityId], period, types: [statistic],
  });
  // The statistics payload is intentionally handled defensively: Home Assistant
  // documents that its shape can evolve, so this adapter only reads stable-ish
  // time/value aliases and lets the caller show the calm fallback otherwise.
  const rows = Array.isArray(response) ? response : (response as any)?.[entityId] ?? (response as any)?.statistics?.[entityId] ?? [];
  return normalisePoints((Array.isArray(rows) ? rows : []).map((row: any) => {
    // We asked Recorder for one statistic, so accept exactly that value. In
    // particular, a cumulative chart must never silently fall back from the
    // adjusted `sum` to `state`: some utility sources legitimately reset
    // their raw state while Recorder's sum remains the truthful total.
    // Missing requested data is therefore an honest unavailable history, not
    // a plausible-looking but incorrect trace.
    const value = numeric(row?.[statistic]);
    const time = timestamp(row?.start ?? row?.start_time ?? row?.end ?? row?.end_time);
    return value === undefined || time === undefined ? undefined : { time, value };
  }).filter((point): point is ChartPoint => Boolean(point)));
};

const interpolateAt = (points: ChartPoint[], time: number): number => {
  let value = 0;
  for (const point of points) { if (point.time > time) break; value = point.value; }
  return value;
};

/** Combine Energy Dashboard grid import/export into one signed series. */
export const signedGrid = (importPoints: ChartPoint[], exportPoints: ChartPoint[], start: number, end: number): ChartPoint[] => {
  const timestamps = [...new Set([start, end, ...importPoints.map((point) => point.time), ...exportPoints.map((point) => point.time)])].sort((a, b) => a - b);
  return timestamps.map((time) => ({ time, value: interpolateAt(importPoints, time) - interpolateAt(exportPoints, time) }));
};

export const bucketPoints = (points: ChartPoint[], start: number, end: number, bucketMs: number, statistic: NonNullable<ChartConfig["bucket_statistic"]> = "mean"): ChartPoint[] => {
  const output: ChartPoint[] = [];
  for (let bucketStart = start; bucketStart < end; bucketStart += bucketMs) {
    const bucketEnd = Math.min(end, bucketStart + bucketMs);
    const bucket = points.filter((point) => point.time >= bucketStart && point.time < bucketEnd);
    if (!bucket.length) continue;
    const values = bucket.map((point) => point.value);
    const value = statistic === "last" ? values.at(-1)! : statistic === "max" ? Math.max(...values) : statistic === "min" ? Math.min(...values) : values.reduce((sum, item) => sum + item, 0) / values.length;
    output.push({ time: bucketStart + (bucketEnd - bucketStart) / 2, value });
  }
  return output;
};

const dailyDeltas = (points: ChartPoint[]): ChartPoint[] => points.slice(1).map((point, index) => ({ time: point.time, value: Math.max(0, point.value - points[index].value) }));

const requestedStatistic = (chart: ChartConfig): StatisticType => {
  if (chart.type === "daily_totals") return "sum";
  if (chart.type === "columns") return ({ mean: "mean", last: "state", max: "max", min: "min" } as const)[chart.bucket_statistic ?? "mean"];
  return "mean";
};

const resolveStrategy = (chart: ChartConfig, source: { entity?: string; importEntity?: string; exportEntity?: string }): ChartDataStrategy => {
  if (chart.history_source === "raw") return "raw";
  if (chart.history_source === "statistics") return "statistics";
  const hours = rangeMilliseconds(chart.range, chart.type ?? "line", chart.hours_to_show) / 3_600_000;
  // Columns and daily totals are intentionally interval views. A continuous
  // Grid chart is not: it should retain recorder detail just like a direct
  // power sensor, otherwise a 24-hour line becomes a misleading 24-point plot.
  if (chart.type === "daily_totals" || chart.type === "columns") return "statistics";
  // A detailed Recorder trace is valuable for today and yesterday. Beyond
  // that, statistics keeps requests bounded and prevents a dashboard full of
  // charts from issuing expensive, multi-day history queries at once.
  return hours > 48 ? "statistics" : "raw";
};

const loadEntityHistory = async (hass: HassLike, entity: string, start: Date, end: Date, chart: ChartConfig, strategy: ChartDataStrategy): Promise<ChartPoint[]> => {
  const statistic = requestedStatistic(chart);
  const rangeHours = Math.max(1, (end.getTime() - start.getTime()) / 3_600_000);
  // A daily grain is both clearer and dramatically lighter for fortnight-plus
  // views. Shorter statistics views retain an hourly shape.
  const period = chart.type === "daily_totals" || rangeHours > 7 * 24 ? "day" : "hour";
  if (strategy === "raw") return rawHistory(hass, entity, start, end);
  if (strategy === "statistics") {
    let statistics: ChartPoint[] = [];
    try { statistics = await statisticsHistory(hass, entity, start, end, period, statistic); } catch { return []; }
    // Do not silently turn a long automatic request into a full raw-history
    // download. If statistics are unavailable, preserve the selected entity
    // and let the card show its calm fallback; users can explicitly opt into
    // Recorder history in Fine tuning when that trade-off is worthwhile.
    return statistics;
  }
  return [];
};

const fetchUncachedChartHistory = async (hass: HassLike, chart: ChartConfig, source: { entity?: string; importEntity?: string; exportEntity?: string }, now: number): Promise<ChartHistory> => {
  const type = chart.type ?? "line";
  const end = new Date(now);
  const start = new Date(now - rangeMilliseconds(chart.range, type, chart.hours_to_show));
  const primary = source.entity ?? source.importEntity;
  if (!primary) return { points: [] };
  const unit = source.entity ? String(hass.states[source.entity]?.attributes.unit_of_measurement ?? "") : String(hass.states[source.importEntity!]?.attributes.unit_of_measurement ?? "");
  const strategy = resolveStrategy(chart, source);
  try {
    let points: ChartPoint[];
    if (source.importEntity && source.exportEntity) {
      const [imports, exportPoints] = await Promise.all([loadEntityHistory(hass, source.importEntity, start, end, chart, strategy), loadEntityHistory(hass, source.exportEntity, start, end, chart, strategy)]);
      points = signedGrid(imports, exportPoints, start.getTime(), end.getTime());
    } else {
      points = await loadEntityHistory(hass, primary, start, end, chart, strategy);
    }
    if (type === "daily_totals") points = dailyDeltas(points);
    return { points: normalisePoints(points), unit, sourceEntity: primary };
  } catch {
    return { points: [], unit, sourceEntity: primary };
  }
};

export const fetchChartHistory = (hass: HassLike, chart: ChartConfig, source: { entity?: string; importEntity?: string; exportEntity?: string }, now = Date.now()): Promise<ChartHistory> => {
  // Snap to the minute: mounted cards requesting the same visible window share
  // one request, while the live value itself continues updating independently.
  const requestTime = Math.floor(now / 60_000) * 60_000;
  const key = JSON.stringify({
    hass: hassInstanceKey(hass), source, requestTime,
    data: { type: chart.type ?? "line", range: chart.range, hours_to_show: chart.hours_to_show, history_source: chart.history_source ?? "auto", bucket_statistic: chart.bucket_statistic ?? "mean" },
  });
  const cached = historyCache.get(key);
  if (cached?.value && cached.expiresAt > now) return Promise.resolve(cached.value);
  if (cached?.pending) return cached.pending;
  const pending = fetchUncachedChartHistory(hass, chart, source, requestTime)
    .then((value) => {
      // Empty Recorder responses can be transient while Home Assistant starts.
      // Retrying should make a new request, not reuse an empty minute-long cache.
      historyCache.set(key, { value, expiresAt: Date.now() + (value.points.length ? HISTORY_CACHE_TTL : 1_000) });
      return value;
    })
    .catch(() => {
      historyCache.delete(key);
      return { points: [] };
    });
  historyCache.set(key, { expiresAt: now + HISTORY_CACHE_TTL, pending });
  return pending;
};

/**
 * Multi-line charts deliberately reuse the established per-entity cache and
 * Recorder/statistics selection. The series are loaded concurrently, while
 * rendering supplies their shared scale later.
 */
export const fetchMultiChartHistory = async (hass: HassLike, chart: ChartConfig, now = Date.now()): Promise<MultiChartHistory[]> => {
  const entities = (chart.entities ?? []).map((series) => series.entity).filter(Boolean).slice(0, 3);
  return Promise.all(entities.map(async (entity) => {
    const history = await fetchChartHistory(hass, { ...chart, entity, energy_source: undefined, type: "line" }, { entity }, now);
    return { entity, points: history.points, unit: history.unit };
  }));
};

const calendarPeriod = (now: Date, period: NonNullable<ChartConfig["comparison_period"]>) => {
  const end = new Date(now);
  const start = new Date(now);
  if (period === "day") start.setHours(0, 0, 0, 0);
  if (period === "week") { const day = (start.getDay() + 6) % 7; start.setDate(start.getDate() - day); start.setHours(0, 0, 0, 0); }
  if (period === "month") { start.setDate(1); start.setHours(0, 0, 0, 0); }
  if (period === "year") { start.setMonth(0, 1); start.setHours(0, 0, 0, 0); }
  const previousEnd = new Date(start);
  const previousStart = new Date(start);
  if (period === "day") previousStart.setDate(previousStart.getDate() - 1);
  if (period === "week") previousStart.setDate(previousStart.getDate() - 7);
  if (period === "month") previousStart.setMonth(previousStart.getMonth() - 1);
  if (period === "year") previousStart.setFullYear(previousStart.getFullYear() - 1);
  return { currentStart: start, currentEnd: end, previousStart, previousEnd };
};

const comparisonDeltas = (points: ChartPoint[]): ChartPoint[] => {
  if (!points.length) return [];
  const initial = points[0].value;
  return points.map((point) => ({ ...point, value: Math.max(0, point.value - initial) }));
};

const comparisonStrategy = (chart: ChartConfig, period: NonNullable<ChartConfig["comparison_period"]>): "raw" | "statistics" => {
  if (chart.history_source === "raw") return "raw";
  if (chart.history_source === "statistics") return "statistics";
  // A day-long trace benefits from Recorder detail. From a week onward the
  // compact chart cannot use every state change, while statistics avoids a
  // potentially expensive pair of long Recorder queries.
  return period === "day" ? "raw" : "statistics";
};

const comparisonPoints = async (hass: HassLike, entity: string, start: Date, end: Date, strategy: "raw" | "statistics", cumulative: boolean, period: NonNullable<ChartConfig["comparison_period"]>): Promise<ChartPoint[]> => {
  if (strategy === "raw") return rawHistory(hass, entity, start, end);
  // Weekly comparisons remain smooth at an hourly resolution; month/year
  // comparisons are deliberately daily so they stay light and readable.
  const resolution = period === "week" ? "hour" : "day";
  // `sum` is Recorder's adjusted monotonic total.  Unlike the raw `state`,
  // it remains meaningful for utility sensors that reset each day/month, so
  // period deltas do not collapse to zero after the latest reset.
  return statisticsHistory(hass, entity, start, end, resolution, cumulative ? "sum" : "mean");
};

/** Calendar-aligned, direct-entity history used by the dedicated comparison chart. */
export const fetchComparisonChartHistory = async (hass: HassLike, chart: ChartConfig, entity: string | undefined, now = Date.now()): Promise<ComparisonChartHistory> => {
  const period = chart.comparison_period ?? "day";
  const bounds = calendarPeriod(new Date(now), period);
  const state = entity ? hass.states[entity] : undefined;
  const stateClass = String(state?.attributes.state_class ?? "");
  const cumulative = chart.comparison_mode === "cumulative" || (chart.comparison_mode !== "live" && ["total", "total_increasing"].includes(stateClass));
  const source = entity ?? "";
  if (!source) return {
    current: { points: [] },
    previous: { points: [] },
    currentStart: bounds.currentStart.getTime(),
    currentEnd: bounds.currentEnd.getTime(),
    previousStart: bounds.previousStart.getTime(),
    previousEnd: bounds.previousEnd.getTime(),
    mode: cumulative ? "cumulative" : "live",
  };
  const unit = String(state?.attributes.unit_of_measurement ?? "");
  const strategy = comparisonStrategy(chart, period);
  const requestTime = Math.floor(now / 60_000) * 60_000;
  const key = JSON.stringify({ hass: hassInstanceKey(hass), source, period, cumulative, strategy, requestTime });
  const cached = comparisonHistoryCache.get(key);
  if (cached?.value && cached.expiresAt > now) return Promise.resolve(cached.value);
  if (cached?.pending) return cached.pending;
  const pending: Promise<ComparisonChartHistory> = Promise.all([
    comparisonPoints(hass, source, bounds.currentStart, bounds.currentEnd, strategy, cumulative, period).catch(() => []),
    comparisonPoints(hass, source, bounds.previousStart, bounds.previousEnd, strategy, cumulative, period).catch(() => []),
  ]).then(([currentPoints, previousPoints]) => ({
    current: { points: cumulative ? comparisonDeltas(currentPoints) : currentPoints, unit, sourceEntity: source },
    previous: { points: cumulative ? comparisonDeltas(previousPoints) : previousPoints, unit, sourceEntity: source },
    currentStart: bounds.currentStart.getTime(), currentEnd: bounds.currentEnd.getTime(),
    previousStart: bounds.previousStart.getTime(), previousEnd: bounds.previousEnd.getTime(),
    mode: (cumulative ? "cumulative" : "live") as ComparisonChartHistory["mode"],
  })).then((value) => {
    comparisonHistoryCache.set(key, { value, expiresAt: Date.now() + (value.current.points.length || value.previous.points.length ? HISTORY_CACHE_TTL : 1_000) });
    return value;
  }, (error) => { comparisonHistoryCache.delete(key); throw error; });
  comparisonHistoryCache.set(key, { expiresAt: now + HISTORY_CACHE_TTL, pending });
  return pending;
};

const earlierPeriodStart = (start: Date, period: NonNullable<ChartConfig["overlay_period"]>): Date => {
  const earlier = new Date(start);
  if (period === "day") earlier.setDate(earlier.getDate() - 1);
  if (period === "week") earlier.setDate(earlier.getDate() - 7);
  if (period === "month") earlier.setMonth(earlier.getMonth() - 1);
  if (period === "year") earlier.setFullYear(earlier.getFullYear() - 1);
  return earlier;
};

/**
 * Period overlays remain a compact chart rather than a separate ridgeline
 * visualisation. These limits keep the Recorder request bounded and the
 * individual traces legible. The planned landscape chart is intended for
 * denser 30–365 day distributions.
 */
export const overlayPeriodLimit = (period: NonNullable<ChartConfig["overlay_period"]>): number => ({
  // Beyond a calendar month of individual daily traces, the compact overlay
  // becomes a dense distribution rather than a readable comparison. The
  // planned landscape chart is the honest home for that 30–365 day view.
  day: 31,
  week: 12,
  month: 12,
  year: 5,
})[period];

export const overlayPeriodHours = (period: NonNullable<ChartConfig["overlay_period"]>, count: number): number => ({
  day: 24 * count,
  week: 7 * 24 * count,
  month: 31 * 24 * count,
  year: 366 * 24 * count,
})[period];

const overlayWindows = (now: Date, period: NonNullable<ChartConfig["overlay_period"]>, count: number) => {
  const current = calendarPeriod(now, period);
  const starts = [current.currentStart];
  while (starts.length < count) starts.unshift(earlierPeriodStart(starts[0], period));
  return starts.map((start, index) => ({
    start,
    end: index === starts.length - 1 ? current.currentEnd : starts[index + 1],
    index,
  }));
};

const overlayStrategy = (chart: ChartConfig, period: NonNullable<ChartConfig["overlay_period"]>, count: number): "raw" | "statistics" => {
  if (chart.history_source === "raw") return "raw";
  if (chart.history_source === "statistics") return "statistics";
  // One or two daily traces can retain their recorder detail. More traces—or
  // any longer calendar period—must stay bounded, even on a busy installation.
  return period === "day" && count <= 2 ? "raw" : "statistics";
};

/**
 * Fetch one bounded source range, then split it into equivalent local calendar
 * windows. This is deliberately not N Recorder requests for N overlay lines.
 */
export const fetchOverlayChartHistory = async (hass: HassLike, chart: ChartConfig, entity: string | undefined, now = Date.now()): Promise<OverlayChartHistory> => {
  const period = chart.overlay_period ?? "day";
  const count = Math.max(2, Math.min(overlayPeriodLimit(period), Math.round(chart.overlay_count ?? (period === "day" ? 4 : 3))));
  const windows = overlayWindows(new Date(now), period, count);
  const source = entity ?? "";
  const state = source ? hass.states[source] : undefined;
  const stateClass = String(state?.attributes.state_class ?? "");
  const cumulative = chart.overlay_mode === "cumulative" || (chart.overlay_mode !== "live" && ["total", "total_increasing"].includes(stateClass));
  const unit = String(state?.attributes.unit_of_measurement ?? "");
  const empty = (): OverlayChartHistory => ({ series: [], unit, sourceEntity: source, currentStart: windows.at(-1)?.start.getTime() ?? now, currentEnd: now, mode: cumulative ? "cumulative" : "live" });
  if (!source) return empty();
  const strategy = overlayStrategy(chart, period, count);
  const requestTime = Math.floor(now / 60_000) * 60_000;
  const key = JSON.stringify({ hass: hassInstanceKey(hass), source, period, count, cumulative, strategy, requestTime });
  const cached = overlayHistoryCache.get(key);
  if (cached?.value && cached.expiresAt > now) return Promise.resolve(cached.value);
  if (cached?.pending) return cached.pending;
  const oldest = windows[0];
  const resolution = period === "day" || period === "week" ? "hour" : "day";
  // Use Recorder's adjusted total for cumulative overlays.  The raw state of
  // a daily-reset energy sensor can legitimately be 0 at night; differencing
  // it across a monthly trace would otherwise falsely turn the current month
  // into a zero line.
  const statistic: StatisticType = cumulative ? "sum" : "mean";
  const pending: Promise<OverlayChartHistory> = (strategy === "raw"
    ? rawHistory(hass, source, oldest.start, windows.at(-1)!.end)
    : statisticsHistory(hass, source, oldest.start, windows.at(-1)!.end, resolution, statistic)
  ).catch(() => []).then((points) => {
    // Recorder statistics often stop at the last completed hour/day. Add the
    // live state for ordinary measurement traces, so today's active segment
    // reaches "now". Cumulative series deliberately remain Recorder-only:
    // their `sum` values are adjusted totals, whereas a direct live state may
    // have reset to zero and must not be mixed into that scale.
    const live = liveNumericState(state);
    const pointsWithCurrentLive = live === undefined || cumulative
      ? points
      : normalisePoints([...points.filter((point) => point.time !== now), { time: now, value: live }]);
    const series = windows.map((window) => {
      const within = pointsWithCurrentLive.filter((point) => point.time >= window.start.getTime() && point.time <= window.end.getTime());
      return { points: cumulative ? comparisonDeltas(within) : within, start: window.start.getTime(), end: window.end.getTime(), index: window.index };
    });
    const value: OverlayChartHistory = { series, unit, sourceEntity: source, currentStart: windows.at(-1)!.start.getTime(), currentEnd: windows.at(-1)!.end.getTime(), mode: cumulative ? "cumulative" : "live" };
    overlayHistoryCache.set(key, { value, expiresAt: Date.now() + (series.some((item) => item.points.length) ? HISTORY_CACHE_TTL : 1_000) });
    return value;
  }, (error) => { overlayHistoryCache.delete(key); throw error; });
  overlayHistoryCache.set(key, { expiresAt: now + HISTORY_CACHE_TTL, pending });
  return pending;
};

export const liveNumericState = (state?: EntityState): number | undefined => numeric(state?.state);
