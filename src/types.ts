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
  formatEntityState?: (state: EntityState) => string;
  callService?: (domain: string, service: string, data?: Record<string, unknown>) => Promise<unknown>;
}

export interface ActionConfig {
  action?: "more-info" | "navigate" | "toggle" | "call-service" | "area-details" | "metric-details" | "status-details" | "none";
  entity?: string;
  navigation_path?: string;
  service?: string;
  data?: Record<string, unknown>;
  confirmation?: string;
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
}

export interface MetricConfig extends ActionConfig {
  preset?: MetricPreset;
  source?: "area" | "entity";
  entity?: string;
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
  aggregation?: "median" | "highest" | "lowest" | "sum";
  /** Controls membership after Home Assistant metadata has identified compatible area entities. */
  membership?: {
    /** `auto_except` keeps future compatible entities included by default. */
    mode?: "auto_except" | "selected_only";
    exclude?: string[];
    include?: string[];
  };
  /** Checks shown by the Attention aggregate. Both are enabled when omitted. */
  attention_types?: ("unavailable" | "updates")[];
  /** Attention can check the card's area or the whole Home Assistant instance. */
  attention_scope?: "area" | "home";
  area?: string;
  domain?: string;
  label?: string;
  icon?: string;
  color?: string;
  /** Reverse the sign of a power reading before it is aggregated or displayed. */
  invert_value?: boolean;
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
  header_action?: ActionConfig;
  layout?: "header" | "stacked" | "metrics-only";
  /** Text alignment is used by the title-above-insights layout. */
  header_alignment?: "left" | "center" | "right";
  height?: "slim" | "compact" | "standard" | "comfortable";
  profile?: "auto" | "room" | "media" | "battery" | "energy" | "house" | "security";
  appearance?: {
    preset?: "theme" | "light" | "slate" | "charcoal" | "custom";
    background?: string;
    shadow?: boolean;
  };
  theme?: "auto" | "light" | "dark";
  accent_color?: string;
  background?: string;
}
