import type { ChartConfig, ChartType, EntityState, HassLike } from "./types";

export interface ChartPoint { time: number; value: number; }
export interface ChartHistory { points: ChartPoint[]; unit?: string; sourceEntity?: string; }

export const rangeMilliseconds = (range: ChartConfig["range"], type: ChartType): number => {
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

const statisticsHistory = async (hass: HassLike, entityId: string, start: Date, end: Date, period: "hour" | "day", cumulative = false): Promise<ChartPoint[]> => {
  if (!hass.callWS) return [];
  const response = await hass.callWS<unknown>({
    type: "recorder/statistics_during_period",
    start_time: start.toISOString(), end_time: end.toISOString(), statistic_ids: [entityId], period,
  });
  // The statistics payload is intentionally handled defensively: Home Assistant
  // documents that its shape can evolve, so this adapter only reads stable-ish
  // time/value aliases and lets the caller show the calm fallback otherwise.
  const rows = Array.isArray(response) ? response : (response as any)?.[entityId] ?? (response as any)?.statistics?.[entityId] ?? [];
  return normalisePoints((Array.isArray(rows) ? rows : []).map((row: any) => {
    // Daily totals need the recorder's cumulative `sum`, not a daily mean.
    // Measurements remain mean-first so environmental charts preserve shape.
    const value = numeric(cumulative ? row?.sum ?? row?.state ?? row?.last ?? row?.mean ?? row?.max ?? row?.min : row?.mean ?? row?.state ?? row?.sum ?? row?.last ?? row?.max ?? row?.min);
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

export const fetchChartHistory = async (hass: HassLike, chart: ChartConfig, source: { entity?: string; importEntity?: string; exportEntity?: string }, now = Date.now()): Promise<ChartHistory> => {
  const type = chart.type ?? "line";
  const end = new Date(now);
  const start = new Date(now - rangeMilliseconds(chart.range, type));
  const primary = source.entity ?? source.importEntity;
  if (!primary) return { points: [] };
  const unit = source.entity ? String(hass.states[source.entity]?.attributes.unit_of_measurement ?? "") : String(hass.states[source.importEntity!]?.attributes.unit_of_measurement ?? "");
  const preferStatistics = chart.history_source === "statistics" || (chart.history_source !== "raw" && type === "daily_totals");
  const load = async (entity: string, period: "hour" | "day" = "hour") => {
    if (!preferStatistics) return rawHistory(hass, entity, start, end);
    const statistics = await statisticsHistory(hass, entity, start, end, period, type === "daily_totals");
    // Automatic mode can still be useful for sensors whose recorder has not
    // generated long-term statistics yet. Do not make that a dead-end.
    if (statistics.length || chart.history_source === "statistics") return statistics;
    return rawHistory(hass, entity, start, end);
  };
  try {
    let points: ChartPoint[];
    if (source.importEntity && source.exportEntity) {
      const [imports, exports] = await Promise.all([load(source.importEntity), load(source.exportEntity)]);
      points = signedGrid(imports, exports, start.getTime(), end.getTime());
    } else {
      points = await load(primary, type === "daily_totals" ? "day" : "hour");
    }
    if (type === "daily_totals") points = dailyDeltas(points);
    return { points: normalisePoints(points), unit, sourceEntity: primary };
  } catch {
    return { points: [], unit, sourceEntity: primary };
  }
};

export const liveNumericState = (state?: EntityState): number | undefined => numeric(state?.state);
