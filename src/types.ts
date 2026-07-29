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
  | "leaks"
  | "people_home"
  /** Legacy name retained so existing configurations continue to work. */
  | "occupancy"
  | "device"
  | "custom";

export type AreaSignal = "motion" | "presence" | "doors" | "windows" | "leaks";

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
  action?: "more-info" | "navigate" | "toggle" | "call-service" | "area-details" | "status-details" | "none";
  entity?: string;
  navigation_path?: string;
  service?: string;
  data?: Record<string, unknown>;
}

export interface StatusConfig extends ActionConfig {
  source?: "area_motion" | "area_presence" | "area_doors" | "area_windows" | "area_leaks" | "entity";
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
  area?: string;
  domain?: string;
  label?: string;
  icon?: string;
  color?: string;
  decimals?: number;
  unit?: string;
  format?: "auto" | "number" | "temperature" | "percent" | "power";
  hide_unavailable?: boolean;
  hidden?: boolean;
}

export interface AreaGlanceConfig extends ActionConfig {
  type?: string;
  title?: string;
  area?: string;
  status?: StatusConfig;
  metrics?: MetricConfig[];
  header_action?: ActionConfig;
  layout?: "header" | "stacked" | "metrics-only";
  height?: "slim" | "compact" | "standard" | "comfortable";
  profile?: "auto" | "room" | "media" | "battery" | "energy" | "house";
  appearance?: {
    preset?: "theme" | "light" | "slate" | "charcoal" | "custom";
    background?: string;
    shadow?: boolean;
  };
  theme?: "auto" | "light" | "dark";
  accent_color?: string;
  background?: string;
}
