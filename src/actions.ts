import type { ActionConfig } from "./types";

export type ActionTrigger = "tap" | "hold" | "double_tap";

/**
 * Send a standard Home Assistant action event. Gesture recognition stays with
 * the card, while Home Assistant remains responsible for executing navigate,
 * more-info, toggle, and service actions.
 */
export const dispatchHassAction = (
  target: EventTarget,
  action: ActionConfig,
  fallbackEntity: string | undefined,
  trigger: ActionTrigger,
) => {
  const entity = action.entity ?? fallbackEntity;
  const nativeAction = { ...action, action: action.action ?? "more-info", ...(entity ? { entity } : {}) };
  target.dispatchEvent(new CustomEvent("hass-action", {
    detail: {
      config: {
        entity,
        tap_action: nativeAction,
        hold_action: nativeAction,
        double_tap_action: nativeAction,
      },
      action: trigger,
    },
    bubbles: true,
    composed: true,
  }));
};
