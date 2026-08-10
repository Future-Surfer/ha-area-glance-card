export type MetricPreset =
  | "temperature"
  | "humidity"
  | "lights"
  | "power"
  | "battery"
  | "co2"
  | "pm25"
  | "voc"
  | "aqi"
  | "motion"
  | "presence"
  | "doors"
  | "windows"
  | "blinds"
  | "locks"
  | "alarm"
  | "camera"
  | "vacuum"
  | "weather"
  | "clock"
  | "calendar"
  | "attention"
  | "leaks"
  | "people_home"
  /** Legacy name retained so existing configurations continue to work. */
  | "occupancy"
  | "device"
  | "custom";

export type AreaSignal = "motion" | "presence" | "doors" | "windows" | "blinds" | "locks" | "leaks";

export interface EntityState {
  state: string;
  last_changed: string;
  attributes: Record<string, unknown>;
}

export interface HassLike {
  states: Record<string, EntityState>;
  entities?: Record<string, { area_id?: string; device_id?: string }>;
  devices?: Record<string, { area_id?: string }>;
  areas?: Record<string, { name?: string }>;
  /** Available in newer Home Assistant frontends; callers retain a friendly-name fallback. */
  formatEntityName?: (state: EntityState, name?: unknown, options?: { separator?: string }) => string;
  formatEntityState?: (state: EntityState) => string;
  callService?: (domain: string, service: string, data?: Record<string, unknown>) => Promise<unknown>;
  /** Narrow read-only REST contract used by the optional Chart profile. */
  callApi?: <T = unknown>(method: string, path: string) => Promise<T>;
  /** Home Assistant WebSocket helper, used for read-only frontend preferences such as Energy Dashboard setup. */
  callWS?: <T = unknown>(message: Record<string, unknown>) => Promise<T>;
}

export type ChartType = "line" | "area" | "columns" | "daily_totals";

/** A deliberately small, single-series chart configuration. */
export interface ChartConfig {
  type?: ChartType;
  /** A directly chosen numeric sensor. */
  entity?: string;
  /** A source explicitly configured in Home Assistant's Energy Dashboard. */
  energy_source?: "grid" | "solar" | "battery_soc" | "battery_power";
  /** Short ranges use Recorder history; longer ranges favour statistics. */
  range?: "6h" | "24h" | "48h" | "7d" | "14d" | "30d";
  history_source?: "auto" | "raw" | "statistics";
  /** Statistic used when bucketing a Columns chart. */
  bucket_statistic?: "mean" | "last" | "max" | "min";
  decimals?: number;
  unit?: string;
  title?: string;
  /** Overrides the automatic live/period header summary. */
  summary?: string;
}

export interface ActionConfig {
  action?: "more-info" | "navigate" | "toggle" | "call-service" | "area-details" | "metric-details" | "status-details" | "none";
  entity?: string;
  navigation_path?: string;
  service?: string;
  data?: Record<string, unknown>;
  confirmation?: string;
}

/** Membership settings for an automatic area or whole-home aggregate. */
export interface AggregateMembership {
  /** `auto_except` keeps future compatible entities included by default. */
  mode?: "auto_except" | "selected_only";
  exclude?: string[];
  include?: string[];
}

export interface StatusConfig extends ActionConfig {
  source?: "security" | "area_motion" | "area_presence" | "area_doors" | "area_windows" | "area_leaks" | "entity";
  area?: string;
  active_text?: string;
  inactive_text?: string;
  active_color?: string;
  inactive_color?: string;
  show_last_changed?: boolean;
  last_changed_text?: string;
  /** Exclusions for an area-based status; newly discovered compatible entities remain included. */
  membership?: AggregateMembership;
}

