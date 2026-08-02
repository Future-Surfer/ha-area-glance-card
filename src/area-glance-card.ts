import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { dispatchHassAction, type ActionTrigger } from "./actions";
import { areaEntityIds } from "./area-index";
import { PRESETS, presetMetric } from "./presets";
import type { ActionConfig, AreaGlanceConfig, AreaSignal, EntityState, HassLike, MetricConfig, MetricPreset, StatusConfig } from "./types";

const UNAVAILABLE = new Set(["unknown", "unavailable", "none", ""]);
const DEFAULT_METRICS = [presetMetric("temperature"), presetMetric("lights"), presetMetric("power"), presetMetric("device")];
const DEFAULT_SECURITY_METRICS = [presetMetric("alarm"), presetMetric("doors"), presetMetric("windows"), presetMetric("locks")];
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
  camera: "Show one chosen camera's state. Use its action to open a dedicated camera view.",
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
  visual?: { kind: "analogue-clock"; hourAngle: number; minuteAngle: number } | { kind: "calendar"; month: string; day: string };
}

interface DisplayValueParts {
  primary: string;
  unit?: string;
}

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
}

export class AreaGlanceCard extends LitElement {
  public hass?: HassLike;
  private _config?: AreaGlanceConfig;
  private _detail?: DetailSheet;
  private _clockTimer?: number;
  private _metricGesture?: { pointerId: number; metric: MetricConfig; display: MetricDisplay; startX: number; startY: number; held: boolean; timer?: number };
  private _pendingMetricTap?: { metric: MetricConfig; display: MetricDisplay; timer: number };
  private _ignoreMetricClick = false;

  static get properties() {
    return { hass: { attribute: false }, _config: { state: true }, _detail: { state: true } };
  }

  static getConfigElement() {
    return document.createElement("area-glance-card-editor");
  }

  static getStubConfig(): AreaGlanceConfig {
    return { title: "Area", metrics: DEFAULT_METRICS };
  }

  public setConfig(config: AreaGlanceConfig): void {
    if (!config || (!config.title && !config.area && config.profile !== "house" && config.profile !== "security" && config.layout !== "metrics-only")) {
      throw new Error("Set a title, choose an area, use the House or Security profile, or use Metrics only.");
    }
    this._config = {
      ...config,
      metrics: config.metrics?.length
        ? config.metrics
        : config.profile === "security" ? DEFAULT_SECURITY_METRICS : DEFAULT_METRICS,
    };
  }

  private _heightOption() { return HEIGHT_OPTIONS[this._config?.height ?? "slim"]; }
  private _gridRows() {
    const height = this._heightOption();
    if (this._config?.layout === "tower") return Math.max(3.5, 1.2 + (this._config?.metrics?.filter((metric) => !metric.hidden).length ?? 1) * 1.15);
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
  public getGridOptions() { return { columns: 12, min_columns: 6 }; }

  connectedCallback() {
    super.connectedCallback();
    this._clockTimer = window.setInterval(() => this.requestUpdate(), 30000);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._clockTimer !== undefined) window.clearInterval(this._clockTimer);
    this._clockTimer = undefined;
    this._cancelMetricGesture();
    if (this._pendingMetricTap) window.clearTimeout(this._pendingMetricTap.timer);
    this._pendingMetricTap = undefined;
  }

  protected willUpdate(changed: PropertyValues<this>) {
    if (changed.has("hass")) this.requestUpdate();
  }

  private _areaName(area?: string): string | undefined {
    if (!area) return undefined;
    return this.hass?.areas?.[area]?.name ?? area.replaceAll("_", " ").replace(/\b\w/g, (l) => l.toUpperCase());
  }

  private _areaEntities(area: string | undefined, domain?: string): string[] {
    return areaEntityIds(this.hass, area, domain);
  }

  private _metricSource(metric: MetricConfig, preset: MetricPreset): "area" | "entity" | "entities" {
    if (preset === "attention") return "area";
    if (preset === "weather" || preset === "clock" || preset === "calendar") return "entity";
    if (preset === "lights" || (AREA_SIGNAL_PRESETS.has(preset) && preset !== "blinds")) return metric.source ?? "area";
    return metric.source ?? (metric.entity ? "entity" : AREA_MEASUREMENT_PRESETS.has(preset) || preset === "blinds" ? "area" : "entity");
  }

  private _aggregateEntityIds(metric: MetricConfig, preset: MetricPreset, area?: string): string[] {
    return this._metricSource(metric, preset) === "entities"
      ? metric.entities ?? []
      : this._areaEntities(area, preset === "lights" ? metric.domain ?? "light" : undefined);
  }

  private _areaSignalSummary(area: string | undefined, signal: AreaSignal, metric?: MetricConfig): AreaSignalSummary {
    const candidates = this._aggregateEntityIds(metric ?? {}, metric?.preset ?? signal, area)
      .map((entityId) => ({ entityId, state: this.hass?.states[entityId] }))
      .filter((entry): entry is { entityId: string; state: EntityState } => entry.state !== undefined && !UNAVAILABLE.has(entry.state.state) && isSignalEntity(signal, entry.entityId, entry.state));
    const included = new Set(metric && this._metricSource(metric, metric.preset ?? signal) === "area" ? includedEntityIds(metric, candidates.map((entry) => entry.entityId)) : candidates.map((entry) => entry.entityId));
    const entities = candidates.filter((entry) => included.has(entry.entityId));
    const active = entities.filter((entry) => isSignalActive(signal, entry.entityId, entry.state));
    const latest = entities.reduce<EntityState | undefined>((newest, entry) => !newest || new Date(entry.state.last_changed) > new Date(newest.last_changed) ? entry.state : newest, undefined);
    return { entities, active, latest };
  }

