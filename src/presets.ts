import type { MetricConfig, MetricPreset } from "./types";

type Preset = Required<Pick<MetricConfig, "icon" | "label" | "format">> & { color: string };

export const PRESETS: Record<MetricPreset, Preset> = {
  temperature: { icon: "mdi:thermometer", label: "Temperature", format: "temperature", color: "var(--red-color, #f44336)" },
  humidity: { icon: "mdi:water-percent", label: "Humidity", format: "percent", color: "var(--blue-color, #2196f3)" },
  lights: { icon: "mdi:lightbulb-group-outline", label: "Lights", format: "auto", color: "var(--yellow-color, #fbc02d)" },
  power: { icon: "mdi:lightning-bolt", label: "Power", format: "power", color: "var(--amber-color, #ff9800)" },
  battery: { icon: "mdi:battery", label: "Battery", format: "percent", color: "var(--blue-color, #2196f3)" },
  co2: { icon: "mdi:molecule-co2", label: "CO₂", format: "auto", color: "var(--green-color, #43a047)" },
  motion: { icon: "mdi:motion-sensor", label: "Motion", format: "auto", color: "var(--amber-color, #ff9800)" },
  presence: { icon: "mdi:account-check-outline", label: "Presence", format: "auto", color: "var(--green-color, #43a047)" },
  doors: { icon: "mdi:door-closed", label: "Doors", format: "auto", color: "var(--green-color, #43a047)" },
  windows: { icon: "mdi:window-closed-variant", label: "Windows", format: "auto", color: "var(--green-color, #43a047)" },
  leaks: { icon: "mdi:water-check-outline", label: "Leaks", format: "auto", color: "var(--green-color, #43a047)" },
  people_home: { icon: "mdi:account-group", label: "People home", format: "auto", color: "var(--green-color, #43a047)" },
  occupancy: { icon: "mdi:account-group", label: "Occupancy helper", format: "auto", color: "var(--green-color, #43a047)" },
  device: { icon: "mdi:devices", label: "A specific entity", format: "auto", color: "var(--blue-color, #2196f3)" },
  custom: { icon: "mdi:chart-box-outline", label: "Metric", format: "auto", color: "var(--primary-color)" },
};

export const presetMetric = (preset: MetricPreset = "temperature"): MetricConfig => {
  const { color: _color, ...defaults } = PRESETS[preset];
  return {
    preset,
    ...defaults,
    ...(["temperature", "humidity", "lights", "power", "co2", "motion", "presence", "doors", "windows", "leaks"].includes(preset) ? { source: "area" as const } : {}),
    hide_unavailable: true,
  };
};
