import type { ChartType } from "./types";
import type { ChartPoint } from "./chart-data";

export interface ChartGeometry {
  min: number; max: number; baseline: number; points: { x: number; y: number; value: number; time: number }[];
  path: string; areaPath: string; bars: { x: number; y: number; width: number; height: number; negative: boolean }[];
}

/** A three-stop axis should read like an instrument scale, not raw recorder noise. */
const niceStep = (value: number): number => {
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(Math.abs(value), Number.EPSILON)));
  const fraction = Math.abs(value) / magnitude;
  const rounded = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return rounded * magnitude;
};

/** Pure SVG geometry. It never changes the source values or their order. */
export const chartGeometry = (source: ChartPoint[], type: ChartType, width: number, height: number, timeRange?: { start: number; end: number }): ChartGeometry | undefined => {
  if (!source.length || width <= 0 || height <= 0) return undefined;
  const values = source.map((point) => point.value);
  const hasNegative = values.some((value) => value < 0);
  const zeroBased = type === "area" || type === "columns" || type === "daily_totals";
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
