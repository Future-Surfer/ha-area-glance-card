import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { PRESETS, presetMetric } from "./presets";
import type { ActionConfig, AreaGlanceConfig, AreaSignal, EntityState, HassLike, MetricConfig, MetricPreset, StatusConfig } from "./types";

const UNAVAILABLE = new Set(["unknown", "unavailable", "none", ""]);
const DEFAULT_METRICS = [presetMetric("temperature"), presetMetric("lights"), presetMetric("power"), presetMetric("device")];
const AREA_SIGNAL_PRESETS = new Set<MetricPreset>(["motion", "presence", "doors", "windows", "leaks"]);
const AREA_MEASUREMENT_PRESETS = new Set<MetricPreset>(["temperature", "humidity", "power", "co2", "pm25", "voc", "aqi"]);
const AUTOMATIC_METRIC_PRESETS: MetricPreset[] = ["temperature", "humidity", "lights", "power", "co2", "pm25", "voc", "aqi", "motion", "presence", "doors", "windows", "leaks"];
const DEVICE_METRIC_PRESETS: MetricPreset[] = ["people_home", "battery", "device", "custom"];
const AREA_STATUS_SOURCES: Record<AreaSignal, StatusConfig["source"]> = {
  motion: "area_motion",
  presence: "area_presence",
  doors: "area_doors",
  windows: "area_windows",
  leaks: "area_leaks",
};
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
  leaks: "Show Dry until any compatible area water-leak sensor reports a leak.",
  people_home: "Show the current count from Home Assistant's Home zone.",
  occupancy: "Show the state of one chosen occupancy helper (legacy option).",
  device: "Choose any entity. The card uses a helpful icon and label for common devices.",
  custom: "Show an entity using its native state and unit.",
};
const HEIGHT_OPTIONS = {
  slim: { contentHeight: 64, stackedContentHeight: 122, metricRowHeight: 54, rows: 1.6, stackedRows: 2.8, scale: 0.82 },
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

const asNumber = (value: string): number | undefined => {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
};

const normalisedUnit = (state?: EntityState): string => String(state?.attributes.unit_of_measurement ?? "")
  .trim()
  .toLowerCase()
  .replaceAll("μ", "µ")
  .replaceAll("³", "3");

const isMeasurementSensor = (entityId: string, state?: EntityState): boolean =>
  entityId.startsWith("sensor.") && asNumber(state?.state ?? "") !== undefined;

const isAreaMeasurement = (preset: MetricPreset, entityId: string, state?: EntityState): boolean => {
  if (!isMeasurementSensor(entityId, state)) return false;
  const deviceClass = String(state?.attributes.device_class ?? "");
  const unit = normalisedUnit(state);
  const rawUnit = String(state?.attributes.unit_of_measurement ?? "");
  if (preset === "temperature") return deviceClass === "temperature";
  if (preset === "humidity") return deviceClass === "humidity";
  if (preset === "power") return ["W", "kW", "MW"].includes(rawUnit);
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

const isSignalEntity = (signal: AreaSignal, entityId: string, state?: EntityState): boolean => {
  if (!state) return false;
  const deviceClass = String(state.attributes.device_class ?? "");
  if (signal === "motion") return entityId.startsWith("binary_sensor.") && deviceClass === "motion";
  if (signal === "presence") return entityId.startsWith("binary_sensor.") && ["occupancy", "presence"].includes(deviceClass);
  if (signal === "doors") return isDoorEntity(entityId, state);
  if (signal === "windows") return isWindowEntity(entityId, state);
  return entityId.startsWith("binary_sensor.") && deviceClass === "moisture";
};

const isSignalActive = (signal: AreaSignal, entityId: string, state: EntityState): boolean =>
  signal === "doors" || signal === "windows" ? isDoorOpen(entityId, state) : state.state === "on";

interface MetricDisplay {
  icon: string;
  color?: string;
  value: string;
  label: string;
  showIcon?: boolean;
  showLabel?: boolean;
  entities?: string[];
  aggregate?: boolean;
}

interface AreaSignalSummary {
  entities: { entityId: string; state: EntityState }[];
  active: { entityId: string; state: EntityState }[];
  latest?: EntityState;
}

interface DetailSheet {
  title: string;
  subtitle: string;
  entities: string[];
  emptyMessage: string;
}

export class AreaGlanceCard extends LitElement {
  public hass?: HassLike;
  private _config?: AreaGlanceConfig;
  private _detail?: DetailSheet;

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
    if (!config || (!config.title && !config.area && config.profile !== "house" && config.layout !== "metrics-only")) {
      throw new Error("Set a title, choose an area, use the House profile, or use Metrics only.");
    }
    this._config = { ...config, metrics: config.metrics?.length ? config.metrics : DEFAULT_METRICS };
  }

  private _heightOption() { return HEIGHT_OPTIONS[this._config?.height ?? "slim"]; }
  private _gridRows() {
    const height = this._heightOption();
    return this._config?.layout === "stacked" ? height.stackedRows : height.rows;
  }

  public getCardSize() { return this._gridRows(); }
  public getGridOptions() { return { columns: 12, min_columns: 6 }; }

  protected willUpdate(changed: PropertyValues<this>) {
    if (changed.has("hass")) this.requestUpdate();
  }

  private _areaName(area?: string): string | undefined {
    if (!area) return undefined;
    return this.hass?.areas?.[area]?.name ?? area.replaceAll("_", " ").replace(/\b\w/g, (l) => l.toUpperCase());
  }

  private _areaEntities(area: string | undefined, domain?: string): string[] {
    if (!this.hass) return [];
    return Object.keys(this.hass.states).filter((entityId) => {
      if (domain && !entityId.startsWith(`${domain}.`)) return false;
      if (!area) return true;
      const entity = this.hass?.entities?.[entityId];
      const deviceArea = entity?.device_id ? this.hass?.devices?.[entity.device_id]?.area_id : undefined;
      return entity?.area_id === area || deviceArea === area;
    });
  }

  private _metricSource(metric: MetricConfig, preset: MetricPreset): "area" | "entity" {
    if (preset === "lights" || AREA_SIGNAL_PRESETS.has(preset)) return "area";
    return metric.source ?? (metric.entity ? "entity" : AREA_MEASUREMENT_PRESETS.has(preset) ? "area" : "entity");
  }

  private _areaSignalSummary(area: string | undefined, signal: AreaSignal): AreaSignalSummary {
    const entities = this._areaEntities(area)
      .map((entityId) => ({ entityId, state: this.hass?.states[entityId] }))
      .filter((entry): entry is { entityId: string; state: EntityState } => entry.state !== undefined && !UNAVAILABLE.has(entry.state.state) && isSignalEntity(signal, entry.entityId, entry.state));
    const active = entities.filter((entry) => isSignalActive(signal, entry.entityId, entry.state));
    const latest = entities.reduce<EntityState | undefined>((newest, entry) => !newest || new Date(entry.state.last_changed) > new Date(newest.last_changed) ? entry.state : newest, undefined);
    return { entities, active, latest };
  }

  private _areaSignalMetric(metric: MetricConfig, signal: AreaSignal, label: string, icon: string): MetricDisplay {
    const area = metric.area ?? this._config?.area;
    const color = metric.color ?? PRESETS[signal].color;
    if (!area && this._config?.profile !== "house") return { icon, color, value: "–", label };
    const summary = this._areaSignalSummary(area, signal);
    if (!summary.entities.length) return { icon, color, value: "–", label };
    const entityIds = summary.entities.map((entry) => entry.entityId);
    if (signal === "motion") {
      if (summary.active.length) return { icon, color: metric.color ?? "var(--amber-color, #ff9800)", value: "Active", label, entities: entityIds, aggregate: true };
      return { icon, color, value: summary.latest ? stateAge(summary.latest.last_changed).replace(" ago", "") : "–", label: "Last motion", entities: entityIds, aggregate: true };
    }
    if (signal === "presence") return { icon, color, value: summary.active.length ? "Occupied" : "Clear", label, entities: entityIds, aggregate: true };
    if (signal === "leaks") {
      return { icon, color: metric.color ?? (summary.active.length ? "var(--error-color, #db4437)" : "var(--success-color, #2eaa45)"), value: summary.active.length ? "Leak!" : "Dry", label, entities: entityIds, aggregate: true };
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

  private _areaMetric(metric: MetricConfig, preset: MetricPreset, label: string, icon: string): MetricDisplay {
    const area = metric.area ?? this._config?.area;
    const color = metric.color ?? PRESETS[preset].color;
    const aggregation = metric.aggregation ?? defaultAggregation(preset);
    if (!area && this._config?.profile !== "house") return { icon, color, value: "–", label };
    if (AREA_SIGNAL_PRESETS.has(preset)) return this._areaSignalMetric(metric, preset as AreaSignal, label, icon);
    if (preset === "lights") {
      const lights = this._areaEntities(area, metric.domain ?? "light");
      const on = lights.filter((id) => this.hass?.states[id]?.state === "on").length;
      return { icon, color: this._thresholdColor(metric, on, color), value: `${on}/${lights.length}`, label, entities: lights, aggregate: true };
    }
    const values = this._areaEntities(area).map((entityId) => ({ entityId, state: this.hass?.states[entityId], value: asNumber(this.hass?.states[entityId]?.state ?? "") }))
      .filter((item) => isAreaMeasurement(preset, item.entityId, item.state) && item.value !== undefined && item.state && !UNAVAILABLE.has(item.state.state)) as { entityId: string; state: EntityState; value: number }[];
    if (!values.length) return { icon, color, value: "–", label };

    if (preset === "power") {
      const watts = aggregateValues(values.map((item) => {
        const unit = String(item.state.attributes.unit_of_measurement ?? "W");
        return item.value * (unit === "kW" ? 1000 : unit === "MW" ? 1000000 : 1);
      }), aggregation);
      const useKilowatts = metric.unit === "kW" || (!metric.unit && Math.abs(watts) >= 1000);
      const displayed = useKilowatts ? watts / 1000 : watts;
      const decimals = metric.decimals ?? (useKilowatts ? 1 : 0);
      const unit = metric.show_unit === false ? "" : metric.unit ?? (useKilowatts ? "kW" : "W");
      return { icon, color: this._thresholdColor(metric, displayed, color), value: `${displayed.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals })}${unit}`, label, entities: values.map((item) => item.entityId), aggregate: true };
    }

    const compatibleValues = preset === "voc"
      ? Object.values(values.reduce<Record<string, typeof values>>((groups, item) => {
        const key = `${item.state.attributes.device_class ?? ""}|${normalisedUnit(item.state)}`;
        (groups[key] ??= []).push(item);
        return groups;
      }, {})).sort((left, right) => right.length - left.length)[0] ?? values
      : values;
    const number = aggregateValues(compatibleValues.map((item) => item.value), aggregation);
    const format = metric.format ?? PRESETS[preset].format;
    const decimals = metric.decimals ?? 0;
    const inferredUnit = String(compatibleValues[0].state.attributes.unit_of_measurement ?? "");
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

  private _metric(metric: MetricConfig): MetricDisplay | undefined {
    if (metric.hidden) return undefined;
    const preset = metric.preset ?? "custom";
    const defaults = PRESETS[preset];
    const state = metric.entity ? this.hass?.states[metric.entity] : undefined;
    if (metric.hide_unavailable && state && UNAVAILABLE.has(state.state)) return undefined;
    const entityDomain = metric.entity?.split(".")[0];
    const devicePresentation = entityDomain === "media_player" ? { icon: "mdi:television", label: "Media" }
      : entityDomain === "vacuum" ? { icon: "mdi:robot-vacuum", label: "Vacuum" }
      : entityDomain === "weather" ? { icon: "mdi:weather-partly-cloudy", label: "Weather" }
      : entityDomain === "climate" ? { icon: "mdi:thermostat", label: "Climate" }
      : undefined;
    const defaultLabel = preset === "device" && (!metric.label || metric.label === defaults.label)
      ? devicePresentation?.label ?? defaults.label
      : metric.label ?? defaults.label;
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

    if (this._metricSource(metric, preset) === "area") return this._areaMetric(metric, preset, label, icon);
    if (!state || UNAVAILABLE.has(state.state)) return { icon, color: metric.color ?? defaults.color, value: "–", label: customLabel };

    const number = asNumber(state.state);
    const format = metric.format ?? defaults.format;
    const decimals = metric.decimals ?? (format === "temperature" ? 0 : 0);
    let value: string;
    if (number !== undefined) {
      const rendered = number.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
      const inferredUnit = typeof state.attributes.unit_of_measurement === "string" ? state.attributes.unit_of_measurement : "";
      const unit = metric.show_unit === false ? "" : metric.unit ?? (format === "temperature" ? "°" : format === "percent" ? "%" : inferredUnit);
      value = `${rendered}${unit}`;
    } else if ((preset === "occupancy" || preset === "people_home") && ["on", "off"].includes(state.state)) {
      value = state.state === "on" ? "Home" : "Away";
    } else {
      value = preset === "device" ? friendlyDeviceState(entityDomain, state.state) : this.hass?.formatEntityState?.(state) ?? friendlyState(state.state);
    }
    let color = metric.color ?? defaults.color;
    if (!metric.color && preset === "battery" && number !== undefined) {
      color = number <= 20 ? "var(--error-color, #db4437)" : number <= 50 ? "var(--warning-color, #e0af00)" : "var(--info-color, #3f8cff)";
    }
    if (preset !== "custom") color = this._thresholdColor(metric, number, color);
    if (preset === "custom") color = this._customColor(metric, state, color);
    return { icon, color, value, label: customLabel };
  }

  private _status() {
    const configuredStatus = this._config?.status;
    const config = configuredStatus ?? {};
    const signal = statusSignal(config?.source);
    if (signal === "motion") {
      const area = config.area ?? this._config?.area;
      if (!area && this._config?.profile !== "house") return { line: "", age: "", color: "var(--disabled-text-color)" };
      const summary = this._areaSignalSummary(area, signal);
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
      const summary = this._areaSignalSummary(area, signal);
      if (!summary.entities.length) return { line: "", age: "", color: "var(--disabled-text-color)" };
      const color = summary.active.length ? (config.active_color ?? "var(--warning-color, #e0af00)") : (config.inactive_color ?? "var(--success-color, #2eaa45)");
      if (!summary.active.length) return { line: config.inactive_text ?? "All doors", age: "closed", color };
      return { line: `${summary.active.length} door${summary.active.length === 1 ? "" : "s"} open`, age: "", color };
    }
    if (signal === "presence") {
      const summary = this._areaSignalSummary(config.area ?? this._config?.area, signal);
      if (!summary.entities.length) return { line: "", age: "", color: "var(--disabled-text-color)" };
      const active = Boolean(summary.active.length);
      return { line: active ? (config.active_text ?? "Occupied") : (config.inactive_text ?? "Clear"), age: "", color: active ? (config.active_color ?? "var(--success-color, #2eaa45)") : (config.inactive_color ?? "var(--disabled-text-color)") };
    }
    if (signal === "windows" || signal === "leaks") {
      const summary = this._areaSignalSummary(config.area ?? this._config?.area, signal);
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

  private _layoutStyle() {
    const height = this._heightOption();
    const accent = this._config?.accent_color ? `--area-glance-accent:${this._config.accent_color};` : "";
    const scale = height.scale;
    const stacked = this._config?.layout === "stacked";
    return `${accent}--area-glance-content-height:${stacked ? height.stackedContentHeight : height.contentHeight}px;--area-glance-metrics-height:${height.metricRowHeight}px;--area-glance-pad-y:${Math.round(8 * scale)}px;--area-glance-pad-x:${Math.round(12 * scale)}px;--area-glance-title-size:${(1.8 * scale).toFixed(2)}rem;--area-glance-status-size:${(.85 * scale).toFixed(2)}rem;--area-glance-icon-size:${Math.round(24 * scale)}px;--area-glance-value-size:${(1.6 * scale).toFixed(2)}rem;--area-glance-label-size:${(.82 * scale).toFixed(2)}rem;--area-glance-metric-padding:${Math.max(2, Math.round(3 * scale))}px;`;
  }

  private _runAction(action?: ActionConfig, fallbackEntity?: string) {
    const config = action ?? this._config;
    const kind = config?.action ?? "more-info";
    const entity = config?.entity ?? fallbackEntity;
    if (kind === "none") return;
    if (config?.confirmation && !window.confirm(config.confirmation)) return;
    if (kind === "area-details") {
      this._openAreaDetails();
      return;
    }
    if (kind === "more-info" && entity) {
      this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: entity }, bubbles: true, composed: true }));
    } else if (kind === "navigate" && config?.navigation_path) {
      history.pushState(null, "", config.navigation_path);
      window.dispatchEvent(new Event("location-changed"));
    } else if (kind === "toggle" && entity) {
      this.hass?.callService?.("homeassistant", "toggle", { entity_id: entity });
    } else if (kind === "call-service" && config?.service) {
      const [domain, service] = config.service.split(".");
      if (domain && service) this.hass?.callService?.(domain, service, config.data);
    }
  }

  private _entityName(entityId: string) {
    return String(this.hass?.states[entityId]?.attributes.friendly_name ?? entityId);
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
    this._detail = {
      title: display.label,
      subtitle: area ? `Included from ${this._areaName(area) ?? "this area"}` : "Included entities",
      entities: display.entities ?? [],
      emptyMessage: "No compatible entities are currently contributing to this insight.",
    };
  }

  private _openStatusDetails() {
    const status = this._config?.status;
    const signal = statusSignal(status?.source);
    if (!status || !signal) return;
    const area = status.area ?? this._config?.area;
    const labels: Record<AreaSignal, string> = { motion: "Motion", presence: "Presence", doors: "Doors", windows: "Windows", leaks: "Water leaks" };
    this._detail = {
      title: labels[signal],
      subtitle: area ? `Included from ${this._areaName(area) ?? "this area"}` : "Included entities",
      entities: this._areaSignalSummary(area, signal).entities.map((entry) => entry.entityId),
      emptyMessage: "No compatible entities are currently contributing to this status.",
    };
  }

  private _metricAction(metric: MetricConfig, display: MetricDisplay, action?: ActionConfig, fallback = false) {
    if (action?.action === "metric-details") {
      this._openMetricDetails(metric, display);
      return;
    }
    if (action?.action && (action.action !== "more-info" || Boolean(action.entity ?? metric.entity))) {
      this._runAction(action, metric.entity);
      return;
    }
    if (!fallback) return;
    const preset = metric.preset ?? "custom";
    if (this._metricSource(metric, preset) === "area") this._openMetricDetails(metric, display);
    else this._runAction(metric, metric.entity);
  }

  private _metricClicked(metric: MetricConfig, display: MetricDisplay, event: Event) {
    event.stopPropagation();
    this._metricAction(metric, display, metric, true);
  }
  private _metricHeld(metric: MetricConfig, display: MetricDisplay, event: Event) { event.preventDefault(); event.stopPropagation(); this._metricAction(metric, display, metric.hold_action); }
  private _metricDoubleTapped(metric: MetricConfig, display: MetricDisplay, event: Event) { event.preventDefault(); event.stopPropagation(); this._metricAction(metric, display, metric.double_tap_action); }

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
    const title = this._config.title ?? (this._config.profile === "house" ? "House" : this._areaName(this._config.area)) ?? "Area";
    const showHeader = this._config.layout !== "metrics-only";
    const appearance = this._config.appearance;
    const background = appearance?.background ?? this._config.background;
    const noShadow = appearance?.shadow === false;
    const headerAction = this._config.header_action ?? this._config;
    const headerClickable = Boolean(headerAction.action && headerAction.action !== "none");
    const statusClickable = Boolean(this._config.status?.action && this._config.status.action !== "none");
    return html`
      <ha-card class=${`${this._config.theme === "dark" ? "force-dark" : this._config.theme === "light" ? "force-light" : ""}${noShadow ? " no-shadow" : ""}${headerClickable ? " clickable" : ""}`} style=${`--ha-card-border-radius:var(--area-glance-card-border-radius, 24px);${background ? `--area-glance-card-background:${background}` : ""}`} @click=${this._headerClicked}>
        <section class=${showHeader ? `layout${this._config.layout === "stacked" ? " stacked" : ""}` : "layout metrics-only"} style=${this._layoutStyle()}>
          ${showHeader ? html`<div class="summary">
              <div class="title">${title}</div>
              ${status.line ? html`<button class=${`status${statusClickable ? " clickable" : ""}`} ?disabled=${!statusClickable} @click=${this._statusClicked}><span class="dot" style=${`background:${status.color}`}></span><span><span>${status.line}</span>${status.age ? html`<small>${status.age}</small>` : nothing}</span></button>` : nothing}
            </div>` : nothing}
          <div class="metrics" style=${`--metric-count:${Math.max(metrics.length, 1)}`}>
            ${metrics.map(({ metric, display }) => html`
              <button class="metric" aria-label=${`${display.label}: ${display.value}${display.aggregate ? ", show included entities" : ""}`} @click=${(event: Event) => this._metricClicked(metric, display, event)} @contextmenu=${(event: Event) => this._metricHeld(metric, display, event)} @dblclick=${(event: Event) => this._metricDoubleTapped(metric, display, event)}>
                ${metric.show_icon !== false ? html`<ha-icon .icon=${display.icon} style=${display.color ? `color:${display.color}` : ""}></ha-icon>` : nothing}
                <span class="value">${display.value}</span>
                ${metric.show_label !== false ? html`<span class="label">${display.label}</span>` : nothing}
              </button>
            `)}
          </div>
        </section>
      </ha-card>
      <dialog class="detail-sheet" @close=${this._closeDetail} @click=${(event: Event) => { if (event.target === event.currentTarget) this._closeDetail(); }}>
        ${this._detail ? html`<div class="detail-content">
          <div class="detail-heading"><div><h2>${this._detail.title}</h2><p>${this._detail.subtitle}</p></div><button class="detail-close" aria-label="Close" @click=${this._closeDetail}>×</button></div>
          ${this._detail.entities.length ? html`<div class="detail-entities">${this._detail.entities.map((entityId) => html`<button class="detail-entity" @click=${() => { this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true })); this._closeDetail(); }}><span><strong>${this._entityName(entityId)}</strong><small>${entityId}</small></span><span class="detail-state">${this._entityState(entityId)}</span></button>`)}</div>` : html`<p class="detail-empty">${this._detail.emptyMessage}</p>`}
        </div>` : nothing}
      </dialog>`;
  }

  static styles = css`
    :host { display:block; --area-glance-accent:var(--primary-color); }
    ha-card { overflow:hidden; border:1px solid color-mix(in srgb, var(--primary-text-color) 8%, transparent); border-radius:var(--area-glance-card-border-radius, 24px); cursor:default; background:var(--area-glance-card-background, var(--ha-card-background, var(--card-background-color))); box-shadow:var(--ha-card-box-shadow, 0 8px 24px rgb(0 0 0 / 18%)); }
    ha-card.clickable { cursor:pointer; }
    ha-card.no-shadow { box-shadow:none; }
    .layout { min-height:var(--area-glance-content-height, 78px); display:grid; grid-template-columns:clamp(126px, 27%, 185px) minmax(0, 1fr); align-items:stretch; padding:var(--area-glance-pad-y, 8px) var(--area-glance-pad-x, 12px); }
    .layout.metrics-only { grid-template-columns:minmax(0, 1fr); }
    .layout.stacked { grid-template-columns:minmax(0, 1fr); grid-template-rows:auto minmax(var(--area-glance-metrics-height, 62px), 1fr); gap:8px; }
    .layout.stacked .summary { padding:3px 4px 0; }
    .layout.stacked .metrics { min-height:var(--area-glance-metrics-height, 62px); }
    .layout.stacked .metric:first-child { border-left:0; }
    .summary { min-width:0; align-self:center; padding:3px 8px 3px 4px; }
    .title { color:var(--primary-text-color); font-size:var(--area-glance-title-size, 1.8rem); font-weight:720; letter-spacing:-.03em; line-height:1.12; padding-block:.03em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .status { appearance:none; width:100%; padding:0; border:0; color:var(--secondary-text-color); background:transparent; display:flex; gap:6px; align-items:flex-start; margin-top:5px; font:inherit; font-size:var(--area-glance-status-size, .85rem); line-height:1.15; min-width:0; text-align:left; }
    .status.clickable { cursor:pointer; border-radius:6px; }
    .status.clickable:hover { background:color-mix(in srgb, var(--area-glance-accent) 8%, transparent); }
    .status:disabled { opacity:1; }
    .status > span:last-child { min-width:0; overflow:hidden; text-overflow:ellipsis; }
    .dot { width:9px; height:9px; border-radius:50%; flex:none; margin-top:3px; }
    small { display:block; font-size:inherit; }
    .metrics { min-width:0; display:grid; grid-template-columns:repeat(var(--metric-count), minmax(0, 1fr)); }
    .metric { appearance:none; border:0; border-left:1px solid color-mix(in srgb, var(--primary-text-color) 13%, transparent); background:transparent; color:var(--primary-text-color); display:flex; flex-direction:column; align-items:center; justify-content:center; min-width:0; padding:var(--area-glance-metric-padding, 3px); font:inherit; cursor:pointer; }
    .metric:hover { background:color-mix(in srgb, var(--area-glance-accent) 8%, transparent); }
    ha-icon { color:var(--area-glance-accent); width:var(--area-glance-icon-size, 24px); height:var(--area-glance-icon-size, 24px); margin-bottom:2px; flex:none; }
    .value { font-size:var(--area-glance-value-size, 1.6rem); line-height:1.1; padding-block:.03em; font-weight:720; letter-spacing:-.02em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%; }
    .label { color:var(--secondary-text-color); font-size:var(--area-glance-label-size, .82rem); line-height:1.08; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%; margin-top:2px; }
    .force-dark { --ha-card-background:#353c45; --primary-text-color:#f5f7fb; --secondary-text-color:#aeb8c7; }
    .force-light { --ha-card-background:#f8f9fb; --primary-text-color:#18212e; --secondary-text-color:#667085; }
    .detail-sheet { width:min(480px, calc(100vw - 32px)); max-height:min(70vh, 620px); padding:0; border:0; border-radius:16px; color:var(--primary-text-color); background:var(--ha-card-background, var(--card-background-color)); box-shadow:0 18px 50px rgb(0 0 0 / 28%); }
    .detail-sheet::backdrop { background:rgb(0 0 0 / 38%); }
    .detail-content { padding:20px; }
    .detail-heading { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; margin-bottom:12px; }
    .detail-heading h2 { margin:0; font-size:1.2rem; }
    .detail-heading p, .detail-empty { margin:4px 0 0; color:var(--secondary-text-color); }
    .detail-close { appearance:none; border:0; width:32px; height:32px; border-radius:50%; color:var(--primary-text-color); background:color-mix(in srgb, var(--primary-text-color) 8%, transparent); font:1.5rem/1 sans-serif; cursor:pointer; }
    .detail-entities { display:grid; gap:4px; max-height:50vh; overflow:auto; }
    .detail-entity { display:flex; align-items:center; justify-content:space-between; gap:12px; width:100%; padding:10px; border:0; border-radius:9px; color:var(--primary-text-color); background:transparent; text-align:left; font:inherit; cursor:pointer; }
    .detail-entity:hover { background:color-mix(in srgb, var(--area-glance-accent) 9%, transparent); }
    .detail-entity strong, .detail-entity small { display:block; }
    .detail-entity small { margin-top:2px; color:var(--secondary-text-color); font-size:.75rem; }
    .detail-state { color:var(--secondary-text-color); white-space:nowrap; font-size:.86rem; }
    @media (max-width: 500px) { ha-card { border-radius:22px; } .layout { grid-template-columns:clamp(100px, 31%, 126px) minmax(0, 1fr); padding:7px 8px; } .title { font-size:min(var(--area-glance-title-size, 1.8rem), 1.35rem); } .status { font-size:min(var(--area-glance-status-size, .85rem), .76rem); } .metric { padding:2px 1px; } ha-icon { width:min(var(--area-glance-icon-size, 24px), 20px); height:min(var(--area-glance-icon-size, 24px), 20px); margin-bottom:1px; } .value { font-size:min(var(--area-glance-value-size, 1.6rem), .88rem); } .label { font-size:min(var(--area-glance-label-size, .82rem), .58rem); margin-top:1px; } }
  `;
}

