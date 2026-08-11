import type { ChartType } from "./types";
import type { ChartPoint } from "./chart-data";

export interface ChartGeometry {
  min: number; max: number; baseline: number; points: { x: number; y: number; value: number; time: number }[];
  path: string; areaPath: string; bars: { x: number; y: number; width: number; height: number; negative: boolean }[];
}

export interface MultiChartGeometry {
  min: number;
  max: number;
  baseline: number;
  series: { path: string; areaPath?: string }[];
}

/** A three-stop axis should read like an instrument scale, not raw recorder noise. */
const niceStep = (value: number): number => {
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(Math.abs(value), Number.EPSILON)));
  const fraction = Math.abs(value) / magnitude;
  const rounded = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return rounded * magnitude;
};

/** Pure SVG geometry. It never changes the source values or their order. */
export const chartGeometry = (source: ChartPoint[], type: ChartType, width: number, height: number, timeRange?: { start: number; end: number }, fillArea = false, axis?: { min?: number; max?: number }): ChartGeometry | undefined => {
  if (!source.length || width <= 0 || height <= 0) return undefined;
  const values = source.map((point) => point.value);
  const hasNegative = values.some((value) => value < 0);
  const zeroBased = fillArea || type === "area" || type === "columns" || type === "daily_totals";
  let rawMin = Math.min(...values), rawMax = Math.max(...values);
  if (zeroBased) rawMin = Math.min(0, rawMin);
  if (rawMin === rawMax) {
    const padding = Math.abs(rawMin || 1) * .12;
    rawMin -= zeroBased && rawMin >= 0 ? 0 : padding;
    rawMax += padding;
  }
  const axisStep = niceStep((rawMax - rawMin) / 2);
  let min = zeroBased && rawMin >= 0 ? 0 : Math.floor(rawMin / axisStep) * axisStep;
  let max = zeroBased && rawMax <= 0 ? 0 : Math.ceil(rawMax / axisStep) * axisStep;
  const configuredMin = Number.isFinite(axis?.min) ? axis!.min : undefined;
  const configuredMax = Number.isFinite(axis?.max) ? axis!.max : undefined;
  if (configuredMin !== undefined) min = configuredMin;
  if (configuredMax !== undefined) max = configuredMax;
  // An incomplete override still preserves a usable scale. Invalid complete
  // overrides fall back to the automatic end rather than inverting the plot.
  if (min >= max) {
    if (configuredMin !== undefined && configuredMax === undefined) max = min + axisStep;
    else if (configuredMax !== undefined && configuredMin === undefined) min = max - axisStep;
    else {
      min = zeroBased && rawMin >= 0 ? 0 : Math.floor(rawMin / axisStep) * axisStep;
      max = zeroBased && rawMax <= 0 ? 0 : Math.ceil(rawMax / axisStep) * axisStep;
    }
  }
  if (min === max) max = min + axisStep;
  const first = timeRange?.start ?? source[0].time, last = timeRange?.end ?? source.at(-1)!.time;
  const scaleX = (time: number) => last === first ? width / 2 : ((time - first) / (last - first)) * width;
  const scaleY = (value: number) => height - ((value - min) / (max - min)) * height;
  const points = source.map((point) => ({ x: scaleX(point.time), y: scaleY(point.value), value: point.value, time: point.time }));
  const baseline = scaleY(0);
  const path = points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
  const areaPath = `${path} L${points.at(-1)!.x.toFixed(2)},${baseline.toFixed(2)} L${points[0].x.toFixed(2)},${baseline.toFixed(2)} Z`;
  const step = width / Math.max(points.length, 1);
  const bars = points.map((point) => {
    const y = Math.min(point.y, baseline);
    return { x: Math.max(0, point.x - step * .32), y, width: Math.max(1, step * .64), height: Math.max(1, Math.abs(point.y - baseline)), negative: point.value < 0 && hasNegative };
  });
  return { min, max, baseline, points, path, areaPath, bars };
};

const boundedSeries = (points: ChartPoint[], start: number, end: number): ChartPoint[] => {
  const bounded = points.filter((point) => point.time >= start && point.time <= end).sort((left, right) => left.time - right.time);
  if (!bounded.length) return [];
  if (bounded[0].time > start) bounded.unshift({ time: start, value: bounded[0].value });
  if (bounded.at(-1)!.time < end) bounded.push({ time: end, value: bounded.at(-1)!.value });
  return bounded;
};

const heldValue = (points: ChartPoint[], time: number): number => {
  let value = points[0]?.value ?? 0;
  for (const point of points) { if (point.time > time) break; value = point.value; }
  return value;
};

/** Shared-scale geometry for a small, compatible set of continuous series. */
export const multiChartGeometry = (
  input: ChartPoint[][],
  width: number,
  height: number,
  timeRange: { start: number; end: number },
  display: "overlap" | "stacked" = "overlap",
  axis?: { min?: number; max?: number },
): MultiChartGeometry | undefined => {
  if (!input.length || width <= 0 || height <= 0) return undefined;
  const series = input.map((points) => boundedSeries(points, timeRange.start, timeRange.end));
  if (!series.some((points) => points.length)) return undefined;
  const timestamps = [...new Set([timeRange.start, timeRange.end, ...series.flatMap((points) => points.map((point) => point.time))])].sort((left, right) => left - right);
  const values = display === "stacked"
    ? series.map((points, seriesIndex) => timestamps.map((time) => series.slice(0, seriesIndex + 1).reduce((sum, other) => sum + heldValue(other, time), 0)))
    : series.map((points) => points.map((point) => point.value));
  const rawValues = values.flat();
  // Overlay lines use the honest combined measurement range. Cumulative
  // stacked areas are the only multi-series presentation that needs a zero
  // baseline by definition.
  let rawMin = display === "stacked" ? Math.min(0, ...rawValues) : Math.min(...rawValues);
  let rawMax = Math.max(...rawValues);
  if (rawMin === rawMax) rawMax = rawMin + Math.max(Math.abs(rawMin || 1) * .12, 1);
  const step = niceStep((rawMax - rawMin) / 2);
  let min = Math.floor(rawMin / step) * step;
  let max = Math.ceil(rawMax / step) * step;
  if (Number.isFinite(axis?.min)) min = axis!.min!;
  if (Number.isFinite(axis?.max)) max = axis!.max!;
  if (min >= max) {
    min = Math.floor(rawMin / step) * step;
    max = Math.ceil(rawMax / step) * step;
  }
  const scaleX = (time: number) => ((time - timeRange.start) / (timeRange.end - timeRange.start)) * width;
  const scaleY = (value: number) => height - ((value - min) / (max - min)) * height;
  const buildPath = (points: ChartPoint[]) => points.map((point, index) => `${index ? "L" : "M"}${scaleX(point.time).toFixed(2)},${scaleY(point.value).toFixed(2)}`).join(" ");
  const result = series.map((points, index) => {
    if (display !== "stacked") return { path: buildPath(points) };
    const upper = timestamps.map((time) => ({ time, value: values[index][timestamps.indexOf(time)] }));
    const lower = timestamps.map((time) => ({ time, value: index ? values[index - 1][timestamps.indexOf(time)] : 0 }));
    const path = buildPath(upper);
    const lowerPath = [...lower].reverse().map((point) => `L${scaleX(point.time).toFixed(2)},${scaleY(point.value).toFixed(2)}`).join(" ");
    return { path, areaPath: `${path} ${lowerPath} Z` };
  });
  return { min, max, baseline: scaleY(0), series: result };
};
