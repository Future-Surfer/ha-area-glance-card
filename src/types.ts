export type MetricPreset =
  | "temperature"
  | "humidity"
  | "lights"
  | "power"
  | "battery"
  | "co2"
  | "device"
  | "custom";

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
  action?: "more-info" | "navigate" | "toggle" | "call-service" | "none";
  entity?: string;
  navigation_path?: string;
  service?: string;
  data?: Record<string, unknown>;
}

export interface StatusConfig {
  source?: "area_motion" | "entity";
  entity?: string;
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
  layout?: "header" | "metrics-only";
  height?: "compact" | "standard" | "comfortable";
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
