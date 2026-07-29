import type { MetricConfig, MetricPreset } from "./types";

type Preset = Required<Pick<MetricConfig, "icon" | "label" | "format">> & { color: string };

export const PRESETS: Record<MetricPreset, Preset> = {
  temperature: { icon: "mdi:thermometer", label: "Temperature", format: "temperature", color: "var(--red-color, #f44336)" },
  humidity: { icon: "mdi:water-percent", label: "Humidity", format: "percent", color: "var(--blue-color, #2196f3)" },
  lights: { icon: "mdi:lightbulb-outline", label: "Lights", format: "auto", color: "var(--yellow-color, #fbc02d)" },
  power: { icon: "mdi:lightning-bolt", label: "Power", format: "power", color: "var(--amber-color, #ff9800)" },
  battery: { icon: "mdi:battery", label: "Battery", format: "percent", color: "var(--blue-color, #2196f3)" },
  co2: { icon: "mdi:molecule-co2", label: "CO₂", format: "auto", color: "var(--green-color, #43a047)" },
  device: { icon: "mdi:power-plug", label: "Device", format: "auto", color: "var(--blue-color, #2196f3)" },
  custom: { icon: "mdi:chart-box-outline", label: "Metric", format: "auto", color: "var(--primary-color)" },
};

export const presetMetric = (preset: MetricPreset = "temperature"): MetricConfig => {
  const { color: _color, ...defaults } = PRESETS[preset];
  return {
    preset,
    ...defaults,
    ...(["temperature", "humidity", "lights", "power", "co2"].includes(preset) ? { source: "area" as const } : {}),
    hide_unavailable: true,
  };
};
