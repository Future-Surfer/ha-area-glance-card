import { LitElement, css, html, nothing, svg, type PropertyValues } from "lit";
import { dispatchHassAction, type ActionTrigger } from "./actions";
import { areaEntityIds } from "./area-index";
import { resolveAreaReference, resolvedAreaId } from "./area-reference";
import { bucketPoints, fetchChartHistory, fetchMultiChartHistory, liveNumericState, rangeMilliseconds, type ChartHistory, type MultiChartHistory } from "./chart-data";
import { chartGeometry, multiChartGeometry } from "./chart-geometry";
import { PRESETS, presetMetric } from "./presets";
import type { ActionConfig, AreaGlanceConfig, AreaReference, AreaSignal, ChartConfig, ChartSeriesConfig, ChartType, EntityState, HassLike, MetricConfig, MetricPreset, StatusConfig } from "./types";

const UNAVAILABLE = new Set(["unknown", "unavailable", "none", ""]);
const DEFAULT_METRICS = [presetMetric("temperature"), presetMetric("lights"), presetMetric("power"), presetMetric("device")];
const DEFAULT_SECURITY_METRICS = [presetMetric("alarm"), presetMetric("doors"), presetMetric("windows"), presetMetric("locks")];
const DEFAULT_ENERGY_METRICS: MetricConfig[] = [
  { ...presetMetric("power"), energy_source: "grid", label: "Grid", icon: "mdi:transmission-tower" },
  { ...presetMetric("power"), energy_source: "solar", label: "Solar", icon: "mdi:solar-power-variant" },
  { ...presetMetric("battery"), energy_source: "battery_soc", label: "Battery" },
  { ...presetMetric("power"), energy_source: "battery_power", label: "Battery flow", icon: "mdi:battery-charging-medium" },
];
/** Home battery starts with the four live Energy Dashboard signals that explain it. */
const DEFAULT_BATTERY_METRICS: MetricConfig[] = [
  { ...presetMetric("battery"), energy_source: "battery_soc", label: "Charge" },
  { ...presetMetric("power"), energy_source: "battery_power", label: "Battery flow", icon: "mdi:battery-charging-medium" },
  { ...presetMetric("power"), energy_source: "solar", label: "Solar", icon: "mdi:solar-power-variant" },
  { ...presetMetric("power"), energy_source: "grid", label: "Grid", icon: "mdi:transmission-tower" },
];
/**
 * A few integrations expose one physical camera as Clear/Fluent, Main/Sub or
 * HD/low camera entities. The entity registry device ID is authoritative; this
 * conservative stem is only a fallback for frontends that have not exposed it.
 */
const cameraDeviceFallback = (entityId: string, attributes: Record<string, unknown>) => {
  const explicit = attributes.device_id;
  if (typeof explicit === "string" && explicit) return `device:${explicit}`;
  const stem = entityId.replace(/^camera\./, "").replace(/(?:[_-](?:clear|fluent|main(?:stream)?|sub(?:stream)?|high|low|hd|sd|live|stream\d*))$/i, "");
  return `camera:${stem}`;
};
const cameraStreamRank = (entityId: string, attributes: Record<string, unknown>) => {
  const value = `${entityId} ${attributes.friendly_name ?? ""}`.toLowerCase();
  if (/(fluent|sub(?:stream)?|low|sd)/.test(value)) return 0;
  if (/(clear|main(?:stream)?|high|hd)/.test(value)) return 2;
  return 1;
};
/** Select up to three feeds, never more than one from each physical camera. */
const cameraProfileMetrics = (hass?: HassLike): MetricConfig[] => {
  const cameras = Object.keys(hass?.states ?? {})
    .filter((entityId) => entityId.startsWith("camera."))
    .map((entityId) => {
      const attributes = hass?.states[entityId]?.attributes ?? {};
      const width = Number(attributes.width ?? attributes.image_width ?? 0);
      const height = Number(attributes.height ?? attributes.image_height ?? 0);
      const resolution = typeof attributes.resolution === "string" ? attributes.resolution.match(/(\d+)\s*[x×]\s*(\d+)/i) : undefined;
      const pixels = width > 0 && height > 0 ? width * height : resolution ? Number(resolution[1]) * Number(resolution[2]) : Number.POSITIVE_INFINITY;
      const deviceId = hass?.entities?.[entityId]?.device_id ?? cameraDeviceFallback(entityId, attributes);
      return { entityId, deviceId, pixels, streamRank: cameraStreamRank(entityId, attributes) };
    })
    .sort((a, b) => a.pixels - b.pixels || a.streamRank - b.streamRank || a.entityId.localeCompare(b.entityId));
  const seenDevices = new Set<string>();
  return cameras.filter((camera) => {
    if (seenDevices.has(camera.deviceId)) return false;
    seenDevices.add(camera.deviceId);
    return true;
  }).slice(0, 3).map(({ entityId }) => ({
    ...presetMetric("camera"),
    source: "entity" as const,
    entity: entityId,
    camera_display: "feed" as const,
    action: "more-info" as const,
  }));
};
const defaultMetricsForProfile = (profile: AreaGlanceConfig["profile"], hass?: HassLike): MetricConfig[] => {
  if (profile === "security") return DEFAULT_SECURITY_METRICS;
  if (profile === "energy") return DEFAULT_ENERGY_METRICS;
  if (profile === "battery") return DEFAULT_BATTERY_METRICS;
  if (profile === "cameras") {
    const metrics = cameraProfileMetrics(hass);
    return metrics.length ? metrics : [presetMetric("camera")];
  }
  return DEFAULT_METRICS;
};
const AREA_SIGNAL_PRESETS = new Set<MetricPreset>(["motion", "presence", "doors", "windows", "blinds", "locks", "leaks"]);
const AREA_MEASUREMENT_PRESETS = new Set<MetricPreset>(["temperature", "humidity", "power", "co2", "pm25", "voc", "aqi"]);
const AUTOMATIC_METRIC_PRESETS: MetricPreset[] = ["temperature", "humidity", "lights", "power", "co2", "pm25", "voc", "aqi", "motion", "presence", "doors", "windows", "blinds", "locks", "attention", "leaks"];
const DEVICE_METRIC_PRESETS: MetricPreset[] = ["alarm", "camera", "vacuum", "weather", "people_home", "battery", "device", "clock", "calendar", "custom"];
const statusSignal = (source: StatusConfig["source"]): AreaSignal | undefined => {
  if (source === "area_motion") return "motion";
  if (source === "area_presence") return "presence";
  if (source === "area_doors") return "doors";
  if (source === "area_windows") return "windows";
  if (source === "area_leaks") return "leaks";
  return undefined;
};
const SLOT_HELPERS: Record<MetricPreset, string> = {
  temperature: "Use the median of area temperature sensors, or one chosen sensor.",
  humidity: "Use the median of area humidity sensors, or one chosen sensor.",
  lights: "Count lights that are on in an area.",
  power: "Sum compatible live power sensors in an area, or use one sensor.",
  battery: "Show a battery percentage with sensible colour thresholds.",
  co2: "Show the highest compatible CO₂ measurement in this area.",
  pm25: "Show the highest compatible PM2.5 measurement in this area.",
  voc: "Show a compatible volatile-organic-compounds measurement in this area.",
  aqi: "Show the highest compatible Air Quality Index in this area.",
  motion: "Show whether there is motion now, or when motion was last seen in this area.",
  presence: "Show whether any area presence sensor reports the room as occupied.",
  doors: "Count compatible area doors and garage doors that are open.",
  windows: "Count compatible area window sensors that are open.",
  blinds: "Count recognised area blinds, shades, shutters, and curtains that are open or moving.",
  locks: "Count locks in an area that are unlocked or need attention.",
  attention: "Show unavailable entities and updates that need attention in an area or across the whole home.",
  alarm: "Show the state of one Home Assistant alarm control panel.",
  camera: "Show one chosen camera's state, or use the whole insight slot for its Home Assistant camera preview.",
  vacuum: "Show one robot vacuum with a state-aware icon and colour, or choose its battery or fan speed.",
  weather: "Show one Weather entity with a live condition icon, or one of its current readings.",
  clock: "Show the current local time as a digital readout or an analogue clock face.",
  calendar: "Show today's date as a compact calendar tile. It does not need an entity.",
  leaks: "Show Dry until any compatible area water-leak sensor reports a leak.",
  people_home: "Show the current count from Home Assistant's Home zone.",
  occupancy: "Show the state of one chosen occupancy helper (legacy option).",
  device: "Choose any entity. The card uses a helpful icon and label for common devices.",
  custom: "Show an entity using its native state and unit.",
};
const HEIGHT_OPTIONS = {
  slim: { contentHeight: 68, stackedContentHeight: 126, metricRowHeight: 58, rows: 1.7, stackedRows: 2.9, scale: 0.82 },
  compact: { contentHeight: 78, stackedContentHeight: 140, metricRowHeight: 62, rows: 1.9, stackedRows: 3, scale: 1 },
  standard: { contentHeight: 94, stackedContentHeight: 160, metricRowHeight: 72, rows: 2.2, stackedRows: 3.4, scale: 1.15 },
  comfortable: { contentHeight: 114, stackedContentHeight: 188, metricRowHeight: 84, rows: 2.8, stackedRows: 4, scale: 1.3 },
} as const;
const APPEARANCE_PRESETS = {
  theme: { theme: "auto", background: undefined },
  light: { theme: "light", background: "#f8f9fb" },
  slate: { theme: "dark", background: "#8d97a3" },
  charcoal: { theme: "dark", background: "#353c45" },
} as const;
type AppearancePreset = keyof typeof APPEARANCE_PRESETS | "custom";
const DEFAULT_CUSTOM_BACKGROUND = "#353c45";

const WEATHER_ICONS: Record<string, string> = {
  "clear-night": "mdi:weather-night",
  cloudy: "mdi:weather-cloudy",
  exceptional: "mdi:weather-cloudy-alert",
  fog: "mdi:weather-fog",
  hail: "mdi:weather-hail",
  lightning: "mdi:weather-lightning",
  "lightning-rainy": "mdi:weather-lightning-rainy",
  partlycloudy: "mdi:weather-partly-cloudy",
  pouring: "mdi:weather-pouring",
  rainy: "mdi:weather-rainy",
  snowy: "mdi:weather-snowy",
  "snowy-rainy": "mdi:weather-snowy-rainy",
  sunny: "mdi:weather-sunny",
  windy: "mdi:weather-windy",
  "windy-variant": "mdi:weather-windy-variant",
};

const weatherColor = (condition: string, fallback: string): string =>
  ["sunny", "lightning", "lightning-rainy"].includes(condition) ? "var(--amber-color, #ff9800)"
    : condition === "clear-night" ? "var(--indigo-color, #5c6bc0)"
      : ["rainy", "pouring", "hail", "snowy", "snowy-rainy"].includes(condition) ? "var(--blue-color, #2196f3)"
        : fallback;

const ordinal = (day: number): string => {
  const remainder = day % 100;
  if (remainder >= 11 && remainder <= 13) return `${day}th`;
  return `${day}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[day % 10] ?? "th"}`;
};

const asNumber = (value: string): number | undefined => {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
};

const normalisedUnit = (state?: EntityState): string => String(state?.attributes.unit_of_measurement ?? "")
  .trim()
  .toLowerCase()
  .replaceAll("μ", "µ")
  .replaceAll("³", "3");

const POWER_UNIT_FACTORS: Record<string, number> = {
  mW: 0.001,
  W: 1,
  kW: 1000,
  MW: 1000000,
  GW: 1000000000,
  TW: 1000000000000,
};

const powerUnit = (unit?: string): keyof typeof POWER_UNIT_FACTORS | undefined => {
  const candidate = String(unit ?? "").trim();
  return Object.prototype.hasOwnProperty.call(POWER_UNIT_FACTORS, candidate)
    ? candidate as keyof typeof POWER_UNIT_FACTORS
    : undefined;
};

const temperatureUnit = (unit?: string): "°C" | "°F" | undefined => {
  const candidate = String(unit ?? "").trim().toLowerCase().replaceAll(" ", "");
  if (["°c", "c", "celsius"].includes(candidate)) return "°C";
  if (["°f", "f", "fahrenheit"].includes(candidate)) return "°F";
  return undefined;
};

const convertTemperature = (value: number, from?: string, to?: string): number => {
  const source = temperatureUnit(from);
  const target = temperatureUnit(to);
  if (!source || !target || source === target) return value;
  return source === "°C" ? value * 9 / 5 + 32 : (value - 32) * 5 / 9;
};

const convertPower = (value: number, from?: string, to?: string): number => {
  const source = powerUnit(from);
  const target = powerUnit(to);
  if (!source || !target) return value;
  return value * POWER_UNIT_FACTORS[source] / POWER_UNIT_FACTORS[target];
};

const isMeasurementSensor = (entityId: string, state?: EntityState): boolean =>
  entityId.startsWith("sensor.") && asNumber(state?.state ?? "") !== undefined;

const isAreaMeasurement = (preset: MetricPreset, entityId: string, state?: EntityState): boolean => {
  if (!isMeasurementSensor(entityId, state)) return false;
  const deviceClass = String(state?.attributes.device_class ?? "");
  const unit = normalisedUnit(state);
  const rawUnit = String(state?.attributes.unit_of_measurement ?? "");
  if (preset === "temperature") return deviceClass === "temperature";
  if (preset === "humidity") return deviceClass === "humidity";
  // Prefer Home Assistant's power device class. The classless fallback keeps
  // established, older integrations working without admitting W/m² sensors.
  if (preset === "power") return Boolean(POWER_UNIT_FACTORS[rawUnit]) && (deviceClass === "power" || !deviceClass);
  if (preset === "co2") return (deviceClass === "carbon_dioxide" && unit === "ppm")
    || (!deviceClass && unit === "ppm" && /(^|_)(co2|carbon_dioxide)(_|$)/.test(entityId));
  if (preset === "pm25") return deviceClass === "pm25" && unit === "µg/m3";
  if (preset === "voc") return (deviceClass === "volatile_organic_compounds" && ["µg/m3", "mg/m3"].includes(unit))
    || (deviceClass === "volatile_organic_compounds_parts" && ["ppm", "ppb"].includes(unit));
  if (preset === "aqi") return deviceClass === "aqi" && !unit;
  return false;
};

const defaultAggregation = (preset: MetricPreset): NonNullable<MetricConfig["aggregation"]> =>
  preset === "power" ? "sum" : ["co2", "pm25", "voc", "aqi"].includes(preset) ? "highest" : "median";

const aggregateValues = (values: number[], aggregation: NonNullable<MetricConfig["aggregation"]>): number => {
  const sorted = [...values].sort((left, right) => left - right);
  if (aggregation === "sum") return sorted.reduce((total, value) => total + value, 0);
  if (aggregation === "average") return sorted.reduce((total, value) => total + value, 0) / sorted.length;
  if (aggregation === "highest") return sorted.at(-1)!;
  if (aggregation === "lowest") return sorted[0]!;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const friendlyState = (state: string) => state.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

const friendlyDeviceState = (domain: string | undefined, state: string): string => {
  if (domain === "weather") {
    const weatherStates: Record<string, string> = { "clear-night": "Clear night", cloudy: "Cloudy", exceptional: "Exceptional", fog: "Fog", hail: "Hail", lightning: "Lightning", "lightning-rainy": "Stormy", partlycloudy: "Partly cloudy", pouring: "Pouring", rainy: "Rainy", snowy: "Snowy", "snowy-rainy": "Sleet", sunny: "Sunny", windy: "Windy", "windy-variant": "Windy" };
    return weatherStates[state] ?? friendlyState(state);
  }
  if (domain === "climate") {
    const climateStates: Record<string, string> = { heat: "Heating", cool: "Cooling", "heat_cool": "Heat/cool", dry: "Drying", fan_only: "Fan", auto: "Auto", off: "Off" };
    return climateStates[state] ?? friendlyState(state);
  }
  return friendlyState(state);
};

const vacuumPresentation = (state: string) => {
  if (["cleaning", "returning", "returning_home"].includes(state)) return { icon: "mdi:robot-vacuum-variant", color: "var(--blue-color, #2196f3)" };
  if (["paused", "stopped"].includes(state)) return { icon: "mdi:robot-vacuum", color: "var(--amber-color, #ff9800)" };
  if (["error", "problem"].includes(state)) return { icon: "mdi:robot-vacuum-alert", color: "var(--error-color, #db4437)" };
  if (["docked", "idle", "off"].includes(state)) return { icon: "mdi:robot-vacuum", color: "var(--success-color, #2eaa45)" };
  return { icon: "mdi:robot-vacuum", color: "var(--secondary-text-color)" };
};

const stateAge = (lastChanged: string): string => {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(lastChanged).getTime()) / 60000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
};

const isDoorEntity = (entityId: string, state?: EntityState): boolean => {
  const deviceClass = String(state?.attributes.device_class ?? "");
  if (entityId.startsWith("binary_sensor.")) return ["door", "garage_door", "opening"].includes(deviceClass);
  if (entityId.startsWith("cover.")) return ["door", "garage"].includes(deviceClass) || /(^|_)(door|garage)(_|$)/.test(entityId);
  return false;
};

const isDoorOpen = (entityId: string, state: EntityState): boolean =>
  entityId.startsWith("cover.") ? ["open", "opening"].includes(state.state) : state.state === "on";

const isWindowEntity = (entityId: string, state?: EntityState): boolean => {
  const deviceClass = String(state?.attributes.device_class ?? "");
  if (entityId.startsWith("binary_sensor.")) return deviceClass === "window";
  if (entityId.startsWith("cover.")) return deviceClass === "window" || /(^|_)window(_|$)/.test(entityId);
  return false;
};

const isBlindEntity = (entityId: string, state?: EntityState): boolean =>
  entityId.startsWith("cover.") && ["blind", "shade", "shutter", "curtain"].includes(String(state?.attributes.device_class ?? ""));

const isBlindOpen = (state: EntityState): boolean => ["open", "opening", "closing"].includes(state.state);

const isLockEntity = (entityId: string, state?: EntityState): boolean =>
  entityId.startsWith("lock.") || (entityId.startsWith("binary_sensor.") && state?.attributes.device_class === "lock");

const isUpdateEntity = (entityId: string, state?: EntityState): boolean =>
  entityId.startsWith("update.") || (entityId.startsWith("binary_sensor.") && state?.attributes.device_class === "update");

const isAlarmEntity = (entityId: string): boolean => entityId.startsWith("alarm_control_panel.");

const isAlarmTriggered = (state: EntityState): boolean => ["triggered", "alarm"].includes(state.state);

const isAlarmArmed = (state: EntityState): boolean => state.state.startsWith("armed_");

const isSignalEntity = (signal: AreaSignal, entityId: string, state?: EntityState): boolean => {
  if (!state) return false;
  const deviceClass = String(state.attributes.device_class ?? "");
  if (signal === "motion") return entityId.startsWith("binary_sensor.") && deviceClass === "motion";
  if (signal === "presence") return entityId.startsWith("binary_sensor.") && ["occupancy", "presence"].includes(deviceClass);
  if (signal === "doors") return isDoorEntity(entityId, state);
  if (signal === "windows") return isWindowEntity(entityId, state);
  if (signal === "blinds") return isBlindEntity(entityId, state);
  if (signal === "locks") return isLockEntity(entityId, state);
  return entityId.startsWith("binary_sensor.") && deviceClass === "moisture";
};

const isSignalActive = (signal: AreaSignal, entityId: string, state: EntityState): boolean =>
  signal === "doors" || signal === "windows" ? isDoorOpen(entityId, state)
    : signal === "blinds" ? isBlindOpen(state)
      : signal === "locks" ? entityId.startsWith("binary_sensor.") ? state.state === "on" : ["unlocked", "unlocking", "jammed"].includes(state.state)
      : state.state === "on";

const includedEntityIds = (config: Pick<MetricConfig, "membership">, candidates: string[]): string[] => {
  const membership = config.membership;
  if (membership?.mode === "selected_only") {
    const selected = new Set(membership.include ?? []);
    return candidates.filter((entityId) => selected.has(entityId));
  }
  const excluded = new Set(membership?.exclude ?? []);
  return candidates.filter((entityId) => !excluded.has(entityId));
};

const attentionTypes = (metric: MetricConfig): ("unavailable" | "updates")[] =>
  metric.attention_types?.length ? metric.attention_types : ["unavailable", "updates"];

interface MetricDisplay {
  icon: string;
  color?: string;
  value: string;
  label: string;
  showIcon?: boolean;
  showLabel?: boolean;
  entities?: string[];
  aggregate?: boolean;
  visual?: { kind: "analogue-clock"; hourAngle: number; minuteAngle: number } | { kind: "calendar"; month: string; day: string } | { kind: "camera"; src: string; alt: string };
}

interface DisplayValueParts {
  primary: string;
  unit?: string;
}

interface EnergySourcePreference {
  type?: string;
  name?: string;
  stat_rate?: string;
  stat_rate_from?: string;
  stat_rate_to?: string;
  stat_soc?: string;
  stat_energy_from?: string;
  stat_energy_to?: string;
  power_config?: { stat_rate?: string; stat_rate_from?: string; stat_rate_to?: string };
  /** Current Energy Dashboard grid configuration uses directional flows. */
  flow_from?: EnergyFlowPreference[];
  flow_to?: EnergyFlowPreference[];
}

interface EnergyFlowPreference {
  stat_rate?: string;
  stat_rate_from?: string;
  stat_rate_to?: string;
  stat_energy_from?: string;
  stat_energy_to?: string;
  power_config?: { stat_rate?: string; stat_rate_from?: string; stat_rate_to?: string };
}

interface EnergyPreferences {
  energy_sources?: EnergySourcePreference[];
}

type ChartEnergySource = NonNullable<ChartConfig["energy_source"]>;
type ResolvedChartSource = { entity?: string; importEntity?: string; exportEntity?: string };

const livePowerEntity = (hass: HassLike | undefined, energyEntity?: string): string | undefined => {
  if (!hass || !energyEntity) return undefined;
  const deviceId = hass.entities?.[energyEntity]?.device_id;
  if (!deviceId) return undefined;
  return Object.entries(hass.states)
    .filter(([entityId, state]) => hass.entities?.[entityId]?.device_id === deviceId && entityId.startsWith("sensor.") && (String(state.attributes.device_class ?? "") === "power" || Boolean(powerUnit(String(state.attributes.unit_of_measurement ?? "")))))
    .sort(([left], [right]) => left.localeCompare(right))[0]?.[0];
};

const firstRate = (source?: EnergySourcePreference | EnergyFlowPreference): string | undefined => source?.power_config?.stat_rate_from ?? source?.power_config?.stat_rate ?? source?.stat_rate_from ?? source?.stat_rate ?? source?.stat_rate_to;
const firstEnergyEntity = (source?: EnergySourcePreference | EnergyFlowPreference): string | undefined => source?.stat_energy_from ?? source?.stat_energy_to;

/** HA has returned both the direct object and a `{ preferences }` wrapper over
 * time. Keep that compatibility at this narrow boundary. */
const normaliseEnergyPreferences = (response: EnergyPreferences | { preferences?: EnergyPreferences } | undefined): EnergyPreferences | undefined => {
  if (!response) return undefined;
  return "preferences" in response ? response.preferences : response as EnergyPreferences;
};

/**
 * The frontend replaces `hass` objects as state updates arrive, but its
 * WebSocket function remains the useful identity for this small, read-only
 * configuration request. Sharing the request stops the editor and preview
 * racing one another, and—crucially—means a state update cannot make us throw
 * away a valid Energy Dashboard response halfway through loading it.
 */
const energyPreferencesCache = new WeakMap<Function, EnergyPreferences>();
const energyPreferencesRequests = new WeakMap<Function, Promise<EnergyPreferences | undefined>>();
const loadSharedEnergyPreferences = (hass?: HassLike): Promise<EnergyPreferences | undefined> => {
  const callWS = hass?.callWS;
  if (!callWS) return Promise.resolve(undefined);
  const cached = energyPreferencesCache.get(callWS);
  if (cached) return Promise.resolve(cached);
  const pending = energyPreferencesRequests.get(callWS);
  if (pending) return pending;
  const request = callWS<EnergyPreferences | { preferences?: EnergyPreferences }>({ type: "energy/get_prefs" })
    .then(normaliseEnergyPreferences)
    .then((preferences) => {
      // Cache a genuine response, including an intentionally empty setup. A
      // transient WebSocket error is deliberately not cached, so a later card
      // can retry instead of being stuck with a false "not configured" state.
      if (preferences) energyPreferencesCache.set(callWS, preferences);
      return preferences;
    })
    .catch(() => undefined)
    .finally(() => energyPreferencesRequests.delete(callWS));
  energyPreferencesRequests.set(callWS, request);
  return request;
};

const flowRate = (hass: HassLike | undefined, flows?: EnergyFlowPreference[]): string | undefined =>
  flows?.map((flow) => firstRate(flow) ?? livePowerEntity(hass, firstEnergyEntity(flow))).find((entity): entity is string => Boolean(entity));

/** Resolve only genuine live sources. Energy totals are used to find a related
 * power sensor on the same device, never charted as if they were live power. */
const resolveEnergyChartSource = (preferences: EnergyPreferences | undefined, hass: HassLike | undefined, type: ChartEnergySource): ResolvedChartSource => {
  const source = (kind: string) => preferences?.energy_sources?.find((entry) => entry.type === kind);
  const grid = source("grid");
  const solar = source("solar");
  const battery = source("battery");
  if (type === "grid") {
    const directImport = grid?.power_config?.stat_rate_from ?? grid?.power_config?.stat_rate ?? grid?.stat_rate;
    const directExport = grid?.power_config?.stat_rate_to;
    const importEntity = directImport ?? flowRate(hass, grid?.flow_from) ?? livePowerEntity(hass, grid?.stat_energy_from);
    const exportEntity = directExport ?? flowRate(hass, grid?.flow_to) ?? livePowerEntity(hass, grid?.stat_energy_to);
    return importEntity ? { importEntity, exportEntity } : {};
  }
  if (type === "solar") {
    const entity = firstRate(solar) ?? livePowerEntity(hass, firstEnergyEntity(solar));
    return entity ? { entity } : {};
  }
  if (type === "battery_soc") return battery?.stat_soc ? { entity: battery.stat_soc } : {};
  const entity = firstRate(battery) ?? livePowerEntity(hass, firstEnergyEntity(battery));
  return entity ? { entity } : {};
};

/**
 * Prefer a deliberately configured Energy Dashboard source where that chart
 * form describes it truthfully. Daily totals remain a direct entity choice:
 * an import/export pair must not be silently treated as one consumption total.
 */
const suggestedEnergyChartSource = (preferences: EnergyPreferences | undefined, hass: HassLike | undefined, type: ChartType): ChartEnergySource | undefined => {
  // Continuous charts open on the most meaningful whole-home source: solar
  // generation where present, then Grid flow, then normal metadata fallback.
  if ((type === "line" || type === "area") && resolveEnergyChartSource(preferences, hass, "solar").entity) return "solar";
  if ((type === "columns" || type === "line") && resolveEnergyChartSource(preferences, hass, "grid").importEntity) return "grid";
  if (type === "area" && resolveEnergyChartSource(preferences, hass, "battery_soc").entity) return "battery_soc";
  return undefined;
};

const configuredEnergyEntities = (preferences: EnergyPreferences | undefined, type: ChartType): Set<string> => {
  if (type === "daily_totals") {
    return new Set((preferences?.energy_sources ?? []).flatMap((source) => [
      source.stat_energy_from,
      source.stat_energy_to,
      ...(source.flow_from ?? []).flatMap((flow) => [flow.stat_energy_from, flow.stat_energy_to]),
      ...(source.flow_to ?? []).flatMap((flow) => [flow.stat_energy_from, flow.stat_energy_to]),
    ]).filter((entity): entity is string => Boolean(entity)));
  }
  return new Set();
};

/** Keep measurement units visually secondary without changing the actual value or its accessible label. */
const splitDisplayUnit = (value: string): DisplayValueParts => {
  const match = value.match(/^(.+?)([µμ]g\/m(?:³|3)|mg\/m(?:³|3)|ppm|ppb|kW|MW|GW|TW|W|°C|°F|°|%|lx|hPa|kPa|km\/h|m\/s)$/);
  if (!match || !/[-+−]?\d/.test(match[1])) return { primary: value };
  return { primary: match[1], unit: match[2] };
};

interface AreaSignalSummary {
  entities: { entityId: string; state: EntityState }[];
  active: { entityId: string; state: EntityState }[];
  latest?: EntityState;
}

interface SecuritySummary {
  alarms: { entityId: string; state: EntityState }[];
  doors: AreaSignalSummary;
  windows: AreaSignalSummary;
  locks: AreaSignalSummary;
}

interface DetailSheet {
  title: string;
  subtitle: string;
  entities: string[];
  emptyMessage: string;
  /** Aggregate sheets can offer a deliberately small set of safe quick controls. */
  quickControls?: boolean;
  /** Lights get a deliberately richer control panel; other aggregates remain compact. */
  lightControlPanel?: boolean;
  /** Shared grouped presentation for automatic/selected aggregates. */
  aggregatePanel?: boolean;
  summary?: string;
  /** A compact, context-setting breakdown for measurement aggregates. */
  statistics?: { label: string; value: string }[];
}

export class AreaGlanceCard extends LitElement {
  public hass?: HassLike;
  private _config?: AreaGlanceConfig;
  private _detail?: DetailSheet;
  private _energyPreferences?: EnergyPreferences;
  /** `hass` is replaced on every state update, so it cannot be used as a load key. */
  private _energyPreferencesLoaded = false;
  private _energyPreferencesRequest?: Promise<void>;
  private _chartHistory?: ChartHistory;
  private _multiChartHistory?: MultiChartHistory[];
  private _chartKey?: string;
  private _chartRequest = 0;
  /** Distinguish a genuinely empty recorder response from the first in-flight request. */
  private _chartLoading = false;
  private _chartRefreshTimer?: number;
  private _chartRetryTimer?: number;
  private _chartRetriedKey?: string;
  private _clockTimer?: number;
  private _resizeObserver?: ResizeObserver;
  /** Actual plot width prevents SVG glyphs being distorted as Sections settles. */
  private _chartPlotWidth = 560;
  /** Matched to the responsive plot container so SVG text is never stretched vertically. */
  private _chartPlotHeight = 138;
  /** Prevent zero-line clip paths from colliding when several charts share a dashboard. */
  private _chartSvgId = `area-glance-chart-${Math.random().toString(36).slice(2)}`;
  private _towerIconMode: "normal" | "compact" | "hidden" = "normal";
  private _metricGesture?: { pointerId: number; metric: MetricConfig; display: MetricDisplay; startX: number; startY: number; held: boolean; timer?: number };
  private _pendingMetricTap?: { metric: MetricConfig; display: MetricDisplay; timer: number };
  private _ignoreMetricClick = false;
  /** Numeric showcase slots have no fixed room definition, so their initial
   * suggestions wait until HA has supplied the resolved area's live entities. */
  private _showcaseSuggestionsKey?: string;
  private _showcaseHasExplicitMetrics = false;

  static get properties() {
    return { hass: { attribute: false }, _config: { state: true }, _detail: { state: true }, _towerIconMode: { state: true }, _chartHistory: { state: true }, _multiChartHistory: { state: true }, _chartLoading: { state: true }, _chartPlotWidth: { state: true } };
  }

  static getConfigElement() {
    return document.createElement("area-glance-card-editor");
  }

  static getStubConfig(): AreaGlanceConfig {
    return { title: "Area", metrics: DEFAULT_METRICS };
  }

  public setConfig(config: AreaGlanceConfig): void {
    if (!config || (!config.title && !config.area && !["house", "security", "energy", "battery", "cameras", "chart"].includes(config.profile ?? "") && config.layout !== "metrics-only")) {
      throw new Error("Set a title, choose an area, use a Home, Energy, Home battery, Security, Cameras, or Chart profile, or use Metrics only.");
    }
    this._showcaseSuggestionsKey = undefined;
    this._showcaseHasExplicitMetrics = Array.isArray(config.metrics);
    this._config = {
      ...config,
      // Camera candidates depend on live hass.states, which is intentionally
      // assigned after setConfig by Home Assistant. Keep this profile dynamic
      // instead of freezing a blank fallback camera before states arrive.
      metrics: this._showcaseHasExplicitMetrics ? config.metrics : (config.profile === "cameras" || typeof config.area === "number") ? undefined : defaultMetricsForProfile(config.profile, this.hass),
    };
    this._loadEnergyPreferences();
    this._ensureChartHistory();
  }

  private _heightOption() { return HEIGHT_OPTIONS[this._config?.height ?? "slim"]; }
  private _effectiveMetrics(): MetricConfig[] {
    const configured = this._config?.metrics;
    if (configured?.length) return configured;
    return this._config?.profile === "cameras" ? cameraProfileMetrics(this.hass) : configured ?? [];
  }

  /**
   * Apply the safe part of the editor's initial area suggestion to portable
   * numeric slots. It intentionally runs only when the YAML did not provide
   * its own metrics: `area: 1` should behave like choosing that room for the
   * first time, while an explicit showcase card stays completely in control.
   */
  private _applyShowcaseAreaSuggestions() {
    const config = this._config;
    if (!config || typeof config.area !== "number" || this._showcaseHasExplicitMetrics || config.metrics?.length || !this.hass) return;
    const areaId = this._resolvedArea(config.area);
    if (!areaId) return;
    const key = `${config.area}:${areaId}:${Object.keys(this.hass.states).length}`;
    if (this._showcaseSuggestionsKey === key) return;
    this._showcaseSuggestionsKey = key;

    const entities = areaEntityIds(this.hass, areaId);
    const state = (entityId: string) => this.hass?.states[entityId];
    const first = (predicate: (entityId: string) => boolean) => entities.find(predicate);
    const hasDeviceClass = (entityId: string, deviceClass: string) => isMeasurementSensor(entityId, state(entityId)) && state(entityId)?.attributes.device_class === deviceClass;
    const isPower = (entityId: string) => isAreaMeasurement("power", entityId, state(entityId));
    const name = (this._areaName(config.area) ?? "").toLowerCase();
    const profile = config.profile === "auto" || !config.profile
      ? /(garage|utility|plant|battery)/.test(name) ? "battery" : /(energy|solar|power)/.test(name) ? "energy" : /(living|lounge|family|den|media|cinema|tv)/.test(name) ? "media" : "room"
      : config.profile;
    const metrics: MetricConfig[] = [];
    const addEntity = (preset: MetricPreset, entity?: string, overrides: Partial<MetricConfig> = {}) => { if (entity && metrics.length < 5) metrics.push({ ...presetMetric(preset), entity, source: "entity", ...overrides }); };
    const addArea = (preset: MetricPreset, available: boolean, overrides: Partial<MetricConfig> = {}) => { if (available && metrics.length < 5) metrics.push({ ...presetMetric(preset), source: "area", area: config.area, ...overrides }); };
    const temperature = first((id) => hasDeviceClass(id, "temperature"));
    const humidity = first((id) => hasDeviceClass(id, "humidity"));
    const co2 = first((id) => isAreaMeasurement("co2", id, state(id)));
    const pm25 = first((id) => isAreaMeasurement("pm25", id, state(id)));
    const voc = first((id) => isAreaMeasurement("voc", id, state(id)));
    const aqi = first((id) => isAreaMeasurement("aqi", id, state(id)));
    const air = ([ ["co2", co2], ["pm25", pm25], ["voc", voc], ["aqi", aqi] ] as const).find(([, entity]) => Boolean(entity))?.[0];
    const power = first(isPower);
    const battery = first((id) => hasDeviceClass(id, "battery"));
    const media = first((id) => id.startsWith("media_player."));
    const device = media ?? first((id) => id.startsWith("switch.") || id.startsWith("fan.") || id.startsWith("climate."));
    const blind = first((id) => isBlindEntity(id, state(id)));
    if (profile === "battery") {
      addEntity("battery", battery); addEntity("power", power); addArea("temperature", Boolean(temperature));
    } else if (profile === "energy") {
      addArea("power", Boolean(power)); addEntity("battery", battery); addArea("temperature", Boolean(temperature));
    } else if (profile === "media") {
      addArea("temperature", Boolean(temperature)); addArea("lights", Boolean(first((id) => id.startsWith("light.")))); addEntity("device", media ?? device, { label: media ? "Media" : undefined }); addArea("blinds", Boolean(blind)); addArea("power", Boolean(power)); if (air) addArea(air, true); addArea("humidity", Boolean(humidity));
    } else {
      addArea("temperature", Boolean(temperature)); addArea("lights", Boolean(first((id) => id.startsWith("light.")))); addArea("blinds", Boolean(blind)); addArea("humidity", Boolean(humidity)); if (air) addArea(air, true); addArea("power", Boolean(power)); if (!metrics.length) addEntity("device", device);
    }
    const motion = first((id) => isSignalEntity("motion", id, state(id)));
    const presence = first((id) => isSignalEntity("presence", id, state(id)));
    this._config = {
      ...config,
      metrics,
      title: config.title ?? this._areaName(config.area),
      status: config.status ?? (presence && (profile === "room" || profile === "media") ? { source: "area_presence", area: config.area } : motion && (profile === "room" || profile === "media") ? { source: "area_motion", area: config.area, active_text: "Motion", inactive_text: "No motion", show_last_changed: true, last_changed_text: "Last motion" } : undefined),
    };
  }
  private _gridRows() {
    const height = this._heightOption();
    // Charts deliberately occupy roughly two bands, while remaining honest to
    // the shared card-height choice used by every other layout.
    if (this._config?.profile === "chart") return height.rows * (this._config.layout === "stacked" ? 2.45 : 2);
    if (this._config?.layout === "tower") return Math.max(3.5, 1.2 + (this._effectiveMetrics().filter((metric) => !metric.hidden).length || 1) * 1.15);
    return this._config?.layout === "stacked" ? height.stackedRows : height.rows;
  }

