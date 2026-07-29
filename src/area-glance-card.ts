import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { PRESETS, presetMetric } from "./presets";
import type { ActionConfig, AreaGlanceConfig, EntityState, HassLike, MetricConfig, MetricPreset, StatusConfig } from "./types";

const UNAVAILABLE = new Set(["unknown", "unavailable", "none", ""]);
const DEFAULT_METRICS = [presetMetric("temperature"), presetMetric("lights"), presetMetric("power"), presetMetric("device")];
const SLOT_HELPERS: Record<MetricPreset, string> = {
  temperature: "Show the current temperature from one entity.",
  humidity: "Show the current relative humidity from one entity.",
  lights: "Count lights that are on in an area.",
  power: "Show a live power reading from one entity.",
  battery: "Show a battery percentage with sensible colour thresholds.",
  co2: "Show a CO₂ reading from one entity.",
  device: "Show the state of a device entity.",
  custom: "Show an entity using its native state and unit.",
};
const HEIGHT_OPTIONS = {
  compact: { contentHeight: 78, rows: 1.5, scale: 1 },
  standard: { contentHeight: 102, rows: 2, scale: 1.24 },
  comfortable: { contentHeight: 126, rows: 2.5, scale: 1.48 },
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

const friendlyState = (state: string) => state.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

const stateAge = (lastChanged: string): string => {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(lastChanged).getTime()) / 60000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
};

interface MetricDisplay {
  icon: string;
  color?: string;
  value: string;
  label: string;
}

export class AreaGlanceCard extends LitElement {
  public hass?: HassLike;
  private _config?: AreaGlanceConfig;

