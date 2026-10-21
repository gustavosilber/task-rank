import type { Aspect, Direction, Lens } from "./types"

export const DEV_ASPECTS: Aspect[] = [
  { id: "delivery", label: "Delivery" },
  { id: "followup", label: "Follow-up" },
  { id: "communication", label: "Communication" },
]

export const PM_ASPECTS: Aspect[] = [
  { id: "scope", label: "Scope clarity" },
  { id: "followup", label: "Follow-up" },
  { id: "communication", label: "Communication" },
]

export function aspectsFor(direction: Direction): Aspect[] {
  return direction === "pm_to_dev" ? DEV_ASPECTS : PM_ASPECTS
}

export function directionFor(lens: Lens): Direction {
  return lens === "dev" ? "pm_to_dev" : "dev_to_pm"
}