  /** Auto keeps a compact header above insights and gives a side header room to breathe. */
  private _headerLineMode(kind: "title" | "status"): "single" | "multi" {
    const configured = kind === "title" ? this._config?.header_title_lines : this._config?.header_status_lines;
    if (configured && configured !== "auto") return configured;
    return this._config?.layout === "stacked" || this._config?.layout === "tower" ? "single" : "multi";
  }

  /** A side header has a deliberately fixed share of the band, so ease long names down before truncating them. */
  private _headerTitleFit(title: string, mode: "single" | "multi"): number {
    if (this._config?.layout === "stacked" || this._config?.layout === "tower" || mode !== "multi") return 1;
    const length = Array.from(title).length;
    if (length <= 12) return 1;
    if (length <= 18) return 0.76;
    if (length <= 26) return 0.68;
    return 0.6;
  }

  public getCardSize() { return this._gridRows(); }
  public getGridOptions() {
    // Towers are intentionally narrow, single-column cards. Keep their useful
    // maximum modest while allowing the native Sections editor down to 3 units.
    if (this._config?.layout === "tower") return { columns: 6, min_columns: 3 };
    return { columns: 12, min_columns: 6 };
  }

  connectedCallback() {
    super.connectedCallback();
    this._clockTimer = window.setInterval(() => this.requestUpdate(), 30000);
    this._resizeObserver = new ResizeObserver(() => { this._syncTowerIconMode(); this._syncChartPlotSize(); });
    this._resizeObserver.observe(this);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._clockTimer !== undefined) window.clearInterval(this._clockTimer);
    if (this._chartRefreshTimer !== undefined) window.clearTimeout(this._chartRefreshTimer);
    if (this._chartRetryTimer !== undefined) window.clearTimeout(this._chartRetryTimer);
    this._clockTimer = undefined;
    this._resizeObserver?.disconnect();
    this._resizeObserver = undefined;
    this._cancelMetricGesture();
    if (this._pendingMetricTap) window.clearTimeout(this._pendingMetricTap.timer);
    this._pendingMetricTap = undefined;
  }

  protected willUpdate(changed: PropertyValues<this>) {
    if (changed.has("hass")) {
      this._applyShowcaseAreaSuggestions();
      this._loadEnergyPreferences();
      this._ensureChartHistory();
      this.requestUpdate();
    }
  }

  private _loadEnergyPreferences() {
    if (!["energy", "battery", "chart"].includes(this._config?.profile ?? "") || !this.hass?.callWS || this._energyPreferencesLoaded || this._energyPreferencesRequest) return;
    this._energyPreferencesRequest = loadSharedEnergyPreferences(this.hass)
      .then((preferences) => {
        this._energyPreferences = preferences;
      })
      .finally(() => {
        this._energyPreferencesLoaded = true;
        this._energyPreferencesRequest = undefined;
        this._ensureChartHistory(true);
        this.requestUpdate();
      });
  }

  private _chartSource(chart = this._config?.chart): { entity?: string; importEntity?: string; exportEntity?: string } {
    if (!chart) return {};
    if (chart.type === "multi_line") return { entity: chart.primary_entity ?? chart.entities?.[0]?.entity };
    if (chart.entity) return { entity: chart.entity };
    const source = chart.energy_source ?? suggestedEnergyChartSource(this._energyPreferences, this.hass, chart.type ?? "line");
    if (source) {
      const resolved = resolveEnergyChartSource(this._energyPreferences, this.hass, source);
      if (resolved.entity || resolved.importEntity) return resolved;
    }
    // Never flash a generic candidate while the Energy Dashboard preferences
    // request is in flight. This also matters for an automatic chart: Grid is
    // its preferred source once those preferences arrive, whereas the generic
    // ranking would otherwise briefly select (for example) a temperature sensor.
    if (!this._energyPreferencesLoaded) return {};
    return { entity: this._suggestChartEntity(chart.type ?? "line") };
  }

  /** Deliberate metadata-only source ranking. Friendly-name order only breaks a tie. */
  private _suggestChartEntity(type: ChartType): string | undefined {
    const candidates = Object.entries(this.hass?.states ?? {})
      .filter((entry): entry is [string, EntityState] => entry[0].startsWith("sensor.") && Boolean(entry[1]) && asNumber(entry[1]?.state ?? "") !== undefined);
    const configuredTotals = configuredEnergyEntities(this._energyPreferences, type);
    const score = ([entityId, state]: [string, EntityState]): number => {
      const deviceClass = String(state.attributes.device_class ?? "");
      const stateClass = String(state.attributes.state_class ?? "");
      const unit = String(state.attributes.unit_of_measurement ?? "");
      if (type === "daily_totals") return ["energy", "water", "gas", "monetary"].includes(deviceClass) && ["total", "total_increasing"].includes(stateClass) ? (configuredTotals.has(entityId) ? 140 : 100) : -1;
      if (type === "columns") return deviceClass === "power" ? 100 : Boolean(powerUnit(unit)) ? 80 : -1;
      if (type === "area") return deviceClass === "power" ? 80 : deviceClass === "battery" || unit === "%" ? 70 : -1;
      // A new Line chart is our whole-home, live-energy default. Prefer a
      // viable power measurement if the Energy Dashboard source cannot be
      // resolved, then retain environmental measurements as a useful fallback.
      if (deviceClass === "power" || Boolean(powerUnit(unit))) return 120;
      return stateClass === "measurement" ? (["temperature", "humidity", "carbon_dioxide", "pm25", "aqi"].includes(deviceClass) ? 100 : 50) : -1;
    };
    return candidates.map((entry) => ({ entry, score: score(entry) })).filter((item) => item.score >= 0)
      .sort((left, right) => right.score - left.score || this._entityName(left.entry[0]).localeCompare(this._entityName(right.entry[0])) || left.entry[0].localeCompare(right.entry[0]))[0]?.entry[0];
  }

  private _chartCacheKey(): string {
    const chart = this._config?.chart ?? {};
    return JSON.stringify({ chart, source: this._chartSource(chart) });
  }

  private _ensureChartHistory(force = false) {
    if (this._config?.profile !== "chart" || !this.hass) return;
    const multi = this._config.chart?.type === "multi_line";
    if (!multi && !this._config.chart?.entity && !this._energyPreferencesLoaded) {
      this._chartLoading = true;
      this.requestUpdate();
      return;
    }
    const key = this._chartCacheKey();
    const keyChanged = this._chartKey !== key;
    if (!force && this._chartKey === key && (multi ? this._multiChartHistory : this._chartHistory)) return;
    if (keyChanged && this._chartRetryTimer !== undefined) {
      window.clearTimeout(this._chartRetryTimer);
      this._chartRetryTimer = undefined;
      this._chartRetriedKey = undefined;
    }
    this._chartKey = key;
    const request = ++this._chartRequest;
    const chart = this._config.chart ?? {};
    const source = this._chartSource(chart);
    this._chartLoading = true;
    // Keep an established plot visible while its periodic refresh is in flight,
    // but never let a previous source masquerade as the newly chosen one.
    if (keyChanged) { this._chartHistory = undefined; this._multiChartHistory = undefined; }
    const requestHistory = multi
      ? fetchMultiChartHistory(this.hass, chart).then((histories) => ({ points: histories.flatMap((history) => history.points), unit: histories[0]?.unit, sourceEntity: histories[0]?.entity, multi: histories }))
      : fetchChartHistory(this.hass, chart, source);
    requestHistory.then((history) => {
      if (request !== this._chartRequest || this._chartKey !== key) return;
      this._chartHistory = { points: history.points, unit: history.unit, sourceEntity: history.sourceEntity };
      this._multiChartHistory = "multi" in history && Array.isArray(history.multi) ? history.multi as MultiChartHistory[] : undefined;
      // Recorder can briefly answer an empty history query while Home Assistant
      // is still bringing the dashboard connection up. Retry that one initial
      // response automatically; a settled empty result remains honest.
      const mayRetry = !history.points.length && (multi ? Boolean(chart.entities?.length) : Boolean(source.entity ?? source.importEntity)) && this._chartRetriedKey !== key;
      this._chartLoading = mayRetry;
      if (mayRetry) {
        this._chartRetriedKey = key;
        this._chartRetryTimer = window.setTimeout(() => {
          this._chartRetryTimer = undefined;
          this._ensureChartHistory(true);
        }, 1500);
      }
      this.requestUpdate();
      if (this._chartRefreshTimer !== undefined) window.clearTimeout(this._chartRefreshTimer);
      const refresh = rangeMilliseconds(chart.range, chart.type ?? "line", chart.hours_to_show) <= 48 * 3_600_000 ? 5 * 60_000 : 15 * 60_000;
      this._chartRefreshTimer = window.setTimeout(() => this._ensureChartHistory(true), refresh);
    });
  }

  private _chartLivePoints(): ChartHistory {
    const chart = this._config?.chart ?? {};
    const history = this._chartHistory ?? { points: [] };
    // A current live value may extend real history, but is not itself a chart.
    // This preserves the explicit, calm unavailable-history state.
    if (!history.points.length) return history;
    // Daily totals have already been converted from a cumulative recorder
    // series into per-day deltas. Appending the raw live total here would turn
    // today into one enormous, incorrect final bar.
    if (chart.type === "daily_totals") return history;
    const source = this._chartSource(chart);
    const live = source.entity ? liveNumericState(this.hass?.states[source.entity]) : source.importEntity ? (liveNumericState(this.hass?.states[source.importEntity]) ?? 0) - (liveNumericState(this.hass?.states[source.exportEntity ?? ""]) ?? 0) : undefined;
    if (live === undefined) return history;
    const now = Date.now();
    const points = [...history.points.filter((point) => now - point.time < rangeMilliseconds(chart.range, chart.type ?? "line", chart.hours_to_show)), { time: now, value: live }];
    return { ...history, points };
  }

  private _chartSeries(chart = this._config?.chart ?? {}): ChartSeriesConfig[] {
    const seen = new Set<string>();
    return (chart.entities ?? []).filter((series) => series.entity && !seen.has(series.entity) && Boolean(seen.add(series.entity))).slice(0, 3);
  }

  private _multiChartLiveHistories(): MultiChartHistory[] {
    const chart = this._config?.chart ?? {};
    const now = Date.now();
    const range = rangeMilliseconds(chart.range, "multi_line", chart.hours_to_show);
    return this._chartSeries(chart).map((series) => {
      const history = this._multiChartHistory?.find((item) => item.entity === series.entity) ?? { entity: series.entity, points: [], unit: String(this.hass?.states[series.entity]?.attributes.unit_of_measurement ?? "") };
      if (!history.points.length) return history;
      const live = liveNumericState(this.hass?.states[series.entity]);
      return live === undefined ? history : { ...history, points: [...history.points.filter((point) => now - point.time < range), { time: now, value: live }] };
    });
  }

  private _seriesUnitMismatch(): string | undefined {
    const units = [...new Set(this._chartSeries().map((series) => String(this.hass?.states[series.entity]?.attributes.unit_of_measurement ?? "")).filter(Boolean))];
    return units.length > 1 ? `Selected entities use different units (${units.join(", ")}). Choose compatible measurements.` : undefined;
  }

  private _seriesColour(index: number, series: ChartSeriesConfig): string {
    return series.color ?? ["#3b82f6", "#e85d20", "#35a34a"][index] ?? "#7c5ce6";
  }

  /** Live state is the authoritative summary for a continuous chart. */
  private _chartLiveValue(chart = this._config?.chart ?? {}): number | undefined {
    if (chart.type === "daily_totals") return undefined;
    const source = this._chartSource(chart);
    if (source.entity) return liveNumericState(this.hass?.states[source.entity]);
    if (source.importEntity) {
      const imported = liveNumericState(this.hass?.states[source.importEntity]);
      const exported = source.exportEntity ? liveNumericState(this.hass?.states[source.exportEntity]) : 0;
      return imported === undefined ? undefined : imported - (exported ?? 0);
    }
    return undefined;
  }

  private _chartTitle() {
    const chart = this._config?.chart ?? {};
    // The shared card title is the primary chart-header override. The older
    // chart.title field remains a YAML-compatible fallback.
    if (this._config?.title) return this._config.title;
    if (chart.title) return chart.title;
    if (chart.type === "multi_line") return "Multiple sensors";
    const source = this._chartSource(chart);
    const energySource = chart.energy_source ?? suggestedEnergyChartSource(this._energyPreferences, this.hass, chart.type ?? "line");
    if (energySource === "grid") return "Grid";
    if (energySource === "solar") return "Solar";
    if (energySource === "battery_soc") return "Battery";
    if (energySource === "battery_power") return "Battery flow";
    // Entity names are the most useful default for a single-source chart.
    return source.entity ? this._entityName(source.entity) : "Chart";
  }

  private _chartSummary(history: ChartHistory): string {
    const chart = this._config?.chart ?? {};
    if (chart.summary) return chart.summary;
    const live = this._chartLiveValue(chart);
    if (live !== undefined) {
      const source = this._chartSource(chart);
      const liveUnit = source.entity
        ? String(this.hass?.states[source.entity]?.attributes.unit_of_measurement ?? "")
        : source.importEntity ? String(this.hass?.states[source.importEntity]?.attributes.unit_of_measurement ?? "") : "";
      const unit = chart.unit ?? liveUnit;
      const decimals = chart.decimals ?? (unit === "W" || unit === "%" ? 0 : 1);
      return `${live.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals })}${unit ? ` ${unit}` : ""}`;
    }
    const points = history.points;
    if (!points.length) return this._chartLoading ? "Loading history…" : "History unavailable";
    // A daily-total chart's header answers "what is today so far?"; the bars
    // already provide the historical context, so do not sum the displayed range.
    const value = chart.type === "daily_totals" ? points.at(-1)!.value : this._chartLiveValue(chart) ?? points.at(-1)!.value;
    const unit = chart.unit ?? history.unit ?? "";
    const decimals = chart.decimals ?? (unit === "W" || unit === "%" ? 0 : 1);
    return `${value.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals })}${unit ? ` ${unit}` : ""}`;
  }

  private _chartHours(chart = this._config?.chart ?? {}): number {
    return rangeMilliseconds(chart.range, chart.type ?? "line", chart.hours_to_show) / 3_600_000;
  }

  private _chartRangeLabel(chart = this._config?.chart ?? {}): string {
    const hours = this._chartHours(chart);
    return hours >= 48 && hours % 24 === 0 ? `${hours / 24}d` : `${hours}h`;
  }

  /** The daily reference uses exactly the bars the reader can see, including
   * today's in-progress total. It is deliberately not a rolling average. */
  private _dailyAverage(history: ChartHistory): number | undefined {
    if (this._config?.chart?.type !== "daily_totals" || !history.points.length) return undefined;
    return history.points.reduce((sum, point) => sum + point.value, 0) / history.points.length;
  }

  private _chartHeaderRange(history: ChartHistory): string {
    const chart = this._config?.chart ?? {};
    const range = this._chartRangeLabel(chart);
    if (chart.type !== "daily_totals" || chart.daily_average !== true || chart.daily_average_header === false) return range;
    const average = this._dailyAverage(history);
    if (average === undefined) return range;
    const unit = chart.unit ?? history.unit ?? "";
    const decimals = chart.decimals ?? (unit === "W" || unit === "%" ? 0 : 1);
    const formatted = average.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
    return `${range} · AVG ${formatted}${unit ? ` ${unit}` : ""}`;
  }

  private _renderMultiLegend() {
    const chart = this._config?.chart ?? {};
    const histories = this._multiChartLiveHistories();
    return html`<span class="chart-legend">${this._chartSeries(chart).map((series, index) => {
      const history = histories.find((item) => item.entity === series.entity);
      const live = liveNumericState(this.hass?.states[series.entity]) ?? history?.points.at(-1)?.value;
      const unit = chart.unit ?? history?.unit ?? String(this.hass?.states[series.entity]?.attributes.unit_of_measurement ?? "");
      const decimals = chart.decimals ?? (unit === "W" || unit === "%" ? 0 : 1);
      const value = live === undefined ? "Unavailable" : `${live.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals })}${unit ? ` ${unit}` : ""}`;
      return html`<span class="chart-legend-item" style=${`--chart-series-colour:${this._seriesColour(index, series)}`}><span class="chart-legend-swatch"></span><span class="chart-legend-label">${series.label || this._entityName(series.entity)}</span><span class="chart-legend-value">${value}</span></span>`;
    })}</span>`;
  }

  /** A multi-line chart is an aggregate: its natural tap target is the same
   * contributor list used by the area-based insight aggregates. */
  private _openMultiChartDetails() {
    const entities = this._chartSeries().map((series) => series.entity);
    this._detail = {
      title: this._chartTitle(),
      subtitle: "Contributing chart entities",
      entities,
      emptyMessage: "No entities are currently contributing to this chart.",
      aggregatePanel: true,
      summary: `${entities.length} included`,
    };
  }

  private _chartClicked(event: Event) {
    event.stopPropagation();
    if (this._config?.chart?.type === "multi_line") {
      this._openMultiChartDetails();
      return;
    }
    const source = this._chartSource();
    this._runAction(this._config, source.entity ?? source.importEntity);
  }

  /** Keep chart axes deliberately small and stable: a complete frame, not a tooltip. */
  private _chartTimeTicks(type: ChartType, range: ChartConfig["range"], start: number, end: number, plotWidth: number) {
    // Daily totals are read as a calendar strip. Show each day in a normal
    // seven-day view, but reduce density gracefully before labels collide.
    const requestedDays = Math.max(1, Math.round((end - start) / 86_400_000));
    const dailyCount = plotWidth >= requestedDays * 32 ? requestedDays : Math.min(requestedDays, 4);
    const count = type === "daily_totals" ? dailyCount : 3;
    const duration = end - start;
    return Array.from({ length: count }, (_, index) => {
      const progress = index / Math.max(1, count - 1);
      const time = start + duration * progress;
      let label: string;
      if (type === "daily_totals") {
        label = new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(new Date(time));
      } else {
        // Follow the Band Graph card's range-derived labels rather than a
        // hard-coded 24-hour clock. This remains truthful for 6h, 48h and 7d.
        const hoursAgo = (duration / 3_600_000) * (1 - progress);
        if (index === count - 1 || hoursAgo < .2) label = "now";
        else if (hoursAgo >= 48 && Math.round(hoursAgo) % 24 === 0) label = `${Math.round(hoursAgo / 24)}d`;
        else label = `${Math.round(hoursAgo * 10) / 10}h`;
      }
      return { x: plotWidth * progress, label, anchor: index === 0 ? "start" : index === count - 1 ? "end" : "middle", weekend: false };
    });
  }

  /** Daily totals are anchored to their actual bars, never to a synthetic range. */
  private _dailyTotalTicks(points: { x: number; time: number }[], plotWidth: number) {
    const count = points.length;
    const weekday = new Intl.DateTimeFormat(undefined, { weekday: plotWidth / Math.max(count, 1) >= 48 ? "short" : "narrow" });
    const day = new Intl.DateTimeFormat(undefined, { day: "numeric" });
    const stride = count <= 10 ? 1 : Math.max(2, Math.ceil(count / 6));
    return points.flatMap((point, index) => {
      const date = new Date(point.time);
      const weekend = date.getDay() === 0 || date.getDay() === 6;
      const show = count <= 10 || index === 0 || index === count - 1 || index % stride === 0;
      if (!show) return [];
      return [{
        x: point.x,
        label: count <= 10 ? weekday.format(date) : day.format(date),
        anchor: "middle" as const,
        weekend,
      }];
    });
  }

  private _renderMultiChart() {
    const chart = this._config?.chart ?? {};
    const series = this._chartSeries(chart);
    const mismatch = this._seriesUnitMismatch();
    if (mismatch) return html`<div class="chart-empty">${mismatch}</div>`;
    const histories = this._multiChartLiveHistories();
    const end = Date.now();
    const start = end - rangeMilliseconds(chart.range, "multi_line", chart.hours_to_show);
    const allNonNegative = histories.every((history) => history.points.every((point) => point.value >= 0));
    const display = chart.multi_display === "stacked" && allNonNegative ? "stacked" : "overlap";
    const svgWidth = this._chartPlotWidth;
    const svgHeight = this._chartPlotHeight;
    const margin = { left: 18, right: 8, top: 13, bottom: 26 };
    const plotWidth = Math.max(120, svgWidth - margin.left - margin.right);
    const plotHeight = svgHeight - margin.top - margin.bottom;
    const geometry = multiChartGeometry(histories.map((history) => history.points), plotWidth, plotHeight, { start, end }, display, { min: chart.axis_min, max: chart.axis_max });
    if (!geometry) return html`<div class="chart-empty">${this._chartLoading ? "Loading historyâ€¦" : "History unavailable"}</div>`;
    const formatAxis = (value: number) => Math.abs(value) >= 1000 ? `${Math.round(value / 1000)}k` : Math.round(value).toLocaleString(undefined, { maximumFractionDigits: 0, useGrouping: false });
    const ticks = this._chartTimeTicks("multi_line", chart.range, start, end, plotWidth);
    const scaleTicks = [
      { value: geometry.max, y: 5 },
      { value: (geometry.max + geometry.min) / 2, y: plotHeight / 2 + 4 },
      { value: geometry.min, y: plotHeight - 2 },
    ];
    const gridLines = chart.grid_lines ?? "none";
    const showVerticalGrid = gridLines === "x" || gridLines === "both";
    const showHorizontalGrid = gridLines === "y" || gridLines === "both";
    const unit = chart.unit ?? histories.find((history) => history.unit)?.unit ?? "";
    return svg`<svg class="chart-svg" width=${svgWidth} height=${svgHeight} viewBox=${`0 0 ${svgWidth} ${svgHeight}`} role="img" aria-label=${`${this._chartTitle()} multi-series history`} preserveAspectRatio="xMinYMid meet">
      <g transform=${`translate(${margin.left} ${margin.top})`}>
        ${showHorizontalGrid ? scaleTicks.slice(0, -1).map((tick) => svg`<line class="chart-grid" x1="0" y1=${Math.max(0, tick.y - (tick.y === 5 ? 5 : 4))} x2=${plotWidth} y2=${Math.max(0, tick.y - (tick.y === 5 ? 5 : 4))}></line>`) : nothing}
        ${showVerticalGrid ? ticks.filter((tick) => tick.x > 0 && tick.x < plotWidth).map((tick) => svg`<line class="chart-grid" x1=${tick.x} y1="0" x2=${tick.x} y2=${plotHeight}></line>`) : nothing}
        <line class="chart-axis chart-y-axis" x1="0" y1="0" x2="0" y2=${plotHeight}></line><line class="chart-axis" x1="0" y1=${plotHeight} x2=${plotWidth} y2=${plotHeight}></line>
        ${geometry.min < 0 ? svg`<line class="chart-zero" x1="0" y1=${geometry.baseline} x2=${plotWidth} y2=${geometry.baseline}></line>` : nothing}
        ${geometry.series.map((shape, index) => svg`${shape.areaPath ? svg`<path class="chart-area multi" style=${`fill:${this._seriesColour(index, series[index])}`} d=${shape.areaPath}></path>` : nothing}<path class="chart-line multi" style=${`stroke:${this._seriesColour(index, series[index])}`} d=${shape.path}></path>`)}
        ${scaleTicks.map((tick) => svg`<text class="chart-scale" x="-8" y=${tick.y} text-anchor="end">${formatAxis(tick.value)}</text>`)}
        ${unit ? svg`<text class="chart-unit" x=${plotWidth} y="7" text-anchor="end">${unit}</text>` : nothing}
        ${ticks.map((tick) => svg`<text class="chart-tick" x=${tick.x} y=${plotHeight + 20} text-anchor=${tick.anchor}>${tick.label}</text>`)}
      </g>
    </svg>`;
  }

  private _renderChart() {
    const chart = this._config?.chart ?? {};
    const type = chart.type ?? "line";
    if (type === "multi_line") return this._renderMultiChart();
    // `area` remains a supported legacy type; the editor now presents one
    // continuous chart with a simple filled/unfilled display choice.
    const filled = type === "area" || (type === "line" && chart.show_area !== false);
    const history = this._chartLivePoints();
    let points = history.points;
    const end = Date.now();
    const start = end - rangeMilliseconds(chart.range, type, chart.hours_to_show);
    if (type === "columns") {
      points = bucketPoints(points, start, end, 3_600_000, chart.bucket_statistic ?? "mean");
    }
    // Recorder returns state changes, rather than a point for every instant.
    // A first known value holds from the requested start until it changes, and
    // the last known value holds until now. Render those honest boundaries so
    // sparse history does not look like it has been accidentally cropped.
    if ((type === "line" || type === "area") && points.length) {
      const bounded = points.filter((point) => point.time >= start && point.time <= end);
      if (bounded.length) {
        if (bounded[0].time > start) bounded.unshift({ time: start, value: bounded[0].value });
        if (bounded.at(-1)!.time < end) bounded.push({ time: end, value: bounded.at(-1)!.value });
        points = bounded;
      }
    }
    // Match the SVG viewBox to the measured wrapper width. This deliberately
    // avoids preserveAspectRatio="none", which squeezes text while Sections
    // finishes distributing its columns.
    const svgWidth = this._chartPlotWidth;
    const svgHeight = this._chartPlotHeight;
    // Let scale labels extend into the header gutter so the actual plot begins
    // closer to the same visual division used by ordinary insight cards.
    const margin = { left: 18, right: 8, top: 13, bottom: 26 };
    const plotWidth = Math.max(120, svgWidth - margin.left - margin.right);
    const plotHeight = svgHeight - margin.top - margin.bottom;
    const geometry = chartGeometry(points, type, plotWidth, plotHeight, { start, end }, filled, { min: chart.axis_min, max: chart.axis_max });
    const unit = chart.unit ?? history.unit ?? "";
    if (!geometry) return html`<div class="chart-empty">${this._chartLoading ? "Loading history…" : "History unavailable"}</div>`;
    // Axis labels are intentionally terse. With the unit already in the
    // top-right, a 5,000 W scale can simply read “5k”, not “5000 W”.
    const formatAxis = (value: number) => Math.abs(value) >= 1000
      ? `${Math.round(value / 1000)}k`
      : Math.round(value).toLocaleString(undefined, { maximumFractionDigits: 0, useGrouping: false });
    const timeTicks = type === "daily_totals"
      ? this._dailyTotalTicks(geometry.points, plotWidth)
      : this._chartTimeTicks(type, chart.range, start, end, plotWidth);
    // Keep short daily reports readable as numbers, not merely a shape. Ten
    // bars still have enough room at the normal chart span; longer strips stay quiet.
    const showDailyBarValues = type === "daily_totals" && geometry.bars.length <= 10 && plotWidth / Math.max(geometry.bars.length, 1) >= 30;
    const dailyValueDecimals = chart.decimals ?? (unit === "W" || unit === "%" ? 0 : 1);
    const formatDailyValue = (value: number) => value.toLocaleString(undefined, {
      maximumFractionDigits: dailyValueDecimals,
      minimumFractionDigits: dailyValueDecimals,
      useGrouping: false,
    });
    const scaleTicks = [
      { value: geometry.max, y: 5 },
      { value: (geometry.max + geometry.min) / 2, y: plotHeight / 2 + 4 },
      { value: geometry.min, y: plotHeight - 2 },
    ];
    const gridLines = chart.grid_lines ?? "none";
    const showVerticalGrid = (type === "line" || type === "area") && (gridLines === "x" || gridLines === "both");
    const showHorizontalGrid = (type === "line" || type === "area") && (gridLines === "y" || gridLines === "both");
    const showDailyHorizontalGrid = type === "daily_totals" && chart.daily_horizontal_grid === true;
    // `week_end` shipped first, so continue to honour it. The editor now
    // presents the more familiar positive choice: Monday- or Sunday-start.
    const weekEnd = chart.week_start === "sunday" ? "saturday" : chart.week_start === "monday" ? "sunday" : chart.week_end ?? "sunday";
    // Daily bars already provide their own rhythm. A single divider at the
    // selected week boundary is clearer than applying a dense vertical grid.
    const dailyWeekDividers = type === "daily_totals" && chart.daily_week_dividers
      ? geometry.bars.flatMap((bar, index) => {
        const date = new Date(geometry.points[index]?.time ?? end);
        const boundaryDay = weekEnd === "saturday" ? 6 : 0;
        if (date.getDay() !== boundaryDay) return [];
        const next = geometry.bars[index + 1];
        const x = next ? (bar.x + bar.width + next.x) / 2 : Math.min(plotWidth, bar.x + bar.width + (plotWidth - (bar.x + bar.width)) / 2);
        return x > 0 && x < plotWidth ? [x] : [];
      })
      : [];
    const dailyAverage = type === "daily_totals" && chart.daily_average === true && geometry.points.length
      ? geometry.points.reduce((sum, point) => sum + point.value, 0) / geometry.points.length
      : undefined;
    const dailyAverageY = dailyAverage === undefined
      ? undefined
      : Math.max(0, Math.min(plotHeight, plotHeight - ((dailyAverage - geometry.min) / (geometry.max - geometry.min)) * plotHeight));
    const dailyAverageStyle = chart.daily_average_style ?? "dashed";
    const dailyAverageThickness = Math.max(1, Math.min(4, Number(chart.daily_average_thickness ?? 1)));
    const positiveClip = `${this._chartSvgId}-positive`;
    const negativeClip = `${this._chartSvgId}-negative`;
    const barOpacity = Math.max(20, Math.min(100, Number(chart.bar_opacity ?? 100)));
    const chartColours = `--area-glance-chart-positive:${chart.positive_color ?? "var(--primary-text-color)"};--area-glance-chart-negative:${chart.negative_color ?? "var(--orange-color, #e85d20)"};--area-glance-chart-daily-primary:${chart.daily_primary_color ?? "#6b7280"};--area-glance-chart-weekend:${chart.weekend_color ?? "#4f555b"};--area-glance-chart-today:${chart.today_color ?? "var(--orange-color, #e85d20)"};--area-glance-chart-average:${chart.daily_average_color ?? "var(--primary-color)"};--area-glance-chart-average-width:${dailyAverageThickness}px;--area-glance-chart-bar-opacity:${barOpacity / 100};`;
    const continuousShape = filled
      ? svg`<path class="chart-area positive" clip-path=${`url(#${positiveClip})`} d=${geometry.areaPath}></path><path class="chart-area negative" clip-path=${`url(#${negativeClip})`} d=${geometry.areaPath}></path><path class="chart-line positive" clip-path=${`url(#${positiveClip})`} d=${geometry.path}></path><path class="chart-line negative" clip-path=${`url(#${negativeClip})`} d=${geometry.path}></path>`
      : svg`<path class="chart-line positive" clip-path=${`url(#${positiveClip})`} d=${geometry.path}></path><path class="chart-line negative" clip-path=${`url(#${negativeClip})`} d=${geometry.path}></path>`;
    return svg`<svg class="chart-svg" style=${chartColours} width=${svgWidth} height=${svgHeight} viewBox=${`0 0 ${svgWidth} ${svgHeight}`} role="img" aria-label=${`${this._chartTitle()} history`} preserveAspectRatio="xMinYMid meet">
      <g transform=${`translate(${margin.left} ${margin.top})`}>
      <defs><clipPath id=${positiveClip}><rect x="0" y="0" width=${plotWidth} height=${Math.max(0, geometry.baseline)}></rect></clipPath><clipPath id=${negativeClip}><rect x="0" y=${geometry.baseline} width=${plotWidth} height=${Math.max(0, plotHeight - geometry.baseline)}></rect></clipPath></defs>
      ${showHorizontalGrid ? scaleTicks.slice(0, -1).map((tick) => svg`<line class="chart-grid" x1="0" y1=${Math.max(0, tick.y - (tick.y === 5 ? 5 : 4))} x2=${plotWidth} y2=${Math.max(0, tick.y - (tick.y === 5 ? 5 : 4))}></line>`) : nothing}
      ${showDailyHorizontalGrid ? scaleTicks.slice(0, -1).map((tick) => svg`<line class="chart-grid" x1="0" y1=${Math.max(0, tick.y - (tick.y === 5 ? 5 : 4))} x2=${plotWidth} y2=${Math.max(0, tick.y - (tick.y === 5 ? 5 : 4))}></line>`) : nothing}
      ${showVerticalGrid ? timeTicks.filter((tick) => tick.x > 0 && tick.x < plotWidth).map((tick) => svg`<line class="chart-grid" x1=${tick.x} y1="0" x2=${tick.x} y2=${plotHeight}></line>`) : nothing}
      ${dailyWeekDividers.map((x) => svg`<line class="chart-grid chart-week-divider" x1=${x} y1="0" x2=${x} y2=${plotHeight}></line>`)}
      <!-- The average is a continuous background reference; foreground text has its own small halo. -->
      ${dailyAverageY === undefined ? nothing : svg`<line class=${`chart-average-line ${dailyAverageStyle}`} x1="0" y1=${dailyAverageY} x2=${plotWidth} y2=${dailyAverageY}></line>`}
      <line class="chart-axis chart-y-axis" x1="0" y1="0" x2="0" y2=${plotHeight}></line><line class="chart-axis" x1="0" y1=${plotHeight} x2=${plotWidth} y2=${plotHeight}></line>
      ${(filled || type === "columns" || type === "daily_totals" || geometry.min < 0) ? svg`<line class="chart-zero" x1="0" y1=${geometry.baseline} x2=${plotWidth} y2=${geometry.baseline}></line>` : nothing}
      ${type === "columns" || type === "daily_totals" ? geometry.bars.map((bar, index) => {
        const current = type === "daily_totals" && index === geometry.bars.length - 1;
        const date = new Date(geometry.points[index]?.time ?? end);
        const weekend = type === "daily_totals" && !current && (date.getDay() === 0 || date.getDay() === 6);
        return svg`<rect class=${`chart-bar${type === "daily_totals" ? " daily" : ""}${bar.negative ? " negative" : ""}${weekend ? " weekend" : ""}${current ? " current" : ""}`} x=${bar.x} y=${bar.y} width=${bar.width} height=${bar.height}></rect>${showDailyBarValues ? svg`<text class=${`chart-bar-value${weekend ? " weekend" : ""}${current ? " current" : ""}`} x=${bar.x + bar.width / 2} y=${Math.max(10, bar.y - 5)} text-anchor="middle">${formatDailyValue(geometry.points[index]?.value ?? 0)}</text>` : nothing}`;
      }) : continuousShape}
      ${timeTicks.map((tick) => svg`<text class=${`chart-tick${tick.weekend ? " weekend" : ""}`} x=${tick.x} y=${plotHeight + 20} text-anchor=${tick.anchor}>${tick.label}</text>`)}
      ${scaleTicks.map((tick) => svg`<text class="chart-scale" x="-7" y=${tick.y} text-anchor="end">${formatAxis(tick.value)}</text>`)}
      ${unit ? svg`<text class="chart-unit" x=${plotWidth} y="5" text-anchor="end">${unit}</text>` : nothing}
      </g>
    </svg>`;
  }

  private _energyMetric(metric: MetricConfig): MetricDisplay | undefined {
    const source = metric.energy_source;
    if (!source) return undefined;
    const resolved = resolveEnergyChartSource(this._energyPreferences, this.hass, source);
    // Energy Dashboard readings are deliberately not area aggregates, but
    // their tap sheet should still truthfully expose the configured source(s).
    // Keep that contributor list on the display object used by both rendering
    // and interaction instead of attempting a second, incompatible lookup.
    const withContributors = (resolvedMetric: MetricConfig, entities: (string | undefined)[]) => {
      const display = this._metric(resolvedMetric);
      if (!display) return undefined;
      return { ...display, entities: [...new Set(entities.filter((entity): entity is string => Boolean(entity)))], aggregate: true };
    };
    if (source === "grid") {
      const importEntity = resolved.importEntity;
      const exportEntity = resolved.exportEntity;
      const importValue = asNumber(this.hass?.states[importEntity ?? ""]?.state ?? "");
      const exportValue = asNumber(this.hass?.states[exportEntity ?? ""]?.state ?? "");
      const exporting = exportValue !== undefined && Math.abs(exportValue) > Math.abs(importValue ?? 0);
      const entity = exporting ? exportEntity : importEntity;
      if (!entity) return undefined;
      return withContributors({ ...metric, energy_source: undefined, entity, source: "entity", label: metric.label_mode === "custom" ? metric.label : exporting ? "Export" : "Import", icon: metric.icon ?? (exporting ? "mdi:transmission-tower-export" : "mdi:transmission-tower-import") }, [importEntity, exportEntity]);
    }
    const entity = resolved.entity;
    if (!entity) return undefined;
    return withContributors({ ...metric, energy_source: undefined, entity, source: "entity" }, [entity]);
  }

  private _resolvedArea(area?: AreaReference): string | undefined {
    return resolvedAreaId(this.hass, area);
  }

  private _areaName(area?: AreaReference): string | undefined {
    const resolved = this._resolvedArea(area);
    if (!resolved) {
      const resolution = resolveAreaReference(this.hass, area);
      return resolution.unavailable ? `Showcase area ${resolution.showcaseSlot} unavailable` : undefined;
    }
    return this.hass?.areas?.[resolved]?.name ?? resolved.replaceAll("_", " ").replace(/\b\w/g, (l) => l.toUpperCase());
  }

  private _headerAreaIcon(title: string): string {
    const configured = this._config?.appearance?.area_icon;
    if (configured) return configured;
    const profile = this._config?.profile;
    if (profile === "house") return "mdi:home-outline";
    if (profile === "energy" || profile === "battery") return "mdi:lightning-bolt-outline";
    if (profile === "security") return "mdi:shield-home-outline";
    if (profile === "cameras") return "mdi:cctv";
    const name = `${title} ${this._areaName(this._config?.area) ?? ""}`.toLowerCase();
    if (/(living|lounge)/.test(name)) return "mdi:sofa-outline";
    if (/(bed|sleep)/.test(name)) return "mdi:bed-outline";
    if (/(kitchen|cook|dining)/.test(name)) return "mdi:stove";
    if (/(office|study|desk)/.test(name)) return "mdi:desk";
    if (/(bath|shower)/.test(name)) return "mdi:shower";
    if (/(garage|workshop)/.test(name)) return "mdi:garage-variant";
    if (/(garden|outside|outdoor|patio)/.test(name)) return "mdi:tree-outline";
    return "mdi:map-marker-radius-outline";
  }

  private _areaEntities(area: AreaReference | undefined, domain?: string): string[] {
    const resolution = resolveAreaReference(this.hass, area);
    // A missing showcase slot must not accidentally become a whole-home
    // aggregate merely because it has no corresponding area ID.
    if (resolution.unavailable) return [];
    return areaEntityIds(this.hass, resolution.areaId, domain);
  }

  private _metricSource(metric: MetricConfig, preset: MetricPreset): "area" | "entity" | "entities" {
    if (preset === "attention") return "area";
    if (preset === "weather" || preset === "clock" || preset === "calendar") return "entity";
    if (preset === "lights" || (AREA_SIGNAL_PRESETS.has(preset) && preset !== "blinds")) return metric.source ?? "area";
    return metric.source ?? (metric.entity ? "entity" : AREA_MEASUREMENT_PRESETS.has(preset) || preset === "blinds" ? "area" : "entity");
  }

  private _aggregateEntityIds(metric: MetricConfig, preset: MetricPreset, area?: AreaReference): string[] {
    return this._metricSource(metric, preset) === "entities"
      ? metric.entities ?? []
      : this._areaEntities(area, preset === "lights" ? metric.domain ?? "light" : undefined);
  }

  private _areaSignalSummary(area: AreaReference | undefined, signal: AreaSignal, metric?: MetricConfig): AreaSignalSummary {
    const candidates = this._aggregateEntityIds(metric ?? {}, metric?.preset ?? signal, area)
      .map((entityId) => ({ entityId, state: this.hass?.states[entityId] }))
      .filter((entry): entry is { entityId: string; state: EntityState } => entry.state !== undefined && !UNAVAILABLE.has(entry.state.state) && isSignalEntity(signal, entry.entityId, entry.state));
    const included = new Set(metric && this._metricSource(metric, metric.preset ?? signal) === "area" ? includedEntityIds(metric, candidates.map((entry) => entry.entityId)) : candidates.map((entry) => entry.entityId));
    const entities = candidates.filter((entry) => included.has(entry.entityId));
    const active = entities.filter((entry) => isSignalActive(signal, entry.entityId, entry.state));
    const latest = entities.reduce<EntityState | undefined>((newest, entry) => !newest || new Date(entry.state.last_changed) > new Date(newest.last_changed) ? entry.state : newest, undefined);
    return { entities, active, latest };
  }

  /**
   * A Security header is a summary of the visible security insights. When it
   * has no explicit membership of its own, inherit the matching area insight's
   * exclusions so “Doors: Closed” cannot sit beside “1 opening”.
   */
  private _securityMembership(preset: MetricPreset, area: AreaReference | undefined, statusMembership?: StatusConfig["membership"]): StatusConfig["membership"] {
    if (statusMembership) return statusMembership;
    const metric = this._config?.metrics?.find((candidate) => candidate.preset === preset
      && this._metricSource(candidate, preset) === "area"
      && this._resolvedArea(candidate.area ?? this._config?.area) === this._resolvedArea(area));
    return metric?.membership;
  }

  private _securitySummary(area: AreaReference | undefined = this._config?.area, membership?: StatusConfig["membership"]): SecuritySummary {
    const membershipMetric = (preset: MetricPreset): MetricConfig => ({ preset, source: "area", membership: this._securityMembership(preset, area, membership) });
    const alarmCandidates = this._areaEntities(area)
      .map((entityId) => ({ entityId, state: this.hass?.states[entityId] }))
      .filter((entry): entry is { entityId: string; state: EntityState } => entry.state !== undefined && !UNAVAILABLE.has(entry.state.state) && isAlarmEntity(entry.entityId));
    const alarmIds = new Set(includedEntityIds(membershipMetric("alarm"), alarmCandidates.map((entry) => entry.entityId)));
    return {
      alarms: alarmCandidates.filter((entry) => alarmIds.has(entry.entityId)),
      doors: this._areaSignalSummary(area, "doors", membershipMetric("doors")),
      windows: this._areaSignalSummary(area, "windows", membershipMetric("windows")),
      locks: this._areaSignalSummary(area, "locks", membershipMetric("locks")),
    };
  }

  private _areaSignalMetric(metric: MetricConfig, signal: AreaSignal, label: string, icon: string): MetricDisplay {
    const area = metric.area ?? this._config?.area;
    const color = metric.color ?? PRESETS[signal].color;
    const summary = this._areaSignalSummary(area, signal, metric);
    if (!summary.entities.length) return { icon, color: metric.color ?? "var(--disabled-text-color)", value: "–", label };
    const entityIds = summary.entities.map((entry) => entry.entityId);
    if (signal === "motion") {
      if (summary.active.length) return { icon, color: metric.color ?? "var(--amber-color, #ff9800)", value: "Active", label, entities: entityIds, aggregate: true };
      return { icon, color, value: summary.latest ? stateAge(summary.latest.last_changed).replace(" ago", "") : "–", label: "Last motion", entities: entityIds, aggregate: true };
    }
    if (signal === "presence") return { icon, color, value: summary.active.length ? "Occupied" : "Clear", label, entities: entityIds, aggregate: true };
    if (signal === "leaks") {
      return { icon, color: metric.color ?? (summary.active.length ? "var(--error-color, #db4437)" : "var(--success-color, #2eaa45)"), value: summary.active.length ? "Leak!" : "Dry", label, entities: entityIds, aggregate: true };
    }
    if (signal === "locks") {
      return { icon, color: metric.color ?? (summary.active.length ? "var(--warning-color, #e0af00)" : "var(--success-color, #2eaa45)"), value: summary.active.length ? `${summary.active.length} unlocked` : "Locked", label, entities: entityIds, aggregate: true };
    }
    if (signal === "blinds") {
      return { icon, color: metric.color ?? (summary.active.length ? "var(--info-color, #3f8cff)" : "var(--success-color, #2eaa45)"), value: summary.active.length ? `${summary.active.length}/${summary.entities.length} open` : "Closed", label, entities: entityIds, aggregate: true };
    }
    const noun = signal === "doors" ? "Doors" : "Windows";
    return { icon, color: metric.color ?? (summary.active.length ? "var(--warning-color, #e0af00)" : "var(--success-color, #2eaa45)"), value: summary.active.length ? `${summary.active.length} open` : "Closed", label: metric.label ?? noun, entities: entityIds, aggregate: true };
  }

  private _thresholdColor(metric: MetricConfig, value: number | undefined, fallback: string): string {
    if (value === undefined) return fallback;
    const rule = metric.thresholds?.find((candidate) => candidate.color.trim()
      && (candidate.above === undefined || value >= candidate.above)
      && (candidate.below === undefined || value <= candidate.below));
    return rule?.color.trim() || fallback;
  }

  private _attentionMetric(metric: MetricConfig, label: string, icon: string): MetricDisplay {
    const wholeHome = metric.attention_scope === "home";
    const area = wholeHome ? undefined : metric.area ?? this._config?.area;
    const types = attentionTypes(metric);
    const candidates = includedEntityIds(metric, this._areaEntities(area));
    const unavailable = types.includes("unavailable")
      ? candidates.filter((entityId) => this.hass?.states[entityId]?.state === "unavailable")
      : [];
    const updates = types.includes("updates")
      ? candidates.filter((entityId) => isUpdateEntity(entityId, this.hass?.states[entityId]) && this.hass?.states[entityId]?.state === "on")
      : [];
    const entities = [...new Set([...unavailable, ...updates])];
    const dynamicLabel = (!metric.label || metric.label === PRESETS.attention.label) && metric.label_mode !== "custom"
      ? types.length === 1 ? types[0] === "unavailable" ? "Unavailable" : "Updates" : "Attention"
      : label;
    const count = unavailable.length + updates.length;
    const value = !count ? "None"
      : types.length === 1 && types[0] === "unavailable" ? `${unavailable.length} unavailable`
        : types.length === 1 ? `${updates.length} update${updates.length === 1 ? "" : "s"}`
          : `${count} issue${count === 1 ? "" : "s"}`;
    const color = metric.color ?? (unavailable.length ? "var(--error-color, #db4437)"
      : updates.length ? "var(--warning-color, #e0af00)"
        : "var(--success-color, #2eaa45)");
    return { icon, color, value, label: dynamicLabel, entities, aggregate: true };
  }

  private _areaMetric(metric: MetricConfig, preset: MetricPreset, label: string, icon: string): MetricDisplay {
    const area = metric.area ?? this._config?.area;
    const source = this._metricSource(metric, preset);
    const color = metric.color ?? PRESETS[preset].color;
    const aggregation = metric.aggregation ?? defaultAggregation(preset);
    if (preset === "attention") return this._attentionMetric(metric, label, icon);
    if (AREA_SIGNAL_PRESETS.has(preset)) return this._areaSignalMetric(metric, preset as AreaSignal, label, icon);
    if (preset === "lights") {
      const candidates = this._aggregateEntityIds(metric, preset, area);
      const lights = source === "area" ? includedEntityIds(metric, candidates) : candidates;
      const on = lights.filter((id) => this.hass?.states[id]?.state === "on").length;
      return { icon, color: this._thresholdColor(metric, on, color), value: `${on}/${lights.length}`, label, entities: lights, aggregate: true };
    }
    const candidates = this._aggregateEntityIds(metric, preset, area).map((entityId) => ({ entityId, state: this.hass?.states[entityId], value: asNumber(this.hass?.states[entityId]?.state ?? "") }))
      .filter((item) => isAreaMeasurement(preset, item.entityId, item.state) && item.value !== undefined && item.state && !UNAVAILABLE.has(item.state.state)) as { entityId: string; state: EntityState; value: number }[];
    const included = new Set(source === "area" ? includedEntityIds(metric, candidates.map((item) => item.entityId)) : candidates.map((item) => item.entityId));
    const values = candidates.filter((item) => included.has(item.entityId));
    if (!values.length) return { icon, color, value: "–", label };

    if (preset === "power") {
      const watts = aggregateValues(values.map((item) => {
        const unit = String(item.state.attributes.unit_of_measurement ?? "W");
        const watts = item.value * (POWER_UNIT_FACTORS[unit] ?? 1);
        return metric.invert_value ? -watts : watts;
      }), aggregation);
      // Four-digit watts remain both more immediate and more compact in a
      // narrow insight segment. Move to kW only once W would need five digits.
      const automaticUnit = Math.abs(watts) >= 1_000_000 ? "MW" : Math.abs(watts) >= 10000 ? "kW" : "W";
      const displayUnit = powerUnit(metric.unit) ?? automaticUnit;
      const displayed = watts / POWER_UNIT_FACTORS[displayUnit];
      const decimals = metric.decimals ?? (displayUnit === "W" ? 0 : 1);
      const unit = metric.show_unit === false ? "" : metric.unit ?? automaticUnit;
      return { icon, color: this._thresholdColor(metric, displayed, color), value: `${displayed.toLocaleString(undefined, { useGrouping: false, maximumFractionDigits: decimals, minimumFractionDigits: decimals })}${unit}`, label, entities: values.map((item) => item.entityId), aggregate: true };
    }

    const compatibleValues = preset === "voc"
      ? Object.values(values.reduce<Record<string, typeof values>>((groups, item) => {
        const key = `${item.state.attributes.device_class ?? ""}|${normalisedUnit(item.state)}`;
        (groups[key] ??= []).push(item);
        return groups;
      }, {})).sort((left, right) => right.length - left.length)[0] ?? values
      : values;
    const rawNumber = aggregateValues(compatibleValues.map((item) => item.value), aggregation);
    const format = metric.format ?? PRESETS[preset].format;
    const inferredUnit = String(compatibleValues[0].state.attributes.unit_of_measurement ?? "");
    const number = preset === "temperature" ? convertTemperature(rawNumber, inferredUnit, metric.unit) : rawNumber;
    const decimals = metric.decimals ?? 0;
    const unit = metric.show_unit === false ? "" : metric.unit ?? (format === "temperature" ? "°" : format === "percent" ? "%" : inferredUnit);
    return { icon, color: this._thresholdColor(metric, number, color), value: `${number.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals })}${unit}`, label, entities: compatibleValues.map((item) => item.entityId), aggregate: true };
  }

  private _entityDisplayValue(entityId?: string): string | undefined {
    const state = entityId ? this.hass?.states[entityId] : undefined;
    if (!state || UNAVAILABLE.has(state.state)) return undefined;
    const number = asNumber(state.state);
    if (number === undefined) return this.hass?.formatEntityState?.(state) ?? friendlyState(state.state);
    const unit = typeof state.attributes.unit_of_measurement === "string" ? state.attributes.unit_of_measurement : "";
    return `${number.toLocaleString(undefined, { maximumFractionDigits: 2 })}${unit}`;
  }

  private _customSupportingText(metric: MetricConfig, fallbackLabel: string): string {
    return this._entityDisplayValue(metric.secondary_entity)
      ?? metric.secondary_text
      ?? (metric.label && metric.label !== PRESETS.custom.label ? metric.label : fallbackLabel);
  }

  private _customColor(metric: MetricConfig, state: EntityState, fallback: string): string {
    const colorState = metric.color_entity ? this.hass?.states[metric.color_entity] : state;
    const stateValue = colorState?.state.trim().toLowerCase();
    const rule = metric.color_rules?.find((candidate) => candidate.state.trim().toLowerCase() === stateValue && candidate.color.trim());
    return rule?.color.trim() || fallback;
  }

  /**
   * Card-wide icon treatments are deliberately only defaults. A configured
   * metric colour, threshold, or state rule is an author's explicit visual
   * decision and must remain visible above the shared treatment.
   */
  private _insightIconColor(metric: MetricConfig, display: MetricDisplay): string | undefined {
    const hasExplicitColor = Boolean(
      metric.color?.trim()
      || metric.thresholds?.some((rule) => rule.color.trim())
      || metric.color_rules?.some((rule) => rule.color.trim()),
    );
    if (hasExplicitColor) return display.color;
    switch (this._config?.appearance?.insight_icon_color ?? "default") {
      case "black": return "var(--primary-text-color)";
      case "grey": return "var(--secondary-text-color)";
      default: return display.color;
    }
  }

  private _clockMetric(metric: MetricConfig, label: string, icon: string): MetricDisplay {
    const now = new Date();
    if (metric.clock_style === "analogue") {
      const minutes = now.getMinutes();
      return {
        icon,
        color: metric.color ?? PRESETS.clock.color,
        value: "",
        label,
        visual: { kind: "analogue-clock", hourAngle: ((now.getHours() % 12) + minutes / 60) * 30, minuteAngle: minutes * 6 },
      };
    }
    return { icon, color: metric.color ?? PRESETS.clock.color, value: now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }), label };
  }

  private _calendarMetric(metric: MetricConfig, label: string, icon: string): MetricDisplay {
    const now = new Date();
    return {
      icon,
      color: metric.color ?? PRESETS.calendar.color,
      value: "",
      label,
      visual: { kind: "calendar", month: now.toLocaleDateString([], { month: "short" }), day: ordinal(now.getDate()) },
    };
  }

  private _weatherMetric(metric: MetricConfig, state: EntityState, label: string, icon: string, color: string): MetricDisplay {
    const display = metric.weather_display ?? "condition";
    const condition = state.state;
    const attributes = state.attributes;
    const values: Record<NonNullable<MetricConfig["weather_display"]>, [unknown, string]> = {
      condition: [friendlyDeviceState("weather", condition), ""],
      temperature: [attributes.temperature ?? attributes.native_temperature, String(attributes.temperature_unit ?? attributes.native_temperature_unit ?? "")],
      apparent_temperature: [attributes.apparent_temperature ?? attributes.native_apparent_temperature, String(attributes.temperature_unit ?? attributes.native_temperature_unit ?? "")],
      humidity: [attributes.humidity, "%"],
      wind_speed: [attributes.wind_speed ?? attributes.native_wind_speed, String(attributes.wind_speed_unit ?? attributes.native_wind_speed_unit ?? "")],
    };
    const [rawValue, unit] = values[display];
    const rawNumber = typeof rawValue === "number" ? rawValue : typeof rawValue === "string" ? asNumber(rawValue) : undefined;
    const number = rawNumber !== undefined && ["temperature", "apparent_temperature"].includes(display)
      ? convertTemperature(rawNumber, unit, metric.unit)
      : rawNumber;
    const value = number === undefined ? String(rawValue ?? "–") : `${number.toLocaleString(undefined, { maximumFractionDigits: metric.decimals ?? 0, minimumFractionDigits: metric.decimals ?? 0 })}${metric.show_unit === false ? "" : metric.unit ?? unit}`;
    const defaultLabels: Partial<Record<NonNullable<MetricConfig["weather_display"]>, string>> = { temperature: "Temp", apparent_temperature: "Feels like", humidity: "Humidity", wind_speed: "Wind" };
    const usesPresetLabel = metric.label_mode !== "custom" && metric.label_mode !== "entity" && (!metric.label || metric.label === PRESETS.weather.label);
    return {
      icon: metric.icon && metric.icon !== PRESETS.weather.icon ? metric.icon : WEATHER_ICONS[condition] ?? icon,
      color: metric.color ?? weatherColor(condition, color),
      value,
      label: display === "condition" ? label : usesPresetLabel ? defaultLabels[display] ?? label : label,
    };
  }

  private _vacuumMetric(metric: MetricConfig, state: EntityState, label: string, icon: string, color: string): MetricDisplay {
    const display = metric.vacuum_display ?? "state";
    const presentation = vacuumPresentation(state.state);
    const battery = asNumber(String(state.attributes.battery_level ?? ""));
    const fanSpeed = state.attributes.fan_speed ?? state.attributes.fan_speed_name;
    const value = display === "battery"
      ? battery === undefined ? "–" : `${battery}%`
      : display === "fan_speed" ? String(fanSpeed ?? "–")
        : friendlyDeviceState("vacuum", state.state);
    const defaultLabel = display === "battery" ? "Battery" : display === "fan_speed" ? "Fan speed" : "Vacuum";
    const usesPresetLabel = metric.label_mode !== "custom" && metric.label_mode !== "entity" && (!metric.label || metric.label === PRESETS.vacuum.label);
    return {
      icon: metric.icon && metric.icon !== PRESETS.vacuum.icon ? metric.icon : presentation.icon ?? icon,
      color: metric.color ?? presentation.color ?? color,
      value,
      label: usesPresetLabel ? defaultLabel : label,
    };
  }

  private _cameraMetric(metric: MetricConfig, entityId: string, state: EntityState, label: string, icon: string, color: string): MetricDisplay {
    const picture = state.attributes.entity_picture;
    if (metric.camera_display !== "feed" || typeof picture !== "string" || !picture.trim()) {
      return { icon, color, value: this.hass?.formatEntityState?.(state) ?? friendlyState(state.state), label };
    }
    // Camera entity pictures are Home Assistant proxy URLs. Refresh a static
    // image at most every 30 seconds without bypassing Home Assistant
    // authentication or depending on internal UI components.
    const separator = picture.includes("?") ? "&" : "?";
    const refreshKey = Math.floor(Date.now() / 30000);
    // Home Assistant serves normal camera images through a proxy URL, while
    // Card Lab (and some integrations) can provide a complete data URI. A
    // query string is useful for the former but corrupts the latter.
    const source = picture.startsWith("data:") ? picture : `${picture}${separator}area_glance=${refreshKey}`;
    return { icon, color, value: "", label, showIcon: false, showLabel: false, visual: { kind: "camera", src: source, alt: label || entityId } };
  }

  private _metric(metric: MetricConfig): MetricDisplay | undefined {
    if (metric.hidden) return undefined;
    if (metric.energy_source) return this._energyMetric(metric);
    const preset = metric.preset ?? "custom";
    const defaults = PRESETS[preset];
    if (preset === "clock") return this._clockMetric(metric, metric.label ?? defaults.label, metric.icon ?? defaults.icon);
    if (preset === "calendar") return this._calendarMetric(metric, metric.label ?? defaults.label, metric.icon ?? defaults.icon);
    const state = metric.entity ? this.hass?.states[metric.entity] : undefined;
    const entityDomain = metric.entity?.split(".")[0];
    // An explicit Unknown icon is also an explicit request to keep that binary
    // sensor visible when its integration has no usable state.
    if (metric.hide_unavailable && state && UNAVAILABLE.has(state.state) && !(entityDomain === "binary_sensor" && metric.icon_unknown)) return undefined;
    const devicePresentation = entityDomain === "media_player" ? { icon: "mdi:television", label: "Media" }
      : entityDomain === "vacuum" ? { icon: "mdi:robot-vacuum", label: "Vacuum" }
      : entityDomain === "camera" ? { icon: "mdi:cctv", label: "Camera" }
      : entityDomain === "weather" ? { icon: "mdi:weather-partly-cloudy", label: "Weather" }
      : entityDomain === "climate" ? { icon: "mdi:thermostat", label: "Climate" }
      : undefined;
    const isLegacyTemperatureLabel = preset === "temperature" && metric.label === "Temperature" && metric.label_mode !== "custom";
    const defaultLabel = preset === "device" && (!metric.label || metric.label === defaults.label)
      ? devicePresentation?.label ?? defaults.label
      : isLegacyTemperatureLabel ? defaults.label : metric.label ?? defaults.label;
    const label = metric.label_mode === "entity" && typeof state?.attributes.friendly_name === "string"
      ? state.attributes.friendly_name
      : defaultLabel;
    const configuredIcon = preset === "device" && (!metric.icon || metric.icon === defaults.icon)
      ? devicePresentation?.icon ?? String(state?.attributes.icon ?? defaults.icon)
      : metric.icon ?? defaults.icon;
    const iconState = metric.icon_entity ? this.hass?.states[metric.icon_entity] : undefined;
    const baseIcon = preset === "custom" && typeof iconState?.attributes.icon === "string"
      ? iconState.attributes.icon
      : configuredIcon;
    const binaryState = state?.state.toLowerCase();
    const icon = entityDomain === "binary_sensor"
      ? !binaryState || UNAVAILABLE.has(binaryState) ? metric.icon_unknown ?? baseIcon
        : binaryState === "on" || binaryState === "true" ? metric.icon_on ?? baseIcon
          : binaryState === "off" || binaryState === "false" ? metric.icon_off ?? baseIcon
            : metric.icon_unknown ?? baseIcon
      : baseIcon;
    const customLabel = preset === "custom" ? this._customSupportingText(metric, label) : label;

    const source = this._metricSource(metric, preset);
    if (source === "area" || source === "entities") return this._areaMetric(metric, preset, label, icon);
    if (source === "entity" && metric.entity && (preset === "lights" || AREA_SIGNAL_PRESETS.has(preset))) {
      return this._areaMetric({ ...metric, source: "entities", entities: [metric.entity] }, preset, label, icon);
    }
    if (!state || UNAVAILABLE.has(state.state)) return { icon, color: metric.color ?? defaults.color, value: "–", label: customLabel };
    if (preset === "weather") return this._weatherMetric(metric, state, label, icon, metric.color ?? defaults.color);
    if (preset === "camera") return this._cameraMetric(metric, metric.entity!, state, label, icon, metric.color ?? defaults.color);
    if (preset === "vacuum") return this._vacuumMetric(metric, state, label, icon, metric.color ?? defaults.color);

    const rawNumber = asNumber(state.state);
    const signedNumber = rawNumber !== undefined && preset === "power" && metric.invert_value ? -rawNumber : rawNumber;
    const format = metric.format ?? defaults.format;
    const inferredUnit = typeof state.attributes.unit_of_measurement === "string" ? state.attributes.unit_of_measurement : "";
    const number = signedNumber === undefined ? undefined
      : preset === "power" ? convertPower(signedNumber, inferredUnit, metric.unit)
        : preset === "temperature" ? convertTemperature(signedNumber, inferredUnit, metric.unit)
          : signedNumber;
    const decimals = metric.decimals ?? (preset === "power" && powerUnit(metric.unit) && metric.unit !== "W" ? 1 : 0);
    let value: string;
    if (number !== undefined) {
      const rendered = number.toLocaleString(undefined, { useGrouping: preset !== "power", maximumFractionDigits: decimals, minimumFractionDigits: decimals });
      const inferredUnit = typeof state.attributes.unit_of_measurement === "string" ? state.attributes.unit_of_measurement : "";
      const unit = metric.show_unit === false ? "" : metric.unit ?? (format === "temperature" ? "°" : format === "percent" ? "%" : inferredUnit);
      value = `${rendered}${unit}`;
    } else if ((preset === "occupancy" || preset === "people_home") && ["on", "off"].includes(state.state)) {
      value = state.state === "on" ? "Home" : "Away";
    } else {
      value = preset === "alarm"
        ? friendlyState(state.state)
        : preset === "device" ? friendlyDeviceState(entityDomain, state.state) : this.hass?.formatEntityState?.(state) ?? friendlyState(state.state);
    }
    let color = metric.color ?? defaults.color;
    if (!metric.color && preset === "alarm") {
      color = isAlarmTriggered(state) ? "var(--error-color, #db4437)"
        : isAlarmArmed(state) ? "var(--success-color, #2eaa45)"
          : state.state === "pending" || state.state === "arming" ? "var(--warning-color, #e0af00)"
            : "var(--secondary-text-color)";
    }
    if (!metric.color && preset === "blinds") {
      color = state.state === "closed" ? "var(--success-color, #2eaa45)"
        : isBlindOpen(state) ? "var(--info-color, #3f8cff)"
          : "var(--secondary-text-color)";
    }
    if (!metric.color && preset === "battery" && number !== undefined) {
      color = number <= 20 ? "var(--error-color, #db4437)" : number <= 50 ? "var(--warning-color, #e0af00)" : "var(--info-color, #3f8cff)";
    }
    if (preset !== "custom") color = this._thresholdColor(metric, number, color);
    if (preset === "custom") color = this._customColor(metric, state, color);
    return { icon, color, value, label: customLabel };
  }

  private _status() {
    const configuredStatus = this._config?.status;
    const config: StatusConfig = configuredStatus ?? {};
    if (config.source === "security") {
      const summary = this._securitySummary(config.area, config.membership);
      const triggered = summary.alarms.find((entry) => isAlarmTriggered(entry.state));
      if (triggered) return { line: "Alarm triggered", age: "", color: config.active_color ?? "var(--error-color, #db4437)" };
      const openCount = summary.doors.active.length + summary.windows.active.length;
      if (openCount) return { line: `${openCount} opening${openCount === 1 ? "" : "s"}`, age: "", color: config.active_color ?? "var(--warning-color, #e0af00)" };
      if (summary.locks.active.length) return { line: `${summary.locks.active.length} unlocked`, age: "", color: config.active_color ?? "var(--warning-color, #e0af00)" };
      const monitoredOpenings = summary.doors.entities.length + summary.windows.entities.length;
      if (monitoredOpenings) return { line: config.inactive_text ?? "All monitored", age: "openings closed", color: config.inactive_color ?? "var(--success-color, #2eaa45)" };
      if (summary.locks.entities.length) return { line: config.inactive_text ?? "All monitored", age: "locks secured", color: config.inactive_color ?? "var(--success-color, #2eaa45)" };
      const armed = summary.alarms.find((entry) => isAlarmArmed(entry.state));
      if (armed) return { line: "Alarm", age: friendlyState(armed.state.state), color: config.inactive_color ?? "var(--success-color, #2eaa45)" };
      return { line: "No monitored", age: "security entities", color: "var(--disabled-text-color)" };
    }
    const signal = statusSignal(config?.source);
    if (signal === "motion") {
      const area = config.area ?? this._config?.area;
      if (!area && this._config?.profile !== "house") return { line: "", age: "", color: "var(--disabled-text-color)" };
      const summary = this._areaSignalSummary(area, signal, { preset: signal, source: "area", membership: config.membership });
      if (!summary.entities.length || !summary.latest) return { line: "", age: "", color: "var(--disabled-text-color)" };
      const active = Boolean(summary.active.length);
      return {
        line: !active && config.show_last_changed ? (config.last_changed_text ?? "Last motion") : active ? (config.active_text ?? "Motion") : (config.inactive_text ?? "No motion"),
        age: config.show_last_changed ? stateAge(summary.latest.last_changed) : "",
        color: active ? (config.active_color ?? "var(--error-color, #db4437)") : (config.inactive_color ?? "var(--success-color, #2eaa45)"),
      };
    }
    if (signal === "doors") {
      const area = config.area ?? this._config?.area;
      if (!area && this._config?.profile !== "house") return { line: "", age: "", color: "var(--disabled-text-color)" };
      const summary = this._areaSignalSummary(area, signal, { preset: signal, source: "area", membership: config.membership });
      if (!summary.entities.length) return { line: "", age: "", color: "var(--disabled-text-color)" };
      const color = summary.active.length ? (config.active_color ?? "var(--warning-color, #e0af00)") : (config.inactive_color ?? "var(--success-color, #2eaa45)");
      if (!summary.active.length) return { line: config.inactive_text ?? "All doors", age: "closed", color };
      return { line: `${summary.active.length} door${summary.active.length === 1 ? "" : "s"} open`, age: "", color };
    }
    if (signal === "presence") {
      const summary = this._areaSignalSummary(config.area ?? this._config?.area, signal, { preset: signal, source: "area", membership: config.membership });
      if (!summary.entities.length) return { line: "", age: "", color: "var(--disabled-text-color)" };
      const active = Boolean(summary.active.length);
      return { line: active ? (config.active_text ?? "Occupied") : (config.inactive_text ?? "Clear"), age: "", color: active ? (config.active_color ?? "var(--success-color, #2eaa45)") : (config.inactive_color ?? "var(--disabled-text-color)") };
    }
    if (signal === "windows" || signal === "leaks") {
      const summary = this._areaSignalSummary(config.area ?? this._config?.area, signal, { preset: signal, source: "area", membership: config.membership });
      if (!summary.entities.length) return { line: "", age: "", color: "var(--disabled-text-color)" };
      const active = Boolean(summary.active.length);
      const activeText = signal === "windows" ? `${summary.active.length} window${summary.active.length === 1 ? "" : "s"} open` : summary.active.length > 1 ? `${summary.active.length} leaks` : "Leak detected";
      return { line: active ? (config.active_text ?? activeText) : (config.inactive_text ?? (signal === "windows" ? "All windows" : "No leaks")), age: active ? "" : (signal === "windows" ? "closed" : "dry"), color: active ? (config.active_color ?? (signal === "leaks" ? "var(--error-color, #db4437)" : "var(--warning-color, #e0af00)")) : (config.inactive_color ?? "var(--success-color, #2eaa45)") };
    }
    const state = config?.entity ? this.hass?.states[config.entity] : undefined;
    if (!configuredStatus || !state) return { line: "", age: "", color: "var(--disabled-text-color)" };
    const active = !["off", "not_home", "closed", "unoccupied", "unavailable", "unknown"].includes(state.state);
    const isMotion = state.attributes.device_class === "motion";
    const inactiveHistoryText = config.last_changed_text ?? (isMotion ? "Last motion" : "Last active");
    return {
      line: !active && config.show_last_changed ? inactiveHistoryText : active ? (config.active_text ?? friendlyState(state.state)) : (config.inactive_text ?? friendlyState(state.state)),
      age: config.show_last_changed ? stateAge(state.last_changed) : "",
      color: active ? (config.active_color ?? "var(--error-color, #db4437)") : (config.inactive_color ?? "var(--success-color, #2eaa45)"),
    };
  }

  private _layoutStyle(metricCount: number) {
    const height = this._heightOption();
    const accent = this._config?.accent_color ? `--area-glance-accent:${this._config.accent_color};` : "";
    const scale = height.scale;
    const stacked = this._config?.layout === "stacked";
    const tower = this._config?.layout === "tower";
    const textScale = this._config?.appearance?.text_scale;
    const percentage = (key: keyof NonNullable<NonNullable<AreaGlanceConfig["appearance"]>["text_scale"]>) =>
      Math.max(0.75, Math.min(1.6, (textScale?.[key] ?? 100) / 100));
    const chartLegacyScale = (key: "x_axis_font_size" | "y_axis_font_size" | "bar_label_font_size", base: number) => {
      const value = this._config?.chart?.[key];
      return Number.isFinite(value) ? Math.max(0.75, Math.min(1.6, value! / base)) : undefined;
    };
    const chartScale = (key: "chart_x_axis" | "chart_y_axis" | "chart_bar_labels", legacyKey: "x_axis_font_size" | "y_axis_font_size" | "bar_label_font_size", base: number) =>
      textScale?.[key] === undefined ? chartLegacyScale(legacyKey, base) ?? 1 : percentage(key);
    const contentHeight = tower ? Math.round((38 + height.metricRowHeight * Math.max(metricCount, 1)) * scale) : stacked ? height.stackedContentHeight : height.contentHeight;
    const chartHeight = Math.round(height.contentHeight * 2);
    return `${accent}--area-glance-content-height:${contentHeight}px;--area-glance-chart-height:${chartHeight}px;--area-glance-metrics-height:${height.metricRowHeight}px;--area-glance-pad-y:${Math.round(8 * scale)}px;--area-glance-pad-x:${Math.round(12 * scale)}px;--area-glance-title-size:${(1.85 * scale).toFixed(2)}rem;--area-glance-status-size:${(.95 * scale).toFixed(2)}rem;--area-glance-icon-size:${Math.round(25 * scale)}px;--area-glance-value-size:${(1.92 * scale).toFixed(2)}rem;--area-glance-label-size:${(.98 * scale).toFixed(2)}rem;--area-glance-title-scale:${percentage("title")};--area-glance-status-scale:${percentage("status")};--area-glance-value-scale:${percentage("value")};--area-glance-label-scale:${percentage("label")};--area-glance-chart-x-scale:${chartScale("chart_x_axis", "x_axis_font_size", 9)};--area-glance-chart-y-scale:${chartScale("chart_y_axis", "y_axis_font_size", 9)};--area-glance-chart-bar-scale:${chartScale("chart_bar_labels", "bar_label_font_size", 11)};--area-glance-metric-padding:${Math.max(1, Math.round(2 * scale))}px;`;
  }

  private _shadowStyle() {
    const appearance = this._config?.appearance;
    const opacity = Math.max(0, Math.min(60, Number(appearance?.shadow_opacity ?? 18)));
    const spread = Math.max(-12, Math.min(16, Number(appearance?.shadow_spread ?? 0)));
    const x = Math.max(-16, Math.min(16, Number(appearance?.shadow_x ?? 0)));
    const y = Math.max(-16, Math.min(16, Number(appearance?.shadow_y ?? 8)));
    const configuredColor = appearance?.shadow_color;
    // A colour input produces #RRGGBB. Retain a conservative black fallback
    // when YAML contains an invalid value rather than interpolating arbitrary CSS.
    const color = typeof configuredColor === "string" && /^#[0-9a-f]{6}$/i.test(configuredColor)
      ? configuredColor
      : "#000000";
    return `--area-glance-shadow-opacity:${opacity}%;--area-glance-shadow-spread:${spread}px;--area-glance-shadow-x:${x}px;--area-glance-shadow-y:${y}px;--area-glance-shadow-color:${color};`;
  }

  private _shadowMode() {
    const appearance = this._config?.appearance;
    return appearance?.shadow_style ?? (appearance?.shadow === false ? "none" : "drop");
  }

  /**
   * Keep the named appearance preset as the source of truth at render time.
   * The editor also writes legacy top-level theme/background values for older
   * YAML consumers, but a saved/restored config is not guaranteed to include
   * those derived fields. Resolving them here gives every profile — including
   * the dedicated Chart renderer — the same reliable colour-style behaviour.
   */
  private _appearanceSurface() {
    const appearance = this._config?.appearance;
    const preset = appearance?.preset as AppearancePreset | undefined;
    // A named preset is authoritative. Earlier editor versions wrote its
    // derived theme/background beside the preset, which meant a stale custom
    // background could silently override a newly chosen named style.
    if (preset && preset !== "custom") return APPEARANCE_PRESETS[preset];
    if (preset === "custom") return {
      theme: this._config?.theme === "light" ? "light" : "dark",
      background: appearance?.background ?? this._config?.background ?? DEFAULT_CUSTOM_BACKGROUND,
    };
    // Configs created before appearance.preset remain fully supported.
    return {
      theme: this._config?.theme ?? "auto",
      background: this._config?.background,
    };
  }

  private _appearanceStyle(background?: string) {
    // ha-card owns its surface inside its own shadow root. Supplying the
    // standard HA variable is therefore essential: setting `background` on
    // the outer custom element alone loses to ha-card's internal stylesheet.
    const configuredRadius = this._config?.appearance?.corner_radius;
    const radius = Number.isFinite(configuredRadius)
      ? Math.max(0, Math.min(48, Number(configuredRadius)))
      : undefined;
    // Keep the existing responsive defaults (24px normally, 22px on narrow
    // screens) when no value is saved. A configured value deliberately wins
    // in every profile and layout, including charts and camera cards.
    const radiusStyle = radius === undefined
      ? "--ha-card-border-radius:var(--area-glance-card-border-radius, 24px);"
      : `--area-glance-card-border-radius:${radius}px;--ha-card-border-radius:${radius}px;`;
    return `${radiusStyle}${background ? `--ha-card-background:${background};--area-glance-card-background:${background};` : ""}`;
  }

  private _textFit(text: string, type: "value" | "label"): number {
    const length = Array.from(text).length;
    const scale = type === "value"
      ? length >= 12 ? 0.68 : length >= 9 ? 0.76 : length >= 7 ? 0.86 : 1
      : length >= 16 ? 0.65 : length >= 12 ? 0.76 : length >= 9 ? 0.86 : 1;
    return Number(scale.toFixed(2));
  }

  private _textContainerCap(text: string, type: "value" | "label"): number {
    const length = Math.max(1, Array.from(text).length);
    const max = type === "value" ? 34 : 15;
    const min = type === "value" ? 14 : 10;
    // A value's available width falls quickly when a slim band has four or
    // five segments. Scale the container-relative cap by its characters so
    // common words such as "Triggered" can shrink before they are ellipsised.
    const characterBudget = type === "value" ? 200 : 110;
    return Number(Math.max(min, Math.min(max, characterBudget / length)).toFixed(2));
  }

  private _unitFit(primary: string, unit?: string): number {
    if (!unit) return 1;
    const unitLength = Array.from(unit).length;
    const primaryLength = Array.from(primary).length;
    let fit = unitLength >= 6 ? 0.4 : unitLength >= 4 ? 0.46 : unitLength >= 3 ? 0.52 : 0.62;
    if (primaryLength >= 4) fit -= 0.06;
    return Math.max(0.34, Number(fit.toFixed(2)));
  }

  private _runAction(action?: ActionConfig, fallbackEntity?: string, trigger: ActionTrigger = "tap") {
    const config = action ?? this._config;
    const kind = config?.action ?? "more-info";
    const entity = config?.entity ?? fallbackEntity;
    if (kind === "none") return;
    // Home Assistant cannot open a more-info dialog without an entity. This
    // also keeps clicks on an otherwise inert card from producing a transient
    // "no entity provided" message.
    if (kind === "more-info" && !entity) return;
    if (config?.confirmation && !window.confirm(config.confirmation)) return;
    if (kind === "area-details") {
      this._openAreaDetails();
      return;
    }
    // Home Assistant owns standard action semantics; local sheets remain in
    // the card because they describe Area Glance's aggregate contributors.
    dispatchHassAction(this, { ...config, action: kind, ...(entity ? { entity } : {}) }, fallbackEntity, trigger);
  }

  private _entityName(entityId: string) {
    const state = this.hass?.states[entityId];
    return state && this.hass?.formatEntityName?.(state, undefined)
      || String(state?.attributes.friendly_name ?? entityId);
  }

  private _entityState(entityId: string) {
    const state = this.hass?.states[entityId];
    if (!state) return "Unavailable";
    return this.hass?.formatEntityState?.(state) ?? `${friendlyState(state.state)}${state.attributes.unit_of_measurement ? ` ${state.attributes.unit_of_measurement}` : ""}`;
  }

  private _openAreaDetails() {
    const area = this._config?.area;
    const title = area ? this._areaName(area) ?? "Area" : this._config?.title ?? "Home";
    this._detail = { title, subtitle: area ? "Entities in this area" : "Entities included in this view", entities: this._areaEntities(area), emptyMessage: "No entities are assigned to this area." };
  }

  /**
   * Detail-sheet statistics deliberately use the same contributor list as the
   * rendered insight. That keeps manual selections and exclusions truthful.
   */
  private _aggregateStatistics(metric: MetricConfig, entityIds: string[]): { label: string; value: string }[] | undefined {
    if (!this.hass || !["temperature", "power"].includes(metric.preset ?? "")) return undefined;
    const samples = entityIds.map((entityId) => ({
      value: asNumber(this.hass?.states[entityId]?.state ?? ""),
      unit: String(this.hass?.states[entityId]?.attributes.unit_of_measurement ?? ""),
    })).filter((sample): sample is { value: number; unit: string } => sample.value !== undefined);
    if (!samples.length) return undefined;

    // The compact insight can stay rounded; its detail breakdown should retain
    // the useful precision that makes a median meaningful.
    const decimals = metric.decimals ?? (metric.preset === "temperature" ? 1 : 0);
    const format = (value: number, unit: string) => `${value.toLocaleString(undefined, {
      useGrouping: false,
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    })}${metric.show_unit === false ? "" : unit}`;

    if (metric.preset === "power") {
      const watts = samples.map(({ value, unit }) => (metric.invert_value ? -1 : 1) * value * (POWER_UNIT_FACTORS[unit] ?? 1));
      const totalWatts = watts.reduce((total, value) => total + value, 0);
      const automaticUnit = Math.abs(totalWatts) >= 1_000_000 ? "MW" : Math.abs(totalWatts) >= 10_000 ? "kW" : "W";
      const displayUnit = powerUnit(metric.unit) ?? automaticUnit;
      const divisor = POWER_UNIT_FACTORS[displayUnit];
      const powerDecimals = metric.decimals ?? (displayUnit === "W" ? 0 : 1);
      const powerFormat = (value: number, extraPrecision = false) => `${value.toLocaleString(undefined, {
        useGrouping: false,
        maximumFractionDigits: metric.decimals ?? powerDecimals + (extraPrecision ? 1 : 0),
        minimumFractionDigits: metric.decimals ?? powerDecimals + (extraPrecision ? 1 : 0),
      })}${metric.show_unit === false ? "" : metric.unit ?? automaticUnit}`;
      const peak = watts.reduce((largest, value) => Math.abs(value) > Math.abs(largest) ? value : largest, watts[0]);
      return [
        { label: "Total", value: powerFormat(totalWatts / divisor) },
        { label: "Average", value: powerFormat(totalWatts / watts.length / divisor, true) },
        { label: "Peak", value: powerFormat(peak / divisor) },
      ];
    }

    const targetUnit = metric.unit ?? samples[0].unit;
    const values = samples.map(({ value, unit }) => convertTemperature(value, unit, targetUnit));
    const sorted = [...values].sort((left, right) => left - right);
    const median = aggregateValues(values, "median");
    const unit = metric.show_unit === false ? "" : metric.unit ?? "°";
    return [
      { label: "Min", value: format(sorted[0], unit) },
      { label: "Median", value: format(median, unit) },
      { label: "Max", value: format(sorted.at(-1)!, unit) },
    ];
  }

  private _openMetricDetails(metric: MetricConfig, display: MetricDisplay) {
    const area = metric.area ?? this._config?.area;
    const attention = metric.preset === "attention";
    const wholeHomeAttention = attention && metric.attention_scope === "home";
    const energySource = Boolean(metric.energy_source);
    const lightControlPanel = metric.preset === "lights" && display.aggregate === true;
    const signalSummary = metric.preset && AREA_SIGNAL_PRESETS.has(metric.preset) ? display.value : undefined;
    this._detail = {
      title: display.label,
      subtitle: energySource ? "Configured in your Energy Dashboard" : attention ? wholeHomeAttention ? "Checked across your home" : `Checked in ${this._areaName(area) ?? "this area"}` : lightControlPanel ? this._areaName(area) ?? "Your home" : area ? `Included from ${this._areaName(area) ?? "this area"}` : "Included entities",
      entities: display.entities ?? [],
      emptyMessage: attention ? "No entities currently need attention for the selected checks." : "No compatible entities are currently contributing to this insight.",
      quickControls: display.aggregate === true && !energySource,
      lightControlPanel,
      aggregatePanel: display.aggregate === true,
      summary: !lightControlPanel && display.aggregate ? energySource ? `${display.entities?.length ?? 0} configured source${(display.entities?.length ?? 0) === 1 ? "" : "s"}` : signalSummary ?? `${display.entities?.length ?? 0} included` : undefined,
      statistics: display.aggregate && !lightControlPanel && !energySource ? this._aggregateStatistics(metric, display.entities ?? []) : undefined,
    };
  }

  private _openStatusDetails() {
    const status = this._config?.status;
    if (status?.source === "security") {
      const area = status.area ?? this._config?.area;
      const summary = this._securitySummary(area, status.membership);
      const entities = [...summary.alarms, ...summary.doors.entities, ...summary.windows.entities, ...summary.locks.entities].map((entry) => entry.entityId);
      this._detail = {
        title: "Security",
        subtitle: area ? `Monitored in ${this._areaName(area) ?? "this area"}` : "Monitored security entities",
        entities,
        emptyMessage: "No alarm, door, window, or lock entities are currently being monitored.",
        aggregatePanel: true,
        summary: `${entities.length} monitored`,
      };
      return;
    }
    const signal = statusSignal(status?.source);
    if (!status || !signal) return;
    const area = status.area ?? this._config?.area;
    const labels: Record<AreaSignal, string> = { motion: "Motion", presence: "Presence", doors: "Doors", windows: "Windows", blinds: "Blinds", locks: "Locks", leaks: "Water leaks" };
    const entities = this._areaSignalSummary(area, signal, { preset: signal, source: "area", membership: status.membership }).entities.map((entry) => entry.entityId);
    this._detail = {
      title: labels[signal],
      subtitle: area ? `Included from ${this._areaName(area) ?? "this area"}` : "Included entities",
      entities,
      emptyMessage: "No compatible entities are currently contributing to this status.",
      aggregatePanel: true,
      summary: `${entities.length} included`,
    };
  }

  private _metricAction(metric: MetricConfig, display: MetricDisplay, action?: ActionConfig, fallback = false, trigger: ActionTrigger = "tap") {
    if (action?.action === "metric-details") {
      this._openMetricDetails(metric, display);
      return;
    }
    if (action?.action && (action.action !== "more-info" || Boolean(action.entity ?? metric.entity))) {
      this._runAction(action, metric.entity, trigger);
      return;
    }
    if (!fallback) return;
    const preset = metric.preset ?? "custom";
    if (this._metricSource(metric, preset) !== "entity") this._openMetricDetails(metric, display);
    else this._runAction(metric, metric.entity, trigger);
  }

  private _metricClicked(metric: MetricConfig, display: MetricDisplay, event: Event) {
    event.stopPropagation();
    if (this._ignoreMetricClick) return;
    this._metricAction(metric, display, metric, true);
  }
  private _suppressMetricClick() { this._ignoreMetricClick = true; window.setTimeout(() => { this._ignoreMetricClick = false; }, 0); }
  private _metricPointerDown(metric: MetricConfig, display: MetricDisplay, event: PointerEvent) {
    if (event.button !== 0) return;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture?.(event.pointerId);
    this._metricGesture?.timer && window.clearTimeout(this._metricGesture.timer);
    const gesture: NonNullable<typeof this._metricGesture> = { pointerId: event.pointerId, metric, display, startX: event.clientX, startY: event.clientY, held: false };
    gesture.timer = window.setTimeout(() => {
      if (this._metricGesture !== gesture) return;
      gesture.held = true;
      this._suppressMetricClick();
      this._metricAction(metric, display, metric.hold_action, false, "hold");
    }, 500);
    this._metricGesture = gesture;
  }
  private _metricPointerMove(event: PointerEvent) {
    const gesture = this._metricGesture;
    if (!gesture || gesture.pointerId !== event.pointerId || gesture.held) return;
    if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > 12) this._cancelMetricGesture();
  }
  private _metricPointerUp(event: PointerEvent) {
    const gesture = this._metricGesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    this._cancelMetricGesture();
    this._suppressMetricClick();
    if (gesture.held) return;
    if (this._pendingMetricTap) {
      window.clearTimeout(this._pendingMetricTap.timer);
      const pending = this._pendingMetricTap;
      this._pendingMetricTap = undefined;
      this._metricAction(pending.metric, pending.display, pending.metric.double_tap_action, false, "double_tap");
      return;
    }
    this._pendingMetricTap = { ...gesture, timer: window.setTimeout(() => {
      const pending = this._pendingMetricTap;
      this._pendingMetricTap = undefined;
      if (pending) this._metricAction(pending.metric, pending.display, pending.metric, true, "tap");
    }, 250) };
  }
  private _cancelMetricGesture() {
    if (this._metricGesture?.timer) window.clearTimeout(this._metricGesture.timer);
    this._metricGesture = undefined;
  }
  private _metricKeyDown(metric: MetricConfig, display: MetricDisplay, event: KeyboardEvent) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    this._suppressMetricClick();
    this._metricAction(metric, display, metric, true, "tap");
  }

  private _headerClicked() {
    // A bare card click is not an action. Header behaviour is opt-in through
    // the editor's "When the header is tapped" setting.
    const action = this._config?.header_action;
    if (!action || action.action === "none") return;
    this._runAction(action);
  }
  private _statusClicked(event: Event) {
    event.stopPropagation();
    const status = this._config?.status;
    if (!status || !status.action || status.action === "none") return;
    if (status.action === "status-details") {
      this._openStatusDetails();
      return;
    }
    this._runAction(status, status.entity);
  }

  private _openEntityDetails(entityId: string) {
    this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
    this._closeDetail();
  }

  /**
   * The sheet intentionally offers only predictable binary controls. Rich
   * device controls belong in Home Assistant's normal more-info dialog.
   */
  private _quickControl(entityId: string): { domain: string; service: "turn_on" | "turn_off"; isOn: boolean } | undefined {
    const state = this.hass?.states[entityId];
    if (!state || UNAVAILABLE.has(state.state)) return undefined;
    const domain = entityId.split(".")[0];
    if (!domain || !["light", "switch", "fan", "input_boolean"].includes(domain)) return undefined;
    if (state.state !== "on" && state.state !== "off") return undefined;
    const service = state.state === "on" ? "turn_off" : "turn_on";
    return { domain, service, isOn: state.state === "on" };
  }

  private _lightDetailIcon(entityId: string): string {
    const state = this.hass?.states[entityId];
    const configured = state?.attributes.icon;
    if (typeof configured === "string" && configured.startsWith("mdi:")) return configured;
    const name = `${entityId} ${state?.attributes.friendly_name ?? ""}`.toLowerCase();
    if (/co2.*(led|indicator)|indicator/.test(name)) return "mdi:molecule-co2";
    if (/(strip|led)/.test(name)) return "mdi:led-strip-variant";
    if (/(ceiling|overhead|pendant|chandelier)/.test(name)) return "mdi:ceiling-light";
    if (/(printer|print)/.test(name)) return "mdi:printer";
    if (/(indicator|status)/.test(name)) return "mdi:lightbulb-outline";
    return state?.state === "on" ? "mdi:lightbulb" : "mdi:lightbulb-outline";
  }

  private _lightDetailDescription(entityId: string): string {
    const state = this.hass?.states[entityId];
    const name = `${entityId} ${state?.attributes.friendly_name ?? ""}`.toLowerCase();
    if (/co2.*(led|indicator)|indicator/.test(name)) return "CO₂ indicator";
    if (/(strip|led)/.test(name)) return "LED strip";
    if (/(ceiling|overhead|pendant|chandelier)/.test(name)) return "Ceiling light";
    if (/(printer|print)/.test(name)) return "Printer light";
    if (/(indicator|status)/.test(name)) return "Status indicator";
    const modes = state?.attributes.supported_color_modes;
    if (Array.isArray(modes) && modes.some((mode) => ["xy", "hs", "rgb", "rgbw", "rgbww"].includes(String(mode)))) return "Colour light";
    if (Array.isArray(modes) && modes.includes("brightness")) return "Dimmable light";
    return "Light";
  }

  private _detailEntityIcon(entityId: string): string {
    const state = this.hass?.states[entityId];
    const configured = state?.attributes.icon;
    if (typeof configured === "string" && configured.startsWith("mdi:")) return configured;
    const [domain] = entityId.split(".");
    const deviceClass = String(state?.attributes.device_class ?? "");
    const identity = `${entityId} ${state?.attributes.friendly_name ?? ""}`.toLowerCase();
    const isActive = state?.state === "on" || state?.state === "open" || state?.state === "unlocked";
    if (domain === "light") return this._lightDetailIcon(entityId);
    if (domain === "binary_sensor") {
      // A number of integrations expose contact sensors as the broad
      // `opening` class. Use the entity's friendly identity only to separate
      // that ambiguous class into the familiar door/window visuals; explicit
      // Home Assistant device classes always take precedence.
      const openingDoor = deviceClass === "opening" && /(door|garage|gate)/.test(identity);
      const openingWindow = deviceClass === "opening" && /window/.test(identity);
      if (deviceClass === "door" || deviceClass === "garage_door" || openingDoor) return isActive ? "mdi:door-open" : "mdi:door-closed";
      if (deviceClass === "window" || openingWindow) return isActive ? "mdi:window-open" : "mdi:window-closed";
      if (deviceClass === "motion") return "mdi:motion-sensor";
      if (["occupancy", "presence"].includes(deviceClass)) return "mdi:account-check";
      if (["moisture", "problem"].includes(deviceClass)) return isActive ? "mdi:water-alert" : "mdi:water-check";
      return isActive ? "mdi:checkbox-marked-circle" : "mdi:checkbox-blank-circle-outline";
    }
    if (domain === "lock") return state?.state === "locked" ? "mdi:lock" : "mdi:lock-open-variant";
    if (domain === "cover") return ["open", "opening"].includes(state?.state ?? "") ? "mdi:blinds-open" : "mdi:blinds";
    if (domain === "fan") return "mdi:fan";
    if (domain === "switch" || domain === "input_boolean") return "mdi:toggle-switch-outline";
    if (domain === "sensor") {
      const icons: Record<string, string> = { temperature: "mdi:thermometer", humidity: "mdi:water-percent", power: "mdi:lightning-bolt", energy: "mdi:lightning-bolt", battery: "mdi:battery", carbon_dioxide: "mdi:molecule-co2", pm25: "mdi:air-filter", volatile_organic_compounds: "mdi:air-filter", aqi: "mdi:air-filter" };
      return icons[deviceClass] ?? "mdi:chart-line";
    }
    return "mdi:information-outline";
  }

  private _detailEntityDescription(entityId: string): string {
    const state = this.hass?.states[entityId];
    const [domain] = entityId.split(".");
    const deviceClass = String(state?.attributes.device_class ?? "");
    const identity = `${entityId} ${state?.attributes.friendly_name ?? ""}`.toLowerCase();
    if (deviceClass === "opening" && /(door|garage|gate)/.test(identity)) return "Door sensor";
    if (deviceClass === "opening" && /window/.test(identity)) return "Window sensor";
    const labels: Record<string, string> = { temperature: "Temperature sensor", humidity: "Humidity sensor", power: "Power sensor", energy: "Energy sensor", battery: "Battery", carbon_dioxide: "CO₂ sensor", pm25: "PM2.5 sensor", volatile_organic_compounds: "VOC sensor", aqi: "Air quality sensor", door: "Door sensor", garage_door: "Garage door", window: "Window sensor", motion: "Motion sensor", occupancy: "Occupancy sensor", presence: "Presence sensor", moisture: "Leak sensor", problem: "Problem sensor" };
    if (labels[deviceClass]) return labels[deviceClass];
    const domains: Record<string, string> = { lock: "Lock", cover: "Blind or cover", fan: "Fan", switch: "Switch", input_boolean: "Toggle", sensor: "Sensor", binary_sensor: "Binary sensor" };
    return domains[domain] ?? entityId;
  }

  private _detailEntityState(entityId: string): string {
    const state = this.hass?.states[entityId];
    if (!state) return "Unavailable";
    const [domain] = entityId.split(".");
    const deviceClass = String(state.attributes.device_class ?? "");
    if (domain === "binary_sensor") {
      const labels: Record<string, [string, string]> = {
        door: ["Closed", "Open"], garage_door: ["Closed", "Open"], window: ["Closed", "Open"],
        motion: ["Clear", "Motion"], occupancy: ["Clear", "Occupied"], presence: ["Clear", "Occupied"],
        moisture: ["Dry", "Wet"], problem: ["Clear", "Problem"],
      };
      const pair = labels[deviceClass];
      if (pair) return state.state === "on" ? pair[1] : pair[0];
    }
    if (domain === "lock") return state.state === "locked" ? "Locked" : state.state === "unlocked" ? "Unlocked" : this._entityState(entityId);
    if (domain === "cover") return friendlyState(state.state);
    return this._entityState(entityId);
  }

  private _detailEntityTone(entityId: string): "active" | "attention" | "muted" | "normal" {
    const state = this.hass?.states[entityId];
    if (!state || UNAVAILABLE.has(state.state)) return "muted";
    const deviceClass = String(state.attributes.device_class ?? "");
    const active = state.state === "on" || state.state === "open" || state.state === "unlocked" || state.state === "triggered";
    if (!active) return "normal";
    return ["moisture", "problem"].includes(deviceClass) || state.state === "triggered" ? "attention" : "active";
  }

  private _lightEntityIds(detail: DetailSheet): string[] {
    return detail.entities.filter((entityId) => entityId.startsWith("light.") && this.hass?.states[entityId]);
  }

  private async _runQuickControl(event: Event, entityId: string) {
    event.preventDefault();
    event.stopPropagation();
    const control = this._quickControl(entityId);
    if (!control || !this.hass?.callService) return;
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    try {
      await this.hass.callService(control.domain, control.service, { entity_id: entityId });
    } catch (error) {
      // Home Assistant remains the source of truth; preserve the sheet and
      // leave a useful diagnostic for frontend/service failures.
      console.error("Area Glance quick control failed", error);
    } finally {
      button.disabled = false;
    }
  }

  private async _runAllLightsControl(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    const detail = this._detail;
    if (!detail) return;
    const entityIds = this._lightEntityIds(detail).filter((entityId) => this._quickControl(entityId)?.domain === "light");
    if (!entityIds.length || !this.hass?.callService) return;
    const service = entityIds.some((entityId) => this.hass?.states[entityId]?.state === "on") ? "turn_off" : "turn_on";
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    try {
      await this.hass.callService("light", service, { entity_id: entityIds });
    } catch (error) {
      console.error("Area Glance all-lights control failed", error);
    } finally {
      button.disabled = false;
    }
  }

  private _closeDetail() { this._detail = undefined; }

  /** Keep tower icon density coherent: every insight changes together. */
  private _syncTowerIconMode() {
    const width = this.renderRoot.querySelector<HTMLElement>("ha-card")?.getBoundingClientRect().width ?? this.getBoundingClientRect().width;
    const next = this._config?.layout !== "tower" || width >= 280
      ? "normal"
      : width >= 140 ? "compact" : "hidden";
    if (next !== this._towerIconMode) this._towerIconMode = next;
  }

  /** Keep the SVG coordinate system aligned to its final rendered dimensions. */
  private _syncChartPlotSize() {
    if (this._config?.profile !== "chart") return;
    const box = this.renderRoot.querySelector<HTMLElement>(".chart-plot")?.getBoundingClientRect();
    const width = box?.width;
    const height = box?.height;
    const nextWidth = width && Number.isFinite(width) ? Math.max(180, Math.round(width)) : undefined;
    const nextHeight = height && Number.isFinite(height) ? Math.max(104, Math.round(height)) : undefined;
    if (nextWidth && Math.abs(nextWidth - this._chartPlotWidth) > 1) this._chartPlotWidth = nextWidth;
    if (nextHeight && Math.abs(nextHeight - this._chartPlotHeight) > 1) this._chartPlotHeight = nextHeight;
  }

  protected updated(changed: PropertyValues<this>) {
    this._syncTowerIconMode();
    this._syncChartPlotSize();
    if (!changed.has("_detail" as never)) return;
    const dialog = this.renderRoot.querySelector<HTMLDialogElement>(".detail-sheet");
    if (this._detail && dialog && !dialog.open) dialog.showModal();
    if (!this._detail && dialog?.open) dialog.close();
  }

  /** Chart has its own early render branch, so it must also render the shared
   * contributor-sheet structure for a multi-line chart to be able to open it. */
  private _renderChartContributorSheet() {
    const detail = this._detail;
    return html`<dialog class="detail-sheet ${detail?.aggregatePanel ? "aggregate-sheet" : ""}${(detail?.entities.length ?? 0) > 4 ? " scrollable-sheet" : ""}" @close=${this._closeDetail} @click=${(event: Event) => { if (event.target === event.currentTarget) this._closeDetail(); }}>
      ${detail ? html`<div class="detail-content ${detail.aggregatePanel ? "aggregate-panel" : ""}">
        <div class="detail-heading"><div><h2>${detail.title}</h2><p>${detail.subtitle}</p></div><button class="detail-close" aria-label="Close" @click=${this._closeDetail}>×</button></div>
        ${detail.summary ? html`<div class="detail-count generic">${detail.summary}</div>` : nothing}
        ${detail.entities.length ? html`<div class="detail-entities">${detail.entities.map((entityId) => {
          const name = this._entityName(entityId);
          const state = this._detailEntityState(entityId);
          const tone = this._detailEntityTone(entityId);
          return html`<div class="detail-entity detail-aggregate-entity"><span class="detail-icon-badge ${tone}"><ha-icon icon=${this._detailEntityIcon(entityId)}></ha-icon></span><button class="detail-entity-main" aria-label=${`${name}: ${state}. Show details`} @click=${() => this._openEntityDetails(entityId)}><span><strong>${name}</strong><small>${this._detailEntityDescription(entityId)}</small></span><span class="detail-state">${state}</span></button></div>`;
        })}</div>` : html`<p class="detail-empty">${detail.emptyMessage}</p>`}
      </div>` : nothing}
    </dialog>`;
  }

  protected render() {
    if (!this._config) return nothing;
    if (this._config.profile === "chart") {
      const appearance = this._config.appearance;
      const surface = this._appearanceSurface();
      const background = surface.background;
      const shadowMode = this._shadowMode();
      const textWeight = appearance?.text_weight ?? (appearance?.style === "light" ? "light" : "bold");
      const history = this._chartLivePoints();
      const explicitStatus = this._config.status ? this._status() : undefined;
      const chartTitle = this._chartTitle();
      const titleLines = this._headerLineMode("title");
      const titleFit = this._headerTitleFit(chartTitle, titleLines);
      const chartStacked = this._config.layout === "stacked";
      const chartHeaderAlignment = chartStacked ? this._config.header_alignment ?? "left" : "left";
      const multiChart = this._config.chart?.type === "multi_line";
      const dashboardDark = this.hass?.themes?.darkMode === true;
      return html`<ha-card class=${`chart-card ${dashboardDark ? "dashboard-dark" : ""} ${surface.theme === "dark" ? "force-dark" : surface.theme === "light" ? "force-light" : ""}${textWeight !== "bold" ? ` ${textWeight}-weight` : ""}${shadowMode === "none" ? " no-shadow" : shadowMode === "inner" ? " inner-shadow" : ""}`} style=${`${this._appearanceStyle(background)}${this._shadowStyle()}${this._layoutStyle(0)}`}>
        <section class=${`chart-layout${chartStacked ? " stacked" : ""}${multiChart ? " multi-chart-layout" : ""}`}><div class=${`chart-summary summary align-${chartHeaderAlignment}`} style=${`--area-glance-title-fit:${titleFit}`}><span class=${`title ${titleLines}`}>${chartTitle}</span>${multiChart && !explicitStatus?.line ? this._renderMultiLegend() : html`<span class="chart-value">${explicitStatus?.line ?? this._chartSummary(history)}</span>`}<span class="chart-range">${explicitStatus?.age ?? this._chartHeaderRange(history)}</span></div><button class="chart-plot" aria-label=${`Open ${chartTitle} details`} @click=${this._chartClicked}>${this._renderChart()}</button></section>
      </ha-card>${this._renderChartContributorSheet()}`;
    }
    const status = this._status();
    const metrics = this._effectiveMetrics().map((metric) => ({ metric, display: this._metric(metric) })).filter((entry): entry is { metric: MetricConfig; display: MetricDisplay } => Boolean(entry.display));
    const title = this._config.title
      ?? (this._config.profile === "house" ? "House" : this._config.profile === "security" ? "Security" : this._config.profile === "energy" ? "Energy" : this._config.profile === "battery" ? "Home battery" : this._config.profile === "cameras" ? "Cameras" : this._areaName(this._config.area))
      ?? "Area";
    const showHeader = this._config.layout !== "metrics-only";
    const headerAlignment = this._config.layout === "stacked" || this._config.layout === "tower" ? this._config.header_alignment ?? "left" : "left";
    const titleLines = this._headerLineMode("title");
    const statusLines = this._headerLineMode("status");
    const titleFit = this._headerTitleFit(title, titleLines);
    const appearance = this._config.appearance;
    const surface = this._appearanceSurface();
    const background = surface.background;
    const shadowMode = this._shadowMode();
    const headerAction = this._config.header_action ?? this._config;
    const headerClickable = Boolean(headerAction.action && headerAction.action !== "none");
    const statusClickable = Boolean(this._config.status?.action && this._config.status.action !== "none");
    const textWeight = appearance?.text_weight ?? (appearance?.style === "light" ? "light" : "bold");
    const showAreaIcon = appearance?.show_area_icon === true;
    const showInsightIcons = appearance?.show_insight_icons !== false;
    const dashboardDark = this.hass?.themes?.darkMode === true;
    return html`
      <ha-card class=${`${dashboardDark ? "dashboard-dark" : ""} ${surface.theme === "dark" ? "force-dark" : surface.theme === "light" ? "force-light" : ""}${textWeight !== "bold" ? ` ${textWeight}-weight` : ""}${shadowMode === "none" ? " no-shadow" : shadowMode === "inner" ? " inner-shadow" : ""}${headerClickable ? " clickable" : ""}`} style=${`${this._appearanceStyle(background)}${this._shadowStyle()}`} @click=${this._headerClicked}>
        <section class=${showHeader ? `layout${this._config.layout === "stacked" ? " stacked" : ""}${this._config.layout === "tower" ? ` tower tower-icons-${this._towerIconMode}` : ""}${showAreaIcon ? " area-icon-layout" : ""}${showInsightIcons ? "" : " insight-icons-hidden"}` : `layout metrics-only${showInsightIcons ? "" : " insight-icons-hidden"}`} style=${this._layoutStyle(metrics.length)}>
          ${showHeader ? html`<div class=${`summary align-${headerAlignment}${showAreaIcon ? " with-area-icon" : ""}`} style=${`--area-glance-title-fit:${titleFit}`}>
              ${showAreaIcon ? html`<span class="area-icon" aria-hidden="true"><ha-icon icon=${this._headerAreaIcon(title)}></ha-icon></span>` : nothing}
              <span class="summary-copy"><span class=${`title ${titleLines}`}>${title}</span>
              ${status.line ? html`<button class=${`status ${statusLines}${statusClickable ? " clickable" : ""}`} ?disabled=${!statusClickable} @click=${this._statusClicked}><span class="dot" style=${`background:${status.color}`}></span><span class="status-copy"><span class="status-line">${status.line}</span>${status.age ? html`<small class="status-age">${status.age}</small>` : nothing}</span></button>` : nothing}</span>
            </div>` : nothing}
          <div class="metrics" style=${`--metric-count:${Math.max(metrics.length, 1)}`}>
            ${metrics.map(({ metric, display }) => {
              const valueParts = splitDisplayUnit(display.value);
              const cameraVisual = display.visual?.kind === "camera" ? display.visual : undefined;
              const iconColor = this._insightIconColor(metric, display);
              return html`
                <button class=${`metric${cameraVisual ? " camera-feed" : ""}`} style=${`--area-glance-value-fit:${this._textFit(valueParts.primary, "value")};--area-glance-value-cap:${this._textContainerCap(valueParts.primary, "value")}cqi;--area-glance-unit-fit:${this._unitFit(valueParts.primary, valueParts.unit)};--area-glance-label-fit:${this._textFit(display.label, "label")};--area-glance-label-cap:${this._textContainerCap(display.label, "label")}cqi`} aria-label=${cameraVisual ? `Open ${cameraVisual.alt}` : `${display.label}: ${display.value}${display.aggregate ? ", show included entities" : ""}`} @click=${(event: Event) => this._metricClicked(metric, display, event)} @pointerdown=${(event: PointerEvent) => this._metricPointerDown(metric, display, event)} @pointermove=${(event: PointerEvent) => this._metricPointerMove(event)} @pointerup=${(event: PointerEvent) => this._metricPointerUp(event)} @pointercancel=${() => this._cancelMetricGesture()} @contextmenu=${(event: Event) => event.preventDefault()} @keydown=${(event: KeyboardEvent) => this._metricKeyDown(metric, display, event)}>
                  ${cameraVisual ? html`<img class="camera-preview" src=${cameraVisual.src} alt=${cameraVisual.alt}>` : display.visual?.kind === "analogue-clock" ? html`<span class="analogue-clock" style=${`--hour-angle:${display.visual.hourAngle}deg;--minute-angle:${display.visual.minuteAngle}deg;color:${iconColor ?? "var(--area-glance-accent)"}`}></span>` : display.visual?.kind === "calendar" ? html`<span class="calendar-date" style=${iconColor ? `color:${iconColor}` : ""}><small>${display.visual.month}</small><strong>${display.visual.day}</strong></span>` : html`${showInsightIcons && metric.show_icon !== false && metric.preset !== "clock" ? html`<ha-icon .icon=${display.icon} style=${iconColor ? `color:${iconColor}` : ""}></ha-icon>` : nothing}<span class="value"><span class="value-primary">${valueParts.primary}</span>${valueParts.unit ? html`<span class="value-unit">${valueParts.unit}</span>` : nothing}</span>`}
                  ${!cameraVisual && metric.show_label !== false ? html`<span class="label">${display.label}</span>` : nothing}
                </button>
              `;
            })}
          </div>
        </section>
      </ha-card>
      <dialog class="detail-sheet ${this._detail?.aggregatePanel ? "aggregate-sheet" : ""}${this._detail?.lightControlPanel ? " light-sheet" : ""}${(this._detail?.entities.length ?? 0) > 4 ? " scrollable-sheet" : ""}" @close=${this._closeDetail} @click=${(event: Event) => { if (event.target === event.currentTarget) this._closeDetail(); }}>
        ${this._detail ? (() => {
          const lightEntities = this._detail.lightControlPanel ? this._lightEntityIds(this._detail) : [];
          const lightsOn = lightEntities.filter((entityId) => this.hass?.states[entityId]?.state === "on").length;
          const allLightsActive = lightsOn > 0;
          const showAllLightsControl = lightEntities.length > 1;
          return html`<div class="detail-content ${this._detail.aggregatePanel ? "aggregate-panel" : ""}${this._detail.lightControlPanel ? " light-control-panel" : ""}">
          <div class="detail-heading"><div><h2>${this._detail.title}</h2><p>${this._detail.subtitle}</p></div><button class="detail-close" aria-label="Close" @click=${this._closeDetail}>×</button></div>
          ${this._detail.lightControlPanel && lightEntities.length ? html`<div class="detail-count"><span class="detail-count-dot"></span>${lightsOn} of ${lightEntities.length} on</div>${showAllLightsControl ? html`<div class="detail-all-lights"><span class="detail-icon-badge active"><ha-icon icon="mdi:lightbulb-group-outline"></ha-icon></span><span class="detail-all-copy"><strong>All lights</strong><small>Turn all on or off</small></span><button class="detail-control ${allLightsActive ? "active" : ""}" role="switch" aria-checked=${String(allLightsActive)} aria-label=${allLightsActive ? "Some lights are on. Turn all lights off" : "All lights are off. Turn all lights on"} @click=${this._runAllLightsControl}><span class="detail-toggle-thumb"></span></button></div>` : nothing}` : this._detail.aggregatePanel && this._detail.summary ? html`<div class="detail-count generic">${this._detail.summary}</div>` : nothing}
          ${this._detail.statistics?.length ? html`<div class="detail-statistics" aria-label="Aggregate statistics">${this._detail.statistics.map((statistic) => html`<span><small>${statistic.label}</small><strong>${statistic.value}</strong></span>`)}</div>` : nothing}
          ${this._detail.entities.length ? html`<div class="detail-entities">${this._detail.entities.map((entityId) => {
            const control = this._detail?.quickControls ? this._quickControl(entityId) : undefined;
            const name = this._entityName(entityId);
            const state = this._detailEntityState(entityId);
            const lightRow = this._detail?.lightControlPanel === true && entityId.startsWith("light.");
            const aggregateRow = this._detail?.aggregatePanel === true;
            const tone = this._detailEntityTone(entityId);
            return html`<div class="detail-entity ${lightRow ? "detail-light-entity" : ""}${aggregateRow ? " detail-aggregate-entity" : ""}">${aggregateRow ? html`<span class="detail-icon-badge ${lightRow && control?.isOn ? "active" : ""} ${lightRow ? "" : tone}"><ha-icon icon=${lightRow ? this._lightDetailIcon(entityId) : this._detailEntityIcon(entityId)}></ha-icon></span>` : nothing}<button class="detail-entity-main" aria-label=${`${name}: ${state}. Show details`} @click=${() => this._openEntityDetails(entityId)}><span><strong>${name}</strong><small>${lightRow ? this._lightDetailDescription(entityId) : aggregateRow ? this._detailEntityDescription(entityId) : entityId}</small></span>${control ? nothing : html`<span class="detail-state">${state}</span>`}</button>${control ? html`<button class="detail-control ${control.isOn ? "active" : ""}" role="switch" aria-checked=${String(control.isOn)} aria-label=${`${name} is ${control.isOn ? "on" : "off"}. Toggle`} @click=${(event: Event) => this._runQuickControl(event, entityId)}><span class="detail-toggle-thumb"></span></button>` : nothing}</div>`;
          })}</div>` : html`<p class="detail-empty">${this._detail.emptyMessage}</p>`}
        </div>`;
        })() : nothing}
      </dialog>`;
  }

  static styles = css`
    :host { display:block; --area-glance-accent:var(--primary-color); }
    ha-card { overflow:hidden; border:1px solid color-mix(in srgb, var(--primary-text-color) 8%, transparent); border-radius:var(--area-glance-card-border-radius, 24px); cursor:default; background:var(--area-glance-card-background, var(--card-background-color, #fff)); box-shadow:var(--area-glance-shadow-x, 0px) var(--area-glance-shadow-y, 8px) 24px var(--area-glance-shadow-spread, 0px) color-mix(in srgb, var(--area-glance-shadow-color, #000) var(--area-glance-shadow-opacity, 18%), transparent); }
    .chart-layout { box-sizing:border-box; height:var(--area-glance-chart-height, 136px); min-height:104px; display:grid; grid-template-columns:clamp(108px, 23%, 152px) minmax(0, 1fr); gap:0; align-items:stretch; padding:var(--area-glance-pad-y, 8px) var(--area-glance-pad-x, 12px); }
    .chart-layout.stacked { height:calc(var(--area-glance-chart-height, 136px) + 42px); grid-template-columns:minmax(0, 1fr); grid-template-rows:auto minmax(0, 1fr); gap:4px; }
    .chart-summary { display:flex; min-width:0; flex-direction:column; justify-content:center; gap:5px; }
    .chart-layout.stacked .chart-summary { display:grid; grid-template-columns:minmax(0, 1fr) auto; grid-template-rows:auto auto; column-gap:12px; row-gap:0; padding:2px 4px; }
    .chart-layout.stacked .chart-summary .title { grid-row:1 / span 2; align-self:center; }
    .chart-layout.stacked .chart-summary .chart-value { grid-column:2; grid-row:1; }
    .chart-layout.stacked .chart-summary .chart-range { grid-column:2; grid-row:2; text-align:right; }
    .chart-layout.stacked .chart-summary.align-center { text-align:center; }
    .chart-layout.stacked .chart-summary.align-center .title { justify-self:center; }
    .chart-layout.stacked .chart-summary.align-right { text-align:right; }
    .chart-layout.stacked .chart-summary.align-right .title { justify-self:end; }
    .chart-value { overflow:hidden; color:var(--primary-text-color); font-size:clamp(calc(1rem * var(--area-glance-value-scale, 1)), calc(2.5vw * var(--area-glance-value-scale, 1)), calc(1.35rem * var(--area-glance-value-scale, 1))); font-weight:750; letter-spacing:-.02em; text-overflow:ellipsis; white-space:nowrap; }
    .chart-range { color:var(--secondary-text-color); font-size:calc(.76rem * var(--area-glance-label-scale, 1)); font-weight:600; text-transform:uppercase; }
    .chart-legend { display:grid; min-width:0; gap:2px; }
    .chart-legend-item { display:grid; grid-template-columns:7px minmax(0, 1fr) auto; align-items:center; column-gap:5px; min-width:0; color:var(--secondary-text-color); font-size:calc(.67rem * var(--area-glance-label-scale, 1)); font-weight:600; line-height:1.12; }
    .chart-legend-swatch { width:6px; height:6px; border-radius:50%; background:var(--chart-series-colour); }
    .chart-legend-label { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .chart-legend-value { color:var(--chart-series-colour); font-variant-numeric:tabular-nums; white-space:nowrap; }
    .chart-plot { display:grid; min-width:0; min-height:0; padding:0; border:0; color:var(--primary-text-color); background:transparent; cursor:pointer; }
    .chart-plot:hover { background:color-mix(in srgb, var(--area-glance-accent) 5%, transparent); border-radius:8px; }
    .chart-svg { display:block; width:100%; height:100%; min-height:0; overflow:visible; }
    .chart-axis, .chart-zero { stroke:color-mix(in srgb, var(--primary-text-color) 30%, transparent); stroke-width:1; vector-effect:non-scaling-stroke; }
    .chart-grid { stroke:color-mix(in srgb, var(--primary-text-color) 10%, transparent); stroke-width:1; vector-effect:non-scaling-stroke; }
    .chart-week-divider { stroke:color-mix(in srgb, var(--primary-text-color) 16%, transparent); }
    .chart-zero { stroke:color-mix(in srgb, var(--primary-text-color) 46%, transparent); }
    .chart-line { fill:none; stroke-width:1.7; vector-effect:non-scaling-stroke; }
    .chart-line.positive { stroke:var(--area-glance-chart-positive, var(--primary-text-color)); }
    .chart-line.negative { stroke:var(--area-glance-chart-negative, var(--orange-color, #e85d20)); }
    .chart-area.positive { fill:color-mix(in srgb, var(--area-glance-chart-positive, var(--primary-text-color)) 18%, transparent); }
    .chart-area.negative { fill:color-mix(in srgb, var(--area-glance-chart-negative, var(--orange-color, #e85d20)) 22%, transparent); }
    .chart-area.multi { opacity:.18; }
    .chart-line.multi { stroke-width:1.8; }
    .chart-bar { fill:var(--area-glance-chart-positive, var(--primary-text-color)); opacity:var(--area-glance-chart-bar-opacity, 1); }
    .chart-bar.daily { fill:var(--area-glance-chart-daily-primary); }
    .chart-bar.negative { fill:var(--area-glance-chart-negative, var(--orange-color, #e85d20)); }
    .chart-bar.weekend { fill:var(--area-glance-chart-weekend); }
    /* Today's daily-total bar is incomplete: reserve the secondary orange for it. */
    .chart-bar.current { fill:var(--area-glance-chart-today, var(--orange-color, #e85d20)); }
    .chart-average-line { stroke:var(--area-glance-chart-average, var(--primary-color)); stroke-width:var(--area-glance-chart-average-width, 1px); vector-effect:non-scaling-stroke; }
    .chart-average-line.dashed { stroke-dasharray:4 3; }
    /* Chart annotations are deliberately quieter than the card's main value. */
    .chart-bar-value { fill:var(--secondary-text-color); font:11px/1 var(--primary-font-family, inherit); font-size:calc(11px * var(--area-glance-chart-bar-scale, 1)) !important; font-variant-numeric:tabular-nums; paint-order:stroke fill; stroke:var(--area-glance-card-background, var(--card-background-color, #fff)); stroke-width:3px; stroke-linejoin:round; }
    .chart-bar-value.weekend, .chart-tick.weekend { fill:var(--area-glance-chart-weekend); }
    .chart-bar-value.current { fill:var(--area-glance-chart-today, var(--orange-color, #e85d20)); font-weight:650; }
    .chart-tick, .chart-scale, .chart-unit { fill:var(--secondary-text-color); font:8px/1 var(--primary-font-family, inherit); font-variant-numeric:tabular-nums; }
    .chart-tick { font-size:calc(9px * var(--area-glance-chart-x-scale, 1)) !important; }
    .chart-scale { font-size:calc(9px * var(--area-glance-chart-y-scale, 1)); }
    .chart-unit { fill:var(--primary-text-color); font-size:calc(8px * var(--area-glance-chart-y-scale, 1)); font-weight:650; paint-order:stroke fill; stroke:var(--area-glance-card-background, var(--card-background-color, #fff)); stroke-width:3px; stroke-linejoin:round; }
    .chart-empty { display:grid; place-items:center; min-height:116px; color:var(--secondary-text-color); font-size:.9rem; }
    ha-card.clickable { cursor:pointer; }
    ha-card.no-shadow { box-shadow:none; }
    ha-card.inner-shadow { border-color:color-mix(in srgb, var(--primary-text-color) 13%, transparent); box-shadow:inset 0 2px 12px var(--area-glance-shadow-spread, 0px) color-mix(in srgb, var(--area-glance-shadow-color, #000) var(--area-glance-shadow-opacity, 18%), transparent), inset 0 1px 0 rgb(255 255 255 / .1); }
    .layout { min-height:var(--area-glance-content-height, 78px); display:grid; grid-template-columns:clamp(108px, 23%, 152px) minmax(0, 1fr); align-items:stretch; padding:var(--area-glance-pad-y, 8px) var(--area-glance-pad-x, 12px); }
    .layout.area-icon-layout { grid-template-columns:clamp(150px, 26%, 208px) minmax(0, 1fr); padding-inline:max(14px, var(--area-glance-pad-x, 12px)); }
    .layout.metrics-only { grid-template-columns:minmax(0, 1fr); }
    .layout.stacked { grid-template-columns:minmax(0, 1fr); grid-template-rows:auto minmax(var(--area-glance-metrics-height, 62px), 1fr); gap:8px; }
    .layout.stacked .summary { padding:3px 4px 0; }
    .layout.stacked .summary.align-center { text-align:center; }
    .layout.stacked .summary.align-right { text-align:right; }
    .layout.stacked .summary.align-center .status { justify-content:center; text-align:center; }
    .layout.stacked .summary.align-right .status { justify-content:flex-end; text-align:right; }
    .layout.stacked .metrics { min-height:var(--area-glance-metrics-height, 62px); }
    .layout.stacked .metric:first-child { border-left:0; }
    .layout.tower { grid-template-columns:minmax(0, 1fr); grid-template-rows:auto minmax(0, 1fr); gap:6px; }
    .layout.tower .summary { padding:3px 4px 2px; }
    .layout.tower .summary.align-center { text-align:center; }
    .layout.tower .summary.align-right { text-align:right; }
    .layout.tower .summary.align-center .status { justify-content:center; text-align:center; }
    .layout.tower .summary.align-right .status { justify-content:flex-end; text-align:right; }
    .layout.tower .metrics { grid-template-columns:minmax(0, 1fr); grid-auto-rows:minmax(var(--area-glance-metrics-height, 62px), 1fr); min-height:0; }
    .summary { min-width:0; align-self:center; padding:3px 8px 3px 4px; }
    .summary-copy { display:block; min-width:0; }
    .summary-copy > .title { display:block; }
    .summary.with-area-icon { display:grid; grid-template-columns:44px minmax(0, 1fr); align-items:center; gap:10px; padding-left:0; }
    .area-icon { display:grid; place-items:center; width:44px; height:44px; border-radius:50%; color:var(--primary-text-color); background:color-mix(in srgb, var(--primary-text-color) 5%, transparent); }
    .area-icon ha-icon { width:25px; height:25px; margin:0; color:var(--primary-text-color); }
    .title { box-sizing:border-box; width:100%; max-width:100%; color:var(--primary-text-color); font-size:calc(var(--area-glance-title-size, 1.8rem) * var(--area-glance-title-scale, 1) * var(--area-glance-title-fit, 1)); font-weight:800; letter-spacing:-.03em; line-height:1.12; padding-block:.03em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .title.multi { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; white-space:normal; }
    .status { appearance:none; width:100%; padding:0; border:0; color:var(--secondary-text-color); background:transparent; display:flex; gap:6px; align-items:flex-start; margin-top:5px; font:inherit; font-size:calc(var(--area-glance-status-size, .85rem) * var(--area-glance-status-scale, 1)); font-weight:550; line-height:1.15; min-width:0; text-align:left; }
    .status.clickable { cursor:pointer; border-radius:6px; }
    .status.clickable:hover { background:color-mix(in srgb, var(--area-glance-accent) 8%, transparent); }
    .status:disabled { opacity:1; }
    .status-copy { min-width:0; overflow:hidden; text-overflow:ellipsis; }
    .status.multi .status-line, .status.multi .status-age { display:block; overflow:hidden; text-overflow:ellipsis; }
    .status.single { align-items:center; }
    .status.single .dot { margin-top:0; }
    .status.single .status-copy { display:flex; align-items:baseline; white-space:nowrap; }
    .status.single .status-line { min-width:0; overflow:hidden; text-overflow:ellipsis; }
    .status.single .status-age { display:inline; flex:none; white-space:nowrap; }
    .status.single .status-age::before { content:" · "; }
    .dot { width:9px; height:9px; border-radius:50%; flex:none; margin-top:3px; }
    small { display:block; font-size:inherit; }
    .metrics { min-width:0; display:grid; grid-template-columns:repeat(var(--metric-count), minmax(0, 1fr)); }
    .metric { appearance:none; position:relative; container-type:inline-size; border:0; background:transparent; color:var(--primary-text-color); display:flex; flex-direction:column; align-items:center; justify-content:center; min-width:0; padding:var(--area-glance-metric-padding, 3px); font:inherit; cursor:pointer; touch-action:manipulation; }
    /* The grid owns camera-slot width. A camera's native aspect ratio may only
       decide what gets cropped inside that fixed rectangle, never the width of
       a neighbouring insight. */
    .metric.camera-feed { display:block; align-self:stretch; width:100%; min-width:0; max-width:100%; height:100%; min-height:0; overflow:hidden; padding:0; }
    .layout.tower .metric.camera-feed { display:block; padding:0; }
    .camera-preview { display:block; width:100%; max-width:100%; height:100%; min-height:0; object-fit:cover; object-position:center; background:var(--secondary-background-color); }
    .metric::before { content:""; position:absolute; left:0; top:10%; height:80%; width:1px; background:color-mix(in srgb, var(--primary-text-color) 12%, transparent); }
    .regular-weight .title { font-weight:650; letter-spacing:-.024em; }
    .regular-weight .status { font-weight:430; }
    .regular-weight .value { font-weight:650; letter-spacing:-.018em; }
    .regular-weight .label { font-weight:430; }
    .regular-weight .chart-value { font-weight:650; letter-spacing:-.018em; }
    .regular-weight .chart-range { font-weight:430; }
    .light-weight .title { font-weight:480; letter-spacing:-.016em; }
    .light-weight .status { font-weight:350; }
    .light-weight .value { font-weight:500; letter-spacing:-.012em; }
    .light-weight .label { font-weight:350; }
    .light-weight .chart-value { font-weight:500; letter-spacing:-.012em; }
    .light-weight .chart-range { font-weight:350; }
    .layout.stacked .metric:first-child::before, .layout.metrics-only .metric:first-child::before { display:none; }
    .layout.tower .metric { display:grid; grid-template-columns:calc(var(--area-glance-tower-icon-size, var(--area-glance-icon-size, 24px)) + 10px) minmax(0, 1fr); grid-template-rows:auto auto; column-gap:8px; justify-content:start; align-content:center; text-align:left; padding-inline:8px; }
    .layout.tower .metric::before { left:8px; top:0; width:calc(100% - 16px); height:1px; }
    .layout.tower .metric:first-child::before { display:none; }
    .layout.tower .metric ha-icon, .layout.tower .metric .analogue-clock, .layout.tower .metric .calendar-date { grid-row:1 / span 2; grid-column:1; margin:0; justify-self:center; }
    .layout.tower .metric .value { grid-row:1; grid-column:2; justify-content:flex-start; }
    .layout.tower .metric .label { grid-row:2; grid-column:2; margin-top:0; }
    .layout.tower.tower-icons-compact { --area-glance-tower-icon-size:18px; }
    .layout.tower.tower-icons-compact .metric { column-gap:7px; }
    .layout.tower.tower-icons-compact .metric ha-icon { width:var(--area-glance-tower-icon-size); height:var(--area-glance-tower-icon-size); }
    .layout.tower.tower-icons-compact .metric .analogue-clock { width:calc(var(--area-glance-tower-icon-size) + 5px); height:calc(var(--area-glance-tower-icon-size) + 5px); }
    .layout.tower.tower-icons-compact .metric .calendar-date { width:calc(var(--area-glance-tower-icon-size) + 10px); min-height:calc(var(--area-glance-tower-icon-size) + 10px); }
    .layout.tower.tower-icons-hidden .metric { grid-template-columns:minmax(0, 1fr); padding-inline:10px; }
    .layout.tower.tower-icons-hidden .metric ha-icon, .layout.tower.tower-icons-hidden .metric .analogue-clock, .layout.tower.tower-icons-hidden .metric .calendar-date { display:none !important; }
    .layout.tower.tower-icons-hidden .metric .value, .layout.tower.tower-icons-hidden .metric .label { grid-column:1; }
    .layout.tower.insight-icons-hidden .metric { grid-template-columns:minmax(0, 1fr); padding-inline:10px; }
    .layout.tower.insight-icons-hidden .metric .value, .layout.tower.insight-icons-hidden .metric .label { grid-column:1; }
    .metric:hover { background:color-mix(in srgb, var(--area-glance-accent) 8%, transparent); }
    ha-icon { color:var(--area-glance-accent); width:var(--area-glance-icon-size, 24px); height:var(--area-glance-icon-size, 24px); margin-bottom:2px; flex:none; }
    .analogue-clock { position:relative; width:calc(var(--area-glance-icon-size, 24px) + 6px); height:calc(var(--area-glance-icon-size, 24px) + 6px); margin-bottom:2px; border:2px solid currentColor; border-radius:50%; box-sizing:border-box; flex:none; }
    .analogue-clock::before, .analogue-clock::after { content:""; position:absolute; left:50%; bottom:50%; width:2px; border-radius:2px; background:currentColor; transform-origin:50% 100%; }
    .analogue-clock::before { height:30%; transform:translateX(-50%) rotate(var(--hour-angle)); }
    .analogue-clock::after { height:42%; transform:translateX(-50%) rotate(var(--minute-angle)); }
    .calendar-date { width:calc(var(--area-glance-icon-size, 24px) + 13px); min-height:calc(var(--area-glance-icon-size, 24px) + 13px); margin-bottom:2px; border:1.5px solid currentColor; border-radius:4px; overflow:hidden; display:flex; flex-direction:column; align-items:center; justify-content:center; line-height:1; flex:none; }
    .calendar-date small { width:100%; padding:2px 0 1px; color:#fff; background:currentColor; font-size:.42em; font-weight:700; letter-spacing:.04em; text-transform:uppercase; }
    .calendar-date strong { padding:2px 0 3px; color:currentColor; font-size:.76em; letter-spacing:-.04em; }
    .value { display:flex; align-items:baseline; justify-content:center; min-width:0; font-size:calc(var(--area-glance-value-size, 1.6rem) * var(--area-glance-value-fit, 1) * var(--area-glance-value-scale, 1)); font-size:min(calc(var(--area-glance-value-size, 1.6rem) * var(--area-glance-value-fit, 1) * var(--area-glance-value-scale, 1)), calc(var(--area-glance-value-cap, 27cqi) * var(--area-glance-value-scale, 1))); line-height:1.05; padding-block:.03em; font-weight:800; letter-spacing:-.02em; white-space:nowrap; overflow:hidden; max-width:100%; }
    .value-primary { min-width:0; overflow:hidden; text-overflow:ellipsis; }
    .value-unit { flex:none; margin-left:.06em; font-size:calc(1em * var(--area-glance-unit-fit, 1)); font-weight:700; letter-spacing:-.045em; }
    .label { color:var(--secondary-text-color); font-size:calc(var(--area-glance-label-size, .82rem) * var(--area-glance-label-fit, 1) * var(--area-glance-label-scale, 1)); font-size:min(calc(var(--area-glance-label-size, .82rem) * var(--area-glance-label-fit, 1) * var(--area-glance-label-scale, 1)), calc(var(--area-glance-label-cap, 15cqi) * var(--area-glance-label-scale, 1))); font-weight:550; line-height:1.1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%; margin-top:1px; }
    /* Dashboard-dark surfaces get a restrained, brighter edge so a card reads
       cleanly against HA's dark page background without looking outlined. */
    .dashboard-dark:not(.force-light) { border-color:color-mix(in srgb, #fff 14%, transparent); }
    .force-dark { --ha-card-background:#353c45; --area-glance-card-background:#353c45; --primary-text-color:#f5f7fb; --secondary-text-color:#c4ccd8; }
    .force-light { --ha-card-background:#fff; --area-glance-card-background:#fff; --primary-text-color:#18212e; --secondary-text-color:#5f6b7e; }
    .detail-sheet { box-sizing:border-box; width:min(560px, calc(100vw - 32px)); max-height:min(78dvh, 720px); padding:0; border:0; border-radius:22px; color:var(--primary-text-color); background:var(--ha-card-background, var(--card-background-color)); box-shadow:0 18px 50px rgb(0 0 0 / 28%); overflow:hidden; }
    .detail-sheet.aggregate-sheet.scrollable-sheet { height:min(78dvh, 720px); }
    .detail-sheet::backdrop { background:rgb(0 0 0 / 30%); backdrop-filter:blur(8px); }
    .detail-content { padding:20px; overflow:hidden; }
    .detail-heading { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; margin-bottom:12px; }
    .detail-heading h2 { margin:0; font-size:1.35rem; }
    .detail-heading p, .detail-empty { margin:4px 0 0; color:var(--secondary-text-color); }
    .detail-close { appearance:none; border:0; width:32px; height:32px; border-radius:50%; color:var(--primary-text-color); background:color-mix(in srgb, var(--primary-text-color) 8%, transparent); font:1.5rem/1 sans-serif; cursor:pointer; outline:none; }
    .detail-entities { display:grid; gap:4px; max-height:50vh; overflow:auto; overflow-x:hidden; }
    .detail-entity { display:flex; align-items:center; gap:6px; border-radius:9px; }
    .detail-entity-main { display:flex; flex:1; min-width:0; align-items:center; justify-content:space-between; gap:12px; padding:10px; border:0; border-radius:9px; color:var(--primary-text-color); background:transparent; text-align:left; font:inherit; cursor:pointer; }
    .detail-entity-main > span:first-child { min-width:0; }
    .detail-entity:hover, .detail-entity:focus-within { background:color-mix(in srgb, var(--area-glance-accent) 9%, transparent); }
    .detail-entity strong, .detail-entity small { display:block; }
    .detail-entity small { margin-top:2px; color:var(--secondary-text-color); font-size:.75rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .detail-state { color:var(--secondary-text-color); white-space:nowrap; font-size:.86rem; }
    .detail-control { box-sizing:border-box; display:flex; align-items:center; width:52px; height:30px; padding:3px; border:0; border-radius:999px; color:var(--secondary-text-color); background:color-mix(in srgb, var(--primary-text-color) 16%, transparent); cursor:pointer; transition:background .18s ease; }
    .detail-control.active { justify-content:flex-end; background:var(--state-light-active-color, var(--warning-color, #ff9800)); }
    .detail-toggle-thumb { display:block; width:24px; height:24px; border-radius:50%; background:var(--card-background-color); box-shadow:0 1px 3px rgb(0 0 0 / 18%); transition:transform .18s ease; }
    .detail-control:disabled { opacity:.55; cursor:wait; }
    .aggregate-panel { box-sizing:border-box; min-height:0; padding:24px; }
    .aggregate-sheet.scrollable-sheet .aggregate-panel { height:100%; display:flex; flex-direction:column; }
    .aggregate-panel .detail-heading { margin-bottom:18px; }
    .aggregate-panel .detail-heading h2 { font-size:1.7rem; letter-spacing:-.028em; }
    .aggregate-panel .detail-heading p { font-size:1rem; }
    .aggregate-panel .detail-entities { gap:0; border:1px solid color-mix(in srgb, var(--primary-text-color) 11%, transparent); border-radius:16px; background:color-mix(in srgb, var(--primary-text-color) 1.5%, transparent); }
    .aggregate-sheet.scrollable-sheet .aggregate-panel .detail-entities { flex:1 1 auto; min-height:0; max-height:none; overscroll-behavior:contain; touch-action:pan-y; }
    .detail-aggregate-entity { gap:13px; min-height:66px; padding:10px 14px; border-radius:0; }
    .detail-aggregate-entity + .detail-aggregate-entity { border-top:1px solid color-mix(in srgb, var(--primary-text-color) 10%, transparent); }
    .detail-aggregate-entity .detail-entity-main { padding:0; border-radius:7px; }
    .detail-aggregate-entity:hover, .detail-aggregate-entity:focus-within { background:color-mix(in srgb, var(--area-glance-accent) 6%, transparent); }
    .detail-icon-badge.attention { color:var(--error-color, #db4437); }
    .detail-icon-badge.muted { color:var(--disabled-text-color); }
    .light-control-panel { padding:28px; }
    .light-control-panel .detail-heading { margin-bottom:20px; }
    .light-control-panel .detail-heading h2 { font-size:clamp(1.7rem, 7vw, 2.4rem); letter-spacing:-.035em; }
    .light-control-panel .detail-heading p { font-size:1.05rem; }
    .light-control-panel .detail-close { width:42px; height:42px; font-size:2rem; }
    .detail-count { align-self:flex-start; display:inline-flex; align-items:center; gap:9px; padding:8px 13px; margin:0 0 18px; border-radius:999px; color:var(--primary-text-color); background:color-mix(in srgb, var(--primary-text-color) 7%, transparent); font-size:.95rem; font-weight:600; }
    .detail-count-dot { width:11px; height:11px; border-radius:50%; background:var(--state-light-active-color, var(--warning-color, #ff9800)); }
    .detail-statistics { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); margin:-5px 0 18px; overflow:hidden; border:1px solid color-mix(in srgb, var(--primary-text-color) 10%, transparent); border-radius:13px; background:color-mix(in srgb, var(--primary-text-color) 2%, transparent); }
    .detail-statistics span { display:grid; gap:2px; min-width:0; padding:9px 10px; text-align:center; }
    .detail-statistics span + span { border-left:1px solid color-mix(in srgb, var(--primary-text-color) 9%, transparent); }
    .detail-statistics small { overflow:hidden; color:var(--secondary-text-color); font-size:.7rem; font-weight:600; line-height:1.1; text-overflow:ellipsis; text-transform:uppercase; white-space:nowrap; }
    .detail-statistics strong { overflow:hidden; color:var(--primary-text-color); font-size:.98rem; font-variant-numeric:tabular-nums; line-height:1.1; text-overflow:ellipsis; white-space:nowrap; }
    .detail-all-lights { display:flex; align-items:center; gap:14px; padding:15px 18px; margin-bottom:18px; border:1px solid color-mix(in srgb, var(--primary-text-color) 10%, transparent); border-radius:16px; background:color-mix(in srgb, var(--primary-text-color) 3%, transparent); }
    .detail-icon-badge { display:grid; flex:none; place-items:center; width:50px; height:50px; border-radius:50%; color:var(--secondary-text-color); background:color-mix(in srgb, var(--primary-text-color) 6%, transparent); }
    .detail-icon-badge.active { color:var(--state-light-active-color, var(--warning-color, #ff9800)); }
    .detail-icon-badge ha-icon { width:27px; height:27px; margin:0; color:currentColor; }
    .detail-all-copy { min-width:0; flex:1; }
    .detail-all-copy strong, .detail-all-copy small { display:block; }
    .detail-all-copy strong { font-size:1.05rem; }
    .detail-all-copy small { margin-top:3px; color:var(--secondary-text-color); }
    .light-control-panel .detail-entities { flex:1 1 auto; min-height:0; gap:0; max-height:none; border:1px solid color-mix(in srgb, var(--primary-text-color) 11%, transparent); border-radius:16px; background:color-mix(in srgb, var(--primary-text-color) 1.5%, transparent); overscroll-behavior:contain; touch-action:pan-y; }
    .light-control-panel .detail-entity { gap:14px; min-height:76px; padding:12px 18px; border-radius:0; }
    .light-control-panel .detail-entity + .detail-entity { border-top:1px solid color-mix(in srgb, var(--primary-text-color) 10%, transparent); }
    .light-control-panel .detail-entity-main { padding:0; border-radius:7px; }
    .light-control-panel .detail-entity:hover, .light-control-panel .detail-entity:focus-within { background:color-mix(in srgb, var(--area-glance-accent) 6%, transparent); }
    .light-control-panel .detail-entity strong { font-size:1.02rem; }
    .light-control-panel .detail-entity small { font-size:.9rem; }
    .light-control-panel .detail-control { width:56px; height:32px; }
    .light-control-panel .detail-toggle-thumb { width:26px; height:26px; }
    @media (max-width: 500px) { .detail-sheet { width:calc(100vw - 20px); max-height:84dvh; border-radius:20px; } .detail-sheet.aggregate-sheet.scrollable-sheet { height:84dvh; } .aggregate-panel { padding:22px 18px; } .detail-aggregate-entity { padding:10px 12px; gap:11px; } .light-control-panel { padding:22px 18px; } .light-control-panel .detail-entity { padding:11px 13px; gap:11px; } .light-control-panel .detail-icon-badge { width:44px; height:44px; } .light-control-panel .detail-icon-badge ha-icon { width:24px; height:24px; } }
    @media (max-width: 500px) { ha-card { border-radius:var(--area-glance-card-border-radius, 22px); } .layout { grid-template-columns:clamp(88px, 25%, 108px) minmax(0, 1fr); padding:7px 8px; } .layout.area-icon-layout { grid-template-columns:clamp(130px, 31%, 160px) minmax(0, 1fr); padding-inline:9px; } .summary.with-area-icon { grid-template-columns:37px minmax(0, 1fr); gap:7px; } .area-icon { width:37px; height:37px; } .area-icon ha-icon { width:22px; height:22px; } .title { font-size:min(calc(var(--area-glance-title-size, 1.8rem) * var(--area-glance-title-scale, 1)), calc(1.48rem * var(--area-glance-title-scale, 1))); } .status { font-size:calc(var(--area-glance-status-size, .85rem) * var(--area-glance-status-scale, 1)); } .metric { padding:2px 1px; } ha-icon { width:min(var(--area-glance-icon-size, 24px), 22px); height:min(var(--area-glance-icon-size, 24px), 22px); margin-bottom:1px; } .label { margin-top:1px; } }
    @media (max-width: 420px) { .chart-layout { grid-template-columns:clamp(88px, 25%, 108px) minmax(0, 1fr); padding:var(--area-glance-pad-y, 7px) var(--area-glance-pad-x, 8px); gap:0; } .chart-value { font-size:1rem; } }
  `;
}

