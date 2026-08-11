import type { AreaReference, HassLike } from "./types";

export interface ResolvedAreaReference {
  /** The real Home Assistant area ID used by all discovery and actions. */
  areaId?: string;
  /** Present only for the portable numeric showcase shorthand. */
  showcaseSlot?: number;
  /** A numeric slot was requested but this installation does not have it. */
  unavailable?: boolean;
}

/**
 * Resolve an ordinary Home Assistant area ID or the portable one-based
 * showcase shorthand (`area: 1`, `area: 2`, ...). String values are always
 * treated as literal area IDs so an unusual real ID such as `"1"` remains
 * fully supported.
 */
export const resolveAreaReference = (hass: HassLike | undefined, area?: AreaReference): ResolvedAreaReference => {
  if (typeof area === "string") return { areaId: area || undefined };
  if (typeof area === "number" && (!Number.isInteger(area) || area < 1)) return { showcaseSlot: area, unavailable: true };
  if (area === undefined) return {};
  const showcaseSlot = area!;
  const areaIds = Object.keys(hass?.areas ?? {}).sort((left, right) => left.localeCompare(right));
  const areaId = areaIds[showcaseSlot - 1];
  return areaId ? { areaId, showcaseSlot } : { showcaseSlot, unavailable: true };
};

export const resolvedAreaId = (hass: HassLike | undefined, area?: AreaReference): string | undefined =>
  resolveAreaReference(hass, area).areaId;
