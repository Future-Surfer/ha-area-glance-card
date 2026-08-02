import type { HassLike } from "./types";

interface AreaEntityIndex {
  states: HassLike["states"];
  entities: HassLike["entities"];
  devices: HassLike["devices"];
  all: string[];
  byArea: Map<string, string[]>;
  byDomain: Map<string, string[]>;
}

const indexes = new WeakMap<object, AreaEntityIndex>();

const append = (index: Map<string, string[]>, key: string, entityId: string) => {
  const values = index.get(key);
  if (values) values.push(entityId);
  else index.set(key, [entityId]);
};

const buildIndex = (hass: HassLike): AreaEntityIndex => {
  const all = Object.keys(hass.states);
  const byArea = new Map<string, string[]>();
  const byDomain = new Map<string, string[]>();
  for (const entityId of all) {
    const domain = entityId.split(".")[0];
    if (domain) append(byDomain, domain, entityId);
    const entity = hass.entities?.[entityId];
    const area = entity?.area_id ?? (entity?.device_id ? hass.devices?.[entity.device_id]?.area_id : undefined);
    if (area) append(byArea, area, entityId);
  }
  return { states: hass.states, entities: hass.entities, devices: hass.devices, all, byArea, byDomain };
};

const getIndex = (hass: HassLike): AreaEntityIndex => {
  const cached = indexes.get(hass);
  if (cached && cached.states === hass.states && cached.entities === hass.entities && cached.devices === hass.devices) return cached;
  const next = buildIndex(hass);
  indexes.set(hass, next);
  return next;
};

/**
 * Return Home Assistant entities for one area or the whole home without
 * rescanning `hass.states` for every insight. The cache is rebuilt whenever
 * Home Assistant supplies a new state or registry object.
 */
export const areaEntityIds = (hass: HassLike | undefined, area?: string, domain?: string): string[] => {
  if (!hass) return [];
  const index = getIndex(hass);
  const candidates = area ? index.byArea.get(area) ?? [] : domain ? index.byDomain.get(domain) ?? [] : index.all;
  return domain && area ? candidates.filter((entityId) => entityId.startsWith(`${domain}.`)) : candidates;
};