  static get properties() {
    return { hass: { attribute: false }, _config: { state: true } };
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

  private _heightOption() { return HEIGHT_OPTIONS[this._config?.height ?? "compact"]; }

  public getCardSize() { return this._heightOption().rows; }
  public getGridOptions() { const rows = this._heightOption().rows; return { rows, columns: 12, min_rows: rows, max_rows: rows, min_columns: 6 }; }

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

  private _metric(metric: MetricConfig): MetricDisplay | undefined {
    if (metric.hidden) return undefined;
    const preset = metric.preset ?? "custom";
    const defaults = PRESETS[preset];
    const state = metric.entity ? this.hass?.states[metric.entity] : undefined;
    if (metric.hide_unavailable && state && UNAVAILABLE.has(state.state)) return undefined;
    const label = metric.label ?? defaults.label;
    const icon = metric.icon ?? defaults.icon;

    if (preset === "lights") {
      const lights = this._areaEntities(metric.area ?? this._config?.area, metric.domain ?? "light");
      const on = lights.filter((id) => this.hass?.states[id]?.state === "on").length;
      return { icon, color: metric.color ?? "var(--warning-color, #e0af00)", value: `${on}/${lights.length}`, label };
    }
    if (!state || UNAVAILABLE.has(state.state)) return { icon, color: metric.color, value: "–", label };

    const number = asNumber(state.state);
    const format = metric.format ?? defaults.format;
    const decimals = metric.decimals ?? (format === "temperature" ? 0 : 0);
    let value: string;
    if (number !== undefined) {
      const rendered = number.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
      const inferredUnit = typeof state.attributes.unit_of_measurement === "string" ? state.attributes.unit_of_measurement : "";
      const unit = metric.unit ?? (format === "temperature" ? "°" : format === "percent" ? "%" : inferredUnit);
      value = `${rendered}${unit}`;
    } else {
      value = this.hass?.formatEntityState?.(state) ?? friendlyState(state.state);
    }
    let color = metric.color;
    if (!color && preset === "battery" && number !== undefined) {
      color = number <= 20 ? "var(--error-color, #db4437)" : number <= 50 ? "var(--warning-color, #e0af00)" : "var(--info-color, #3f8cff)";
    }
    return { icon, color, value, label };
  }

  private _status() {
    const config = this._config?.status;
    const state = config?.entity ? this.hass?.states[config.entity] : undefined;
    if (!config || !state) return { line: "", age: "", color: "var(--disabled-text-color)" };
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
    return `${accent}--area-glance-content-height:${height.contentHeight}px;--area-glance-pad-y:${Math.round(8 * scale)}px;--area-glance-pad-x:${Math.round(12 * scale)}px;--area-glance-title-size:${(1.8 * scale).toFixed(2)}rem;--area-glance-status-size:${(.85 * scale).toFixed(2)}rem;--area-glance-icon-size:${Math.round(24 * scale)}px;--area-glance-value-size:${(1.6 * scale).toFixed(2)}rem;--area-glance-label-size:${(.82 * scale).toFixed(2)}rem;--area-glance-metric-padding:${Math.max(2, Math.round(3 * scale))}px;`;
  }

  private _runAction(action?: ActionConfig, fallbackEntity?: string) {
    const config = action ?? this._config;
    const kind = config?.action ?? "more-info";
    const entity = config?.entity ?? fallbackEntity;
    if (kind === "none") return;
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

  protected render() {
    if (!this._config) return nothing;
    const status = this._status();
    const metrics = (this._config.metrics ?? []).map((metric) => ({ metric, display: this._metric(metric) })).filter((entry): entry is { metric: MetricConfig; display: MetricDisplay } => Boolean(entry.display));
    const title = this._config.title ?? (this._config.profile === "house" ? "House" : this._areaName(this._config.area)) ?? "Area";
    const showHeader = this._config.layout !== "metrics-only";
    const appearance = this._config.appearance;
    const background = appearance?.background ?? this._config.background;
    const noShadow = appearance?.shadow === false;
    return html`
      <ha-card class=${`${this._config.theme === "dark" ? "force-dark" : this._config.theme === "light" ? "force-light" : ""}${noShadow ? " no-shadow" : ""}`} style=${`--ha-card-border-radius:var(--area-glance-card-border-radius, 24px);${background ? `--area-glance-card-background:${background}` : ""}`} @click=${() => this._runAction()}>
        <section class=${showHeader ? "layout" : "layout metrics-only"} style=${this._layoutStyle()}>
          ${showHeader ? html`<div class="summary">
              <div class="title">${title}</div>
              ${status.line ? html`<div class="status"><span class="dot" style=${`background:${status.color}`}></span><span><span>${status.line}</span>${status.age ? html`<small>${status.age}</small>` : nothing}</span></div>` : nothing}
            </div>` : nothing}
          <div class="metrics" style=${`--metric-count:${Math.max(metrics.length, 1)}`}>
            ${metrics.map(({ metric, display }) => html`
              <button class="metric" aria-label=${display.label} @click=${(event: Event) => { event.stopPropagation(); this._runAction(metric, metric.entity); }}>
                <ha-icon .icon=${display.icon} style=${display.color ? `color:${display.color}` : ""}></ha-icon>
                <span class="value">${display.value}</span>
                <span class="label">${display.label}</span>
              </button>
            `)}
          </div>
        </section>
      </ha-card>`;
  }

  static styles = css`
    :host { display:block; --area-glance-accent:var(--primary-color); }
    ha-card { overflow:hidden; border:1px solid color-mix(in srgb, var(--primary-text-color) 8%, transparent); border-radius:var(--area-glance-card-border-radius, 24px); cursor:pointer; background:var(--area-glance-card-background, var(--ha-card-background, var(--card-background-color))); box-shadow:var(--ha-card-box-shadow, 0 8px 24px rgb(0 0 0 / 18%)); }
    ha-card.no-shadow { box-shadow:none; }
    .layout { min-height:var(--area-glance-content-height, 78px); display:grid; grid-template-columns:minmax(126px, 1.65fr) minmax(0, 4fr); align-items:stretch; padding:var(--area-glance-pad-y, 8px) var(--area-glance-pad-x, 12px); }
    .layout.metrics-only { grid-template-columns:minmax(0, 1fr); }
    .summary { min-width:0; align-self:center; padding:3px 8px 3px 4px; }
    .title { color:var(--primary-text-color); font-size:var(--area-glance-title-size, 1.8rem); font-weight:720; letter-spacing:-.03em; line-height:1.12; padding-block:.03em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .status { color:var(--secondary-text-color); display:flex; gap:6px; align-items:flex-start; margin-top:5px; font-size:var(--area-glance-status-size, .85rem); line-height:1.15; min-width:0; }
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
    @media (max-width: 500px) { ha-card { border-radius:22px; } .layout { min-height:72px; grid-template-columns:minmax(104px, 1.35fr) minmax(0, 4fr); padding:7px 8px; } .title { font-size:min(var(--area-glance-title-size, 1.8rem), 1.5rem); } .status { font-size:min(var(--area-glance-status-size, .85rem), .78rem); } .metric { padding:2px 1px; } ha-icon { width:min(var(--area-glance-icon-size, 24px), 22px); height:min(var(--area-glance-icon-size, 24px), 22px); margin-bottom:1px; } .value { font-size:min(var(--area-glance-value-size, 1.6rem), 1.1rem); } .label { font-size:min(var(--area-glance-label-size, .82rem), .64rem); margin-top:1px; } }
  `;
}

export class AreaGlanceCardEditor extends LitElement {
  public hass?: HassLike;
  private _config: AreaGlanceConfig = { title: "Area", metrics: DEFAULT_METRICS };

  static get properties() { return { hass: { attribute: false }, _config: { state: true } }; }
  public setConfig(config: AreaGlanceConfig) { this._config = { ...config, metrics: config.metrics?.length ? config.metrics : DEFAULT_METRICS }; }

  private _change(change: Partial<AreaGlanceConfig>) {
    this._config = { ...this._config, ...change };
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this._config }, bubbles: true, composed: true }));
  }
  private _input(event: Event, key: "title" | "area") { this._change({ [key]: (event.target as HTMLInputElement).value }); }
  private _statusInput(event: Event, key: keyof StatusConfig) { this._change({ status: { ...this._config.status, [key]: (event.target as HTMLInputElement).value } }); }
  private _statusBoolean(event: Event, key: keyof StatusConfig) { this._change({ status: { ...this._config.status, [key]: (event.target as HTMLInputElement).checked } }); }
  private _metricBoolean(index: number, key: "hidden") { return (event: Event) => this._updateMetric(index, { [key]: (event.target as HTMLInputElement).checked }); }
  private _layoutChanged(event: Event) { this._change({ layout: (event.target as HTMLSelectElement).value as AreaGlanceConfig["layout"] }); }
  private _heightChanged(event: Event) { this._change({ height: (event.target as HTMLSelectElement).value as AreaGlanceConfig["height"] }); }
  private _profileChanged(event: Event) {
    const profile = (event.target as HTMLSelectElement).value as NonNullable<AreaGlanceConfig["profile"]>;
    if (profile === "house") {
      this._populateAreaPreset("", profile);
      return;
    }
    this._change({ profile });
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
    const hasDeviceClass = (entityId: string, deviceClass: string) => state(entityId)?.attributes.device_class === deviceClass;
    const isPower = (entityId: string) => hasDeviceClass(entityId, "power") || ["W", "kW", "MW"].includes(String(state(entityId)?.attributes.unit_of_measurement ?? ""));
    const metrics: MetricConfig[] = [];
    const addEntityMetric = (preset: MetricPreset, entity?: string, overrides: Partial<MetricConfig> = {}) => { if (entity && metrics.length < 5) metrics.push({ ...presetMetric(preset), entity, ...overrides }); };
    const addLights = () => { if (first((id) => id.startsWith("light.")) && metrics.length < 5) metrics.push({ ...presetMetric("lights"), ...(area ? { area } : {}) }); };
    const temperature = first((id) => hasDeviceClass(id, "temperature"));
    const humidity = first((id) => hasDeviceClass(id, "humidity"));
    const co2 = first((id) => hasDeviceClass(id, "carbon_dioxide") || /(^|_)(co2|carbon_dioxide)(_|$)/.test(id));
    const power = first(isPower);
    const battery = first((id) => hasDeviceClass(id, "battery"));
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
      addEntityMetric("temperature", temperature);
      addLights();
      addEntityMetric("device", media ?? device, { label: media ? "Media" : undefined });
      addEntityMetric("power", power);
      addEntityMetric("co2", co2);
      addEntityMetric("humidity", humidity);
    } else {
      addEntityMetric("temperature", temperature);
      addLights();
      addEntityMetric("humidity", humidity);
      addEntityMetric("co2", co2);
      addEntityMetric("power", power);
      if (profile === "room") addEntityMetric("device", device);
    }
    const motion = first((id) => id.startsWith("binary_sensor.") && hasDeviceClass(id, "motion"));
    this._change({
      area: area || undefined,
      profile: requestedProfile,
      title: this._config.layout === "metrics-only" ? this._config.title : profile === "house" ? "House" : this._areaName(area),
      status: motion && (profile === "room" || profile === "media") ? { entity: motion, active_text: "Motion", inactive_text: "No motion", show_last_changed: true, last_changed_text: "Last motion" } : this._config.status,
      metrics: metrics.length ? metrics : this._config.metrics,
    });
  }
  private _areaSelected(event: Event) { this._populateAreaPreset(this._pickerValue(event)); }
  private _updateMetric(index: number, change: Partial<MetricConfig>) {
    const metrics = [...(this._config.metrics ?? [])];
    const updated = { ...metrics[index], ...change };
    if (change.preset) Object.assign(updated, presetMetric(change.preset));
    metrics[index] = updated;
    this._change({ metrics });
  }
  private _removeMetric(index: number) { this._change({ metrics: (this._config.metrics ?? []).filter((_, metricIndex) => metricIndex !== index) }); }
  private _addMetric() { this._change({ metrics: [...(this._config.metrics ?? []), presetMetric("temperature")] }); }

  protected render() {
    const metrics = this._config.metrics ?? [];
    const visibleMetricCount = metrics.filter((metric) => !metric.hidden).length;
    const profile = this._config.profile ?? "auto";
    const appearancePreset = this._config.appearance?.preset ?? "theme";
    return html`<div class="editor">
      <h3>Area Glance</h3>
      <p class="hint">Choose a title and up to five helpful at-a-glance metrics. Start with a preset; optional fields let you tailor it later.</p>
      <label>Band layout
        <select .value=${this._config.layout ?? "header"} @change=${this._layoutChanged}>
          <option value="header">Header + metric segments</option>
          <option value="metrics-only">Metric segments only</option>
        </select>
      </label>
      <label>Card height
        <select .value=${this._config.height ?? "compact"} @change=${this._heightChanged}>
          <option value="compact">Compact (original style)</option>
          <option value="standard">Standard</option>
          <option value="comfortable">Comfortable</option>
        </select>
      </label>
      <details class="appearance" open>
        <summary>Appearance</summary>
        <label>Colour preset
          <select .value=${appearancePreset} @change=${this._appearancePresetChanged}>
            <option value="theme">Theme default</option>
            <option value="light">Light</option>
            <option value="slate">Slate (energy-style)</option>
            <option value="charcoal">Charcoal (house-style)</option>
            <option value="custom">Custom background</option>
          </select>
        </label>
        ${appearancePreset === "custom" ? html`<label>Background colour <input type="color" .value=${this._config.appearance?.background ?? "#353c45"} @input=${this._customBackgroundChanged}></label>` : nothing}
        <label class="checkbox"><input type="checkbox" .checked=${this._config.appearance?.shadow !== false} @change=${this._shadowChanged}> Show drop shadow</label>
      </details>
      <p class="hint">${visibleMetricCount} visible metric segment${visibleMetricCount === 1 ? "" : "s"}. Add/remove metrics or hide one below; the band sizes the remaining segments automatically.</p>
      <label>Starter profile
        <select .value=${profile} @change=${this._profileChanged}>
          <option value="auto">Auto (infer from area name)</option>
          <option value="room">Room</option>
          <option value="media">Media room</option>
          <option value="battery">Battery / garage</option>
          <option value="energy">Energy</option>
          <option value="house">House-wide (no area)</option>
        </select>
      </label>
      ${profile === "house" ? html`<p class="hint">House-wide scans the available entities, so leave the area blank.</p>` : html`<ha-area-picker .hass=${this.hass} .value=${this._config.area ?? ""} .label=${"Area (select to populate a starter preset)"} @value-changed=${this._areaSelected}></ha-area-picker>`}
      <button class="populate" ?disabled=${profile !== "house" && !this._config.area} @click=${() => this._populateAreaPreset(profile === "house" ? "" : this._config.area ?? "", profile)}>Populate slots from this profile</button>
      ${this._config.layout !== "metrics-only" ? html`
        <label>Title <input .value=${this._config.title ?? ""} placeholder="Living room" @input=${(e: Event) => this._input(e, "title")}></label>
        <details ?open=${Boolean(this._config.status?.entity)}><summary>Status (optional)</summary>
          <ha-entity-picker .hass=${this.hass} .value=${this._config.status?.entity ?? ""} .label=${"Status entity"} allow-custom-entity @value-changed=${(e: Event) => this._change({ status: { ...this._config.status, entity: this._pickerValue(e) } })}></ha-entity-picker>
          <div class="two"><label>Active text <input .value=${this._config.status?.active_text ?? ""} placeholder="Motion"></label><label>Inactive text <input .value=${this._config.status?.inactive_text ?? ""} placeholder="No motion"></label></div>
          <label class="checkbox"><input type="checkbox" .checked=${this._config.status?.show_last_changed ?? false} @change=${(e: Event) => this._statusBoolean(e, "show_last_changed")}> Show when it last changed</label>
          ${this._config.status?.show_last_changed ? html`<label>Inactive history text <input .value=${this._config.status?.last_changed_text ?? ""} placeholder="Last motion (automatic for motion sensors)" @input=${(e: Event) => this._statusInput(e, "last_changed_text")}></label>` : nothing}
        </details>` : html`<p class="hint">This layout deliberately omits the title and status header.</p>`}
      <h3>Metrics</h3>
      ${metrics.map((metric, index) => {
        const preset = metric.preset ?? "custom";
        const usesArea = preset === "lights";
        return html`<details class="metric-editor" open>
        <summary>Slot ${index + 1} — ${PRESETS[preset].label}</summary>
        <label>What is this slot about?
          <select .value=${metric.preset ?? "custom"} @change=${(e: Event) => this._updateMetric(index, { preset: (e.target as HTMLSelectElement).value as MetricPreset })}>
            ${Object.entries(PRESETS).map(([preset, defaults]) => html`<option value=${preset}>${defaults.label}</option>`)}
          </select>
        </label>
        <p class="slot-hint">${SLOT_HELPERS[preset]}</p>
        ${usesArea ? html`<ha-area-picker .hass=${this.hass} .value=${metric.area ?? this._config.area ?? ""} .label=${"Area to count"} @value-changed=${(e: Event) => this._updateMetric(index, { area: this._pickerValue(e) })}></ha-area-picker>` : html`<ha-entity-picker .hass=${this.hass} .value=${metric.entity ?? ""} .label=${`${PRESETS[preset].label} entity`} allow-custom-entity @value-changed=${(e: Event) => this._updateMetric(index, { entity: this._pickerValue(e) })}></ha-entity-picker>`}
        <details><summary>Fine-tune this metric</summary>
          <div class="two"><label>Label <input .value=${metric.label ?? ""} @input=${(e: Event) => this._updateMetric(index, { label: (e.target as HTMLInputElement).value })}></label><label>Icon <input .value=${metric.icon ?? ""} placeholder="mdi:thermometer" @input=${(e: Event) => this._updateMetric(index, { icon: (e.target as HTMLInputElement).value })}></label></div>
          <div class="two"><label>Colour <input .value=${metric.color ?? ""} placeholder="var(--primary-color)" @input=${(e: Event) => this._updateMetric(index, { color: (e.target as HTMLInputElement).value })}></label><label>Unit override <input .value=${metric.unit ?? ""} @input=${(e: Event) => this._updateMetric(index, { unit: (e.target as HTMLInputElement).value })}></label></div>
        </details>
        <label class="checkbox"><input type="checkbox" .checked=${metric.hidden ?? false} @change=${this._metricBoolean(index, "hidden")}> Hide this metric</label>
        <button class="remove" @click=${() => this._removeMetric(index)}>Remove metric</button>
      </details>`})}
      <button class="add" ?disabled=${metrics.length >= 5} @click=${this._addMetric}>Add metric</button>
    </div>`;
  }
  static styles = css`
    :host { display:block; } .editor { padding:12px; } h3 { margin:8px 0; } .hint, .slot-hint { color:var(--secondary-text-color); margin:0 0 12px; } .slot-hint { font-size:.88rem; margin:4px 0 10px; } label { display:block; font-weight:500; margin:10px 0; } ha-entity-picker, ha-area-picker { display:block; margin:12px 0; } input, select { box-sizing:border-box; width:100%; padding:8px; margin-top:4px; font:inherit; color:inherit; background:var(--card-background-color); border:1px solid var(--divider-color); border-radius:4px; } .checkbox input { width:auto; margin:0 6px 0 0; vertical-align:middle; } details { border:1px solid var(--divider-color); border-radius:6px; padding:8px; margin:10px 0; } summary { cursor:pointer; font-weight:600; } .two { display:grid; grid-template-columns:1fr 1fr; gap:8px; } button { padding:8px 12px; border-radius:4px; cursor:pointer; font:inherit; } .populate { width:100%; margin:0 0 12px; color:var(--primary-color); background:transparent; border:1px solid var(--primary-color); } .populate:disabled { cursor:default; opacity:.45; } .add { color:white; background:var(--primary-color); border:0; } .remove { color:var(--error-color); background:transparent; border:0; padding-left:0; } @media (max-width: 400px) { .two { grid-template-columns:1fr; } }
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
  documentationURL: "https://github.com/lewis/ha-area-glance-card",
});

declare global { interface Window { customCards: unknown[]; } }
