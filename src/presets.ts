import type { MetricConfig, MetricPreset } from "./types";

export const PRESETS: Record<MetricPreset, Required<Pick<MetricConfig, "icon" | "label" | "format">>> = {
  temperature: { icon: "mdi:thermometer", label: "Temperature", format: "temperature" },
  humidity: { icon: "mdi:water-percent", label: "Humidity", format: "percent" },
  lights: { icon: "mdi:lightbulb-outline", label: "Lights", format: "auto" },
  power: { icon: "mdi:lightning-bolt", label: "Power", format: "power" },
  battery: { icon: "mdi:battery", label: "Battery", format: "percent" },
  co2: { icon: "mdi:molecule-co2", label: "CO₂", format: "auto" },
  device: { icon: "mdi:power-plug", label: "Device", format: "auto" },
  custom: { icon: "mdi:chart-box-outline", label: "Metric", format: "auto" },
};

export const presetMetric = (preset: MetricPreset = "temperature"): MetricConfig => ({
  preset,
  ...PRESETS[preset],
  hide_unavailable: true,
});
