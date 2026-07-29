import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { PRESETS, presetMetric } from "./presets";
import type { ActionConfig, AreaGlanceConfig, EntityState, HassLike, MetricConfig, MetricPreset, StatusConfig } from "./types";

const UNAVAILABLE = new Set(["unknown", "unavailable", "none", ""]);
const DEFAULT_METRICS = [presetMetric("temperature"), presetMetric("lights"), presetMetric("power"), presetMetric("device")];
const SLOT_HELPERS: Record<MetricPreset, string> = {
  temperature: "Use the median of area temperature sensors, or one chosen sensor.",
  humidity: "Use the median of area humidity sensors, or one chosen sensor.",
  lights: "Count lights that are on in an area.",
  power: "Sum compatible live power sensors in an area, or use one sensor.",
  battery: "Show a battery percentage with sensible colour thresholds.",
  co2: "Show a CO₂ reading from one entity.",
  device: "Show the state of a device entity.",
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
  entities?: string[];
  aggregate?: boolean;
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
    if (preset === "lights") return "area";
    return metric.source ?? (metric.entity ? "entity" : ["temperature", "humidity", "power", "co2"].includes(preset) ? "area" : "entity");
  }

  private _areaMetric(metric: MetricConfig, preset: MetricPreset, label: string, icon: string): MetricDisplay {
    const area = metric.area ?? this._config?.area;
    if (!area && this._config?.profile !== "house") return { icon, color: metric.color, value: "–", label };
    if (preset === "lights") {
      const lights = this._areaEntities(area, metric.domain ?? "light");
      const on = lights.filter((id) => this.hass?.states[id]?.state === "on").length;
      return { icon, color: metric.color ?? "var(--warning-color, #e0af00)", value: `${on}/${lights.length}`, label, entities: lights, aggregate: true };
    }
    const matches = (entityId: string) => {
      const state = this.hass?.states[entityId];
      const deviceClass = state?.attributes.device_class;
      if (preset === "temperature") return deviceClass === "temperature";
      if (preset === "humidity") return deviceClass === "humidity";
      if (preset === "power") return (deviceClass === "power" || ["W", "kW", "MW"].includes(String(state?.attributes.unit_of_measurement ?? ""))) && ["W", "kW", "MW"].includes(String(state?.attributes.unit_of_measurement ?? ""));
      return deviceClass === "carbon_dioxide" || /(^|_)(co2|carbon_dioxide)(_|$)/.test(entityId);
    };
    const values = this._areaEntities(area).map((entityId) => ({ entityId, state: this.hass?.states[entityId], value: asNumber(this.hass?.states[entityId]?.state ?? "") }))
      .filter((item) => matches(item.entityId) && item.value !== undefined && item.state && !UNAVAILABLE.has(item.state.state)) as { entityId: string; state: EntityState; value: number }[];
    if (!values.length) return { icon, color: metric.color, value: "–", label };

    if (preset === "power") {
      const watts = values.reduce((total, item) => {
        const unit = String(item.state.attributes.unit_of_measurement ?? "W");
        return total + item.value * (unit === "kW" ? 1000 : unit === "MW" ? 1000000 : 1);
      }, 0);
      const useKilowatts = metric.unit === "kW" || (!metric.unit && Math.abs(watts) >= 1000);
      const displayed = useKilowatts ? watts / 1000 : watts;
      const decimals = metric.decimals ?? (useKilowatts ? 1 : 0);
      return { icon, color: metric.color, value: `${displayed.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals })}${metric.unit ?? (useKilowatts ? "kW" : "W")}`, label, entities: values.map((item) => item.entityId), aggregate: true };
    }

    const sorted = values.map((item) => item.value).sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    const number = preset === "co2" ? sorted.at(-1)! : sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    const format = metric.format ?? PRESETS[preset].format;
    const decimals = metric.decimals ?? 0;
    const inferredUnit = String(values[0].state.attributes.unit_of_measurement ?? "");
    const unit = metric.unit ?? (format === "temperature" ? "°" : format === "percent" ? "%" : inferredUnit);
    return { icon, color: metric.color, value: `${number.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals })}${unit}`, label, entities: values.map((item) => item.entityId), aggregate: true };
  }

  private _metric(metric: MetricConfig): MetricDisplay | undefined {
    if (metric.hidden) return undefined;
    const preset = metric.preset ?? "custom";
    const defaults = PRESETS[preset];
    const state = metric.entity ? this.hass?.states[metric.entity] : undefined;
    if (metric.hide_unavailable && state && UNAVAILABLE.has(state.state)) return undefined;
    const label = metric.label ?? defaults.label;
    const icon = metric.icon ?? defaults.icon;

    if (this._metricSource(metric, preset) === "area") return this._areaMetric(metric, preset, label, icon);
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
    if (config?.source === "area_motion") {
      const area = config.area ?? this._config?.area;
      if (!area && this._config?.profile !== "house") return { line: "", age: "", color: "var(--disabled-text-color)" };
      const motions = this._areaEntities(area, "binary_sensor")
        .map((entityId) => this.hass?.states[entityId])
        .filter((state): state is EntityState => state?.attributes.device_class === "motion" && !UNAVAILABLE.has(state.state));
      if (!motions.length) return { line: "", age: "", color: "var(--disabled-text-color)" };
      const active = motions.some((state) => state.state === "on");
      const latest = motions.reduce((newest, state) => new Date(state.last_changed) > new Date(newest.last_changed) ? state : newest);
      return {
        line: !active && config.show_last_changed ? (config.last_changed_text ?? "Last motion") : active ? (config.active_text ?? "Motion") : (config.inactive_text ?? "No motion"),
        age: config.show_last_changed ? stateAge(latest.last_changed) : "",
        color: active ? (config.active_color ?? "var(--error-color, #db4437)") : (config.inactive_color ?? "var(--success-color, #2eaa45)"),
      };
    }
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
    const stacked = this._config?.layout === "stacked";
    return `${accent}--area-glance-content-height:${stacked ? height.stackedContentHeight : height.contentHeight}px;--area-glance-metrics-height:${height.metricRowHeight}px;--area-glance-pad-y:${Math.round(8 * scale)}px;--area-glance-pad-x:${Math.round(12 * scale)}px;--area-glance-title-size:${(1.8 * scale).toFixed(2)}rem;--area-glance-status-size:${(.85 * scale).toFixed(2)}rem;--area-glance-icon-size:${Math.round(24 * scale)}px;--area-glance-value-size:${(1.6 * scale).toFixed(2)}rem;--area-glance-label-size:${(.82 * scale).toFixed(2)}rem;--area-glance-metric-padding:${Math.max(2, Math.round(3 * scale))}px;`;
  }

  private _runAction(action?: ActionConfig, fallbackEntity?: string) {
    const config = action ?? this._config;
    const kind = config?.action ?? "more-info";
    const entity = config?.entity ?? fallbackEntity;
    if (kind === "none") return;
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

  private _metricClicked(metric: MetricConfig, display: MetricDisplay, event: Event) {
    event.stopPropagation();
    const preset = metric.preset ?? "custom";
    if (metric.action && metric.action !== "more-info") {
      this._runAction(metric, metric.entity);
      return;
    }
    if (this._metricSource(metric, preset) === "area") {
      this._openMetricDetails(metric, display);
      return;
    }
    this._runAction(metric, metric.entity);
  }

  private _headerClicked() { this._runAction(this._config?.header_action ?? this._config); }
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
    return html`
      <ha-card class=${`${this._config.theme === "dark" ? "force-dark" : this._config.theme === "light" ? "force-light" : ""}${noShadow ? " no-shadow" : ""}${headerClickable ? " clickable" : ""}`} style=${`--ha-card-border-radius:var(--area-glance-card-border-radius, 24px);${background ? `--area-glance-card-background:${background}` : ""}`} @click=${this._headerClicked}>
        <section class=${showHeader ? `layout${this._config.layout === "stacked" ? " stacked" : ""}` : "layout metrics-only"} style=${this._layoutStyle()}>
          ${showHeader ? html`<div class="summary">
              <div class="title">${title}</div>
              ${status.line ? html`<div class="status"><span class="dot" style=${`background:${status.color}`}></span><span><span>${status.line}</span>${status.age ? html`<small>${status.age}</small>` : nothing}</span></div>` : nothing}
            </div>` : nothing}
          <div class="metrics" style=${`--metric-count:${Math.max(metrics.length, 1)}`}>
            ${metrics.map(({ metric, display }) => html`
              <button class="metric" aria-label=${`${display.label}: ${display.value}${display.aggregate ? ", show included entities" : ""}`} @click=${(event: Event) => this._metricClicked(metric, display, event)}>
                <ha-icon .icon=${display.icon} style=${display.color ? `color:${display.color}` : ""}></ha-icon>
                <span class="value">${display.value}</span>
                <span class="label">${display.label}</span>
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
    .layout { min-height:var(--area-glance-content-height, 78px); display:grid; grid-template-columns:minmax(126px, 1.65fr) minmax(0, 4fr); align-items:stretch; padding:var(--area-glance-pad-y, 8px) var(--area-glance-pad-x, 12px); }
    .layout.metrics-only { grid-template-columns:minmax(0, 1fr); }
    .layout.stacked { grid-template-columns:minmax(0, 1fr); grid-template-rows:auto minmax(var(--area-glance-metrics-height, 62px), 1fr); gap:8px; }
    .layout.stacked .summary { padding:3px 4px 0; }
    .layout.stacked .metrics { min-height:var(--area-glance-metrics-height, 62px); }
    .layout.stacked .metric:first-child { border-left:0; }
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
    @media (max-width: 500px) { ha-card { border-radius:22px; } .layout { grid-template-columns:minmax(104px, 1.35fr) minmax(0, 4fr); padding:7px 8px; } .title { font-size:min(var(--area-glance-title-size, 1.8rem), 1.5rem); } .status { font-size:min(var(--area-glance-status-size, .85rem), .78rem); } .metric { padding:2px 1px; } ha-icon { width:min(var(--area-glance-icon-size, 24px), 22px); height:min(var(--area-glance-icon-size, 24px), 22px); margin-bottom:1px; } .value { font-size:min(var(--area-glance-value-size, 1.6rem), 1.1rem); } .label { font-size:min(var(--area-glance-label-size, .82rem), .64rem); margin-top:1px; } }
  `;
}

export class AreaGlanceCardEditor extends LitElement {
  public hass?: HassLike;
  private _config: AreaGlanceConfig = { title: "Area", metrics: DEFAULT_METRICS };
  private _suggestionsNeedUpdate = false;

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
    const source = (event.target as HTMLSelectElement).value as "area_motion" | "entity";
    this._change({ status: { ...this._config.status, source, ...(source === "area_motion" ? { entity: undefined } : {}) } });
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
    const addEntityMetric = (preset: MetricPreset, entity?: string, overrides: Partial<MetricConfig> = {}) => { if (entity && metrics.length < 5) metrics.push({ ...presetMetric(preset), entity, source: "entity", ...overrides }); };
    const addAreaMetric = (preset: MetricPreset, available: boolean, overrides: Partial<MetricConfig> = {}) => { if (available && metrics.length < 5) metrics.push({ ...presetMetric(preset), source: "area", ...(area ? { area } : {}), ...overrides }); };
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
      addAreaMetric("temperature", Boolean(temperature));
      addAreaMetric("lights", Boolean(first((id) => id.startsWith("light."))));
      addEntityMetric("device", media ?? device, { label: media ? "Media" : undefined });
      addAreaMetric("power", Boolean(power));
      addAreaMetric("co2", Boolean(co2));
      addAreaMetric("humidity", Boolean(humidity));
    } else {
      addAreaMetric("temperature", Boolean(temperature));
      addAreaMetric("lights", Boolean(first((id) => id.startsWith("light."))));
      addAreaMetric("humidity", Boolean(humidity));
      addAreaMetric("co2", Boolean(co2));
      addAreaMetric("power", Boolean(power));
      if (profile === "room") addEntityMetric("device", device);
    }
    const motion = first((id) => id.startsWith("binary_sensor.") && hasDeviceClass(id, "motion"));
    this._suggestionsNeedUpdate = false;
    this._change({
      area: area || undefined,
      profile: requestedProfile,
      title: this._config.layout === "metrics-only" ? this._config.title : profile === "house" ? "House" : this._areaName(area),
      status: motion && (profile === "room" || profile === "media") ? { source: "area_motion", ...(area ? { area } : {}), active_text: "Motion", inactive_text: "No motion", show_last_changed: true, last_changed_text: "Last motion" } : this._config.status,
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
      Object.assign(updated, presetMetric(change.preset));
      if (["temperature", "humidity", "lights", "power", "co2"].includes(change.preset)) updated.entity = undefined;
      else updated.source = "entity";
    }
    metrics[index] = updated;
    this._change({ metrics });
  }
  private _removeMetric(index: number) { this._change({ metrics: (this._config.metrics ?? []).filter((_, metricIndex) => metricIndex !== index) }); }
  private _addMetric() { this._change({ metrics: [...(this._config.metrics ?? []), presetMetric("temperature")] }); }

  protected render() {
    const metrics = this._config.metrics ?? [];
    const purpose = this._purpose();
    const appearancePreset = this._config.appearance?.preset ?? "theme";
    const status = this._config.status;
    const statusSource = status?.source ?? (status?.entity ? "entity" : "area_motion");
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
        const supportsArea = ["temperature", "humidity", "power", "co2"].includes(preset);
        const usesArea = preset === "lights" || (supportsArea && (metric.source ?? (metric.entity ? "entity" : "area")) === "area");
        const source = metric.source ?? (metric.entity ? "entity" : "area");
        const sourceLabel = usesArea ? (preset === "lights" ? "Area count" : "Area aggregate") : "Specific entity";
        return html`<details class="insight-editor">
        <summary><ha-icon .icon=${metric.icon ?? PRESETS[preset].icon}></ha-icon><span class="insight-name">${PRESETS[preset].label}</span><span class="source-pill">${sourceLabel}</span></summary>
        <div class="insight-fields"><label>What should this show?
          <select .value=${metric.preset ?? "custom"} @change=${(e: Event) => this._updateMetric(index, { preset: (e.target as HTMLSelectElement).value as MetricPreset })}>
            ${Object.entries(PRESETS).map(([preset, defaults]) => html`<option value=${preset}>${defaults.label}</option>`)}
          </select>
        </label>
        <p class="slot-hint">${SLOT_HELPERS[preset]}</p>
        ${supportsArea ? html`<label>Use data from
          <select .value=${source} @change=${(e: Event) => this._metricSourceChanged(index, e)}>
            <option value="area">This area (recommended)</option>
            <option value="entity">A specific entity</option>
          </select>
        </label>` : nothing}
        ${usesArea ? html`<ha-area-picker .hass=${this.hass} .value=${metric.area ?? this._config.area ?? ""} .label=${preset === "lights" ? "Area to count" : "Area to summarise"} @value-changed=${(e: Event) => this._updateMetric(index, { source: "area", area: this._pickerValue(e) })}></ha-area-picker>` : html`<ha-entity-picker .hass=${this.hass} .value=${metric.entity ?? ""} .label=${`${PRESETS[preset].label} entity`} allow-custom-entity @value-changed=${(e: Event) => this._updateMetric(index, { source: "entity", entity: this._pickerValue(e) })}></ha-entity-picker>`}
        <details class="more-options"><summary>More options</summary>
          <div class="two"><label>Label <input .value=${metric.label ?? ""} @input=${(e: Event) => this._updateMetric(index, { label: (e.target as HTMLInputElement).value })}></label><ha-icon-picker label="Icon" .value=${metric.icon ?? ""} .placeholder=${PRESETS[preset].icon} @value-changed=${(e: Event) => this._updateMetric(index, { icon: this._pickerValue(e) })}></ha-icon-picker></div>
          <div class="two"><label>Colour <input .value=${metric.color ?? ""} placeholder="var(--primary-color)" @input=${(e: Event) => this._updateMetric(index, { color: (e.target as HTMLInputElement).value })}></label><label>Unit override <input .value=${metric.unit ?? ""} @input=${(e: Event) => this._updateMetric(index, { unit: (e.target as HTMLInputElement).value })}></label></div>
        </details>
        <div class="insight-actions"><label class="checkbox"><input type="checkbox" .checked=${metric.hidden ?? false} @change=${this._metricBoolean(index, "hidden")}> Hide</label><button class="remove" @click=${() => this._removeMetric(index)}>Remove</button></div></div>
      </details>`})}
      <button class="add" ?disabled=${metrics.length >= 5} @click=${this._addMetric}>Add insight</button>
      </section>
      <details class="settings"><summary>Header</summary>
        <label>Card layout<select .value=${this._config.layout ?? "header"} @change=${this._layoutChanged}><option value="header">Title beside insights (default)</option><option value="stacked">Title above insights</option><option value="metrics-only">Insights only</option></select></label>
        ${this._config.layout !== "metrics-only" ? html`<label>Title <input .value=${this._config.title ?? ""} placeholder=${currentAreaName} @input=${(e: Event) => this._input(e, "title")}></label><label>When the header is tapped<select .value=${headerAction} @change=${this._headerActionChanged}><option value="none">Do nothing</option><option value="area-details">Show area details</option><option value="navigate">Navigate to a dashboard page</option></select></label>${headerAction === "navigate" ? html`<label>Dashboard path <input .value=${this._config.header_action?.navigation_path ?? ""} placeholder="/dashboard/room" @input=${this._headerNavigationChanged}></label>` : nothing}<label class="checkbox"><input type="checkbox" .checked=${Boolean(status)} @change=${this._statusEnabledChanged}> Show a status line</label>${status ? html`<label>Status comes from<select .value=${statusSource} @change=${this._statusSourceChanged}><option value="area_motion">Motion in this area</option><option value="entity">A specific entity</option></select></label>${statusSource === "area_motion" ? html`<ha-area-picker .hass=${this.hass} .value=${status.area ?? this._config.area ?? ""} .label=${"Motion area"} @value-changed=${(e: Event) => this._change({ status: { ...status, source: "area_motion", area: this._pickerValue(e) } })}></ha-area-picker>` : html`<ha-entity-picker .hass=${this.hass} .value=${status.entity ?? ""} .label=${"Status entity"} allow-custom-entity @value-changed=${(e: Event) => this._change({ status: { ...status, source: "entity", entity: this._pickerValue(e) } })}></ha-entity-picker>`}<div class="two"><label>When active <input .value=${status.active_text ?? ""} placeholder="Motion" @input=${(e: Event) => this._statusInput(e, "active_text")}></label><label>When inactive <input .value=${status.inactive_text ?? ""} placeholder="No motion" @input=${(e: Event) => this._statusInput(e, "inactive_text")}></label></div><label class="checkbox"><input type="checkbox" .checked=${status.show_last_changed ?? false} @change=${(e: Event) => this._statusBoolean(e, "show_last_changed")}> Show when it last changed</label>${status.show_last_changed ? html`<label>History label <input .value=${status.last_changed_text ?? ""} placeholder="Last motion" @input=${(e: Event) => this._statusInput(e, "last_changed_text")}></label>` : nothing}` : nothing}` : nothing}
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
    :host { display:block; } .editor { padding:12px; } h3 { margin:0; } .hint, .slot-hint { color:var(--secondary-text-color); margin:4px 0 12px; } .slot-hint { font-size:.88rem; } label { display:block; font-weight:500; margin:12px 0; } ha-entity-picker, ha-area-picker { display:block; margin:12px 0; } input, select { box-sizing:border-box; width:100%; padding:8px; margin-top:4px; font:inherit; color:inherit; background:var(--card-background-color); border:1px solid var(--divider-color); border-radius:6px; } button { cursor:pointer; font:inherit; } .setup, .insights { margin-top:18px; } .section-label { display:block; font-weight:600; margin-bottom:8px; } .purpose-grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:8px; } .purpose { text-align:left; min-height:62px; padding:10px; color:var(--primary-text-color); background:var(--card-background-color); border:1px solid var(--divider-color); border-radius:8px; } .purpose.selected { border:2px solid var(--primary-color); background:color-mix(in srgb, var(--primary-color) 8%, var(--card-background-color)); } .purpose strong, .purpose small { display:block; } .purpose small { color:var(--secondary-text-color); font-size:.78rem; margin-top:3px; } .applied { color:var(--secondary-text-color); font-size:.9rem; margin:8px 0; } .suggestion-update { display:flex; gap:8px; align-items:center; justify-content:space-between; padding:10px; margin-top:8px; border-radius:8px; background:color-mix(in srgb, var(--primary-color) 8%, var(--card-background-color)); } .suggestion-update span { font-size:.88rem; } .primary, .add { padding:8px 12px; color:white; background:var(--primary-color); border:0; border-radius:6px; white-space:nowrap; } .advanced-setup, .settings, .insight-editor { border:1px solid var(--divider-color); border-radius:8px; padding:10px; margin-top:12px; } summary { cursor:pointer; font-weight:600; } .advanced-setup summary, .settings summary, .more-options summary { color:var(--secondary-text-color); } .insight-editor { padding:0; overflow:hidden; } .insight-editor > summary { display:flex; align-items:center; gap:8px; padding:12px; list-style:none; } .insight-editor > summary::-webkit-details-marker { display:none; } .insight-editor > summary::after { content:"›"; margin-left:auto; color:var(--secondary-text-color); font-size:1.4rem; } .insight-editor[open] > summary::after { transform:rotate(90deg); } .insight-editor ha-icon { width:22px; height:22px; color:var(--primary-color); } .insight-name { min-width:0; flex:1; } .source-pill { padding:3px 6px; border-radius:999px; color:var(--secondary-text-color); background:color-mix(in srgb, var(--secondary-text-color) 12%, transparent); font-size:.72rem; white-space:nowrap; } .insight-fields { padding:0 12px 12px; border-top:1px solid var(--divider-color); } .more-options { margin-top:12px; } .two { display:grid; grid-template-columns:1fr 1fr; gap:8px; } .checkbox { font-weight:400; } .checkbox input { width:auto; margin:0 6px 0 0; vertical-align:middle; } .insight-actions { display:flex; align-items:center; justify-content:space-between; } .remove { padding:6px 0; color:var(--error-color); background:transparent; border:0; } .add { margin-top:12px; } @media (max-width:400px) { .purpose-grid, .two { grid-template-columns:1fr; } .suggestion-update { align-items:flex-start; flex-direction:column; } }
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