export interface MetricConfig extends ActionConfig {
  preset?: MetricPreset;
  /** Where this insight obtains its data. Existing cards without this field retain their current behaviour. */
  source?: "area" | "entity" | "entities";
  /**
   * Bind this metric to one of the live sources configured in Home Assistant's
   * Energy Dashboard. It is intentionally separate from ordinary entity and
   * area aggregation, so a system Energy card never guesses by entity name.
   */
  energy_source?: "grid" | "solar" | "battery_soc" | "battery_power";
  entity?: string;
  /** A deliberate group of entities, independent of Home Assistant area membership. */
  entities?: string[];
  /** Optional second line for a custom-combination insight. */
  secondary_entity?: string;
  secondary_text?: string;
  /** Optional entity whose icon is used by a custom-combination insight. */
  icon_entity?: string;
  /** Optional entity whose state selects a custom-combination colour rule. */
  color_entity?: string;
  color_rules?: { state: string; color: string }[];
  /** Ordered numeric colour rules for standard measurement insights. */
  thresholds?: { above?: number; below?: number; color: string }[];
  aggregation?: "median" | "average" | "highest" | "lowest" | "sum";
  /** Controls membership after Home Assistant metadata has identified compatible area entities. */
  membership?: AggregateMembership;
  /** Checks shown by the Attention aggregate. Both are enabled when omitted. */
  attention_types?: ("unavailable" | "updates")[];
  /** Attention can check the card's area or the whole Home Assistant instance. */
  attention_scope?: "area" | "home";
  area?: string;
  domain?: string;
  label?: string;
  icon?: string;
  /** Optional icons used only when the selected entity is a binary sensor. */
  icon_on?: string;
  icon_off?: string;
  icon_unknown?: string;
  color?: string;
  /** Reverse the sign of a power reading before it is aggregated or displayed. */
  invert_value?: boolean;
  /** The primary live value shown by a weather entity. */
  weather_display?: "condition" | "temperature" | "apparent_temperature" | "humidity" | "wind_speed";
  /** Robot vacuum segments can prioritise the activity state, charge, or chosen cleaning mode. */
  vacuum_display?: "state" | "battery" | "fan_speed";
  /** Camera segments can remain compact or use the entire insight slot for the live preview. */
  camera_display?: "state" | "feed";
  /** Clock segments can show a numeric time or a live analogue clock face. */
  clock_style?: "digital" | "analogue";
  decimals?: number;
  unit?: string;
  show_unit?: boolean;
  show_icon?: boolean;
  show_label?: boolean;
  label_mode?: "preset" | "entity" | "custom";
  format?: "auto" | "number" | "temperature" | "percent" | "power";
  hide_unavailable?: boolean;
  hidden?: boolean;
  hold_action?: ActionConfig;
  double_tap_action?: ActionConfig;
}

export interface AreaGlanceConfig extends ActionConfig {
  type?: string;
  title?: string;
  area?: string;
  status?: StatusConfig;
  metrics?: MetricConfig[];
  /** Chart is a dedicated header-plus-plot profile, rather than an insight slot. */
  chart?: ChartConfig;
  header_action?: ActionConfig;
  layout?: "header" | "stacked" | "metrics-only" | "tower";
  /** Text alignment is used by the title-above-insights layout. */
  header_alignment?: "left" | "center" | "right";
  /** Leave on Auto for a layout-aware header: beside insights wraps, above insights stays compact. */
  header_title_lines?: "auto" | "single" | "multi";
  /** Controls whether the status and its time are kept together or shown on separate lines. */
  header_status_lines?: "auto" | "single" | "multi";
  height?: "slim" | "compact" | "standard" | "comfortable";
  profile?: "auto" | "room" | "media" | "battery" | "energy" | "house" | "security" | "cameras" | "chart";
  appearance?: {
    preset?: "theme" | "light" | "slate" | "charcoal" | "custom";
    /** Shared typography weight for the title and insight text. */
    text_weight?: "bold" | "regular" | "light";
    /** @deprecated Replaced by text_weight. Retained so existing card YAML keeps its typography. */
    style?: "bold" | "light";
    /** Show an inferred area/profile icon in the header. Disabled by default. */
    show_area_icon?: boolean;
    /** Optional MDI override for the Light-style header icon. */
    area_icon?: string;
    background?: string;
    shadow?: boolean;
    /** Global percentage adjustments, deliberately shared by every insight. */
    text_scale?: {
      title?: number;
      status?: number;
      value?: number;
      label?: number;
    };
  };
  theme?: "auto" | "light" | "dark";
  accent_color?: string;
  background?: string;
}