export class AreaGlanceCardEditor extends LitElement {
  public hass?: HassLike;
  private _config: AreaGlanceConfig = { title: "Area", metrics: DEFAULT_METRICS };
  /** The editor reads the same trusted Energy Dashboard preferences as the card. */
  private _chartEnergyPreferences?: EnergyPreferences;
  private _chartEnergyPreferencesLoaded = false;
  private _chartEnergyPreferencesRequest?: Promise<void>;
  private _suggestionsNeedUpdate = false;
  private _draggedMetricIndex?: number;
  private _dragOverMetricIndex?: number;
  private _draggedMetricHeight = 0;
  /** Original row centres captured before any preview transforms are applied. */
  private _dragMetricMidpoints: { index: number; midpoint: number }[] = [];
  /** Native drag event ordering differs between browsers and embedded HA views. */
  private _dragDropCommitted = false;
  private _dragEndTimer?: number;

  static get properties() { return { hass: { attribute: false }, _config: { state: true }, _suggestionsNeedUpdate: { state: true }, _chartEnergyPreferences: { state: true } }; }
  public setConfig(config: AreaGlanceConfig) {
    this._config = { ...config, metrics: config.metrics?.length ? config.metrics : defaultMetricsForProfile(config.profile, this.hass) };
    this._loadChartEnergyPreferences();
  }