  private _securitySummary(area = this._config?.area, membership?: StatusConfig["membership"]): SecuritySummary {
    const membershipMetric = (preset: MetricPreset): MetricConfig => ({ preset, source: "area", membership });
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

  private _metric(metric: MetricConfig): MetricDisplay | undefined {
    if (metric.hidden) return undefined;
    const preset = metric.preset ?? "custom";
    const defaults = PRESETS[preset];
    if (preset === "clock") return this._clockMetric(metric, metric.label ?? defaults.label, metric.icon ?? defaults.icon);
    if (preset === "calendar") return this._calendarMetric(metric, metric.label ?? defaults.label, metric.icon ?? defaults.icon);
    const state = metric.entity ? this.hass?.states[metric.entity] : undefined;
    if (metric.hide_unavailable && state && UNAVAILABLE.has(state.state)) return undefined;
    const entityDomain = metric.entity?.split(".")[0];
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
    const icon = preset === "custom" && typeof iconState?.attributes.icon === "string"
      ? iconState.attributes.icon
      : configuredIcon;
    const customLabel = preset === "custom" ? this._customSupportingText(metric, label) : label;

    const source = this._metricSource(metric, preset);
    if (source === "area" || source === "entities") return this._areaMetric(metric, preset, label, icon);
    if (source === "entity" && metric.entity && (preset === "lights" || AREA_SIGNAL_PRESETS.has(preset))) {
      return this._areaMetric({ ...metric, source: "entities", entities: [metric.entity] }, preset, label, icon);
    }
    if (!state || UNAVAILABLE.has(state.state)) return { icon, color: metric.color ?? defaults.color, value: "–", label: customLabel };
    if (preset === "weather") return this._weatherMetric(metric, state, label, icon, metric.color ?? defaults.color);
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
      Math.max(0.8, Math.min(1.35, (textScale?.[key] ?? 100) / 100));
    const contentHeight = tower ? Math.round((38 + height.metricRowHeight * Math.max(metricCount, 1)) * scale) : stacked ? height.stackedContentHeight : height.contentHeight;
    return `${accent}--area-glance-content-height:${contentHeight}px;--area-glance-metrics-height:${height.metricRowHeight}px;--area-glance-pad-y:${Math.round(8 * scale)}px;--area-glance-pad-x:${Math.round(12 * scale)}px;--area-glance-title-size:${(1.85 * scale).toFixed(2)}rem;--area-glance-status-size:${(.95 * scale).toFixed(2)}rem;--area-glance-icon-size:${Math.round(25 * scale)}px;--area-glance-value-size:${(1.92 * scale).toFixed(2)}rem;--area-glance-label-size:${(.98 * scale).toFixed(2)}rem;--area-glance-title-scale:${percentage("title")};--area-glance-status-scale:${percentage("status")};--area-glance-value-scale:${percentage("value")};--area-glance-label-scale:${percentage("label")};--area-glance-metric-padding:${Math.max(1, Math.round(2 * scale))}px;`;
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

  private _openMetricDetails(metric: MetricConfig, display: MetricDisplay) {
    const area = metric.area ?? this._config?.area;
    const attention = metric.preset === "attention";
    const wholeHomeAttention = attention && metric.attention_scope === "home";
    const lightControlPanel = metric.preset === "lights" && display.aggregate === true;
    this._detail = {
      title: display.label,
      subtitle: attention ? wholeHomeAttention ? "Checked across your home" : `Checked in ${this._areaName(area) ?? "this area"}` : lightControlPanel ? this._areaName(area) ?? "Your home" : area ? `Included from ${this._areaName(area) ?? "this area"}` : "Included entities",
      entities: display.entities ?? [],
      emptyMessage: attention ? "No entities currently need attention for the selected checks." : "No compatible entities are currently contributing to this insight.",
      quickControls: display.aggregate === true,
      lightControlPanel,
    };
  }

  private _openStatusDetails() {
    const status = this._config?.status;
    if (status?.source === "security") {
      const area = status.area ?? this._config?.area;
      const summary = this._securitySummary(area, status.membership);
      this._detail = {
        title: "Security",
        subtitle: area ? `Monitored in ${this._areaName(area) ?? "this area"}` : "Monitored security entities",
        entities: [...summary.alarms, ...summary.doors.entities, ...summary.windows.entities, ...summary.locks.entities].map((entry) => entry.entityId),
        emptyMessage: "No alarm, door, window, or lock entities are currently being monitored.",
      };
      return;
    }
    const signal = statusSignal(status?.source);
    if (!status || !signal) return;
    const area = status.area ?? this._config?.area;
    const labels: Record<AreaSignal, string> = { motion: "Motion", presence: "Presence", doors: "Doors", windows: "Windows", blinds: "Blinds", locks: "Locks", leaks: "Water leaks" };
    this._detail = {
      title: labels[signal],
      subtitle: area ? `Included from ${this._areaName(area) ?? "this area"}` : "Included entities",
      entities: this._areaSignalSummary(area, signal, { preset: signal, source: "area", membership: status.membership }).entities.map((entry) => entry.entityId),
      emptyMessage: "No compatible entities are currently contributing to this status.",
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

  private _headerClicked() { this._runAction(this._config?.header_action ?? this._config); }
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

  protected updated(changed: PropertyValues<this>) {
    if (!changed.has("_detail" as never)) return;
    const dialog = this.renderRoot.querySelector<HTMLDialogElement>(".detail-sheet");
    if (this._detail && dialog && !dialog.open) dialog.showModal();
    if (!this._detail && dialog?.open) dialog.close();
  }

  protected render() {
    if (!this._config) return nothing;
    const status = this._status();
    const metrics = (this._config.metrics ?? []).map((metric) => ({ metric, display: this._metric(metric) })).filter((entry): entry is { metric: MetricConfig; display: MetricDisplay } => Boolean(entry.display));
    const title = this._config.title
      ?? (this._config.profile === "house" ? "House" : this._config.profile === "security" ? "Security" : this._areaName(this._config.area))
      ?? "Area";
    const showHeader = this._config.layout !== "metrics-only";
    const headerAlignment = this._config.layout === "stacked" || this._config.layout === "tower" ? this._config.header_alignment ?? "left" : "left";
    const titleLines = this._headerLineMode("title");
    const statusLines = this._headerLineMode("status");
    const titleFit = this._headerTitleFit(title, titleLines);
    const appearance = this._config.appearance;
    const background = appearance?.background ?? this._config.background;
    const noShadow = appearance?.shadow === false;
    const headerAction = this._config.header_action ?? this._config;
    const headerClickable = Boolean(headerAction.action && headerAction.action !== "none");
    const statusClickable = Boolean(this._config.status?.action && this._config.status.action !== "none");
    return html`
      <ha-card class=${`${this._config.theme === "dark" ? "force-dark" : this._config.theme === "light" ? "force-light" : ""}${noShadow ? " no-shadow" : ""}${headerClickable ? " clickable" : ""}`} style=${`--ha-card-border-radius:var(--area-glance-card-border-radius, 24px);${background ? `--area-glance-card-background:${background}` : ""}`} @click=${this._headerClicked}>
        <section class=${showHeader ? `layout${this._config.layout === "stacked" ? " stacked" : ""}${this._config.layout === "tower" ? " tower" : ""}` : "layout metrics-only"} style=${this._layoutStyle(metrics.length)}>
          ${showHeader ? html`<div class=${`summary align-${headerAlignment}`} style=${`--area-glance-title-fit:${titleFit}`}>
              <div class=${`title ${titleLines}`}>${title}</div>
              ${status.line ? html`<button class=${`status ${statusLines}${statusClickable ? " clickable" : ""}`} ?disabled=${!statusClickable} @click=${this._statusClicked}><span class="dot" style=${`background:${status.color}`}></span><span class="status-copy"><span class="status-line">${status.line}</span>${status.age ? html`<small class="status-age">${status.age}</small>` : nothing}</span></button>` : nothing}
            </div>` : nothing}
          <div class="metrics" style=${`--metric-count:${Math.max(metrics.length, 1)}`}>
            ${metrics.map(({ metric, display }) => {
              const valueParts = splitDisplayUnit(display.value);
              return html`
                <button class="metric" style=${`--area-glance-value-fit:${this._textFit(valueParts.primary, "value")};--area-glance-value-cap:${this._textContainerCap(valueParts.primary, "value")}cqi;--area-glance-unit-fit:${this._unitFit(valueParts.primary, valueParts.unit)};--area-glance-label-fit:${this._textFit(display.label, "label")};--area-glance-label-cap:${this._textContainerCap(display.label, "label")}cqi`} aria-label=${`${display.label}: ${display.value}${display.aggregate ? ", show included entities" : ""}`} @click=${(event: Event) => this._metricClicked(metric, display, event)} @pointerdown=${(event: PointerEvent) => this._metricPointerDown(metric, display, event)} @pointermove=${(event: PointerEvent) => this._metricPointerMove(event)} @pointerup=${(event: PointerEvent) => this._metricPointerUp(event)} @pointercancel=${() => this._cancelMetricGesture()} @contextmenu=${(event: Event) => event.preventDefault()} @keydown=${(event: KeyboardEvent) => this._metricKeyDown(metric, display, event)}>
                  ${display.visual?.kind === "analogue-clock" ? html`<span class="analogue-clock" style=${`--hour-angle:${display.visual.hourAngle}deg;--minute-angle:${display.visual.minuteAngle}deg;color:${display.color ?? "var(--area-glance-accent)"}`}></span>` : display.visual?.kind === "calendar" ? html`<span class="calendar-date" style=${display.color ? `color:${display.color}` : ""}><small>${display.visual.month}</small><strong>${display.visual.day}</strong></span>` : html`${metric.show_icon !== false && metric.preset !== "clock" ? html`<ha-icon .icon=${display.icon} style=${display.color ? `color:${display.color}` : ""}></ha-icon>` : nothing}<span class="value"><span class="value-primary">${valueParts.primary}</span>${valueParts.unit ? html`<span class="value-unit">${valueParts.unit}</span>` : nothing}</span>`}
                  ${metric.show_label !== false ? html`<span class="label">${display.label}</span>` : nothing}
                </button>
              `;
            })}
          </div>
        </section>
      </ha-card>
      <dialog class="detail-sheet" @close=${this._closeDetail} @click=${(event: Event) => { if (event.target === event.currentTarget) this._closeDetail(); }}>
        ${this._detail ? (() => {
          const lightEntities = this._detail.lightControlPanel ? this._lightEntityIds(this._detail) : [];
          const lightsOn = lightEntities.filter((entityId) => this.hass?.states[entityId]?.state === "on").length;
          const allLightsActive = lightsOn > 0;
          return html`<div class="detail-content ${this._detail.lightControlPanel ? "light-control-panel" : ""}">
          <div class="detail-heading"><div><h2>${this._detail.title}</h2><p>${this._detail.subtitle}</p></div><button class="detail-close" aria-label="Close" @click=${this._closeDetail}>×</button></div>
          ${this._detail.lightControlPanel && lightEntities.length ? html`<div class="detail-count"><span class="detail-count-dot"></span>${lightsOn} of ${lightEntities.length} on</div><div class="detail-all-lights"><span class="detail-icon-badge active"><ha-icon icon="mdi:lightbulb-group-outline"></ha-icon></span><span class="detail-all-copy"><strong>All lights</strong><small>Turn all on or off</small></span><button class="detail-control ${allLightsActive ? "active" : ""}" role="switch" aria-checked=${String(allLightsActive)} aria-label=${allLightsActive ? "Some lights are on. Turn all lights off" : "All lights are off. Turn all lights on"} @click=${this._runAllLightsControl}><span class="detail-toggle-thumb"></span></button></div>` : nothing}
          ${this._detail.entities.length ? html`<div class="detail-entities">${this._detail.entities.map((entityId) => {
            const control = this._detail?.quickControls ? this._quickControl(entityId) : undefined;
            const name = this._entityName(entityId);
            const state = this._entityState(entityId);
            const lightRow = this._detail?.lightControlPanel === true && entityId.startsWith("light.");
            return html`<div class="detail-entity ${lightRow ? "detail-light-entity" : ""}">${lightRow ? html`<span class="detail-icon-badge ${control?.isOn ? "active" : ""}"><ha-icon icon=${this._lightDetailIcon(entityId)}></ha-icon></span>` : nothing}<button class="detail-entity-main" aria-label=${`${name}: ${state}. Show details`} @click=${() => this._openEntityDetails(entityId)}><span><strong>${name}</strong><small>${lightRow ? this._lightDetailDescription(entityId) : entityId}</small></span>${control ? nothing : html`<span class="detail-state">${state}</span>`}</button>${control ? html`<button class="detail-control ${control.isOn ? "active" : ""}" role="switch" aria-checked=${String(control.isOn)} aria-label=${`${name} is ${control.isOn ? "on" : "off"}. Toggle`} @click=${(event: Event) => this._runQuickControl(event, entityId)}><span class="detail-toggle-thumb"></span></button>` : nothing}</div>`;
          })}</div>` : html`<p class="detail-empty">${this._detail.emptyMessage}</p>`}
        </div>`;
        })() : nothing}
      </dialog>`;
  }

  static styles = css`
    :host { display:block; --area-glance-accent:var(--primary-color); }
    ha-card { overflow:hidden; border:1px solid color-mix(in srgb, var(--primary-text-color) 8%, transparent); border-radius:var(--area-glance-card-border-radius, 24px); cursor:default; background:var(--area-glance-card-background, var(--card-background-color, #fff)); box-shadow:var(--ha-card-box-shadow, 0 8px 24px rgb(0 0 0 / 18%)); }
    ha-card.clickable { cursor:pointer; }
    ha-card.no-shadow { box-shadow:none; }
    .layout { min-height:var(--area-glance-content-height, 78px); display:grid; grid-template-columns:clamp(108px, 23%, 152px) minmax(0, 1fr); align-items:stretch; padding:var(--area-glance-pad-y, 8px) var(--area-glance-pad-x, 12px); }
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
    .title { box-sizing:border-box; width:100%; max-width:100%; color:var(--primary-text-color); font-size:calc(var(--area-glance-title-size, 1.8rem) * var(--area-glance-title-scale, 1) * var(--area-glance-title-fit, 1)); font-weight:720; letter-spacing:-.03em; line-height:1.12; padding-block:.03em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .title.multi { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; white-space:normal; }
    .status { appearance:none; width:100%; padding:0; border:0; color:var(--secondary-text-color); background:transparent; display:flex; gap:6px; align-items:flex-start; margin-top:5px; font:inherit; font-size:calc(var(--area-glance-status-size, .85rem) * var(--area-glance-status-scale, 1)); line-height:1.15; min-width:0; text-align:left; }
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
    .metric::before { content:""; position:absolute; left:0; top:10%; height:80%; width:1px; background:color-mix(in srgb, var(--primary-text-color) 12%, transparent); }
    .layout.stacked .metric:first-child::before, .layout.metrics-only .metric:first-child::before { display:none; }
    .layout.tower .metric { display:grid; grid-template-columns:calc(var(--area-glance-icon-size, 24px) + 10px) minmax(0, 1fr); grid-template-rows:auto auto; column-gap:8px; justify-content:start; align-content:center; text-align:left; padding-inline:8px; }
    .layout.tower .metric::before { left:8px; top:0; width:calc(100% - 16px); height:1px; }
    .layout.tower .metric:first-child::before { display:none; }
    .layout.tower .metric ha-icon, .layout.tower .metric .analogue-clock, .layout.tower .metric .calendar-date { grid-row:1 / span 2; grid-column:1; margin:0; justify-self:center; }
    .layout.tower .metric .value { grid-row:1; grid-column:2; justify-content:flex-start; }
    .layout.tower .metric .label { grid-row:2; grid-column:2; margin-top:0; }
    .metric:hover { background:color-mix(in srgb, var(--area-glance-accent) 8%, transparent); }
    ha-icon { color:var(--area-glance-accent); width:var(--area-glance-icon-size, 24px); height:var(--area-glance-icon-size, 24px); margin-bottom:2px; flex:none; }
    .analogue-clock { position:relative; width:calc(var(--area-glance-icon-size, 24px) + 6px); height:calc(var(--area-glance-icon-size, 24px) + 6px); margin-bottom:2px; border:2px solid currentColor; border-radius:50%; box-sizing:border-box; flex:none; }
    .analogue-clock::before, .analogue-clock::after { content:""; position:absolute; left:50%; bottom:50%; width:2px; border-radius:2px; background:currentColor; transform-origin:50% 100%; }
    .analogue-clock::before { height:30%; transform:translateX(-50%) rotate(var(--hour-angle)); }
    .analogue-clock::after { height:42%; transform:translateX(-50%) rotate(var(--minute-angle)); }
    .calendar-date { width:calc(var(--area-glance-icon-size, 24px) + 13px); min-height:calc(var(--area-glance-icon-size, 24px) + 13px); margin-bottom:2px; border:1.5px solid currentColor; border-radius:4px; overflow:hidden; display:flex; flex-direction:column; align-items:center; justify-content:center; line-height:1; flex:none; }
    .calendar-date small { width:100%; padding:2px 0 1px; color:#fff; background:currentColor; font-size:.42em; font-weight:700; letter-spacing:.04em; text-transform:uppercase; }
    .calendar-date strong { padding:2px 0 3px; color:currentColor; font-size:.76em; letter-spacing:-.04em; }
    .value { display:flex; align-items:baseline; justify-content:center; min-width:0; font-size:calc(var(--area-glance-value-size, 1.6rem) * var(--area-glance-value-fit, 1) * var(--area-glance-value-scale, 1)); font-size:min(calc(var(--area-glance-value-size, 1.6rem) * var(--area-glance-value-fit, 1) * var(--area-glance-value-scale, 1)), var(--area-glance-value-cap, 27cqi)); line-height:1.05; padding-block:.03em; font-weight:720; letter-spacing:-.02em; white-space:nowrap; overflow:hidden; max-width:100%; }
    .value-primary { min-width:0; overflow:hidden; text-overflow:ellipsis; }
    .value-unit { flex:none; margin-left:.06em; font-size:calc(1em * var(--area-glance-unit-fit, 1)); font-weight:700; letter-spacing:-.045em; }
    .label { color:var(--secondary-text-color); font-size:calc(var(--area-glance-label-size, .82rem) * var(--area-glance-label-fit, 1) * var(--area-glance-label-scale, 1)); font-size:min(calc(var(--area-glance-label-size, .82rem) * var(--area-glance-label-fit, 1) * var(--area-glance-label-scale, 1)), var(--area-glance-label-cap, 15cqi)); line-height:1.1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%; margin-top:1px; }
    .force-dark { --area-glance-card-background:#353c45; --primary-text-color:#f5f7fb; --secondary-text-color:#c4ccd8; }
    .force-light { --area-glance-card-background:#fff; --primary-text-color:#18212e; --secondary-text-color:#5f6b7e; }
    .detail-sheet { width:min(560px, calc(100vw - 32px)); max-height:min(78vh, 720px); padding:0; border:0; border-radius:22px; color:var(--primary-text-color); background:var(--ha-card-background, var(--card-background-color)); box-shadow:0 18px 50px rgb(0 0 0 / 28%); overflow:hidden; }
    .detail-sheet::backdrop { background:rgb(0 0 0 / 30%); backdrop-filter:blur(8px); }
    .detail-content { padding:20px; overflow:hidden; }
    .detail-heading { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; margin-bottom:12px; }
    .detail-heading h2 { margin:0; font-size:1.35rem; }
    .detail-heading p, .detail-empty { margin:4px 0 0; color:var(--secondary-text-color); }
    .detail-close { appearance:none; border:0; width:32px; height:32px; border-radius:50%; color:var(--primary-text-color); background:color-mix(in srgb, var(--primary-text-color) 8%, transparent); font:1.5rem/1 sans-serif; cursor:pointer; outline:none; }
    .detail-close:focus-visible { outline:2px solid var(--primary-color); outline-offset:2px; }
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
    .light-control-panel { padding:28px; }
    .light-control-panel .detail-heading { margin-bottom:20px; }
    .light-control-panel .detail-heading h2 { font-size:clamp(1.7rem, 7vw, 2.4rem); letter-spacing:-.035em; }
    .light-control-panel .detail-heading p { font-size:1.05rem; }
    .light-control-panel .detail-close { width:42px; height:42px; font-size:2rem; }
    .detail-count { display:inline-flex; align-items:center; gap:9px; padding:8px 13px; margin:0 0 18px; border-radius:999px; color:var(--primary-text-color); background:color-mix(in srgb, var(--primary-text-color) 7%, transparent); font-size:.95rem; font-weight:600; }
    .detail-count-dot { width:11px; height:11px; border-radius:50%; background:var(--state-light-active-color, var(--warning-color, #ff9800)); }
    .detail-all-lights { display:flex; align-items:center; gap:14px; padding:15px 18px; margin-bottom:18px; border:1px solid color-mix(in srgb, var(--primary-text-color) 10%, transparent); border-radius:16px; background:color-mix(in srgb, var(--primary-text-color) 3%, transparent); }
    .detail-icon-badge { display:grid; flex:none; place-items:center; width:50px; height:50px; border-radius:50%; color:var(--secondary-text-color); background:color-mix(in srgb, var(--primary-text-color) 6%, transparent); }
    .detail-icon-badge.active { color:var(--state-light-active-color, var(--warning-color, #ff9800)); }
    .detail-icon-badge ha-icon { width:27px; height:27px; margin:0; color:currentColor; }
    .detail-all-copy { min-width:0; flex:1; }
    .detail-all-copy strong, .detail-all-copy small { display:block; }
    .detail-all-copy strong { font-size:1.05rem; }
    .detail-all-copy small { margin-top:3px; color:var(--secondary-text-color); }
    .light-control-panel .detail-entities { gap:0; max-height:47vh; border:1px solid color-mix(in srgb, var(--primary-text-color) 11%, transparent); border-radius:16px; background:color-mix(in srgb, var(--primary-text-color) 1.5%, transparent); }
    .light-control-panel .detail-entity { gap:14px; min-height:76px; padding:12px 18px; border-radius:0; }
    .light-control-panel .detail-entity + .detail-entity { border-top:1px solid color-mix(in srgb, var(--primary-text-color) 10%, transparent); }
    .light-control-panel .detail-entity-main { padding:0; border-radius:7px; }
    .light-control-panel .detail-entity:hover, .light-control-panel .detail-entity:focus-within { background:color-mix(in srgb, var(--area-glance-accent) 6%, transparent); }
    .light-control-panel .detail-entity strong { font-size:1.02rem; }
    .light-control-panel .detail-entity small { font-size:.9rem; }
    .light-control-panel .detail-control { width:56px; height:32px; }
    .light-control-panel .detail-toggle-thumb { width:26px; height:26px; }
    @media (max-width: 500px) { .detail-sheet { width:calc(100vw - 20px); max-height:84vh; border-radius:20px; } .light-control-panel { padding:22px 18px; } .light-control-panel .detail-entity { padding:11px 13px; gap:11px; } .light-control-panel .detail-icon-badge { width:44px; height:44px; } .light-control-panel .detail-icon-badge ha-icon { width:24px; height:24px; } }
    @media (max-width: 500px) { ha-card { border-radius:22px; } .layout { grid-template-columns:clamp(88px, 25%, 108px) minmax(0, 1fr); padding:7px 8px; } .title { font-size:min(calc(var(--area-glance-title-size, 1.8rem) * var(--area-glance-title-scale, 1)), 1.48rem); } .status { font-size:calc(var(--area-glance-status-size, .85rem) * var(--area-glance-status-scale, 1)); } .metric { padding:2px 1px; } ha-icon { width:min(var(--area-glance-icon-size, 24px), 22px); height:min(var(--area-glance-icon-size, 24px), 22px); margin-bottom:1px; } .label { margin-top:1px; } }
  `;
}

export class AreaGlanceCardEditor extends LitElement {
  public hass?: HassLike;
  private _config: AreaGlanceConfig = { title: "Area", metrics: DEFAULT_METRICS };
  private _suggestionsNeedUpdate = false;
  private _draggedMetricIndex?: number;
  private _dragOverMetricIndex?: number;
  private _draggedMetricHeight = 0;
  /** Original row centres captured before any preview transforms are applied. */
  private _dragMetricMidpoints: { index: number; midpoint: number }[] = [];

  static get properties() { return { hass: { attribute: false }, _config: { state: true }, _suggestionsNeedUpdate: { state: true } }; }
  public setConfig(config: AreaGlanceConfig) {
    this._config = { ...config, metrics: config.metrics?.length ? config.metrics : DEFAULT_METRICS };
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
    return "area";
  }
  private _purposeSelected(purpose: "area" | "house" | "energy" | "battery" | "security") {
    if (purpose === "house" || purpose === "security") {
      this._populateAreaPreset("", purpose);
      return;
    }
    const profile = purpose === "area" ? "auto" : purpose;
    this._change({ profile });
    if (this._config.area) this._suggestionsNeedUpdate = true;
  }
  private _appearancePresetChanged(event: Event) {
    const preset = (event.target as HTMLSelectElement).value as NonNullable<NonNullable<AreaGlanceConfig["appearance"]>["preset"]>;
    if (preset === "custom") {
      this._change({ theme: "dark", background: undefined, appearance: { ...this._config.appearance, preset, background: this._config.appearance?.background ?? "#353c45" } });
      return;
    }
    const appearance = APPEARANCE_PRESETS[preset];
    this._change({ theme: appearance.theme, background: undefined, appearance: { ...this._config.appearance, preset, background: appearance.background } });
  }
  private _customBackgroundChanged(event: Event) {
    this._change({ appearance: { ...this._config.appearance, preset: "custom", background: (event.target as HTMLInputElement).value } });
  }
  private _shadowChanged(event: Event) {
    this._change({ appearance: { ...this._config.appearance, shadow: (event.target as HTMLInputElement).checked } });
  }
  private _textScaleChanged(key: "title" | "status" | "value" | "label", event: Event) {
    const value = Math.max(80, Math.min(135, Number((event.target as HTMLInputElement).value)));
    const textScale = { ...this._config.appearance?.text_scale, [key]: value };
    if (value === 100) delete textScale[key];
    this._change({ appearance: { ...this._config.appearance, text_scale: Object.keys(textScale).length ? textScale : undefined } });
  }
  private _resetTextScale() {
    this._change({ appearance: { ...this._config.appearance, text_scale: undefined } });
  }
  private _pickerValue(event: Event): string { return (event as CustomEvent<{ value?: string }>).detail?.value ?? ""; }
  private _areaName(area: string): string {
    return this.hass?.areas?.[area]?.name ?? area.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  }
  private _entitiesInArea(area: string): string[] {
    return areaEntityIds(this.hass, area);
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
  private _inferredProfile(area: string, requested: NonNullable<AreaGlanceConfig["profile"]>): Exclude<NonNullable<AreaGlanceConfig["profile"]>, "auto"> {
    if (requested !== "auto") return requested;
    if (!area) return "house";
    const name = this._areaName(area).toLowerCase();
    if (/(garage|utility|plant|battery)/.test(name)) return "battery";
    if (/(energy|solar|power)/.test(name)) return "energy";
    if (/(living|lounge|family|den|media|cinema|tv)/.test(name)) return "media";
    return "room";
  }
  private _populateAreaPreset(area: string, requestedProfile = this._config.profile ?? "auto") {
    const entities = this._entitiesInArea(area);
    const profile = this._inferredProfile(area, requestedProfile);
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
      title: this._config.layout === "metrics-only" ? this._config.title : profile === "house" ? "House" : profile === "security" ? "Security" : this._areaName(area),
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
  private _dragEnd() {
    this._draggedMetricIndex = undefined;
    this._dragOverMetricIndex = undefined;
    this._draggedMetricHeight = 0;
    this._dragMetricMidpoints = [];
    this.requestUpdate();
  }
  private _dropMetric(index: number, event: DragEvent) {
    event.preventDefault();
    const from = this._draggedMetricIndex ?? Number(event.dataTransfer?.getData("text/plain"));
    this._draggedMetricIndex = undefined;
    this._dragOverMetricIndex = undefined;
    this._draggedMetricHeight = 0;
    this._dragMetricMidpoints = [];
    if (!Number.isInteger(from) || from === index || from < 0) return;
    const metrics = [...(this._config.metrics ?? [])];
    const [moved] = metrics.splice(from, 1);
    metrics.splice(index, 0, moved);
    this._change({ metrics });
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
    const appearancePreset = this._config.appearance?.preset ?? "theme";
    const textScale = this._config.appearance?.text_scale ?? {};
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
          ${([ ["area", "An area", "Room insights"], ["house", "Whole home", "Home overview"], ["energy", "Energy", "Energy system"], ["battery", "Home battery", "Battery system"], ["security", "Security", "Home security"] ] as const).map(([value, title, description]) => html`<button class="purpose ${value === "security" ? "security" : ""} ${purpose === value ? "selected" : ""}" aria-pressed=${purpose === value} @click=${() => this._purposeSelected(value)}><strong>${title}</strong><small>${description}</small></button>`)}
        </div>
        ${purpose === "house" || purpose === "security" ? html`<p class="applied">${purpose === "security" ? "Whole-home security suggestions are applied." : "Whole-home suggestions are applied."} You can refine the insights below.</p>` : html`<ha-area-picker .hass=${this.hass} .value=${this._config.area ?? ""} .label=${areaLabel} @value-changed=${this._areaSelected}></ha-area-picker>${this._suggestionsNeedUpdate ? html`<div class="suggestion-update"><span>${currentAreaName} is selected. Update the insights to match it?</span><button class="primary" @click=${this._applySuggestions}>Update suggestions</button></div>` : this._config.area ? html`<p class="applied">Suggestions are based on ${currentAreaName}. Change any insight below.</p>` : nothing}`}
      </section>
      <section class="insights"><h3>Insights</h3><p class="hint">Keep up to five. They resize automatically to fit the card.</p>
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
        const sourceLabel = usesArea ? (wholeHomeAggregate ? "Whole home" : preset === "attention" ? "Area health" : preset === "lights" ? "Area count" : "Whole area") : usesSelectedEntities ? "Selected entities" : selfContained ? "Live date & time" : preset === "people_home" ? "Home zone" : "One entity";
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
        <summary><span class="drag-handle" draggable="true" role="img" aria-label="Drag insight to reorder" title="Drag to reorder" @click=${(event: Event) => { event.preventDefault(); event.stopPropagation(); }} @dragstart=${(event: DragEvent) => this._dragStart(index, event)} @dragend=${this._dragEnd}>⠿</span><ha-icon .icon=${metric.icon ?? PRESETS[preset].icon}></ha-icon><span class="insight-name">${PRESETS[preset].label}</span><span class="source-pill">${sourceLabel}</span></summary>
        <div class="insight-fields"><label>What should this show?
          <select .value=${metric.preset ?? "custom"} @change=${(e: Event) => this._updateMetric(index, { preset: (e.target as HTMLSelectElement).value as MetricPreset })}>
            <optgroup label="Automatic area insights">${AUTOMATIC_METRIC_PRESETS.map((option) => html`<option value=${option}>${PRESETS[option].label}</option>`)}</optgroup>
            <optgroup label="Chosen entities and utilities">${DEVICE_METRIC_PRESETS.map((option) => html`<option value=${option}>${PRESETS[option].label}</option>`)}</optgroup>
            ${preset === "occupancy" ? html`<option value="occupancy">${PRESETS.occupancy.label}</option>` : nothing}
          </select>
        </label>
        <p class="slot-hint">${SLOT_HELPERS[preset]}</p>
        ${canChooseSource ? html`<label>Use data from
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
        ${usesArea && !(preset === "attention" && metric.attention_scope === "home") ? html`<ha-area-picker .hass=${this.hass} .value=${metric.area ?? this._config.area ?? ""} .label=${preset === "attention" ? "Area to check (leave blank for all)" : preset === "lights" ? "Area to count (leave blank for all)" : preset === "blinds" ? "Area with blinds (leave blank for all)" : "Area to summarise (leave blank for all)"} @value-changed=${(e: Event) => this._updateMetric(index, { source: "area", area: this._pickerValue(e) })}></ha-area-picker>` : nothing}
        ${usesArea && contributorHint ? html`<p class="contributor-hint">${contributorHint}</p>` : nothing}
        ${usesSelectedEntities ? html`<div class="selected-entities"><p class="slot-hint">Choose compatible entities from anywhere in Home Assistant. They are combined using the option below.</p>${(metric.entities ?? []).map((entityId, entityIndex) => html`<div class="selected-entity"><ha-entity-picker .hass=${this.hass} .value=${entityId} .label=${`${PRESETS[preset].label} entity ${entityIndex + 1}`} allow-custom-entity @value-changed=${(e: Event) => this._selectedEntityChanged(index, entityIndex, e)}></ha-entity-picker><button class="remove-rule" aria-label="Remove selected entity" @click=${() => this._removeSelectedEntity(index, entityIndex)}>Remove</button></div>`)}${!(metric.entities?.length) ? html`<p class="slot-hint">Add the entities you want to combine.</p>` : nothing}<button class="add-rule" @click=${() => this._addSelectedEntity(index)}>Add entity</button>${selectedCandidates.length ? nothing : html`<p class="slot-hint">No compatible entities are currently detected, but you can still enter an entity ID manually.</p>`}</div>` : nothing}
        ${requiresEntity ? html`<ha-entity-picker .hass=${this.hass} .value=${metric.entity ?? ""} .label=${preset === "custom" ? "Main text entity" : preset === "device" ? "Device or entity" : preset === "vacuum" ? "Robot vacuum" : `${PRESETS[preset].label} entity`} allow-custom-entity @value-changed=${(e: Event) => this._updateMetric(index, { source: "entity", entity: this._pickerValue(e) })}></ha-entity-picker>` : nothing}
        ${preset === "weather" ? html`<label>Show<select .value=${metric.weather_display ?? "condition"} @change=${(e: Event) => this._updateMetric(index, { weather_display: (e.target as HTMLSelectElement).value as NonNullable<MetricConfig["weather_display"]> })}><option value="condition">Condition</option><option value="temperature">Temperature</option><option value="apparent_temperature">Feels like</option><option value="humidity">Humidity</option><option value="wind_speed">Wind speed</option></select></label>` : nothing}
        ${preset === "vacuum" ? html`<label>Show<select .value=${metric.vacuum_display ?? "state"} @change=${(e: Event) => this._updateMetric(index, { vacuum_display: (e.target as HTMLSelectElement).value as NonNullable<MetricConfig["vacuum_display"]> })}><option value="state">Activity state</option><option value="battery">Battery level</option><option value="fan_speed">Fan speed</option></select></label>` : nothing}
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
      </section>
      <details class="settings">
        <summary>Header</summary>
        <label>Card layout<select .value=${this._config.layout ?? "header"} @change=${this._layoutChanged}><option value="header">Title beside insights (default)</option><option value="stacked">Title above insights</option><option value="tower">Insight tower (one column)</option><option value="metrics-only">Insights only</option></select></label>
        ${this._config.layout !== "metrics-only" ? html`
          ${this._config.layout === "stacked" || this._config.layout === "tower" ? html`<label>Header alignment<select .value=${this._config.header_alignment ?? "left"} @change=${(e: Event) => this._change({ header_alignment: (e.target as HTMLSelectElement).value as NonNullable<AreaGlanceConfig["header_alignment"]> })}><option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option></select></label>` : nothing}
          <label>Title <input .value=${this._config.title ?? ""} placeholder=${currentAreaName} @input=${(e: Event) => this._input(e, "title")}></label>
          <details class="header-fine-tuning"><summary>Header fine tuning</summary><p class="slot-hint">Auto keeps a title above insights on one line, and lets a title beside insights use two lines when needed.</p><div class="two"><label>Title lines<select .value=${this._config.header_title_lines ?? "auto"} @change=${(e: Event) => this._change({ header_title_lines: (e.target as HTMLSelectElement).value as NonNullable<AreaGlanceConfig["header_title_lines"]> })}><option value="auto">Auto (recommended)</option><option value="single">One line</option><option value="multi">Up to two lines</option></select></label><label>Status lines<select .value=${this._config.header_status_lines ?? "auto"} @change=${(e: Event) => this._change({ header_status_lines: (e.target as HTMLSelectElement).value as NonNullable<AreaGlanceConfig["header_status_lines"]> })}><option value="auto">Auto (recommended)</option><option value="single">One line</option><option value="multi">Up to two lines</option></select></label></div></details>
          <label>When the header is tapped<select .value=${headerAction} @change=${this._headerActionChanged}><option value="none">Do nothing</option><option value="area-details">Show area details</option><option value="navigate">Navigate to a dashboard page</option></select></label>
          ${headerAction === "navigate" ? html`<label>Dashboard path <input .value=${this._config.header_action?.navigation_path ?? ""} placeholder="/dashboard/room" @input=${this._headerNavigationChanged}></label>` : nothing}
          <label class="checkbox"><input type="checkbox" .checked=${Boolean(status)} @change=${this._statusEnabledChanged}> Show a status line</label>
          ${status ? html`
            <label>Status comes from<select .value=${statusSource} @change=${this._statusSourceChanged}><option value="security">Whole-home security</option><option value="area_presence">Presence in this area</option><option value="area_motion">Motion in this area</option><option value="area_doors">Doors in this area</option><option value="area_windows">Windows in this area</option><option value="area_leaks">Water leaks in this area</option><option value="entity">A specific entity</option></select></label>
            ${statusSource === "security" ? html`<p class="slot-hint">Security checks recognised alarms, doors, windows, and locks. Leave the area empty for the whole home.</p>` : nothing}
            ${usesAreaStatus ? html`<ha-area-picker .hass=${this.hass} .value=${status.area ?? this._config.area ?? ""} .label=${statusAreaLabel} @value-changed=${this._statusAreaChanged}></ha-area-picker>` : html`<ha-entity-picker .hass=${this.hass} .value=${status.entity ?? ""} .label="Status entity" allow-custom-entity @value-changed=${(e: Event) => this._change({ status: { ...status, source: "entity", entity: this._pickerValue(e) } })}></ha-entity-picker>`}
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
        <label>Colour style<select .value=${appearancePreset} @change=${this._appearancePresetChanged}><option value="theme">Use dashboard theme</option><option value="light">Light</option><option value="slate">Slate</option><option value="charcoal">Dark</option><option value="custom">Custom background</option></select></label>
        ${appearancePreset === "custom" ? html`<label>Background colour <input type="color" .value=${this._config.appearance?.background ?? "#353c45"} @input=${this._customBackgroundChanged}></label>` : nothing}
        <label class="checkbox"><input type="checkbox" .checked=${this._config.appearance?.shadow !== false} @change=${this._shadowChanged}> Show drop shadow</label>
        <details class="typography"><summary>Text size</summary><p class="slot-hint">Applies across the whole card. The default is 100%.</p>
          ${([ ["title", "Header"], ["status", "Header status"], ["value", "Insight values"], ["label", "Insight labels"] ] as const).map(([key, label]) => html`<div class="text-scale-row"><label>${label}<input type="range" min="80" max="135" step="5" .value=${String(textScale[key] ?? 100)} @input=${(event: Event) => this._textScaleChanged(key, event)}></label><output>${textScale[key] ?? 100}%</output></div>`)}
          ${Object.keys(textScale).length ? html`<button class="reset-membership" @click=${this._resetTextScale}>Reset text sizes</button>` : nothing}
        </details>
      </details>
    </div>`;
  }
  static styles = css`
    :host { display:block; } .editor { padding:12px; } h3 { margin:0; } .hint, .slot-hint, .contributor-hint { color:var(--secondary-text-color); margin:4px 0 12px; } .slot-hint, .contributor-hint { font-size:.88rem; } .contributor-hint { padding:7px 9px; border-radius:6px; background:color-mix(in srgb, var(--primary-color) 7%, var(--card-background-color)); } label { display:block; font-weight:500; margin:12px 0; } ha-entity-picker, ha-area-picker { display:block; margin:12px 0; } input, select { box-sizing:border-box; width:100%; padding:8px; margin-top:4px; font:inherit; color:inherit; background:var(--card-background-color); border:1px solid var(--divider-color); border-radius:6px; } button { cursor:pointer; font:inherit; } .setup, .insights { margin-top:18px; } .section-label { display:block; font-weight:600; margin-bottom:8px; } .purpose-grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:8px; } .purpose { text-align:left; min-height:62px; padding:10px; color:var(--primary-text-color); background:var(--card-background-color); border:1px solid var(--divider-color); border-radius:8px; } .purpose.selected { border:2px solid var(--primary-color); background:color-mix(in srgb, var(--primary-color) 8%, var(--card-background-color)); } .purpose strong, .purpose small { display:block; } .purpose small { color:var(--secondary-text-color); font-size:.78rem; margin-top:3px; } .applied { color:var(--secondary-text-color); font-size:.9rem; margin:8px 0; } .suggestion-update { display:flex; gap:8px; align-items:center; justify-content:space-between; padding:10px; margin-top:8px; border-radius:8px; background:color-mix(in srgb, var(--primary-color) 8%, var(--card-background-color)); } .suggestion-update span { font-size:.88rem; } .primary, .add { padding:8px 12px; color:white; background:var(--primary-color); border:0; border-radius:6px; white-space:nowrap; } .advanced-setup, .settings, .insight-editor { border:1px solid var(--divider-color); border-radius:8px; padding:10px; margin-top:12px; } summary { cursor:pointer; font-weight:600; } .advanced-setup summary, .settings summary, .header-fine-tuning summary, .more-options summary, .thresholds summary, .metric-actions summary, .secondary-actions summary { color:var(--secondary-text-color); } .header-fine-tuning { margin-top:12px; padding:10px; border:1px solid var(--divider-color); border-radius:8px; } .header-fine-tuning .slot-hint { margin-bottom:4px; } .insight-editor { padding:0; overflow:hidden; transform:translateY(var(--reorder-shift, 0)); transition:transform 170ms ease, opacity .15s ease, box-shadow .15s ease, border-color .15s ease; will-change:transform; } .insight-editor.dragging { opacity:.22; } .insight-editor.drag-over { border-color:var(--primary-color); box-shadow:0 0 0 2px color-mix(in srgb, var(--primary-color) 24%, transparent); } .insight-editor > summary { display:flex; align-items:center; gap:8px; padding:12px; list-style:none; } .insight-editor > summary::-webkit-details-marker { display:none; } .insight-editor > summary::after { content:"›"; margin-left:auto; color:var(--secondary-text-color); font-size:1.4rem; } .insight-editor[open] > summary::after { transform:rotate(90deg); } .insight-editor ha-icon { width:22px; height:22px; color:var(--primary-color); } .drag-handle { display:inline-grid; place-items:center; width:26px; min-height:32px; margin:-8px 0 -8px -6px; border-radius:5px; color:var(--secondary-text-color); cursor:grab; font-size:1.15rem; letter-spacing:-2px; touch-action:none; user-select:none; } .drag-handle:hover { color:var(--primary-color); background:color-mix(in srgb, var(--primary-color) 9%, transparent); } .drag-handle:active { cursor:grabbing; } .insight-name { min-width:0; flex:1; } .source-pill { padding:3px 6px; border-radius:999px; color:var(--secondary-text-color); background:color-mix(in srgb, var(--secondary-text-color) 12%, transparent); font-size:.72rem; white-space:nowrap; } .insight-fields { padding:0 12px 12px; border-top:1px solid var(--divider-color); } .more-options, .thresholds, .metric-actions, .secondary-actions { margin-top:12px; } .thresholds, .metric-actions { padding:10px; border:1px solid var(--divider-color); border-radius:8px; } .two { display:grid; grid-template-columns:1fr 1fr; gap:8px; } .three { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:8px; align-items:end; } .checkbox { font-weight:400; } .checkbox input { width:auto; margin:0 6px 0 0; vertical-align:middle; } .threshold { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)) auto; gap:8px; align-items:end; margin-top:8px; } .threshold label { margin:0; } .insight-actions, .reorder { display:flex; align-items:center; gap:8px; } .insight-actions { justify-content:space-between; } .reorder button { padding:5px 7px; border:1px solid var(--divider-color); border-radius:5px; color:var(--primary-text-color); background:transparent; } .reorder button:disabled { opacity:.45; cursor:default; } .remove { padding:6px 0; color:var(--error-color); background:transparent; border:0; } .add { margin-top:12px; } @media (max-width:400px) { .purpose-grid, .two, .three, .threshold { grid-template-columns:1fr; } .suggestion-update { align-items:flex-start; flex-direction:column; } }
    .purpose.security { grid-column:span 2; }
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