export class AreaGlanceCardEditor extends LitElement {
  public hass?: HassLike;
  private _config: AreaGlanceConfig = { title: "Area", metrics: DEFAULT_METRICS };
  private _suggestionsNeedUpdate = false;
  private _draggedMetricIndex?: number;

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
    const action = source === "entity" && previous?.action === "status-details" ? "more-info" : source !== "entity" && previous?.action === "more-info" ? "status-details" : previous?.action;
    this._change({ status: { ...previous, source, action, ...(source === "entity" ? {} : { entity: undefined }) } });
  }
  private _statusEnabledChanged(event: Event) {
    const enabled = (event.target as HTMLInputElement).checked;
    this._change({
      status: enabled
        ? this._config.status ?? { source: "area_motion", ...(this._config.area ? { area: this._config.area } : {}), show_last_changed: true, last_changed_text: "Last motion" }
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
  private _purpose() {
    const profile = this._config.profile ?? "auto";
    if (profile === "house") return "house";
    if (profile === "energy") return "energy";
    if (profile === "battery") return "battery";
    return "area";
  }
  private _purposeSelected(purpose: "area" | "house" | "energy" | "battery") {
    if (purpose === "house") {
      this._populateAreaPreset("", "house");
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
  private _pickerValue(event: Event): string { return (event as CustomEvent<{ value?: string }>).detail?.value ?? ""; }
  private _areaName(area: string): string {
    return this.hass?.areas?.[area]?.name ?? area.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  }
  private _entitiesInArea(area: string): string[] {
    if (!this.hass) return [];
    if (!area) return Object.keys(this.hass.states);
    return Object.keys(this.hass.states).filter((entityId) => {
      const entity = this.hass?.entities?.[entityId];
      const deviceArea = entity?.device_id ? this.hass?.devices?.[entity.device_id]?.area_id : undefined;
      return entity?.area_id === area || deviceArea === area;
    });
  }
  private _contributorHint(metric: MetricConfig, preset: MetricPreset, usesArea: boolean): string | undefined {
    if (!usesArea) return undefined;
    const area = metric.area ?? this._config.area;
    if (!area) return "Choose an area to see compatible contributors.";
    const entities = this._entitiesInArea(area);
    const count = preset === "lights"
      ? entities.filter((entityId) => entityId.startsWith("light.")).length
      : AREA_SIGNAL_PRESETS.has(preset)
        ? entities.filter((entityId) => isSignalEntity(preset as AreaSignal, entityId, this.hass?.states[entityId])).length
        : entities.filter((entityId) => isAreaMeasurement(preset, entityId, this.hass?.states[entityId])).length;
    const noun = preset === "lights" ? "light" : "compatible sensor";
    return `Using ${count} ${noun}${count === 1 ? "" : "s"} from ${this._areaName(area)}.`;
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
    if (profile === "battery") {
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
      addAreaMetric("humidity", Boolean(humidity));
      if (airQualityPreset) addAreaMetric(airQualityPreset, true);
      addAreaMetric("power", Boolean(power));
      if (profile === "room") addEntityMetric("device", device);
    }
    const motion = first((id) => isSignalEntity("motion", id, state(id)));
    const door = first((id) => isDoorEntity(id, state(id)));
    this._suggestionsNeedUpdate = false;
    this._change({
      area: area || undefined,
      profile: requestedProfile,
      title: this._config.layout === "metrics-only" ? this._config.title : profile === "house" ? "House" : this._areaName(area),
      status: presence && (profile === "room" || profile === "media") ? { source: "area_presence", ...(area ? { area } : {}) } : motion && (profile === "room" || profile === "media") ? { source: "area_motion", ...(area ? { area } : {}), active_text: "Motion", inactive_text: "No motion", show_last_changed: true, last_changed_text: "Last motion" } : door && profile === "house" ? { source: "area_doors", inactive_text: "All doors" } : this._config.status,
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
    const source = (event.target as HTMLSelectElement).value as "area" | "entity";
    this._updateMetric(index, { source, ...(source === "area" ? { entity: undefined } : {}) });
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
    this._draggedMetricIndex = index;
    event.dataTransfer?.setData("text/plain", String(index));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }
  private _dropMetric(index: number, event: DragEvent) {
    event.preventDefault();
    const from = this._draggedMetricIndex ?? Number(event.dataTransfer?.getData("text/plain"));
    this._draggedMetricIndex = undefined;
    if (!Number.isInteger(from) || from === index || from < 0) return;
    const metrics = [...(this._config.metrics ?? [])];
    const [moved] = metrics.splice(from, 1);
    metrics.splice(index, 0, moved);
    this._change({ metrics });
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
    const status = this._config.status;
    const statusSource = status?.source ?? (status?.entity ? "entity" : "area_motion");
    const statusAction = status?.action ?? "none";
    const usesAreaStatus = Boolean(statusSignal(statusSource));
    const areaLabel = purpose === "energy" ? "Which energy area?" : purpose === "battery" ? "Where is the battery system?" : "Which area?";
    const currentAreaName = this._config.area ? this._areaName(this._config.area) : "this area";
    const headerAction = this._config.header_action?.action ?? "none";
    return html`<div class="editor">
      <h3>Area Glance</h3>
      <p class="hint">Choose a place first. Area Glance suggests useful live insights; you can change any of them afterwards.</p>
      <section class="setup">
        <span class="section-label">What does this card show?</span>
        <div class="purpose-grid">
          ${([ ["area", "An area", "Room insights"], ["house", "Whole home", "Home overview"], ["energy", "Energy", "Energy system"], ["battery", "Home battery", "Battery system"] ] as const).map(([value, title, description]) => html`<button class="purpose ${purpose === value ? "selected" : ""}" aria-pressed=${purpose === value} @click=${() => this._purposeSelected(value)}><strong>${title}</strong><small>${description}</small></button>`)}
        </div>
        ${purpose === "house" ? html`<p class="applied">Whole-home suggestions are applied. You can refine the insights below.</p>` : html`<ha-area-picker .hass=${this.hass} .value=${this._config.area ?? ""} .label=${areaLabel} @value-changed=${this._areaSelected}></ha-area-picker>${this._suggestionsNeedUpdate ? html`<div class="suggestion-update"><span>${currentAreaName} is selected. Update the insights to match it?</span><button class="primary" @click=${this._applySuggestions}>Update suggestions</button></div>` : this._config.area ? html`<p class="applied">Suggestions are based on ${currentAreaName}. Change any insight below.</p>` : nothing}`}
      </section>
      <section class="insights"><h3>Insights</h3><p class="hint">Keep up to five. They resize automatically to fit the card.</p>
      ${metrics.map((metric, index) => {
        const preset = metric.preset ?? "custom";
        const supportsArea = AREA_MEASUREMENT_PRESETS.has(preset);
        const usesArea = preset === "lights" || AREA_SIGNAL_PRESETS.has(preset) || (supportsArea && (metric.source ?? (metric.entity ? "entity" : "area")) === "area");
        const source = metric.source ?? (metric.entity ? "entity" : "area");
        const sourceLabel = usesArea ? (preset === "lights" ? "Area count" : "Area aggregate") : preset === "people_home" ? "Home zone" : "Specific entity";
        const contributorHint = this._contributorHint(metric, preset, usesArea);
        const supportsThresholds = ["temperature", "humidity", "lights", "power", "battery", "co2", "pm25", "voc", "aqi"].includes(preset);
        return html`<details class="insight-editor" draggable="true" @dragstart=${(event: DragEvent) => this._dragStart(index, event)} @dragover=${(event: DragEvent) => event.preventDefault()} @drop=${(event: DragEvent) => this._dropMetric(index, event)}>
        <summary><span class="drag-handle" title="Drag to reorder">⠿</span><ha-icon .icon=${metric.icon ?? PRESETS[preset].icon}></ha-icon><span class="insight-name">${PRESETS[preset].label}</span><span class="source-pill">${sourceLabel}</span></summary>
        <div class="insight-fields"><label>What should this show?
          <select .value=${metric.preset ?? "custom"} @change=${(e: Event) => this._updateMetric(index, { preset: (e.target as HTMLSelectElement).value as MetricPreset })}>
            <optgroup label="Automatic area insights">${AUTOMATIC_METRIC_PRESETS.map((option) => html`<option value=${option}>${PRESETS[option].label}</option>`)}</optgroup>
            <optgroup label="Home and chosen entities">${DEVICE_METRIC_PRESETS.map((option) => html`<option value=${option}>${PRESETS[option].label}</option>`)}</optgroup>
            ${preset === "occupancy" ? html`<option value="occupancy">${PRESETS.occupancy.label}</option>` : nothing}
          </select>
        </label>
        <p class="slot-hint">${SLOT_HELPERS[preset]}</p>
        ${supportsArea ? html`<label>Use data from
          <select .value=${source} @change=${(e: Event) => this._metricSourceChanged(index, e)}>
            <option value="area">This area (recommended)</option>
            <option value="entity">A specific entity</option>
          </select>
        </label>` : nothing}
        ${usesArea ? html`<ha-area-picker .hass=${this.hass} .value=${metric.area ?? this._config.area ?? ""} .label=${preset === "lights" ? "Area to count" : "Area to summarise"} @value-changed=${(e: Event) => this._updateMetric(index, { source: "area", area: this._pickerValue(e) })}></ha-area-picker>${contributorHint ? html`<p class="contributor-hint">${contributorHint}</p>` : nothing}` : html`<ha-entity-picker .hass=${this.hass} .value=${metric.entity ?? ""} .label=${preset === "custom" ? "Main text entity" : preset === "device" ? "Device or entity" : `${PRESETS[preset].label} entity`} allow-custom-entity @value-changed=${(e: Event) => this._updateMetric(index, { source: "entity", entity: this._pickerValue(e) })}></ha-entity-picker>`}
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
          ${preset !== "custom" ? html`<label>Label source<select .value=${metric.label_mode ?? (metric.label && metric.label !== PRESETS[preset].label ? "custom" : "preset")} @change=${(e: Event) => { const labelMode = (e.target as HTMLSelectElement).value as MetricConfig["label_mode"]; this._updateMetric(index, { label_mode: labelMode, ...(labelMode === "preset" ? { label: undefined } : {}) }); }}><option value="preset">Preset label</option>${!usesArea ? html`<option value="entity">Entity name</option>` : nothing}<option value="custom">Custom label</option></select></label>` : nothing}
          <div class="two"><label>${preset === "custom" ? "Supporting text fallback" : "Custom label"} <input .value=${preset === "custom" ? metric.secondary_text ?? "" : metric.label ?? ""} placeholder=${PRESETS[preset].label} @input=${(e: Event) => this._updateMetric(index, preset === "custom" ? { secondary_text: (e.target as HTMLInputElement).value || undefined } : { label_mode: "custom", label: (e.target as HTMLInputElement).value || undefined })}></label><ha-icon-picker label="Icon" .value=${metric.icon ?? ""} .placeholder=${PRESETS[preset].icon} @value-changed=${(e: Event) => this._updateMetric(index, { icon: this._pickerValue(e) })}></ha-icon-picker></div>
          <div class="two"><label>${preset === "custom" ? "Fallback colour" : "Colour"} <input .value=${metric.color ?? ""} placeholder="var(--primary-color)" @input=${(e: Event) => this._updateMetric(index, { color: (e.target as HTMLInputElement).value || undefined })}></label><label>Unit override <input .value=${metric.unit ?? ""} @input=${(e: Event) => this._updateMetric(index, { unit: (e.target as HTMLInputElement).value || undefined })}></label></div>
          <div class="three"><label>Decimal places <input type="number" min="0" max="4" .value=${metric.decimals?.toString() ?? ""} placeholder="Auto" @input=${(e: Event) => { const value = (e.target as HTMLInputElement).value; this._updateMetric(index, { decimals: value === "" ? undefined : Math.max(0, Math.min(4, Number(value))) }); }}></label><label class="checkbox"><input type="checkbox" .checked=${metric.show_unit !== false} @change=${(e: Event) => this._updateMetric(index, { show_unit: (e.target as HTMLInputElement).checked })}> Show unit</label><label class="checkbox"><input type="checkbox" .checked=${metric.show_icon !== false} @change=${(e: Event) => this._updateMetric(index, { show_icon: (e.target as HTMLInputElement).checked })}> Show icon</label></div>
          <label class="checkbox"><input type="checkbox" .checked=${metric.show_label !== false} @change=${(e: Event) => this._updateMetric(index, { show_label: (e.target as HTMLInputElement).checked })}> Show label</label>
          ${usesArea && supportsArea ? html`<label>Area aggregation<select .value=${metric.aggregation ?? "auto"} @change=${(e: Event) => this._aggregationChanged(index, e)}><option value="auto">Smart default (${defaultAggregation(preset)})</option><option value="median">Median</option><option value="highest">Highest</option><option value="lowest">Lowest</option>${preset === "power" ? html`<option value="sum">Sum</option>` : nothing}</select></label>` : nothing}
          ${supportsThresholds && preset !== "custom" ? html`<details class="thresholds"><summary>Colour thresholds</summary><p class="slot-hint">First matching rule wins. Thresholds use the displayed value and unit.</p>${(metric.thresholds ?? []).map((threshold, thresholdIndex) => html`<div class="threshold"><label>At least <input type="number" .value=${threshold.above?.toString() ?? ""} placeholder="Optional" @input=${(e: Event) => { const value = (e.target as HTMLInputElement).value; this._updateThreshold(index, thresholdIndex, { above: value === "" ? undefined : Number(value) }); }}></label><label>At most <input type="number" .value=${threshold.below?.toString() ?? ""} placeholder="Optional" @input=${(e: Event) => { const value = (e.target as HTMLInputElement).value; this._updateThreshold(index, thresholdIndex, { below: value === "" ? undefined : Number(value) }); }}></label><label>Colour <input .value=${threshold.color} placeholder="var(--warning-color)" @input=${(e: Event) => this._updateThreshold(index, thresholdIndex, { color: (e.target as HTMLInputElement).value })}></label><button class="remove-rule" @click=${() => this._removeThreshold(index, thresholdIndex)}>Remove</button></div>`)}<button class="add-rule" @click=${() => this._addThreshold(index)}>Add threshold</button></details>` : nothing}
          <details class="metric-actions"><summary>Actions (optional)</summary>${this._metricActionFields(index, metric, "tap", usesArea)}<details class="secondary-actions"><summary>Hold and double-tap</summary>${this._metricActionFields(index, metric, "hold", usesArea)}${this._metricActionFields(index, metric, "double", usesArea)}</details></details>
        </details>
        <div class="insight-actions"><div class="reorder"><button ?disabled=${index === 0} aria-label="Move insight left" @click=${() => this._moveMetric(index, -1)}>←</button><button ?disabled=${index === metrics.length - 1} aria-label="Move insight right" @click=${() => this._moveMetric(index, 1)}>→</button><button ?disabled=${metrics.length >= 5} @click=${() => this._duplicateMetric(index)}>Duplicate</button></div><label class="checkbox"><input type="checkbox" .checked=${metric.hidden ?? false} @change=${this._metricBoolean(index, "hidden")}> Hide</label><button class="remove" @click=${() => this._removeMetric(index)}>Remove</button></div></div>
      </details>`})}
      <button class="add" ?disabled=${metrics.length >= 5} @click=${this._addMetric}>Add insight</button>
      </section>
      <details class="settings">
        <summary>Header</summary>
        <label>Card layout<select .value=${this._config.layout ?? "header"} @change=${this._layoutChanged}><option value="header">Title beside insights (default)</option><option value="stacked">Title above insights</option><option value="metrics-only">Insights only</option></select></label>
        ${this._config.layout !== "metrics-only" ? html`
          <label>Title <input .value=${this._config.title ?? ""} placeholder=${currentAreaName} @input=${(e: Event) => this._input(e, "title")}></label>
          <label>When the header is tapped<select .value=${headerAction} @change=${this._headerActionChanged}><option value="none">Do nothing</option><option value="area-details">Show area details</option><option value="navigate">Navigate to a dashboard page</option></select></label>
          ${headerAction === "navigate" ? html`<label>Dashboard path <input .value=${this._config.header_action?.navigation_path ?? ""} placeholder="/dashboard/room" @input=${this._headerNavigationChanged}></label>` : nothing}
          <label class="checkbox"><input type="checkbox" .checked=${Boolean(status)} @change=${this._statusEnabledChanged}> Show a status line</label>
          ${status ? html`
            <label>Status comes from<select .value=${statusSource} @change=${this._statusSourceChanged}><option value="area_presence">Presence in this area</option><option value="area_motion">Motion in this area</option><option value="area_doors">Doors in this area</option><option value="area_windows">Windows in this area</option><option value="area_leaks">Water leaks in this area</option><option value="entity">A specific entity</option></select></label>
            ${usesAreaStatus ? html`<ha-area-picker .hass=${this.hass} .value=${status.area ?? this._config.area ?? ""} .label=${statusSource === "area_doors" ? "Door area" : statusSource === "area_windows" ? "Window area" : statusSource === "area_leaks" ? "Area to check for leaks" : statusSource === "area_presence" ? "Presence area" : "Motion area"} @value-changed=${(e: Event) => this._change({ status: { ...status, source: statusSource, area: this._pickerValue(e) } })}></ha-area-picker>` : html`<ha-entity-picker .hass=${this.hass} .value=${status.entity ?? ""} .label="Status entity" allow-custom-entity @value-changed=${(e: Event) => this._change({ status: { ...status, source: "entity", entity: this._pickerValue(e) } })}></ha-entity-picker>`}
            <label>When the status is tapped<select .value=${statusAction} @change=${this._statusActionChanged}><option value="none">Do nothing</option>${usesAreaStatus ? html`<option value="status-details">Show matching entities</option><option value="area-details">Show area details</option>` : html`<option value="more-info">Show entity details</option>`}<option value="navigate">Navigate to a dashboard page</option></select></label>
            ${statusAction === "navigate" ? html`<label>Dashboard path <input .value=${status.navigation_path ?? ""} placeholder="/dashboard/room" @input=${this._statusNavigationChanged}></label>` : nothing}
            ${statusSource === "area_doors" ? html`<p class="slot-hint">Closed doors show a green summary; open doors show a clear count.</p>` : statusSource === "area_windows" ? html`<p class="slot-hint">Closed windows show a green summary; open windows need attention.</p>` : statusSource === "area_leaks" ? html`<p class="slot-hint">Dry is green; a detected leak is red.</p>` : statusSource === "area_presence" ? html`<p class="slot-hint">Presence means an occupancy or presence sensor is active. It is different from recent motion.</p>` : html`
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
      </details>
    </div>`;
  }
  static styles = css`
    :host { display:block; } .editor { padding:12px; } h3 { margin:0; } .hint, .slot-hint, .contributor-hint { color:var(--secondary-text-color); margin:4px 0 12px; } .slot-hint, .contributor-hint { font-size:.88rem; } .contributor-hint { padding:7px 9px; border-radius:6px; background:color-mix(in srgb, var(--primary-color) 7%, var(--card-background-color)); } label { display:block; font-weight:500; margin:12px 0; } ha-entity-picker, ha-area-picker { display:block; margin:12px 0; } input, select { box-sizing:border-box; width:100%; padding:8px; margin-top:4px; font:inherit; color:inherit; background:var(--card-background-color); border:1px solid var(--divider-color); border-radius:6px; } button { cursor:pointer; font:inherit; } .setup, .insights { margin-top:18px; } .section-label { display:block; font-weight:600; margin-bottom:8px; } .purpose-grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:8px; } .purpose { text-align:left; min-height:62px; padding:10px; color:var(--primary-text-color); background:var(--card-background-color); border:1px solid var(--divider-color); border-radius:8px; } .purpose.selected { border:2px solid var(--primary-color); background:color-mix(in srgb, var(--primary-color) 8%, var(--card-background-color)); } .purpose strong, .purpose small { display:block; } .purpose small { color:var(--secondary-text-color); font-size:.78rem; margin-top:3px; } .applied { color:var(--secondary-text-color); font-size:.9rem; margin:8px 0; } .suggestion-update { display:flex; gap:8px; align-items:center; justify-content:space-between; padding:10px; margin-top:8px; border-radius:8px; background:color-mix(in srgb, var(--primary-color) 8%, var(--card-background-color)); } .suggestion-update span { font-size:.88rem; } .primary, .add { padding:8px 12px; color:white; background:var(--primary-color); border:0; border-radius:6px; white-space:nowrap; } .advanced-setup, .settings, .insight-editor { border:1px solid var(--divider-color); border-radius:8px; padding:10px; margin-top:12px; } summary { cursor:pointer; font-weight:600; } .advanced-setup summary, .settings summary, .more-options summary, .thresholds summary, .metric-actions summary, .secondary-actions summary { color:var(--secondary-text-color); } .insight-editor { padding:0; overflow:hidden; } .insight-editor > summary { display:flex; align-items:center; gap:8px; padding:12px; list-style:none; } .insight-editor > summary::-webkit-details-marker { display:none; } .insight-editor > summary::after { content:"›"; margin-left:auto; color:var(--secondary-text-color); font-size:1.4rem; } .insight-editor[open] > summary::after { transform:rotate(90deg); } .insight-editor ha-icon { width:22px; height:22px; color:var(--primary-color); } .drag-handle { color:var(--secondary-text-color); cursor:grab; font-size:1.15rem; letter-spacing:-2px; } .insight-name { min-width:0; flex:1; } .source-pill { padding:3px 6px; border-radius:999px; color:var(--secondary-text-color); background:color-mix(in srgb, var(--secondary-text-color) 12%, transparent); font-size:.72rem; white-space:nowrap; } .insight-fields { padding:0 12px 12px; border-top:1px solid var(--divider-color); } .more-options, .thresholds, .metric-actions, .secondary-actions { margin-top:12px; } .thresholds, .metric-actions { padding:10px; border:1px solid var(--divider-color); border-radius:8px; } .two { display:grid; grid-template-columns:1fr 1fr; gap:8px; } .three { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:8px; align-items:end; } .checkbox { font-weight:400; } .checkbox input { width:auto; margin:0 6px 0 0; vertical-align:middle; } .threshold { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)) auto; gap:8px; align-items:end; margin-top:8px; } .threshold label { margin:0; } .insight-actions, .reorder { display:flex; align-items:center; gap:8px; } .insight-actions { justify-content:space-between; } .reorder button { padding:5px 7px; border:1px solid var(--divider-color); border-radius:5px; color:var(--primary-text-color); background:transparent; } .reorder button:disabled { opacity:.45; cursor:default; } .remove { padding:6px 0; color:var(--error-color); background:transparent; border:0; } .add { margin-top:12px; } @media (max-width:400px) { .purpose-grid, .two, .three, .threshold { grid-template-columns:1fr; } .suggestion-update { align-items:flex-start; flex-direction:column; } }
    .custom-rules { margin:14px 0; padding:10px; border:1px solid var(--divider-color); border-radius:8px; }
    .custom-rules .slot-hint { margin-bottom:8px; }
    .color-rule { display:grid; grid-template-columns:minmax(0, 1fr) minmax(0, 1fr) auto; gap:8px; align-items:end; margin-top:8px; }
    .color-rule label { margin:0; }
    .remove-rule, .add-rule { padding:8px 10px; border:1px solid var(--divider-color); border-radius:6px; background:transparent; color:var(--primary-text-color); }
    .remove-rule { color:var(--error-color); }
    .add-rule { margin-top:10px; }
    ha-icon-picker { display:block; margin:12px 0; }
    .two ha-icon-picker { align-self:end; }
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