  protected willUpdate(changed: PropertyValues<this>) {
    if (changed.has("hass")) this._loadChartEnergyPreferences();
  }

  private _loadChartEnergyPreferences() {
    if (!this.hass?.callWS || this._chartEnergyPreferencesLoaded || this._chartEnergyPreferencesRequest) return;
    this._chartEnergyPreferencesRequest = loadSharedEnergyPreferences(this.hass)
      .then((preferences) => { this._chartEnergyPreferences = preferences; })
      .finally(() => {
        this._chartEnergyPreferencesLoaded = true;
        this._chartEnergyPreferencesRequest = undefined;
        // Commit the resolved automatic source once, so the picker displays
        // the real entity and a late preferences response cannot make the
        // preview appear to jump between a generic sensor and Solar/Grid.
        if (this._config.profile === "chart" && this._config.chart?.type !== "multi_line" && !this._config.chart?.entity && !this._config.chart?.energy_source) {
          this._change({ chart: { ...(this._config.chart ?? { type: "line" }), ...this._chartSuggestion(this._config.chart?.type ?? "line") } });
        }
        this.requestUpdate();
      });
  }

  private _change(change: Partial<AreaGlanceConfig>) {
    this._config = { ...this._config, ...change };
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this._config }, bubbles: true, composed: true }));
  }
  private _input(event: Event, key: "title" | "area") { this._change({ [key]: (event.target as HTMLInputElement).value }); }
  private _statusInput(event: Event, key: keyof StatusConfig) { this._change({ status: { ...this._config.status, [key]: (event.target as HTMLInputElement).value } }); }
  private _statusBoolean(event: Event, key: keyof StatusConfig) { this._change({ status: { ...this._config.status, [key]: (event.target as HTMLInputElement).checked } }); }
  private _statusSourceChanged(event: Event) {
    const source = (event.target as HTMLSelectElement).value as NonNullable<StatusConfig["source"]>;
    const previous = this._config.status;
    const aggregateSource = source !== "entity";
    const action = !aggregateSource && previous?.action === "status-details" ? "more-info" : aggregateSource && previous?.action === "more-info" ? "status-details" : previous?.action;
    const { membership: _membership, ...withoutMembership } = previous ?? {};
    this._change({ status: { ...withoutMembership, source, action, ...(source === "entity" ? {} : { entity: undefined }) } });
  }
  private _statusEnabledChanged(event: Event) {
    const enabled = (event.target as HTMLInputElement).checked;
    this._change({
      status: enabled
        ? this._config.status ?? (this._config.profile === "security" ? { source: "security", action: "status-details" } : { source: "area_motion", ...(this._config.area ? { area: this._config.area } : {}), show_last_changed: true, last_changed_text: "Last motion" })
        : undefined,
    });
  }
  private _metricBoolean(index: number, key: "hidden") { return (event: Event) => this._updateMetric(index, { [key]: (event.target as HTMLInputElement).checked }); }
  private _layoutChanged(event: Event) { this._change({ layout: (event.target as HTMLSelectElement).value as AreaGlanceConfig["layout"] }); }
  private _heightChanged(event: Event) { this._change({ height: (event.target as HTMLSelectElement).value as AreaGlanceConfig["height"] }); }
  private _headerActionChanged(event: Event) {
    const action = (event.target as HTMLSelectElement).value as NonNullable<ActionConfig["action"]>;
    this._change({ header_action: { ...this._config.header_action, action } });
  }
  private _headerNavigationChanged(event: Event) {
    this._change({ header_action: { ...this._config.header_action, action: "navigate", navigation_path: (event.target as HTMLInputElement).value } });
  }
  private _statusActionChanged(event: Event) {
    const action = (event.target as HTMLSelectElement).value as NonNullable<ActionConfig["action"]>;
    this._change({ status: { ...this._config.status, action } });
  }
  private _statusNavigationChanged(event: Event) {
    this._change({ status: { ...this._config.status, action: "navigate", navigation_path: (event.target as HTMLInputElement).value } });
  }
  private _statusAreaChanged(event: Event) {
    const source = this._config.status?.source ?? "area_motion";
    this._change({ status: { ...this._config.status, source, area: this._pickerValue(event) || undefined } });
  }
  private _statusCandidates(status: StatusConfig): string[] {
    const area = status.area ?? this._config.area ?? "";
    const entities = this._entitiesInArea(area);
    if (status.source === "security") return entities.filter((entityId) => {
      const state = this.hass?.states[entityId];
      return isAlarmEntity(entityId) || isSignalEntity("doors", entityId, state) || isSignalEntity("windows", entityId, state) || isSignalEntity("locks", entityId, state);
    });
    const signal = statusSignal(status.source);
    return signal ? entities.filter((entityId) => isSignalEntity(signal, entityId, this.hass?.states[entityId])) : [];
  }
  private _statusMembershipEntityChanged(entityId: string, event: Event) {
    const status = this._config.status;
    if (!status) return;
    const included = (event.target as HTMLInputElement).checked;
    const excluded = new Set(status.membership?.exclude ?? []);
    if (included) excluded.delete(entityId); else excluded.add(entityId);
    this._change({ status: { ...status, membership: excluded.size ? { mode: "auto_except", exclude: [...excluded] } : undefined } });
  }
  private _resetStatusMembership() {
    const status = this._config.status;
    if (status) this._change({ status: { ...status, membership: undefined } });
  }
  private _purpose() {
    const profile = this._config.profile ?? "auto";
    if (profile === "house") return "house";
    if (profile === "security") return "security";
    if (profile === "energy") return "energy";
    if (profile === "battery") return "battery";
    if (profile === "cameras") return "cameras";
    if (profile === "chart") return "chart";
    return "area";
  }
  private _purposeSelected(purpose: "area" | "house" | "energy" | "battery" | "security" | "cameras" | "chart") {
    if (purpose === "chart") {
      // Keep the initial chart automatic: once Energy Dashboard preferences
      // arrive, it chooses Solar generation first, then Grid flow, before any
      // ordinary sensor fallback. This remains immediately reversible below.
      const chart: ChartConfig = this._purpose() === "chart" && this._config.chart
        ? this._config.chart
        : { type: "line", hours_to_show: 24 };
      // Charts show their source's live summary. A security status such as
      // "2 openings" is profile-specific, so do not carry it into a chart.
      const layout = this._config.layout === "stacked" ? "stacked" : "header";
      this._change({ profile: "chart", layout, chart, metrics: [], title: undefined, status: undefined, area: undefined });
      return;
    }
    if (purpose === "house" || purpose === "security" || purpose === "energy" || purpose === "battery" || purpose === "cameras") {
      this._populateAreaPreset("", purpose);
      return;
    }
    const profile = purpose === "area" ? "auto" : purpose;
    this._change({ profile });
    if (this._config.area) this._suggestionsNeedUpdate = true;
  }
  private _chartCandidate(type: ChartType): string | undefined {
    const configuredTotals = configuredEnergyEntities(this._chartEnergyPreferences, type);
    return Object.entries(this.hass?.states ?? {})
      .filter((entry): entry is [string, EntityState] => entry[0].startsWith("sensor.") && Boolean(entry[1]) && asNumber(entry[1]?.state ?? "") !== undefined)
      .map(([id, state]) => {
        const deviceClass = String(state.attributes.device_class ?? "");
        const stateClass = String(state.attributes.state_class ?? "");
        const unit = String(state.attributes.unit_of_measurement ?? "");
        const score = type === "daily_totals" ? (["energy", "water", "gas", "monetary"].includes(deviceClass) && ["total", "total_increasing"].includes(stateClass) ? (configuredTotals.has(id) ? 140 : 100) : -1)
          : type === "columns" ? (deviceClass === "power" || Boolean(powerUnit(unit)) ? 90 : -1)
            : type === "area" ? (deviceClass === "power" || deviceClass === "battery" || unit === "%" ? 80 : -1)
              : deviceClass === "power" || Boolean(powerUnit(unit)) ? 120
                : stateClass === "measurement" ? (["temperature", "humidity", "carbon_dioxide", "pm25", "aqi"].includes(deviceClass) ? 100 : 50) : -1;
        return { id, score, name: this._entityName(id) };
      }).filter((entry) => entry.score >= 0).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))[0]?.id;
  }
  private _chartSuggestion(type: ChartType): Pick<ChartConfig, "entity" | "energy_source"> {
    // Keep the chart automatic until the Energy Dashboard configuration has
    // loaded. Committing a generic sensor here would make the eventual Grid
    // preference look like a late, surprising change.
    if (!this._chartEnergyPreferencesLoaded) return { entity: undefined, energy_source: undefined };
    const energy_source = suggestedEnergyChartSource(this._chartEnergyPreferences, this.hass, type);
    if (energy_source) {
      const resolved = resolveEnergyChartSource(this._chartEnergyPreferences, this.hass, energy_source);
      // Solar/battery are a single visible sensor, so make the automatic
      // choice concrete in the ordinary picker. Grid deliberately remains a
      // Dashboard source because it can combine import and export entities.
      return { energy_source, entity: energy_source === "grid" ? undefined : resolved.entity };
    }
    return { entity: this._chartCandidate(type), energy_source: undefined };
  }
  private _chartEnergySourceChanged(event: Event) {
    const energy_source = ((event.target as HTMLSelectElement).value || undefined) as ChartConfig["energy_source"];
    const resolved = energy_source ? resolveEnergyChartSource(this._chartEnergyPreferences, this.hass, energy_source) : {};
    this._chartChanged({ energy_source, entity: energy_source === "grid" ? undefined : resolved.entity });
  }
  private _chartChanged(change: Partial<ChartConfig>) {
    const previous = this._config.chart ?? {};
    const chart = { ...previous, ...change };
    // Keep legacy preset ranges useful for existing YAML. The visual editor
    // intentionally exposes one clear duration control: hours_to_show.
    if (change.range) chart.hours_to_show = undefined;
    this._change({ chart });
  }
  private _chartDurationChanged(event: Event) {
    const value = Number((event.target as HTMLInputElement).value);
    const daily = (this._config.chart?.type ?? "line") === "daily_totals";
    const fallback = daily ? 7 : 24;
    const duration = Number.isFinite(value) && value > 0 ? value : fallback;
    this._chartChanged({ hours_to_show: daily ? Math.min(30, duration) * 24 : Math.min(720, duration), range: undefined });
  }
  private _editorChartSeries(chart = this._config.chart ?? {}): ChartSeriesConfig[] {
    const seen = new Set<string>();
    return (chart.entities ?? []).filter((series) => series.entity && !seen.has(series.entity) && Boolean(seen.add(series.entity))).slice(0, 3);
  }
  private _editorSeriesColour(index: number, series: ChartSeriesConfig): string {
    return series.color ?? ["#3b82f6", "#e85d20", "#35a34a"][index] ?? "#7c5ce6";
  }
  private _editorSeriesUnitMismatch(series = this._editorChartSeries()): string | undefined {
    const units = [...new Set(series.map((item) => String(this.hass?.states[item.entity]?.attributes.unit_of_measurement ?? "")).filter(Boolean))];
    return units.length > 1 ? `Selected entities use different units (${units.join(", ")}). Choose compatible measurements.` : undefined;
  }
  private _multiSeriesChanged(entities: ChartSeriesConfig[], change: Partial<ChartConfig> = {}) {
    this._chartChanged({ type: "multi_line", entities: entities.slice(0, 3), entity: undefined, energy_source: undefined, ...change });
  }
  private _multiSeriesEntityChanged(index: number, event: Event) {
    const entity = this._pickerValue(event);
    if (!entity) return;
    const entities = this._editorChartSeries().map((series, itemIndex) => itemIndex === index ? { ...series, entity } : series);
    this._multiSeriesChanged(entities);
  }
  private _addMultiSeries() {
    const existing = this._editorChartSeries();
    const referenceUnit = String(this.hass?.states[existing[0]?.entity ?? ""]?.attributes.unit_of_measurement ?? "");
    const candidates = Object.keys(this.hass?.states ?? {}).filter((entity) => entity.startsWith("sensor.") && !existing.some((series) => series.entity === entity) && asNumber(this.hass?.states[entity]?.state ?? "") !== undefined && (!referenceUnit || String(this.hass?.states[entity]?.attributes.unit_of_measurement ?? "") === referenceUnit));
    const entity = candidates[0];
    if (entity) this._multiSeriesChanged([...this._editorChartSeries(), { entity }]);
  }
  private _renderMultiChartEditor(chart: ChartConfig, hours: number) {
    const series = this._editorChartSeries(chart);
    const unitMismatch = this._editorSeriesUnitMismatch(series);
    const allNonNegative = series.every((item) => (liveNumericState(this.hass?.states[item.entity]) ?? 0) >= 0);
    return html`<section class="insights chart-editor"><h3>Chart</h3><p class="hint">Choose up to three compatible sensors. Each is shown as a line with a matching legend entry.</p>
      <label>Chart type<select .value="multi_line" @change=${(event: Event) => { const next = (event.target as HTMLSelectElement).value as Exclude<ChartType, "area">; if (next !== "multi_line") this._chartChanged({ type: next, ...this._chartSuggestion(next), entities: undefined, multi_display: undefined, hours_to_show: next === "daily_totals" ? 168 : 24, range: undefined }); }}><option value="line">Line (single entity)</option><option value="multi_line">Line (multiple entities)</option><option value="columns">Columns</option><option value="daily_totals">Daily totals</option></select></label>
      <label>History to show (hours)<input type="number" min="1" max="720" step="1" .value=${String(hours)} @change=${this._chartDurationChanged}></label><p class="slot-hint">Any whole number from 1 hour to 30 days.</p>
      <label>Lines</label>${series.map((item, index) => html`<div class="multi-series-row"><ha-entity-picker .hass=${this.hass} .value=${item.entity} .label=${`Line ${index + 1}`} allow-custom-entity @value-changed=${(event: Event) => this._multiSeriesEntityChanged(index, event)}></ha-entity-picker><input class="series-colour" aria-label=${`Line ${index + 1} colour`} type="color" .value=${this._editorSeriesColour(index, item)} @input=${(event: Event) => this._multiSeriesChanged(series.map((current, itemIndex) => itemIndex === index ? { ...current, color: (event.target as HTMLInputElement).value } : current))}><button class="icon-button" aria-label=${`Remove line ${index + 1}`} @click=${() => this._multiSeriesChanged(series.filter((_, itemIndex) => itemIndex !== index))}>×</button><input class="series-label" .value=${item.label ?? ""} placeholder="Legend label (optional)" @input=${(event: Event) => this._multiSeriesChanged(series.map((current, itemIndex) => itemIndex === index ? { ...current, label: (event.target as HTMLInputElement).value || undefined } : current))}></div>`)}
      ${series.length < 3 ? html`<button class="add-insight" @click=${this._addMultiSeries}>Add line</button>` : nothing}${unitMismatch ? html`<p class="editor-warning">${unitMismatch}</p>` : nothing}
      <details class="more-options"><summary>Fine tuning (optional)</summary>
        <label>Display<select .value=${chart.multi_display ?? "overlap"} @change=${(event: Event) => this._multiSeriesChanged(series, { multi_display: (event.target as HTMLSelectElement).value as "overlap" | "stacked" })}><option value="overlap">Overlapping lines (default)</option><option value="stacked" ?disabled=${Boolean(unitMismatch) || !allNonNegative}>Stacked areas</option></select></label><p class="slot-hint">Stacked areas are available only for compatible non-negative readings. Overlap keeps every line independent.</p>
        <label>Grid lines<select .value=${chart.grid_lines ?? "none"} @change=${(event: Event) => this._multiSeriesChanged(series, { grid_lines: (event.target as HTMLSelectElement).value as NonNullable<ChartConfig["grid_lines"]> })}><option value="none">None (default)</option><option value="x">Vertical, time guides</option><option value="y">Horizontal, value guides</option><option value="both">Both axes</option></select></label><p class="slot-hint">Faint guides align to the visible time and value-axis labels, behind the lines.</p>
        <div class="two"><label>Value-axis minimum<input type="number" step="any" .value=${chart.axis_min?.toString() ?? ""} placeholder="Automatic" @input=${(event: Event) => { const value = (event.target as HTMLInputElement).value; this._multiSeriesChanged(series, { axis_min: value === "" ? undefined : Number(value) }); }}></label><label>Value-axis maximum<input type="number" step="any" .value=${chart.axis_max?.toString() ?? ""} placeholder="Automatic" @input=${(event: Event) => { const value = (event.target as HTMLInputElement).value; this._multiSeriesChanged(series, { axis_max: value === "" ? undefined : Number(value) }); }}></label></div>
        <div class="two"><label>Decimals<input type="number" min="0" max="4" .value=${chart.decimals?.toString() ?? ""} placeholder="Automatic" @input=${(event: Event) => { const value = (event.target as HTMLInputElement).value; this._multiSeriesChanged(series, { decimals: value === "" ? undefined : Number(value) }); }}></label><label>Unit override<input .value=${chart.unit ?? ""} placeholder="Home Assistant unit" @input=${(event: Event) => this._multiSeriesChanged(series, { unit: (event.target as HTMLInputElement).value || undefined })}></label></div>
        <label>Data source<select .value=${chart.history_source ?? "auto"} @change=${(event: Event) => this._multiSeriesChanged(series, { history_source: (event.target as HTMLSelectElement).value as ChartConfig["history_source"] })}><option value="auto">Automatic</option><option value="raw">Recorder history</option><option value="statistics">Long-term statistics</option></select></label>
      </details></section>`;
  }
  private _renderChartEditor() {
    const chart = this._config.chart ?? { type: "line" as const };
    const type = chart.type === "area" ? "line" : chart.type ?? "line";
    const suggested = this._chartEnergyPreferencesLoaded ? this._chartCandidate(type) : undefined;
    const energySuggestion = this._chartEnergyPreferencesLoaded ? suggestedEnergyChartSource(this._chartEnergyPreferences, this.hass, type) : undefined;
    const hasEnergyDashboard = Boolean(this._chartEnergyPreferences?.energy_sources?.length);
    const sourceHint = chart.energy_source ? `Using ${chart.energy_source.replaceAll("_", " ")} from Energy Dashboard` : chart.entity ? `Using ${this._entityName(chart.entity)}` : !this._chartEnergyPreferencesLoaded ? "Checking Energy Dashboard sources…" : energySuggestion ? `Starting with ${energySuggestion.replaceAll("_", " ")} from Energy Dashboard` : hasEnergyDashboard && suggested ? `Energy Dashboard is configured, but it has no compatible live source for this chart. Starting with ${this._entityName(suggested)}.` : suggested ? `No Energy Dashboard sources are configured. Starting with ${this._entityName(suggested)}.` : hasEnergyDashboard ? "Energy Dashboard is configured, but choose a compatible sensor to chart." : "Choose a sensor to chart";
    const typeHint: Record<Exclude<ChartType, "area">, string> = { line: "One continuous sensor history", multi_line: "Up to three compatible sensor histories", columns: "Hourly signed or interval readings", daily_totals: "Daily total-increasing sensor deltas" };
    const hours = chart.hours_to_show ?? (rangeMilliseconds(chart.range, type) / 3_600_000);
    const daily = type === "daily_totals";
    if (type === "multi_line") return this._renderMultiChartEditor(chart, hours);
    return html`<section class="insights chart-editor"><h3>Chart</h3><p class="hint">Start with a useful whole-home source, or choose exactly what you want to chart.</p>
      <label>Chart type<select .value=${type} @change=${(event: Event) => { const next = (event.target as HTMLSelectElement).value as Exclude<ChartType, "area">; if (next === "multi_line") { const startingEntity = chart.entity ?? this._chartCandidate("line"); this._chartChanged({ type: next, entity: undefined, energy_source: undefined, entities: chart.entities?.length ? chart.entities : startingEntity ? [{ entity: startingEntity }] : [], multi_display: chart.multi_display ?? "overlap", hours_to_show: 24, range: undefined }); } else { this._chartChanged({ type: next, ...this._chartSuggestion(next), entities: undefined, multi_display: undefined, hours_to_show: next === "daily_totals" ? 168 : 24, range: undefined }); } }}><option value="line">Line (single entity)</option><option value="multi_line">Line (multiple entities)</option><option value="columns">Columns</option><option value="daily_totals">Daily totals</option></select></label><p class="slot-hint">${typeHint[type]}</p>
      <label>${daily ? "Days to show" : "History to show (hours)"}<input type="number" min=${daily ? "2" : "1"} max=${daily ? "30" : "720"} step="1" .value=${String(daily ? Math.max(1, Math.round(hours / 24)) : hours)} @change=${this._chartDurationChanged}></label><p class="slot-hint">${daily ? "Daily totals are grouped by calendar day, up to 30 days." : "Any whole number from 1 hour to 30 days."}</p>
      <label>Suggested source</label><p class="contributor-hint">${sourceHint}${!chart.energy_source && suggested ? " — matched from compatible Home Assistant sensors" : ""}</p>
      <ha-entity-picker .hass=${this.hass} .value=${chart.entity ?? ""} .label="Use another entity" allow-custom-entity @value-changed=${(event: Event) => this._chartChanged({ entity: this._pickerValue(event), energy_source: undefined })}></ha-entity-picker>
      ${type !== "daily_totals" ? html`<label>Or use Energy Dashboard<select .value=${chart.energy_source ?? ""} @change=${this._chartEnergySourceChanged}><option value="">Direct entity (recommended)</option>${type === "columns" || type === "line" ? html`<option value="grid">Grid import / export</option>` : nothing}<option value="solar">Solar generation</option><option value="battery_soc">Battery charge</option><option value="battery_power">Battery flow</option></select></label>` : nothing}
      <details class="more-options"><summary>Fine tuning (optional)</summary>
        ${type === "line" ? html`<label class="checkbox"><input type="checkbox" .checked=${chart.show_area !== false} @change=${(event: Event) => this._chartChanged({ show_area: (event.target as HTMLInputElement).checked })}> Fill beneath the line</label><p class="slot-hint">A filled chart is the default. Turn it off for a lighter, unfilled line.</p>` : nothing}
        ${type === "line" ? html`<label>Grid lines<select .value=${chart.grid_lines ?? "none"} @change=${(event: Event) => this._chartChanged({ grid_lines: (event.target as HTMLSelectElement).value as NonNullable<ChartConfig["grid_lines"]> })}><option value="none">None (default)</option><option value="x">Vertical, time guides</option><option value="y">Horizontal, value guides</option><option value="both">Both axes</option></select></label><p class="slot-hint">Faint guides align to the visible time and value-axis labels, behind the line.</p>` : nothing}
        ${type === "line" || type === "columns" ? html`<div class="two"><label>Positive colour<input type="color" .value=${chart.positive_color ?? "#263238"} @input=${(event: Event) => this._chartChanged({ positive_color: (event.target as HTMLInputElement).value })}></label><label>Negative / export colour<input type="color" .value=${chart.negative_color ?? "#e85d20"} @input=${(event: Event) => this._chartChanged({ negative_color: (event.target as HTMLInputElement).value })}></label></div><p class="slot-hint">Orange marks values below zero, such as grid export. Leave the defaults for the restrained chart style.</p>` : nothing}
        ${daily ? html`<div class="three"><label>Primary colour<input type="color" .value=${chart.daily_primary_color ?? "#6b7280"} @input=${(event: Event) => this._chartChanged({ daily_primary_color: (event.target as HTMLInputElement).value })}></label><label>Weekend colour<input type="color" .value=${chart.weekend_color ?? "#4f555b"} @input=${(event: Event) => this._chartChanged({ weekend_color: (event.target as HTMLInputElement).value })}></label><label>Today colour<input type="color" .value=${chart.today_color ?? "#e85d20"} @input=${(event: Event) => this._chartChanged({ today_color: (event.target as HTMLInputElement).value })}></label></div><p class="slot-hint">Weekends are darker than completed weekdays. Today is highlighted because it is incomplete.</p>` : nothing}
        ${type === "columns" || daily ? html`<label>Bar opacity<input type="range" min="20" max="100" step="5" .value=${String(chart.bar_opacity ?? 100)} @input=${(event: Event) => this._chartChanged({ bar_opacity: Number((event.target as HTMLInputElement).value) })}><span class="range-value">${chart.bar_opacity ?? 100}%</span></label><p class="slot-hint">Solid bars are the default. Lower this only when you want a lighter visual treatment.</p>` : nothing}
        ${daily ? html`<label class="checkbox"><input type="checkbox" .checked=${chart.daily_average === true} @change=${(event: Event) => this._chartChanged({ daily_average: (event.target as HTMLInputElement).checked || undefined })}> Show average line</label>${chart.daily_average ? html`<div class="three"><label>Line style<select .value=${chart.daily_average_style ?? "dashed"} @change=${(event: Event) => this._chartChanged({ daily_average_style: (event.target as HTMLSelectElement).value as "solid" | "dashed" })}><option value="dashed">Dashed (default)</option><option value="solid">Solid</option></select></label><label>Colour<input type="color" .value=${chart.daily_average_color ?? "#03a9f4"} @input=${(event: Event) => this._chartChanged({ daily_average_color: (event.target as HTMLInputElement).value })}></label><label>Thickness<input type="number" min="1" max="4" step="1" .value=${String(chart.daily_average_thickness ?? 1)} @input=${(event: Event) => this._chartChanged({ daily_average_thickness: Math.max(1, Math.min(4, Number((event.target as HTMLInputElement).value))) })}></label></div><label class="checkbox"><input type="checkbox" .checked=${chart.daily_average_header !== false} @change=${(event: Event) => this._chartChanged({ daily_average_header: (event.target as HTMLInputElement).checked || undefined })}> Show AVG in header</label><p class="slot-hint">Average is calculated from the displayed daily totals, including today so far. The main header value remains today's total.</p>` : nothing}` : nothing}
        ${daily ? html`<label class="checkbox"><input type="checkbox" .checked=${chart.daily_horizontal_grid === true} @change=${(event: Event) => this._chartChanged({ daily_horizontal_grid: (event.target as HTMLInputElement).checked })}> Show horizontal value guides</label><p class="slot-hint">Faint guides align to the visible value-axis labels and sit behind the bars.</p>` : nothing}
        ${daily ? html`<label class="checkbox"><input type="checkbox" .checked=${chart.daily_week_dividers === true} @change=${(event: Event) => this._chartChanged({ daily_week_dividers: (event.target as HTMLInputElement).checked })}> Show week dividers</label>${chart.daily_week_dividers ? html`<label>Week starts on<select .value=${chart.week_start ?? (chart.week_end === "saturday" ? "sunday" : "monday")} @change=${(event: Event) => this._chartChanged({ week_start: (event.target as HTMLSelectElement).value as "monday" | "sunday", week_end: undefined })}><option value="monday">Monday (default)</option><option value="sunday">Sunday</option></select></label><p class="slot-hint">A faint divider is drawn at the end of each calendar week, behind the bars.</p>` : nothing}` : nothing}
        <div class="two"><label>Value-axis minimum<input type="number" step="any" .value=${chart.axis_min?.toString() ?? ""} placeholder="Automatic" @input=${(event: Event) => { const value = (event.target as HTMLInputElement).value; this._chartChanged({ axis_min: value === "" ? undefined : Number(value) }); }}></label><label>Value-axis maximum<input type="number" step="any" .value=${chart.axis_max?.toString() ?? ""} placeholder="Automatic" @input=${(event: Event) => { const value = (event.target as HTMLInputElement).value; this._chartChanged({ axis_max: value === "" ? undefined : Number(value) }); }}></label></div><p class="slot-hint">Optional fixed limits for the plotted values. Leave both blank to keep the automatic scale.</p>
        <div class="two"><label>Decimals<input type="number" min="0" max="4" .value=${chart.decimals?.toString() ?? ""} placeholder="Automatic" @input=${(event: Event) => { const value = (event.target as HTMLInputElement).value; this._chartChanged({ decimals: value === "" ? undefined : Number(value) }); }}></label><label>Unit override<input .value=${chart.unit ?? ""} placeholder="Home Assistant unit" @input=${(event: Event) => this._chartChanged({ unit: (event.target as HTMLInputElement).value || undefined })}></label></div>
        <label>Data source<select .value=${chart.history_source ?? "auto"} @change=${(event: Event) => this._chartChanged({ history_source: (event.target as HTMLSelectElement).value as ChartConfig["history_source"] })}><option value="auto">Automatic</option><option value="raw">Recorder history</option><option value="statistics">Long-term statistics</option></select></label>
        ${type === "columns" ? html`<label>Columns show<select .value=${chart.bucket_statistic ?? "mean"} @change=${(event: Event) => this._chartChanged({ bucket_statistic: (event.target as HTMLSelectElement).value as ChartConfig["bucket_statistic"] })}><option value="mean">Hourly mean</option><option value="last">Last value</option><option value="max">Highest value</option><option value="min">Lowest value</option></select></label>` : nothing}
      </details></section>`;
  }
  private _appearancePresetChanged(event: Event) {
    const preset = (event.target as HTMLSelectElement).value as AppearancePreset;
    if (preset === "custom") {
      const wasCustom = this._config.appearance?.preset === "custom";
      this._change({ theme: "dark", background: undefined, appearance: { ...this._config.appearance, preset, background: wasCustom ? this._config.appearance?.background ?? DEFAULT_CUSTOM_BACKGROUND : DEFAULT_CUSTOM_BACKGROUND } });
      return;
    }
    // Keep a compact, unambiguous configuration going forward. The renderer
    // resolves named presets itself; legacy top-level fields are fallback-only.
    this._change({ theme: undefined, background: undefined, appearance: { ...this._config.appearance, preset, background: undefined } });
  }
  private _customBackgroundChanged(event: Event) {
    this._change({ appearance: { ...this._config.appearance, preset: "custom", background: (event.target as HTMLInputElement).value } });
  }
  private _shadowStyleChanged(event: Event) {
    this._change({ appearance: { ...this._config.appearance, shadow_style: (event.target as HTMLSelectElement).value as "drop" | "inner" | "none", shadow: undefined } });
  }
  private _shadowOpacityChanged(event: Event) {
    const shadow_opacity = Math.max(0, Math.min(60, Number((event.target as HTMLInputElement).value)));
    this._change({ appearance: { ...this._config.appearance, shadow_opacity } });
  }
  private _shadowSpreadChanged(event: Event) {
    const shadow_spread = Math.max(-12, Math.min(16, Number((event.target as HTMLInputElement).value)));
    this._change({ appearance: { ...this._config.appearance, shadow_spread: shadow_spread || undefined } });
  }
  private _shadowOffsetChanged(axis: "x" | "y", event: Event) {
    const value = Math.max(-16, Math.min(16, Number((event.target as HTMLInputElement).value)));
    this._change({ appearance: { ...this._config.appearance, [axis === "x" ? "shadow_x" : "shadow_y"]: value || undefined } });
  }
  private _shadowColorChanged(event: Event) {
    this._change({ appearance: { ...this._config.appearance, shadow_color: (event.target as HTMLInputElement).value.toUpperCase() } });
  }
  private _cornerRadiusChanged(event: Event) {
    const corner_radius = Math.max(0, Math.min(48, Number((event.target as HTMLInputElement).value)));
    this._change({ appearance: { ...this._config.appearance, corner_radius: corner_radius === 24 ? undefined : corner_radius } });
  }
  private _resetCornerRadius() {
    this._change({ appearance: { ...this._config.appearance, corner_radius: undefined } });
  }
  private _resetShadowFineTuning() {
    this._change({ appearance: { ...this._config.appearance, shadow_opacity: undefined, shadow_spread: undefined, shadow_x: undefined, shadow_y: undefined, shadow_color: undefined } });
  }
  private _textWeightChanged(event: Event) {
    this._change({ appearance: { ...this._config.appearance, text_weight: (event.target as HTMLSelectElement).value as "bold" | "regular" | "light", style: undefined } });
  }
  private _areaIconVisibilityChanged(event: Event) {
    this._change({ appearance: { ...this._config.appearance, show_area_icon: (event.target as HTMLInputElement).checked } });
  }
  private _insightIconVisibilityChanged(event: Event) {
    this._change({ appearance: { ...this._config.appearance, show_insight_icons: (event.target as HTMLInputElement).checked } });
  }
  private _insightIconColorChanged(event: Event) {
    const color = (event.target as HTMLSelectElement).value as "default" | "black" | "grey";
    this._change({ appearance: { ...this._config.appearance, insight_icon_color: color === "default" ? undefined : color } });
  }
  private _areaIconChanged(event: Event) {
    const area_icon = this._pickerValue(event);
    this._change({ appearance: { ...this._config.appearance, area_icon: area_icon || undefined } });
  }
  private _textScaleChanged(key: keyof NonNullable<NonNullable<AreaGlanceConfig["appearance"]>["text_scale"]>, event: Event) {
    const value = Math.max(75, Math.min(160, Number((event.target as HTMLInputElement).value)));
    const textScale = { ...this._config.appearance?.text_scale, [key]: value };
    if (value === 100) delete textScale[key];
    this._change({ appearance: { ...this._config.appearance, text_scale: Object.keys(textScale).length ? textScale : undefined } });
  }
  private _resetTextScale() {
    this._change({ appearance: { ...this._config.appearance, text_scale: undefined } });
  }
  private _pickerValue(event: Event): string { return (event as CustomEvent<{ value?: string }>).detail?.value ?? ""; }
  private _areaPickerValue(area?: AreaReference): string {
    return resolvedAreaId(this.hass, area) ?? "";
  }
  private _showcaseAreaHint(area?: AreaReference) {
    const resolution = resolveAreaReference(this.hass, area);
    if (resolution.showcaseSlot === undefined) return nothing;
    return html`<p class="slot-hint">Showcase area ${resolution.showcaseSlot} ${resolution.areaId ? `resolves to ${this._areaName(area)} on this Home Assistant instance.` : "is not available on this Home Assistant instance."}</p>`;
  }
  private _areaName(area?: AreaReference): string {
    const resolution = resolveAreaReference(this.hass, area);
    if (resolution.unavailable) return `Showcase area ${resolution.showcaseSlot} unavailable`;
    const areaId = resolution.areaId;
    return areaId ? this.hass?.areas?.[areaId]?.name ?? areaId.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "this area";
  }
  private _entitiesInArea(area?: AreaReference): string[] {
    const resolution = resolveAreaReference(this.hass, area);
    return resolution.unavailable ? [] : areaEntityIds(this.hass, resolution.areaId);
  }
  private _sourceForEditor(metric: MetricConfig, preset: MetricPreset): "area" | "entity" | "entities" {
    if (preset === "attention") return "area";
    if (preset === "weather" || preset === "clock" || preset === "calendar") return "entity";
    if (preset === "lights" || (AREA_SIGNAL_PRESETS.has(preset) && preset !== "blinds")) return metric.source ?? "area";
    return metric.source ?? (metric.entity ? "entity" : AREA_MEASUREMENT_PRESETS.has(preset) || preset === "blinds" ? "area" : "entity");
  }
  private _aggregateCandidates(metric: MetricConfig, preset: MetricPreset): string[] {
    const wholeHomeAttention = preset === "attention" && metric.attention_scope === "home";
    const area = wholeHomeAttention ? "" : metric.area ?? this._config.area ?? "";
    const entities = this._entitiesInArea(area);
    if (preset === "attention") return entities;
    if (preset === "lights") return entities.filter((entityId) => entityId.startsWith(`${metric.domain ?? "light"}.`));
    if (AREA_SIGNAL_PRESETS.has(preset)) return entities.filter((entityId) => isSignalEntity(preset as AreaSignal, entityId, this.hass?.states[entityId]));
    return entities.filter((entityId) => isAreaMeasurement(preset, entityId, this.hass?.states[entityId]));
  }
  private _selectedEntityCandidates(preset: MetricPreset): string[] {
    const entities = Object.keys(this.hass?.states ?? {});
    if (preset === "lights") return entities.filter((entityId) => entityId.startsWith("light."));
    if (AREA_SIGNAL_PRESETS.has(preset)) return entities.filter((entityId) => isSignalEntity(preset as AreaSignal, entityId, this.hass?.states[entityId]));
    return entities.filter((entityId) => isAreaMeasurement(preset, entityId, this.hass?.states[entityId]));
  }
  private _entityName(entityId: string): string {
    const state = this.hass?.states[entityId];
    const formatted = state && this.hass?.formatEntityName?.(state, undefined);
    if (formatted) return formatted;
    const name = state?.attributes.friendly_name;
    return typeof name === "string" && name.trim() ? name : entityId.replace(/^[^.]+\./, "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  }
  private _contributorHint(metric: MetricConfig, preset: MetricPreset, usesArea: boolean): string | undefined {
    if (!usesArea) return undefined;
    const wholeHomeAttention = preset === "attention" && metric.attention_scope === "home";
    const area = wholeHomeAttention ? "" : metric.area ?? this._config.area;
    const candidates = this._aggregateCandidates(metric, preset);
    const count = includedEntityIds(metric, candidates).length;
    const location = area ? `in ${this._areaName(area)}` : "across your home";
    if (preset === "attention") {
      const checks = attentionTypes(metric).map((type) => type === "unavailable" ? "unavailable entities" : "available updates").join(" and ");
      return `Checking ${count} entities for ${checks} ${location}.`;
    }
    const noun = preset === "lights" ? "light" : preset === "blinds" ? "blind" : "compatible sensor";
    return `Using ${count} ${noun}${count === 1 ? "" : "s"} ${location}.`;
  }
  private _inferredProfile(area: AreaReference | undefined, requested: NonNullable<AreaGlanceConfig["profile"]>): Exclude<NonNullable<AreaGlanceConfig["profile"]>, "auto"> {
    if (requested !== "auto") return requested;
    if (!area) return "house";
    const name = this._areaName(area).toLowerCase();
    if (/(garage|utility|plant|battery)/.test(name)) return "battery";
    if (/(energy|solar|power)/.test(name)) return "energy";
    if (/(living|lounge|family|den|media|cinema|tv)/.test(name)) return "media";
    return "room";
  }
  private _populateAreaPreset(area: AreaReference | undefined, requestedProfile = this._config.profile ?? "auto") {
    const profile = this._inferredProfile(area, requestedProfile);
    if (profile === "energy" && !area) {
      this._suggestionsNeedUpdate = false;
      this._change({
        area: undefined,
        profile: "energy",
        title: this._config.layout === "metrics-only" ? this._config.title : "Energy",
        status: undefined,
        metrics: DEFAULT_ENERGY_METRICS.map((metric) => ({ ...metric })),
      });
      return;
    }
    if (profile === "battery" && !area) {
      this._suggestionsNeedUpdate = false;
      this._change({
        area: undefined,
        profile: "battery",
        title: this._config.layout === "metrics-only" ? this._config.title : "Home battery",
        status: undefined,
        metrics: DEFAULT_BATTERY_METRICS.map((metric) => ({ ...metric })),
      });
      return;
    }
    if (profile === "cameras") {
      this._suggestionsNeedUpdate = false;
      const metrics = cameraProfileMetrics(this.hass);
      this._change({
        area: undefined,
        profile: "cameras",
        title: this._config.layout === "metrics-only" ? this._config.title : "Cameras",
        status: undefined,
        metrics: metrics.length ? metrics : [presetMetric("camera")],
      });
      return;
    }
    const entities = this._entitiesInArea(area);
    const state = (entityId: string) => this.hass?.states[entityId];
    const first = (predicate: (entityId: string) => boolean) => entities.find(predicate);
    const hasDeviceClass = (entityId: string, deviceClass: string) => isMeasurementSensor(entityId, state(entityId)) && state(entityId)?.attributes.device_class === deviceClass;
    const isPower = (entityId: string) => isAreaMeasurement("power", entityId, state(entityId));
    const metrics: MetricConfig[] = [];
    const addEntityMetric = (preset: MetricPreset, entity?: string, overrides: Partial<MetricConfig> = {}) => { if (entity && metrics.length < 5) metrics.push({ ...presetMetric(preset), entity, source: "entity", ...overrides }); };
    const addAreaMetric = (preset: MetricPreset, available: boolean, overrides: Partial<MetricConfig> = {}) => { if (available && metrics.length < 5) metrics.push({ ...presetMetric(preset), source: "area", ...(area ? { area } : {}), ...overrides }); };
    const temperature = first((id) => hasDeviceClass(id, "temperature"));
    const humidity = first((id) => hasDeviceClass(id, "humidity"));
    const co2 = first((id) => isAreaMeasurement("co2", id, state(id)));
    const pm25 = first((id) => isAreaMeasurement("pm25", id, state(id)));
    const voc = first((id) => isAreaMeasurement("voc", id, state(id)));
    const aqi = first((id) => isAreaMeasurement("aqi", id, state(id)));
    const airQualityPreset = ([ ["co2", co2], ["pm25", pm25], ["voc", voc], ["aqi", aqi] ] as const).find(([, entity]) => Boolean(entity))?.[0];
    const power = first(isPower);
    const battery = first((id) => hasDeviceClass(id, "battery"));
    const homeZone = state("zone.home") && asNumber(state("zone.home")?.state ?? "") !== undefined ? "zone.home" : undefined;
    const presence = first((id) => isSignalEntity("presence", id, state(id)));
    const media = first((id) => id.startsWith("media_player."));
    const device = media ?? first((id) => id.startsWith("switch.") || id.startsWith("fan.") || id.startsWith("climate."));
    const solar = first((id) => isPower(id) && /(solar|generation|pv)/.test(id));
    const grid = first((id) => isPower(id) && /(grid|export|import)/.test(id));
    const alarm = first(isAlarmEntity);
    const door = first((id) => isDoorEntity(id, state(id)));
    const windowSensor = first((id) => isWindowEntity(id, state(id)));
    const lock = first((id) => isLockEntity(id, state(id)));
    const blind = first((id) => isBlindEntity(id, state(id)));
    if (profile === "security") {
      addEntityMetric("alarm", alarm);
      addAreaMetric("doors", Boolean(door));
      addAreaMetric("windows", Boolean(windowSensor));
      addAreaMetric("locks", Boolean(lock));
    } else if (profile === "battery") {
      addEntityMetric("battery", battery);
      addEntityMetric("power", power);
      addEntityMetric("power", solar, { label: "Solar", icon: "mdi:solar-power-variant" });
      addEntityMetric("power", grid, { label: "Grid", icon: "mdi:transmission-tower" });
      addEntityMetric("temperature", temperature);
    } else if (profile === "energy") {
      addEntityMetric("power", first((id) => isPower(id) && /home/.test(id)) ?? power, { label: "Home", icon: "mdi:home-lightning-bolt" });
      addEntityMetric("power", solar, { label: "Solar", icon: "mdi:solar-power-variant" });
      addEntityMetric("battery", battery);
      addEntityMetric("power", grid, { label: "Grid", icon: "mdi:transmission-tower" });
      addEntityMetric("temperature", temperature);
    } else if (profile === "media") {
      addAreaMetric("temperature", Boolean(temperature));
      addAreaMetric("lights", Boolean(first((id) => id.startsWith("light."))));
      addEntityMetric("device", media ?? device, { label: media ? "Media" : undefined });
      addAreaMetric("blinds", Boolean(blind));
      addAreaMetric("power", Boolean(power));
      if (airQualityPreset) addAreaMetric(airQualityPreset, true);
      addAreaMetric("humidity", Boolean(humidity));
    } else if (profile === "house") {
      const outsideTemperature = first((id) => hasDeviceClass(id, "temperature") && /(outside|outdoor|exterior)/.test(id));
      const insideTemperature = first((id) => hasDeviceClass(id, "temperature") && id !== outsideTemperature) ?? temperature;
      addEntityMetric("temperature", insideTemperature, { label: "Inside", icon: "mdi:home-thermometer" });
      addEntityMetric("temperature", outsideTemperature, { label: "Outside", icon: "mdi:thermometer-lines" });
      addAreaMetric("lights", Boolean(first((id) => id.startsWith("light."))));
      addEntityMetric("people_home", homeZone, { label: "People home" });
      addAreaMetric("power", Boolean(power));
    } else {
      addAreaMetric("temperature", Boolean(temperature));
      addAreaMetric("lights", Boolean(first((id) => id.startsWith("light."))));
      addAreaMetric("blinds", Boolean(blind));
      addAreaMetric("humidity", Boolean(humidity));
      if (airQualityPreset) addAreaMetric(airQualityPreset, true);
      addAreaMetric("power", Boolean(power));
      if (profile === "room") addEntityMetric("device", device);
    }
    const motion = first((id) => isSignalEntity("motion", id, state(id)));
    this._suggestionsNeedUpdate = false;
    this._change({
      area: area || undefined,
      profile: requestedProfile,
      title: this._config.layout === "metrics-only" ? this._config.title : profile === "house" ? "House" : profile === "security" ? "Security" : profile === "energy" ? "Energy" : this._areaName(area),
      status: profile === "security" ? { source: "security", action: "status-details" } : presence && (profile === "room" || profile === "media") ? { source: "area_presence", ...(area ? { area } : {}) } : motion && (profile === "room" || profile === "media") ? { source: "area_motion", ...(area ? { area } : {}), active_text: "Motion", inactive_text: "No motion", show_last_changed: true, last_changed_text: "Last motion" } : door && profile === "house" ? { source: "area_doors", inactive_text: "All doors" } : this._config.status,
      metrics: metrics.length ? metrics : this._config.metrics,
    });
  }
  private _areaSelected(event: Event) {
    const area = this._pickerValue(event);
    if (!area) return;
    if (!this._config.area) {
      this._populateAreaPreset(area);
      return;
    }
    this._change({ area });
    this._suggestionsNeedUpdate = true;
  }
  private _applySuggestions() { this._populateAreaPreset(this._config.area ?? "", this._config.profile ?? "auto"); }
  private _metricSourceChanged(index: number, event: Event) {
    const source = (event.target as HTMLSelectElement).value as "area" | "entity" | "entities";
    this._updateMetric(index, { source, ...(source === "area" ? { entity: undefined, entities: undefined } : source === "entities" ? { entity: undefined } : { entities: undefined }) });
  }
  private _addSelectedEntity(index: number) {
    const metric = (this._config.metrics ?? [])[index];
    this._updateMetric(index, { source: "entities", entities: [...(metric.entities ?? []), ""] });
  }
  private _selectedEntityChanged(index: number, entityIndex: number, event: Event) {
    const metric = (this._config.metrics ?? [])[index];
    const entities = [...(metric.entities ?? [])];
    const entity = this._pickerValue(event);
    if (entity) entities[entityIndex] = entity;
    this._updateMetric(index, { source: "entities", entities: [...new Set(entities.filter(Boolean))] });
  }
  private _removeSelectedEntity(index: number, entityIndex: number) {
    const metric = (this._config.metrics ?? [])[index];
    this._updateMetric(index, { entities: (metric.entities ?? []).filter((_, currentIndex) => currentIndex !== entityIndex) });
  }
  private _membershipModeChanged(index: number, event: Event) {
    const metric = (this._config.metrics ?? [])[index];
    const preset = metric.preset ?? "custom";
    const candidates = this._aggregateCandidates(metric, preset);
    const currentlyIncluded = new Set(includedEntityIds(metric, candidates));
    const mode = (event.target as HTMLSelectElement).value as NonNullable<NonNullable<MetricConfig["membership"]>["mode"]>;
    const membership = mode === "selected_only"
      ? { mode, include: candidates.filter((entityId) => currentlyIncluded.has(entityId)) }
      : { mode, exclude: candidates.filter((entityId) => !currentlyIncluded.has(entityId)) };
    this._updateMetric(index, { membership });
  }
  private _membershipEntityChanged(index: number, entityId: string, event: Event) {
    const included = (event.target as HTMLInputElement).checked;
    const metric = (this._config.metrics ?? [])[index];
    const mode = metric.membership?.mode ?? "auto_except";
    const current = new Set(mode === "selected_only" ? metric.membership?.include ?? [] : metric.membership?.exclude ?? []);
    if (mode === "selected_only") {
      if (included) current.add(entityId); else current.delete(entityId);
      this._updateMetric(index, { membership: { mode, include: [...current] } });
      return;
    }
    if (included) current.delete(entityId); else current.add(entityId);
    this._updateMetric(index, { membership: current.size ? { mode, exclude: [...current] } : undefined });
  }
  private _resetMembership(index: number) { this._updateMetric(index, { membership: undefined }); }
  private _attentionScopeChanged(index: number, event: Event) {
    this._updateMetric(index, { attention_scope: (event.target as HTMLSelectElement).value === "home" ? "home" : undefined });
  }
  private _attentionTypeChanged(index: number, type: "unavailable" | "updates", event: Event) {
    const metric = (this._config.metrics ?? [])[index];
    const enabled = (event.target as HTMLInputElement).checked;
    const types = new Set(attentionTypes(metric));
    if (enabled) types.add(type);
    else if (types.size > 1) types.delete(type);
    const next = (["unavailable", "updates"] as const).filter((candidate) => types.has(candidate));
    this._updateMetric(index, { attention_types: next.length === 2 ? undefined : next });
  }
  private _updateMetric(index: number, change: Partial<MetricConfig>) {
    const metrics = [...(this._config.metrics ?? [])];
    const updated = { ...metrics[index], ...change };
    if (change.preset && change.preset !== metrics[index].preset) {
      delete updated.secondary_entity;
      delete updated.secondary_text;
      delete updated.icon_entity;
      delete updated.icon_on;
      delete updated.icon_off;
      delete updated.icon_unknown;
      delete updated.color_entity;
      delete updated.color_rules;
      delete updated.thresholds;
      delete updated.aggregation;
      delete updated.membership;
      delete updated.entities;
      delete updated.attention_types;
      delete updated.attention_scope;
      delete updated.vacuum_display;
      Object.assign(updated, presetMetric(change.preset));
      if (AUTOMATIC_METRIC_PRESETS.includes(change.preset)) updated.entity = undefined;
      else {
        updated.source = "entity";
        if (change.preset === "people_home" && this.hass?.states["zone.home"]) updated.entity = "zone.home";
      }
    }
    metrics[index] = updated;
    this._change({ metrics });
  }
  private _updateColorRule(index: number, ruleIndex: number, change: Partial<NonNullable<MetricConfig["color_rules"]>[number]>) {
    const metrics = [...(this._config.metrics ?? [])];
    const rules = [...(metrics[index].color_rules ?? [])];
    rules[ruleIndex] = { ...rules[ruleIndex], ...change };
    metrics[index] = { ...metrics[index], color_rules: rules };
    this._change({ metrics });
  }
  private _addColorRule(index: number) {
    const metrics = [...(this._config.metrics ?? [])];
    metrics[index] = { ...metrics[index], color_rules: [...(metrics[index].color_rules ?? []), { state: "", color: "" }] };
    this._change({ metrics });
  }
  private _removeColorRule(index: number, ruleIndex: number) {
    const metrics = [...(this._config.metrics ?? [])];
    metrics[index] = { ...metrics[index], color_rules: (metrics[index].color_rules ?? []).filter((_, currentIndex) => currentIndex !== ruleIndex) };
    this._change({ metrics });
  }
  private _moveMetric(index: number, direction: -1 | 1) {
    const metrics = [...(this._config.metrics ?? [])];
    const destination = index + direction;
    if (destination < 0 || destination >= metrics.length) return;
    [metrics[index], metrics[destination]] = [metrics[destination], metrics[index]];
    this._change({ metrics });
  }
  private _duplicateMetric(index: number) {
    const metrics = [...(this._config.metrics ?? [])];
    if (metrics.length >= 5) return;
    metrics.splice(index + 1, 0, structuredClone(metrics[index]));
    this._change({ metrics });
  }
  private _dragStart(index: number, event: DragEvent) {
    event.stopPropagation();
    if (this._dragEndTimer !== undefined) window.clearTimeout(this._dragEndTimer);
    this._dragEndTimer = undefined;
    this._dragDropCommitted = false;
    this._draggedMetricIndex = index;
    this._dragOverMetricIndex = undefined;
    const source = (event.currentTarget as HTMLElement).closest<HTMLElement>(".insight-editor");
    const next = source?.nextElementSibling as HTMLElement | null;
    const previous = source?.previousElementSibling as HTMLElement | null;
    // Include the editor's inter-row gap, otherwise shifted neighbours would
    // overlap the translucent source row during the live preview.
    this._draggedMetricHeight = next ? next.offsetTop - source!.offsetTop
      : previous ? source!.offsetTop - previous.offsetTop
        : source?.offsetHeight ?? 0;
    this._dragMetricMidpoints = source ? Array.from(source.parentElement!.querySelectorAll<HTMLElement>(":scope > .insight-editor"))
      .map((row, rowIndex) => {
        const bounds = row.getBoundingClientRect();
        return { index: rowIndex, midpoint: bounds.top + bounds.height / 2 };
      }) : [];
    event.dataTransfer?.setData("text/plain", String(index));
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.dropEffect = "move";
    }
    this.requestUpdate();
  }
  private _dragOver(event: DragEvent) {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    if (this._draggedMetricIndex === undefined || !this._dragMetricMidpoints.length) return;
    const target = this._dragMetricMidpoints.reduce((nearest, candidate) =>
      Math.abs(candidate.midpoint - event.clientY) < Math.abs(nearest.midpoint - event.clientY) ? candidate : nearest,
    ).index;
    const nextTarget = target === this._draggedMetricIndex ? undefined : target;
    if (nextTarget === this._dragOverMetricIndex) return;
    this._dragOverMetricIndex = nextTarget;
    this.requestUpdate();
  }
  private _resetDragState() {
    this._draggedMetricIndex = undefined;
    this._dragOverMetricIndex = undefined;
    this._draggedMetricHeight = 0;
    this._dragMetricMidpoints = [];
    this.requestUpdate();
  }

  private _commitMetricMove(from: number, to: number) {
    if (!Number.isInteger(from) || !Number.isInteger(to) || from === to || from < 0 || to < 0) return;
    const metrics = [...(this._config.metrics ?? [])];
    const [moved] = metrics.splice(from, 1);
    if (!moved) return;
    metrics.splice(to, 0, moved);
    this._change({ metrics });
  }

  private _dragEnd(event: DragEvent) {
    const from = this._draggedMetricIndex;
    const to = this._dragOverMetricIndex;
    if (from === undefined) {
      this._dragDropCommitted = false;
      return;
    }
    // `drop` normally fires first. Some embedded/mobile WebViews dispatch
    // `dragend` first, so defer a one-time fallback until the event cycle has
    // completed. A cancelled/outside drop reports `none` and never reorders.
    const canUseFallback = event.dataTransfer?.dropEffect === "move";
    this._dragEndTimer = window.setTimeout(() => {
      if (!this._dragDropCommitted && canUseFallback && to !== undefined) this._commitMetricMove(from, to);
      this._resetDragState();
      this._dragDropCommitted = false;
      this._dragEndTimer = undefined;
    }, 0);
  }

  private _dropMetric(index: number, event: DragEvent) {
    event.preventDefault();
    const from = this._draggedMetricIndex ?? Number(event.dataTransfer?.getData("text/plain"));
    // Prefer the live target calculated from row midpoints. It is resilient to
    // the row shifting animation and avoids relying on a stale render closure.
    const to = this._dragOverMetricIndex ?? index;
    this._dragDropCommitted = true;
    this._commitMetricMove(from, to);
    this._resetDragState();
  }
  /** Shift surrounding rows into the source row's space without moving the
   * active draggable element in the DOM (which would cancel native dragging). */
  private _dragShift(index: number): number {
    const from = this._draggedMetricIndex;
    const to = this._dragOverMetricIndex;
    if (from === undefined || to === undefined || !this._draggedMetricHeight) return 0;
    if (from < to && index > from && index <= to) return -this._draggedMetricHeight;
    if (to < from && index >= to && index < from) return this._draggedMetricHeight;
    return 0;
  }
  private _metricAction(metric: MetricConfig, trigger: "tap" | "hold" | "double"): ActionConfig | undefined {
    return trigger === "tap" ? metric : trigger === "hold" ? metric.hold_action : metric.double_tap_action;
  }
  private _metricActionChanged(index: number, trigger: "tap" | "hold" | "double", event: Event) {
    const action = (event.target as HTMLSelectElement).value as NonNullable<ActionConfig["action"]> | "auto";
    if (trigger === "tap") {
      this._updateMetric(index, { action: action === "auto" ? undefined : action });
      return;
    }
    this._updateMetric(index, { [trigger === "hold" ? "hold_action" : "double_tap_action"]: action === "auto" ? undefined : { action } });
  }
  private _metricActionInput(index: number, trigger: "tap" | "hold" | "double", key: keyof ActionConfig, event: Event) {
    const value = (event.target as HTMLInputElement).value;
    if (trigger === "tap") {
      this._updateMetric(index, { [key]: value || undefined });
      return;
    }
    const metric = (this._config.metrics ?? [])[index];
    const actionKey = trigger === "hold" ? "hold_action" : "double_tap_action";
    this._updateMetric(index, { [actionKey]: { ...metric[actionKey], [key]: value || undefined } });
  }
  private _toggleMetricConfirmation(index: number, trigger: "tap" | "hold" | "double", event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    const message = checked ? "Are you sure?" : undefined;
    if (trigger === "tap") { this._updateMetric(index, { confirmation: message }); return; }
    const metric = (this._config.metrics ?? [])[index];
    const actionKey = trigger === "hold" ? "hold_action" : "double_tap_action";
    this._updateMetric(index, { [actionKey]: { ...metric[actionKey], confirmation: message } });
  }
  private _metricActionFields(index: number, metric: MetricConfig, trigger: "tap" | "hold" | "double", usesArea: boolean) {
    const config = this._metricAction(metric, trigger);
    const action = config?.action ?? "auto";
    const title = trigger === "tap" ? "When tapped" : trigger === "hold" ? "When held" : "When double-tapped";
    const canToggle = Boolean(metric.entity) && !usesArea;
    return html`<label>${title}<select .value=${action} @change=${(event: Event) => this._metricActionChanged(index, trigger, event)}>
      <option value="auto">${trigger === "tap" ? "Automatic" : "Not set"}</option>
      ${usesArea ? html`<option value="metric-details">Show included entities</option><option value="area-details">Show area details</option>` : html`<option value="more-info">Show entity details</option>`}
      <option value="navigate">Navigate to a dashboard page</option>${canToggle ? html`<option value="toggle">Toggle this entity</option>` : nothing}<option value="call-service">Call a service</option><option value="none">Do nothing</option>
    </select></label>
    ${action === "navigate" ? html`<label>Dashboard path <input .value=${config?.navigation_path ?? ""} placeholder="/dashboard/room" @input=${(event: Event) => this._metricActionInput(index, trigger, "navigation_path", event)}></label>` : nothing}
    ${action === "call-service" ? html`<label>Service <input .value=${config?.service ?? ""} placeholder="light.turn_on" @input=${(event: Event) => this._metricActionInput(index, trigger, "service", event)}></label>` : nothing}
    ${action === "toggle" || action === "call-service" ? html`<label class="checkbox"><input type="checkbox" .checked=${Boolean(config?.confirmation)} @change=${(event: Event) => this._toggleMetricConfirmation(index, trigger, event)}> Ask for confirmation</label>` : nothing}`;
  }
  private _updateThreshold(index: number, thresholdIndex: number, change: Partial<NonNullable<MetricConfig["thresholds"]>[number]>) {
    const metrics = [...(this._config.metrics ?? [])];
    const thresholds = [...(metrics[index].thresholds ?? [])];
    thresholds[thresholdIndex] = { ...thresholds[thresholdIndex], ...change };
    metrics[index] = { ...metrics[index], thresholds };
    this._change({ metrics });
  }
  private _addThreshold(index: number) {
    const metrics = [...(this._config.metrics ?? [])];
    metrics[index] = { ...metrics[index], thresholds: [...(metrics[index].thresholds ?? []), { above: undefined, color: "" }] };
    this._change({ metrics });
  }
  private _removeThreshold(index: number, thresholdIndex: number) {
    const metrics = [...(this._config.metrics ?? [])];
    metrics[index] = { ...metrics[index], thresholds: (metrics[index].thresholds ?? []).filter((_, currentIndex) => currentIndex !== thresholdIndex) };
    this._change({ metrics });
  }
  private _aggregationChanged(index: number, event: Event) {
    const value = (event.target as HTMLSelectElement).value;
    this._updateMetric(index, { aggregation: value === "auto" ? undefined : value as NonNullable<MetricConfig["aggregation"]> });
  }
  private _removeMetric(index: number) { this._change({ metrics: (this._config.metrics ?? []).filter((_, metricIndex) => metricIndex !== index) }); }
  private _addMetric() { this._change({ metrics: [...(this._config.metrics ?? []), presetMetric("temperature")] }); }

  protected render() {
    const metrics = this._config.metrics ?? [];
    const purpose = this._purpose();
    const chart = this._config.chart ?? {};
    const explicitAppearancePreset = this._config.appearance?.preset as AppearancePreset | undefined;
    const legacyBackground = this._config.background;
    const appearancePreset: AppearancePreset = explicitAppearancePreset
      ?? (legacyBackground ? "custom" : this._config.theme === "light" ? "light" : this._config.theme === "dark" ? "charcoal" : "theme");
    const textScale = this._config.appearance?.text_scale ?? {};
    const shadowStyle = this._config.appearance?.shadow_style ?? (this._config.appearance?.shadow === false ? "none" : "drop");
    const shadowOpacity = Math.max(0, Math.min(60, Number(this._config.appearance?.shadow_opacity ?? 18)));
    const shadowSpread = Math.max(-12, Math.min(16, Number(this._config.appearance?.shadow_spread ?? 0)));
    const shadowX = Math.max(-16, Math.min(16, Number(this._config.appearance?.shadow_x ?? 0)));
    const shadowY = Math.max(-16, Math.min(16, Number(this._config.appearance?.shadow_y ?? 8)));
    const shadowColor = /^#[0-9a-f]{6}$/i.test(this._config.appearance?.shadow_color ?? "") ? this._config.appearance?.shadow_color ?? "#000000" : "#000000";
    const cornerRadius = Math.max(0, Math.min(48, Number(this._config.appearance?.corner_radius ?? 24)));
    const textScaleControls = (purpose === "chart"
      ? [["title", "Header"], ["value", "Header value"], ["label", "History range"], ["chart_x_axis", "X-axis labels"], ["chart_y_axis", "Y-axis labels"], ["chart_bar_labels", "Bar values"]]
      : [["title", "Header"], ["status", "Header status"], ["value", "Insight values"], ["label", "Insight labels"]]
    ) as [keyof typeof textScale, string][];
    const status = this._config.status;
    const statusSource = status?.source ?? (status?.entity ? "entity" : "area_motion");
    const statusAction = status?.action ?? "none";
    const usesAreaStatus = statusSource === "security" || Boolean(statusSignal(statusSource));
    const statusAreaLabel = statusSource === "security" ? "Security area (optional)" : statusSource === "area_doors" ? "Door area" : statusSource === "area_windows" ? "Window area" : statusSource === "area_leaks" ? "Area to check for leaks" : statusSource === "area_presence" ? "Presence area" : "Motion area";
    const statusCandidates = status && usesAreaStatus ? this._statusCandidates(status) : [];
    const includedStatusEntities = new Set(status ? includedEntityIds(status, statusCandidates) : []);
    const statusArea = status?.area ?? this._config.area;
    const wholeHomeStatus = !statusArea;
    const areaLabel = purpose === "energy" ? "Which energy area?" : purpose === "battery" ? "Where is the battery system?" : "Which area?";
    const currentAreaName = this._config.area ? this._areaName(this._config.area) : "this area";
    const headerAction = this._config.header_action?.action ?? "none";
    return html`<div class="editor">
      <h3>Area Glance</h3>
      <p class="hint">Choose a place first. Area Glance suggests useful live insights; you can change any of them afterwards.</p>
      <section class="setup">
        <span class="section-label">What does this card show?</span>
        <div class="purpose-grid">
          ${([ ["area", "An area", "Room insights"], ["house", "Whole home", "Home overview"], ["energy", "Energy", "Energy system"], ["battery", "Home battery", "Battery system"], ["security", "Security", "Home security"], ["cameras", "Cameras", "Live camera feeds"], ["chart", "Chart", "Compact history"] ] as const).map(([value, title, description]) => html`<button class="purpose ${purpose === value ? "selected" : ""}" aria-pressed=${purpose === value} @click=${() => this._purposeSelected(value)}><strong>${title}</strong><small>${description}</small></button>`)}
        </div>
        ${purpose === "chart" ? html`<p class="applied">A dedicated chart uses one selected source. Its live summary updates immediately; recorded history refreshes calmly in the background.</p>` : purpose === "house" || purpose === "security" || purpose === "energy" || purpose === "battery" || purpose === "cameras" ? html`<p class="applied">${purpose === "energy" ? "System-wide live insights come from the Energy Dashboard setup. If it is not configured, add your own entity insights below." : purpose === "battery" ? "Battery charge, flow, solar, and grid readings come from the Energy Dashboard setup. If it is not configured, replace those slots with your own entity insights." : purpose === "security" ? "Whole-home security suggestions are applied." : purpose === "cameras" ? "Up to three feeds are selected: one lower-resolution camera per device where Home Assistant exposes that information." : "Whole-home suggestions are applied."} You can refine the insights below.</p>` : html`<ha-area-picker .hass=${this.hass} .value=${this._areaPickerValue(this._config.area)} .label=${areaLabel} @value-changed=${this._areaSelected}></ha-area-picker>${this._showcaseAreaHint(this._config.area)}${this._suggestionsNeedUpdate ? html`<div class="suggestion-update"><span>${currentAreaName} is selected. Update the insights to match it?</span><button class="primary" @click=${this._applySuggestions}>Update suggestions</button></div>` : this._config.area ? html`<p class="applied">Suggestions are based on ${currentAreaName}. Change any insight below.</p>` : nothing}`}
      </section>
      ${purpose === "chart" ? html`<section class="card-layout">
        <span class="section-label">What layout does this card have?</span>
        <label>Card layout<select .value=${this._config.layout === "stacked" ? "stacked" : "header"} @change=${this._layoutChanged}><option value="header">Title beside chart (default)</option><option value="stacked">Title above chart</option></select></label>
      </section>` : html`<section class="card-layout">
        <span class="section-label">What layout does this card have?</span>
        <label>Card layout<select .value=${this._config.layout ?? "header"} @change=${this._layoutChanged}><option value="header">Title beside insights (default)</option><option value="stacked">Title above insights</option><option value="tower">Insight tower (one column)</option><option value="metrics-only">Insights only</option></select></label>
      </section>`}
      ${purpose === "chart" ? this._renderChartEditor() : html`<section class="insights"><h3>Insights</h3><p class="hint">Keep up to five. They resize automatically to fit the card.</p>
      ${metrics.map((metric, index) => {
        const preset = metric.preset ?? "custom";
        const supportsAggregate = AREA_MEASUREMENT_PRESETS.has(preset) || preset === "lights" || AREA_SIGNAL_PRESETS.has(preset);
        const supportsValueAggregation = AREA_MEASUREMENT_PRESETS.has(preset);
        const canChooseSource = supportsAggregate && preset !== "attention";
        const source = this._sourceForEditor(metric, preset);
        const usesArea = source === "area";
        const wholeHomeAggregate = usesArea && (metric.area === "" || (!metric.area && !this._config.area) || (preset === "attention" && metric.attention_scope === "home"));
        const usesSelectedEntities = source === "entities";
        const usesAggregate = usesArea || usesSelectedEntities;
        const selfContained = preset === "clock" || preset === "calendar";
        const requiresEntity = source === "entity" && !selfContained;
        const isBinarySensor = requiresEntity && metric.entity?.startsWith("binary_sensor.");
        const sourceLabel = metric.energy_source ? "Energy Dashboard" : usesArea ? (wholeHomeAggregate ? "Whole home" : preset === "attention" ? "Area health" : preset === "lights" ? "Area count" : "Whole area") : usesSelectedEntities ? "Selected entities" : selfContained ? "Live date & time" : preset === "people_home" ? "Home zone" : "One entity";
        const contributorHint = this._contributorHint(metric, preset, usesArea);
        const candidates = usesArea ? this._aggregateCandidates(metric, preset) : [];
        const selectedCandidates = usesSelectedEntities ? this._selectedEntityCandidates(preset) : [];
        const included = new Set(includedEntityIds(metric, candidates));
        const membershipMode = metric.membership?.mode ?? "auto_except";
        const selectedAttentionTypes = new Set(attentionTypes(metric));
        const supportsThresholds = ["temperature", "humidity", "lights", "power", "battery", "co2", "pm25", "voc", "aqi"].includes(preset);
        const supportsDecimals = AREA_MEASUREMENT_PRESETS.has(preset) || ["battery", "device", "custom", "weather"].includes(preset);
        const isTemperatureDisplay = preset === "temperature" || (preset === "weather" && ["temperature", "apparent_temperature"].includes(metric.weather_display ?? "condition"));
        const unitOptions = preset === "power"
          ? [["", "Automatic"], ["W", "Watts (W)"], ["kW", "Kilowatts (kW)"], ["MW", "Megawatts (MW)"]]
          : isTemperatureDisplay ? [["", "Home Assistant default"], ["°C", "Celsius (°C)"], ["°F", "Fahrenheit (°F)"]]
            : undefined;
        return html`<details class="insight-editor ${this._draggedMetricIndex === index ? "dragging" : ""} ${this._dragOverMetricIndex === index ? "drag-over" : ""}" style=${`--reorder-shift:${this._dragShift(index)}px`} @dragover=${(event: DragEvent) => this._dragOver(event)} @drop=${(event: DragEvent) => this._dropMetric(index, event)}>
        <summary><span class="drag-handle" draggable="true" role="img" aria-label="Drag insight to reorder" title="Drag to reorder" @click=${(event: Event) => { event.preventDefault(); event.stopPropagation(); }} @dragstart=${(event: DragEvent) => this._dragStart(index, event)} @dragend=${(event: DragEvent) => this._dragEnd(event)}>⠿</span><ha-icon .icon=${metric.icon ?? PRESETS[preset].icon}></ha-icon><span class="insight-name">${PRESETS[preset].label}</span><span class="source-pill">${sourceLabel}</span></summary>
        <div class="insight-fields"><label>What should this show?
          <select .value=${metric.preset ?? "custom"} @change=${(e: Event) => this._updateMetric(index, { preset: (e.target as HTMLSelectElement).value as MetricPreset })}>
            <optgroup label="Automatic area insights">${AUTOMATIC_METRIC_PRESETS.map((option) => html`<option value=${option}>${PRESETS[option].label}</option>`)}</optgroup>
            <optgroup label="Chosen entities and utilities">${DEVICE_METRIC_PRESETS.map((option) => html`<option value=${option}>${PRESETS[option].label}</option>`)}</optgroup>
            ${preset === "occupancy" ? html`<option value="occupancy">${PRESETS.occupancy.label}</option>` : nothing}
          </select>
        </label>
        <p class="slot-hint">${SLOT_HELPERS[preset]}</p>
        ${metric.energy_source ? html`<p class="slot-hint">This live reading is linked to the matching source in your Energy Dashboard. Remove it or add another insight if you would prefer a manual entity.</p>` : canChooseSource ? html`<label>Use data from
          <select .value=${source} @change=${(e: Event) => this._metricSourceChanged(index, e)}>
            <option value="area">Whole area or home (recommended)</option>
            <option value="entities">Selected entities</option>
            <option value="entity">One entity</option>
          </select>
        </label>` : nothing}
        ${preset === "attention" ? html`<label>Check
          <select .value=${metric.attention_scope ?? "area"} @change=${(e: Event) => this._attentionScopeChanged(index, e)}><option value="area">This area (or all when blank)</option><option value="home">Whole home</option></select>
        </label>
        <details class="attention-options"><summary>What needs attention</summary><label class="checkbox"><input type="checkbox" .checked=${selectedAttentionTypes.has("unavailable")} ?disabled=${selectedAttentionTypes.size === 1 && selectedAttentionTypes.has("unavailable")} @change=${(e: Event) => this._attentionTypeChanged(index, "unavailable", e)}> Unavailable entities</label><label class="checkbox"><input type="checkbox" .checked=${selectedAttentionTypes.has("updates")} ?disabled=${selectedAttentionTypes.size === 1 && selectedAttentionTypes.has("updates")} @change=${(e: Event) => this._attentionTypeChanged(index, "updates", e)}> Updates available</label><p class="slot-hint">At least one check stays enabled. Updates use Home Assistant Update entities, with compatibility for legacy update binary sensors.</p></details>` : nothing}
        ${usesArea && !(preset === "attention" && metric.attention_scope === "home") ? html`<ha-area-picker .hass=${this.hass} .value=${this._areaPickerValue(metric.area ?? this._config.area)} .label=${preset === "attention" ? "Area to check (leave blank for all)" : preset === "lights" ? "Area to count (leave blank for all)" : preset === "blinds" ? "Area with blinds (leave blank for all)" : "Area to summarise (leave blank for all)"} @value-changed=${(e: Event) => this._updateMetric(index, { source: "area", area: this._pickerValue(e) })}></ha-area-picker>${this._showcaseAreaHint(metric.area ?? this._config.area)}` : nothing}
        ${usesArea && contributorHint ? html`<p class="contributor-hint">${contributorHint}</p>` : nothing}
        ${usesSelectedEntities ? html`<div class="selected-entities"><p class="slot-hint">Choose compatible entities from anywhere in Home Assistant. They are combined using the option below.</p>${(metric.entities ?? []).map((entityId, entityIndex) => html`<div class="selected-entity"><ha-entity-picker .hass=${this.hass} .value=${entityId} .label=${`${PRESETS[preset].label} entity ${entityIndex + 1}`} allow-custom-entity @value-changed=${(e: Event) => this._selectedEntityChanged(index, entityIndex, e)}></ha-entity-picker><button class="remove-rule" aria-label="Remove selected entity" @click=${() => this._removeSelectedEntity(index, entityIndex)}>Remove</button></div>`)}${!(metric.entities?.length) ? html`<p class="slot-hint">Add the entities you want to combine.</p>` : nothing}<button class="add-rule" @click=${() => this._addSelectedEntity(index)}>Add entity</button>${selectedCandidates.length ? nothing : html`<p class="slot-hint">No compatible entities are currently detected, but you can still enter an entity ID manually.</p>`}</div>` : nothing}
        ${requiresEntity ? html`<ha-entity-picker .hass=${this.hass} .value=${metric.entity ?? ""} .label=${preset === "custom" ? "Main text entity" : preset === "device" ? "Device or entity" : preset === "vacuum" ? "Robot vacuum" : `${PRESETS[preset].label} entity`} allow-custom-entity @value-changed=${(e: Event) => this._updateMetric(index, { source: "entity", entity: this._pickerValue(e) })}></ha-entity-picker>` : nothing}
        ${preset === "weather" ? html`<label>Show<select .value=${metric.weather_display ?? "condition"} @change=${(e: Event) => this._updateMetric(index, { weather_display: (e.target as HTMLSelectElement).value as NonNullable<MetricConfig["weather_display"]> })}><option value="condition">Condition</option><option value="temperature">Temperature</option><option value="apparent_temperature">Feels like</option><option value="humidity">Humidity</option><option value="wind_speed">Wind speed</option></select></label>` : nothing}
        ${preset === "vacuum" ? html`<label>Show<select .value=${metric.vacuum_display ?? "state"} @change=${(e: Event) => this._updateMetric(index, { vacuum_display: (e.target as HTMLSelectElement).value as NonNullable<MetricConfig["vacuum_display"]> })}><option value="state">Activity state</option><option value="battery">Battery level</option><option value="fan_speed">Fan speed</option></select></label>` : nothing}
        ${preset === "camera" ? html`<label>Camera display<select .value=${metric.camera_display ?? "state"} @change=${(e: Event) => this._updateMetric(index, { camera_display: (e.target as HTMLSelectElement).value as NonNullable<MetricConfig["camera_display"]> })}><option value="state">Compact state</option><option value="feed">Full-slot camera preview</option></select></label><p class="slot-hint">Preview uses the camera image supplied by Home Assistant and fills the whole insight slot. Its tap action remains available.</p>` : nothing}
        ${preset === "clock" ? html`<label>Clock style<select .value=${metric.clock_style ?? "digital"} @change=${(e: Event) => this._updateMetric(index, { clock_style: (e.target as HTMLSelectElement).value as NonNullable<MetricConfig["clock_style"]> })}><option value="digital">Digital</option><option value="analogue">Analogue</option></select></label>` : nothing}
        ${preset === "custom" ? html`
          <p class="slot-hint">Use one entity for the main state and another for the smaller supporting value beneath it.</p>
          <ha-entity-picker .hass=${this.hass} .value=${metric.secondary_entity ?? ""} label="Supporting value entity (optional)" allow-custom-entity @value-changed=${(e: Event) => this._updateMetric(index, { secondary_entity: this._pickerValue(e) || undefined })}></ha-entity-picker>
          <ha-entity-picker .hass=${this.hass} .value=${metric.icon_entity ?? ""} label="Use icon from entity (optional)" allow-custom-entity @value-changed=${(e: Event) => this._updateMetric(index, { icon_entity: this._pickerValue(e) || undefined })}></ha-entity-picker>
          <ha-entity-picker .hass=${this.hass} .value=${metric.color_entity ?? ""} label="Colour state entity (optional)" allow-custom-entity @value-changed=${(e: Event) => this._updateMetric(index, { color_entity: this._pickerValue(e) || undefined })}></ha-entity-picker>
          <div class="custom-rules"><span class="section-label">Icon colour rules</span><p class="slot-hint">Match the state of the colour entity, or the main entity when left blank.</p>
            ${(metric.color_rules ?? []).map((rule, ruleIndex) => html`<div class="color-rule"><label>State <input .value=${rule.state} placeholder="Good" @input=${(e: Event) => this._updateColorRule(index, ruleIndex, { state: (e.target as HTMLInputElement).value })}></label><label>Colour <input .value=${rule.color} placeholder="var(--green-color)" @input=${(e: Event) => this._updateColorRule(index, ruleIndex, { color: (e.target as HTMLInputElement).value })}></label><button class="remove-rule" @click=${() => this._removeColorRule(index, ruleIndex)}>Remove</button></div>`) }
            <button class="add-rule" @click=${() => this._addColorRule(index)}>Add colour rule</button>
          </div>
        ` : nothing}
        <details class="more-options"><summary>Fine tuning (optional)</summary>
          ${preset !== "custom" ? html`<label>Label source<select .value=${metric.label_mode ?? (metric.label && metric.label !== PRESETS[preset].label && !(preset === "temperature" && metric.label === "Temperature") ? "custom" : "preset")} @change=${(e: Event) => { const labelMode = (e.target as HTMLSelectElement).value as MetricConfig["label_mode"]; this._updateMetric(index, { label_mode: labelMode, ...(labelMode === "preset" ? { label: undefined } : {}) }); }}><option value="preset">Preset label</option>${requiresEntity ? html`<option value="entity">Entity name</option>` : nothing}<option value="custom">Custom label</option></select></label>` : nothing}
          <div class="two"><label>${preset === "custom" ? "Supporting text fallback" : "Custom label"} <input .value=${preset === "custom" ? metric.secondary_text ?? "" : metric.label ?? ""} placeholder=${PRESETS[preset].label} @input=${(e: Event) => this._updateMetric(index, preset === "custom" ? { secondary_text: (e.target as HTMLInputElement).value || undefined } : { label_mode: "custom", label: (e.target as HTMLInputElement).value || undefined })}></label><ha-icon-picker label="Icon" .value=${metric.icon ?? ""} .placeholder=${PRESETS[preset].icon} @value-changed=${(e: Event) => this._updateMetric(index, { icon: this._pickerValue(e) })}></ha-icon-picker></div>
          ${isBinarySensor ? html`<details class="binary-icons"><summary>Binary sensor icons</summary><p class="slot-hint">Optional overrides for the sensor's current state. Leave a field empty to use the normal insight icon.</p><div class="three"><ha-icon-picker label="On / true" .value=${metric.icon_on ?? ""} .placeholder=${metric.icon ?? PRESETS[preset].icon} @value-changed=${(e: Event) => this._updateMetric(index, { icon_on: this._pickerValue(e) || undefined })}></ha-icon-picker><ha-icon-picker label="Off / false" .value=${metric.icon_off ?? ""} .placeholder=${metric.icon ?? PRESETS[preset].icon} @value-changed=${(e: Event) => this._updateMetric(index, { icon_off: this._pickerValue(e) || undefined })}></ha-icon-picker><ha-icon-picker label="Unknown" .value=${metric.icon_unknown ?? ""} .placeholder=${metric.icon ?? PRESETS[preset].icon} @value-changed=${(e: Event) => this._updateMetric(index, { icon_unknown: this._pickerValue(e) || undefined })}></ha-icon-picker></div></details>` : nothing}
          ${preset === "attention" ? html`<label>Colour <input .value=${metric.color ?? ""} placeholder="var(--warning-color)" @input=${(e: Event) => this._updateMetric(index, { color: (e.target as HTMLInputElement).value || undefined })}></label><label class="checkbox"><input type="checkbox" .checked=${metric.show_icon !== false} @change=${(e: Event) => this._updateMetric(index, { show_icon: (e.target as HTMLInputElement).checked })}> Show icon</label>` : html`<div class="two"><label>${preset === "custom" ? "Fallback colour" : "Colour"} <input .value=${metric.color ?? ""} placeholder="var(--primary-color)" @input=${(e: Event) => this._updateMetric(index, { color: (e.target as HTMLInputElement).value || undefined })}></label>${supportsDecimals ? unitOptions ? html`<label>Display unit<select .value=${metric.unit ?? ""} @change=${(e: Event) => this._updateMetric(index, { unit: (e.target as HTMLSelectElement).value || undefined })}>${unitOptions.map(([value, name]) => html`<option value=${value}>${name}</option>`)}</select></label>` : html`<label>Unit override <input .value=${metric.unit ?? ""} @input=${(e: Event) => this._updateMetric(index, { unit: (e.target as HTMLInputElement).value || undefined })}></label>` : nothing}</div>
          ${preset === "power" ? html`<label class="checkbox"><input type="checkbox" .checked=${metric.invert_value ?? false} @change=${(e: Event) => this._updateMetric(index, { invert_value: (e.target as HTMLInputElement).checked || undefined })}> Invert the power direction</label><p class="slot-hint">Use this when an import or export reading has the opposite sign to the one you want to show.</p>` : nothing}
          <div class=${supportsDecimals ? "three" : "two"}>${supportsDecimals ? html`<label>Decimal places <input type="number" min="0" max="4" .value=${metric.decimals?.toString() ?? ""} placeholder="Automatic" @input=${(e: Event) => { const value = (e.target as HTMLInputElement).value; this._updateMetric(index, { decimals: value === "" ? undefined : Math.max(0, Math.min(4, Number(value))) }); }}></label>` : nothing}${supportsDecimals ? html`<label class="checkbox"><input type="checkbox" .checked=${metric.show_unit !== false} @change=${(e: Event) => this._updateMetric(index, { show_unit: (e.target as HTMLInputElement).checked })}> Show unit</label>` : nothing}<label class="checkbox"><input type="checkbox" .checked=${metric.show_icon !== false} @change=${(e: Event) => this._updateMetric(index, { show_icon: (e.target as HTMLInputElement).checked })}> Show icon</label></div>`}
           <label class="checkbox"><input type="checkbox" .checked=${metric.show_label !== false} @change=${(e: Event) => this._updateMetric(index, { show_label: (e.target as HTMLInputElement).checked })}> Show label</label>
           ${usesArea ? html`<details class="membership"><summary>${wholeHomeAggregate ? "Exclude entities from this home" : "Exclude entities from this area"}</summary><p class="slot-hint">${membershipMode === "auto_except" ? "New compatible entities are included automatically. Uncheck anything you want to leave out." : "This older fixed list is retained. For a deliberate cross-area group, use Selected entities above."}</p>${candidates.length ? html`<div class="membership-list">${candidates.map((entityId) => html`<label class="member"><input type="checkbox" .checked=${included.has(entityId)} @change=${(e: Event) => this._membershipEntityChanged(index, entityId, e)}><span><strong>${this._entityName(entityId)}</strong><small>${entityId} · ${this.hass?.states[entityId]?.state ?? "unknown"}</small></span></label>`)}</div>` : html`<p class="slot-hint">No compatible entities are currently available for this insight.</p>`}${metric.membership ? html`<button class="reset-membership" @click=${() => this._resetMembership(index)}>Reset to automatic membership</button>` : nothing}</details>` : nothing}
           ${usesAggregate && supportsValueAggregation ? html`<label>${usesSelectedEntities ? "Combine selected values" : "Aggregate values"}<select .value=${metric.aggregation ?? "auto"} @change=${(e: Event) => this._aggregationChanged(index, e)}><option value="auto">Smart default (${defaultAggregation(preset)})</option><option value="sum">Sum</option><option value="average">Average</option><option value="median">Median</option><option value="highest">Highest</option><option value="lowest">Lowest</option></select></label>` : nothing}
          ${supportsThresholds && preset !== "custom" ? html`<details class="thresholds"><summary>Colour thresholds</summary><p class="slot-hint">First matching rule wins. Thresholds use the displayed value and unit.</p>${(metric.thresholds ?? []).map((threshold, thresholdIndex) => html`<div class="threshold"><label>At least <input type="number" .value=${threshold.above?.toString() ?? ""} placeholder="Optional" @input=${(e: Event) => { const value = (e.target as HTMLInputElement).value; this._updateThreshold(index, thresholdIndex, { above: value === "" ? undefined : Number(value) }); }}></label><label>At most <input type="number" .value=${threshold.below?.toString() ?? ""} placeholder="Optional" @input=${(e: Event) => { const value = (e.target as HTMLInputElement).value; this._updateThreshold(index, thresholdIndex, { below: value === "" ? undefined : Number(value) }); }}></label><label>Colour <input .value=${threshold.color} placeholder="var(--warning-color)" @input=${(e: Event) => this._updateThreshold(index, thresholdIndex, { color: (e.target as HTMLInputElement).value })}></label><button class="remove-rule" @click=${() => this._removeThreshold(index, thresholdIndex)}>Remove</button></div>`)}<button class="add-rule" @click=${() => this._addThreshold(index)}>Add threshold</button></details>` : nothing}
          <details class="metric-actions"><summary>Actions (optional)</summary>${this._metricActionFields(index, metric, "tap", usesAggregate)}<details class="secondary-actions"><summary>Hold and double-tap</summary>${this._metricActionFields(index, metric, "hold", usesAggregate)}${this._metricActionFields(index, metric, "double", usesAggregate)}</details></details>
        </details>
        <div class="insight-actions"><div class="reorder"><button ?disabled=${index === 0} aria-label="Move insight left" @click=${() => this._moveMetric(index, -1)}>←</button><button ?disabled=${index === metrics.length - 1} aria-label="Move insight right" @click=${() => this._moveMetric(index, 1)}>→</button><button ?disabled=${metrics.length >= 5} @click=${() => this._duplicateMetric(index)}>Duplicate</button></div><label class="checkbox"><input type="checkbox" .checked=${metric.hidden ?? false} @change=${this._metricBoolean(index, "hidden")}> Hide</label><button class="remove" @click=${() => this._removeMetric(index)}>Remove</button></div></div>
      </details>`})}
      <button class="add" ?disabled=${metrics.length >= 5} @click=${this._addMetric}>Add insight</button>
      </section>`}
      <details class="settings">
        <summary>Title &amp; header</summary>
        ${purpose === "chart" ? html`
          ${this._config.layout === "stacked" ? html`<label>Header alignment<select .value=${this._config.header_alignment ?? "left"} @change=${(event: Event) => this._change({ header_alignment: (event.target as HTMLSelectElement).value as NonNullable<AreaGlanceConfig["header_alignment"]> })}><option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option></select></label>` : nothing}
          <label>Title <input .value=${this._config.title ?? chart.title ?? ""} placeholder="Use selected source name" @input=${(event: Event) => { const title = (event.target as HTMLInputElement).value || undefined; this._change({ title, chart: { ...chart, title: undefined } }); }}></label>
          <p class="slot-hint">Leave this blank to use the selected entity or Energy Dashboard source name.</p>
          <label>Summary override <input .value=${chart.summary ?? ""} placeholder="Automatic current value" @input=${(event: Event) => this._chartChanged({ summary: (event.target as HTMLInputElement).value || undefined })}></label>
          <p class="slot-hint">By default, the chart header shows the latest live value (or the current period total).</p>
          <details class="header-fine-tuning"><summary>Title fine tuning</summary><p class="slot-hint">Auto uses the same responsive title fitting as every other Area Glance header.</p><label>Title lines<select .value=${this._config.header_title_lines ?? "auto"} @change=${(event: Event) => this._change({ header_title_lines: (event.target as HTMLSelectElement).value as NonNullable<AreaGlanceConfig["header_title_lines"]> })}><option value="auto">Auto (recommended)</option><option value="single">One line</option><option value="multi">Up to two lines</option></select></label></details>
        ` : this._config.layout !== "metrics-only" ? html`
          ${this._config.layout === "stacked" || this._config.layout === "tower" ? html`<label>Header alignment<select .value=${this._config.header_alignment ?? "left"} @change=${(e: Event) => this._change({ header_alignment: (e.target as HTMLSelectElement).value as NonNullable<AreaGlanceConfig["header_alignment"]> })}><option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option></select></label>` : nothing}
          <label>Title <input .value=${this._config.title ?? ""} placeholder=${currentAreaName} @input=${(e: Event) => this._input(e, "title")}></label>
          <details class="header-fine-tuning"><summary>Header fine tuning</summary><p class="slot-hint">Auto keeps a title above insights on one line, and lets a title beside insights use two lines when needed.</p><div class="two"><label>Title lines<select .value=${this._config.header_title_lines ?? "auto"} @change=${(e: Event) => this._change({ header_title_lines: (e.target as HTMLSelectElement).value as NonNullable<AreaGlanceConfig["header_title_lines"]> })}><option value="auto">Auto (recommended)</option><option value="single">One line</option><option value="multi">Up to two lines</option></select></label><label>Status lines<select .value=${this._config.header_status_lines ?? "auto"} @change=${(e: Event) => this._change({ header_status_lines: (e.target as HTMLSelectElement).value as NonNullable<AreaGlanceConfig["header_status_lines"]> })}><option value="auto">Auto (recommended)</option><option value="single">One line</option><option value="multi">Up to two lines</option></select></label></div></details>
          <label>When the header is tapped<select .value=${headerAction} @change=${this._headerActionChanged}><option value="none">Do nothing</option><option value="area-details">Show area details</option><option value="navigate">Navigate to a dashboard page</option></select></label>
          ${headerAction === "navigate" ? html`<label>Dashboard path <input .value=${this._config.header_action?.navigation_path ?? ""} placeholder="/dashboard/room" @input=${this._headerNavigationChanged}></label>` : nothing}
          <label class="checkbox"><input type="checkbox" .checked=${Boolean(status)} @change=${this._statusEnabledChanged}> Show a status line</label>
          ${status ? html`
            <label>Status comes from<select .value=${statusSource} @change=${this._statusSourceChanged}><option value="security">Whole-home security</option><option value="area_presence">Presence in this area</option><option value="area_motion">Motion in this area</option><option value="area_doors">Doors in this area</option><option value="area_windows">Windows in this area</option><option value="area_leaks">Water leaks in this area</option><option value="entity">A specific entity</option></select></label>
            ${statusSource === "security" ? html`<p class="slot-hint">Security checks recognised alarms, doors, windows, and locks. Leave the area empty for the whole home.</p>` : nothing}
            ${usesAreaStatus ? html`<ha-area-picker .hass=${this.hass} .value=${this._areaPickerValue(status.area ?? this._config.area)} .label=${statusAreaLabel} @value-changed=${this._statusAreaChanged}></ha-area-picker>${this._showcaseAreaHint(status.area ?? this._config.area)}` : html`<ha-entity-picker .hass=${this.hass} .value=${status.entity ?? ""} .label="Status entity" allow-custom-entity @value-changed=${(e: Event) => this._change({ status: { ...status, source: "entity", entity: this._pickerValue(e) } })}></ha-entity-picker>`}
            ${usesAreaStatus ? html`<details class="membership"><summary>${wholeHomeStatus ? "Exclude entities from this home" : "Exclude entities from this area"}</summary><p class="slot-hint">New compatible entities are included automatically. Uncheck anything you want to leave out of this status.</p>${statusCandidates.length ? html`<div class="membership-list">${statusCandidates.map((entityId) => html`<label class="member"><input type="checkbox" .checked=${includedStatusEntities.has(entityId)} @change=${(e: Event) => this._statusMembershipEntityChanged(entityId, e)}><span><strong>${this._entityName(entityId)}</strong><small>${entityId} · ${this.hass?.states[entityId]?.state ?? "unknown"}</small></span></label>`)}</div>` : html`<p class="slot-hint">No compatible entities are currently available for this status.</p>`}${status.membership ? html`<button class="reset-membership" @click=${this._resetStatusMembership}>Reset to automatic membership</button>` : nothing}</details>` : nothing}
            <label>When the status is tapped<select .value=${statusAction} @change=${this._statusActionChanged}><option value="none">Do nothing</option>${usesAreaStatus ? html`<option value="status-details">Show matching entities</option><option value="area-details">Show area details</option>` : html`<option value="more-info">Show entity details</option>`}<option value="navigate">Navigate to a dashboard page</option></select></label>
            ${statusAction === "navigate" ? html`<label>Dashboard path <input .value=${status.navigation_path ?? ""} placeholder="/dashboard/room" @input=${this._statusNavigationChanged}></label>` : nothing}
            ${statusSource === "security" ? nothing : statusSource === "area_doors" ? html`<p class="slot-hint">Closed doors show a green summary; open doors show a clear count.</p>` : statusSource === "area_windows" ? html`<p class="slot-hint">Closed windows show a green summary; open windows need attention.</p>` : statusSource === "area_leaks" ? html`<p class="slot-hint">Dry is green; a detected leak is red.</p>` : statusSource === "area_presence" ? html`<p class="slot-hint">Presence means an occupancy or presence sensor is active. It is different from recent motion.</p>` : html`
              <div class="two"><label>When active <input .value=${status.active_text ?? ""} placeholder="Motion" @input=${(e: Event) => this._statusInput(e, "active_text")}></label><label>When inactive <input .value=${status.inactive_text ?? ""} placeholder="No motion" @input=${(e: Event) => this._statusInput(e, "inactive_text")}></label></div>
              <label class="checkbox"><input type="checkbox" .checked=${status.show_last_changed ?? false} @change=${(e: Event) => this._statusBoolean(e, "show_last_changed")}> Show when it last changed</label>
              ${status.show_last_changed ? html`<label>History label <input .value=${status.last_changed_text ?? ""} placeholder="Last motion" @input=${(e: Event) => this._statusInput(e, "last_changed_text")}></label>` : nothing}
            `}
          ` : nothing}
        ` : nothing}
      </details>
      <details class="settings"><summary>Card appearance</summary>
        <label>Size<select .value=${this._config.height ?? "slim"} @change=${this._heightChanged}><option value="slim">Slim (default)</option><option value="compact">Compact</option><option value="standard">Medium</option><option value="comfortable">Tall</option></select></label>
        <label class="checkbox"><input type="checkbox" .checked=${this._config.appearance?.show_area_icon === true} @change=${this._areaIconVisibilityChanged}> Show area icon</label>
        ${this._config.appearance?.show_area_icon === true ? html`<ha-icon-picker label="Area icon (automatic by default)" .value=${this._config.appearance?.area_icon ?? ""} placeholder="mdi:map-marker-radius-outline" @value-changed=${this._areaIconChanged}></ha-icon-picker><p class="slot-hint">The icon is inferred from the area or profile. Set one here only when you want to override it.</p>` : nothing}
        ${purpose !== "chart" ? html`<label class="checkbox"><input type="checkbox" .checked=${this._config.appearance?.show_insight_icons !== false} @change=${this._insightIconVisibilityChanged}> Show insight icons</label>${this._config.appearance?.show_insight_icons !== false ? html`<label>Insight icon colours<select .value=${this._config.appearance?.insight_icon_color ?? "default"} @change=${this._insightIconColorChanged}><option value="default">Preset colours (default)</option><option value="black">Black</option><option value="grey">Grey</option></select></label><p class="slot-hint">Changes the shared default only. A colour set in an insight's Fine tuning, including threshold or state colours, still wins.</p>` : nothing}<p class="slot-hint">Turn icons off for a quieter, value-led look. Camera previews, analogue clocks, and calendar tiles keep their dedicated visual display.</p>` : nothing}
        <label>Colour style<select .value=${appearancePreset} @change=${this._appearancePresetChanged}><option value="theme">Use dashboard theme</option><option value="light">Light</option><option value="slate">Slate</option><option value="charcoal">Dark</option><option value="custom">Custom background</option></select></label>
        ${appearancePreset === "custom" ? html`<label>Background colour <input type="color" .value=${this._config.appearance?.background ?? "#353c45"} @input=${this._customBackgroundChanged}></label>` : nothing}
        <div class="text-scale-row"><label>Corner rounding<input type="range" min="0" max="48" step="1" .value=${String(cornerRadius)} @input=${this._cornerRadiusChanged}></label><output>${cornerRadius}px</output></div>
        <p class="slot-hint">Applies to every card layout, including charts, towers, and camera feeds. The responsive default is retained at 24px.</p>
        ${this._config.appearance?.corner_radius !== undefined ? html`<button class="reset-membership" @click=${this._resetCornerRadius}>Reset corner rounding</button>` : nothing}
        <label>Card shadow<select .value=${shadowStyle} @change=${this._shadowStyleChanged}><option value="drop">Raised (drop shadow)</option><option value="inner">Sunken (inner shadow)</option><option value="none">No shadow</option></select></label>
        ${shadowStyle !== "none" ? html`<div class="two shadow-controls"><div class="text-scale-row"><label>Shadow opacity<input type="range" min="0" max="60" step="1" .value=${String(shadowOpacity)} @input=${this._shadowOpacityChanged}></label><output>${shadowOpacity}%</output></div><div class="text-scale-row"><label>Shadow spread<input type="range" min="-12" max="16" step="1" .value=${String(shadowSpread)} @input=${this._shadowSpreadChanged}></label><output>${shadowSpread}px</output></div></div>${shadowStyle === "drop" ? html`<div class="two shadow-controls"><div class="text-scale-row"><label>Horizontal offset<input type="range" min="-16" max="16" step="1" .value=${String(shadowX)} @input=${(event: Event) => this._shadowOffsetChanged("x", event)}></label><output>${shadowX}px</output></div><div class="text-scale-row"><label>Vertical offset<input type="range" min="-16" max="16" step="1" .value=${String(shadowY)} @input=${(event: Event) => this._shadowOffsetChanged("y", event)}></label><output>${shadowY}px</output></div></div>` : nothing}<label>Shadow colour <input type="color" .value=${shadowColor} @input=${this._shadowColorChanged}></label><p class="slot-hint">Defaults to black. In dark dashboards, try a low-opacity white shadow for a soft glow.</p>${this._config.appearance?.shadow_opacity !== undefined || this._config.appearance?.shadow_spread !== undefined || this._config.appearance?.shadow_x !== undefined || this._config.appearance?.shadow_y !== undefined || this._config.appearance?.shadow_color !== undefined ? html`<button class="reset-membership" @click=${this._resetShadowFineTuning}>Reset shadow fine tuning</button>` : nothing}` : nothing}
        <details class="typography"><summary>Text size and weight</summary><p class="slot-hint">Applies across the whole card. The default is 100% with bold text. Choose 75–160%; long values still shrink or truncate at very narrow widths to keep the band intact.</p>
          <label>Text weight<select .value=${this._config.appearance?.text_weight ?? (this._config.appearance?.style === "light" ? "light" : "bold")} @change=${this._textWeightChanged}><option value="bold">Bold (default)</option><option value="regular">Regular</option><option value="light">Light</option></select></label>
          ${textScaleControls.map(([key, label]) => html`<div class="text-scale-row"><label>${label}<input type="range" min="75" max="160" step="1" .value=${String(textScale[key] ?? 100)} @input=${(event: Event) => this._textScaleChanged(key, event)}></label><output>${textScale[key] ?? 100}%</output></div>`)}
          ${Object.keys(textScale).length ? html`<button class="reset-membership" @click=${this._resetTextScale}>Reset text sizes</button>` : nothing}
        </details>
      </details>
    </div>`;
  }
  static styles = css`
    :host { display:block; } .editor { padding:12px; } h3 { margin:0; } .hint, .slot-hint, .contributor-hint { color:var(--secondary-text-color); margin:4px 0 12px; } .slot-hint, .contributor-hint { font-size:.88rem; } .contributor-hint { padding:7px 9px; border-radius:6px; background:color-mix(in srgb, var(--primary-color) 7%, var(--card-background-color)); } label { display:block; font-weight:500; margin:12px 0; } ha-entity-picker, ha-area-picker { display:block; margin:12px 0; } input, select { box-sizing:border-box; width:100%; padding:8px; margin-top:4px; font:inherit; color:inherit; background:var(--card-background-color); border:1px solid var(--divider-color); border-radius:6px; } button { cursor:pointer; font:inherit; } .setup, .insights { margin-top:18px; } .section-label { display:block; font-weight:600; margin-bottom:8px; } .purpose-grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:8px; } .purpose { text-align:left; min-height:62px; padding:10px; color:var(--primary-text-color); background:var(--card-background-color); border:1px solid var(--divider-color); border-radius:8px; } .purpose.selected { border:2px solid var(--primary-color); background:color-mix(in srgb, var(--primary-color) 8%, var(--card-background-color)); } .purpose strong, .purpose small { display:block; } .purpose small { color:var(--secondary-text-color); font-size:.78rem; margin-top:3px; } .applied { color:var(--secondary-text-color); font-size:.9rem; margin:8px 0; } .suggestion-update { display:flex; gap:8px; align-items:center; justify-content:space-between; padding:10px; margin-top:8px; border-radius:8px; background:color-mix(in srgb, var(--primary-color) 8%, var(--card-background-color)); } .suggestion-update span { font-size:.88rem; } .primary, .add { padding:8px 12px; color:white; background:var(--primary-color); border:0; border-radius:6px; white-space:nowrap; } .advanced-setup, .settings, .insight-editor { border:1px solid var(--divider-color); border-radius:8px; padding:10px; margin-top:12px; } summary { cursor:pointer; font-weight:600; } .advanced-setup summary, .settings summary, .header-fine-tuning summary, .more-options summary, .thresholds summary, .metric-actions summary, .secondary-actions summary { color:var(--secondary-text-color); } .header-fine-tuning { margin-top:12px; padding:10px; border:1px solid var(--divider-color); border-radius:8px; } .header-fine-tuning .slot-hint { margin-bottom:4px; } .insight-editor { padding:0; overflow:hidden; transform:translateY(var(--reorder-shift, 0)); transition:transform 170ms ease, opacity .15s ease, box-shadow .15s ease, border-color .15s ease; will-change:transform; } .insight-editor.dragging { opacity:.22; } .insight-editor.drag-over { border-color:var(--primary-color); box-shadow:0 0 0 2px color-mix(in srgb, var(--primary-color) 24%, transparent); } .insight-editor > summary { display:flex; align-items:center; gap:8px; padding:12px; list-style:none; } .insight-editor > summary::-webkit-details-marker { display:none; } .insight-editor > summary::after { content:"›"; margin-left:auto; color:var(--secondary-text-color); font-size:1.4rem; } .insight-editor[open] > summary::after { transform:rotate(90deg); } .insight-editor ha-icon { width:22px; height:22px; color:var(--primary-color); } .drag-handle { display:inline-grid; place-items:center; width:26px; min-height:32px; margin:-8px 0 -8px -6px; border-radius:5px; color:var(--secondary-text-color); cursor:grab; font-size:1.15rem; letter-spacing:-2px; touch-action:none; user-select:none; } .drag-handle:hover { color:var(--primary-color); background:color-mix(in srgb, var(--primary-color) 9%, transparent); } .drag-handle:active { cursor:grabbing; } .insight-name { min-width:0; flex:1; } .source-pill { padding:3px 6px; border-radius:999px; color:var(--secondary-text-color); background:color-mix(in srgb, var(--secondary-text-color) 12%, transparent); font-size:.72rem; white-space:nowrap; } .insight-fields { padding:0 12px 12px; border-top:1px solid var(--divider-color); } .more-options, .thresholds, .metric-actions, .secondary-actions { margin-top:12px; } .thresholds, .metric-actions { padding:10px; border:1px solid var(--divider-color); border-radius:8px; } .two { display:grid; grid-template-columns:1fr 1fr; gap:8px; } .three { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:8px; align-items:end; } .checkbox { font-weight:400; } .checkbox input { width:auto; margin:0 6px 0 0; vertical-align:middle; } .threshold { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)) auto; gap:8px; align-items:end; margin-top:8px; } .threshold label { margin:0; } .insight-actions, .reorder { display:flex; align-items:center; gap:8px; } .insight-actions { justify-content:space-between; } .reorder button { padding:5px 7px; border:1px solid var(--divider-color); border-radius:5px; color:var(--primary-text-color); background:transparent; } .reorder button:disabled { opacity:.45; cursor:default; } .remove { padding:6px 0; color:var(--error-color); background:transparent; border:0; } .add { margin-top:12px; } @media (max-width:400px) { .purpose-grid, .two, .three, .threshold { grid-template-columns:1fr; } .suggestion-update { align-items:flex-start; flex-direction:column; } }
    .card-layout { margin-top:18px; }
    .custom-rules { margin:14px 0; padding:10px; border:1px solid var(--divider-color); border-radius:8px; }
    .custom-rules .slot-hint { margin-bottom:8px; }
    .color-rule { display:grid; grid-template-columns:minmax(0, 1fr) minmax(0, 1fr) auto; gap:8px; align-items:end; margin-top:8px; }
    .color-rule label { margin:0; }
    .remove-rule, .add-rule { padding:8px 10px; border:1px solid var(--divider-color); border-radius:6px; background:transparent; color:var(--primary-text-color); }
    .remove-rule { color:var(--error-color); }
    .add-rule { margin-top:10px; }
    ha-icon-picker { display:block; margin:12px 0; }
    .two ha-icon-picker { align-self:end; }
    .membership, .attention-options { margin-top:12px; padding:10px; border:1px solid var(--divider-color); border-radius:8px; }
    .selected-entities { margin:12px 0; padding:10px; border:1px solid var(--divider-color); border-radius:8px; }
    .selected-entities .slot-hint:first-child { margin-top:0; }
    .selected-entity { display:grid; grid-template-columns:minmax(0, 1fr) auto; gap:8px; align-items:end; }
    .selected-entity + .selected-entity { margin-top:8px; }
    .selected-entity ha-entity-picker { margin:0; }
    .membership-list { display:grid; gap:4px; max-height:220px; overflow:auto; margin-top:10px; border:1px solid var(--divider-color); border-radius:6px; }
    .member { display:flex; align-items:flex-start; gap:8px; margin:0; padding:8px; font-weight:400; }
    .member + .member { border-top:1px solid var(--divider-color); }
    .member input { width:auto; margin:3px 0 0; }
    .member strong, .member small { display:block; }
    .member small { margin-top:2px; color:var(--secondary-text-color); font-size:.75rem; overflow-wrap:anywhere; }
    .reset-membership { margin-top:10px; padding:6px 8px; border:1px solid var(--divider-color); border-radius:6px; color:var(--primary-text-color); background:transparent; }
    .typography { margin-top:12px; padding:10px; border:1px solid var(--divider-color); border-radius:8px; }
    .text-scale-row { display:grid; grid-template-columns:minmax(0, 1fr) 46px; gap:8px; align-items:end; margin-top:10px; }
    .text-scale-row label { margin:0; }
    .text-scale-row input[type="range"] { padding:0; }
    .text-scale-row output { padding-bottom:8px; color:var(--secondary-text-color); font-variant-numeric:tabular-nums; text-align:right; }
    .multi-series-row { display:grid; grid-template-columns:minmax(0, 1fr) 38px 28px; gap:8px; align-items:end; margin:10px 0; }
    .multi-series-row ha-entity-picker { margin:0; }
    .series-colour { height:42px; padding:4px; }
    .icon-button { height:42px; border:1px solid var(--divider-color); border-radius:6px; color:var(--secondary-text-color); background:transparent; font-size:1.35rem; line-height:1; }
    .series-label { grid-column:1 / -1; margin-top:-4px; }
    .add-insight { margin-top:4px; padding:7px 10px; color:var(--primary-text-color); background:transparent; border:1px solid var(--divider-color); border-radius:6px; }
    .editor-warning { margin:10px 0; padding:8px 10px; color:var(--warning-color, #b85c00); background:color-mix(in srgb, var(--warning-color, #b85c00) 10%, transparent); border-radius:6px; font-size:.88rem; }
  `;
}

if (!customElements.get("area-glance-card")) customElements.define("area-glance-card", AreaGlanceCard);
if (!customElements.get("area-glance-card-editor")) customElements.define("area-glance-card-editor", AreaGlanceCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "area-glance-card",
  name: "Area Glance Card",
  description: "A compact, preset-led summary for an area, home, or energy system.",
  preview: true,
  documentationURL: "https://github.com/Future-Surfer/ha-area-glance-card",
});

declare global { interface Window { customCards: unknown[]; } }
