import type { ChartConfig, ChartType, EntityState, HassLike } from "./types";

export interface ChartPoint { time: number; value: number; }
export interface ChartHistory { points: ChartPoint[]; unit?: string; sourceEntity?: string; }
export interface MultiChartHistory { entity: string; points: ChartPoint[]; unit?: string; }

type ChartDataStrategy = "raw" | "statistics" | "hybrid";
type StatisticType = "mean" | "min" | "max" | "state" | "sum";

/**
 * A dashboard commonly mounts several chart cards together. Keep both settled
 * results and in-flight requests briefly shared, rather than making Recorder
 * serve the same history window once per card.
 */
const HISTORY_CACHE_TTL = 60_000;
const historyCache = new Map<string, { expiresAt: number; value?: ChartHistory; pending?: Promise<ChartHistory> }>();
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
  }).filter((point): point is ChartPoint => Boolean(point)));
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
    // The requested statistic is both smaller to transport and semantically
    // explicit. Remaining aliases make this tolerant of HA recorder changes.
    const value = numeric(row?.[statistic] ?? row?.mean ?? row?.state ?? row?.sum ?? row?.last ?? row?.max ?? row?.min);
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
  // Longer continuous charts keep a small recent raw window for shape while
  // avoiding a full multi-day state-history query.
  return hours >= 48 ? "hybrid" : "raw";
};

const mergeHistory = (older: ChartPoint[], recent: ChartPoint[]): ChartPoint[] => normalisePoints([...older, ...recent]);

const loadEntityHistory = async (hass: HassLike, entity: string, start: Date, end: Date, chart: ChartConfig, strategy: ChartDataStrategy): Promise<ChartPoint[]> => {
  const statistic = requestedStatistic(chart);
  const period = chart.type === "daily_totals" ? "day" : "hour";
  if (strategy === "raw") return rawHistory(hass, entity, start, end);
  if (strategy === "statistics") {
    let statistics: ChartPoint[] = [];
    try { statistics = await statisticsHistory(hass, entity, start, end, period, statistic); } catch { return chart.history_source === "statistics" ? [] : rawHistory(hass, entity, start, end); }
    // Some otherwise valid entities have no generated statistics. Preserve the
    // selected source and transparently fall back to the bounded REST query.
    return statistics.length || chart.history_source === "statistics" ? statistics : rawHistory(hass, entity, start, end);
  }
  const recentStart = new Date(Math.max(start.getTime(), end.getTime() - 6 * 3_600_000));
  const [statistics, recent] = await Promise.all([
    statisticsHistory(hass, entity, start, recentStart, period, statistic).catch(() => []),
    rawHistory(hass, entity, recentStart, end),
  ]);
  if (statistics.length) return mergeHistory(statistics.filter((point) => point.time < recentStart.getTime()), recent);
  // No statistics: a complete raw fallback is more honest than silently
  // presenting a six-hour fragment of a longer chart.
  return rawHistory(hass, entity, start, end);
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

export const liveNumericState = (state?: EntityState): number | undefined => numeric(state?.state);
