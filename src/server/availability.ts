import type { Restaurant } from "../shared/restaurant";
import { isoToNyParts } from "../shared/time";
import { minutesToClock, openAt } from "./hours";

export type AvailabilityStatus = "reservable" | "walk_in" | "unavailable" | "unknown";

export type Availability = {
  restaurantId: string;
  status: AvailabilityStatus;
  /** Local "HH:MM" reservable slots near the requested time. */
  slots: string[];
  reason: "closed" | "hours_unknown" | "policy_unknown" | "walk_in_only" | "no_online_tables" | "fully_booked" | "tables_available";
  /** Fixture key: restaurant | local date | 15-min window | party size | seed. */
  key: string;
};

export const AVAILABILITY_METHOD = {
  id: "fixture-v1",
  slotOffsetsMin: [-30, -15, 0, 15, 30, 45],
  baseReservableP: 0.75,
  perExtraDinerPenalty: 0.08,
};

/** FNV-1a 32-bit → [0, 1). */
function unitHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 2 ** 32;
}

/**
 * Deterministic simulated availability. Never offers a usable seat at a
 * restaurant known to be closed; unknown hours or policy stay unknown.
 */
export function simulateAvailability(r: Restaurant, diningAtIso: string, partySize: number, seed: string): Availability {
  const p = isoToNyParts(diningAtIso);
  const minute = p.hour * 60 + p.minute;
  const window = Math.round(minute / 15) * 15;
  const date = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  const key = `${r.id}|${date}|${minutesToClock(window)}|${partySize}|${seed}`;
  const base = { restaurantId: r.id, slots: [] as string[], key };

  const open = openAt(r, diningAtIso);
  if (open.status === "closed") return { ...base, status: "unavailable", reason: "closed" };
  if (open.status === "unknown") return { ...base, status: "unknown", reason: "hours_unknown" };
  if (r.reservationPolicy === "unknown") return { ...base, status: "unknown", reason: "policy_unknown" };
  if (r.reservationPolicy === "walk_in_only") return { ...base, status: "walk_in", reason: "walk_in_only" };

  const m = AVAILABILITY_METHOD;
  const pReservable = Math.max(0.1, m.baseReservableP - m.perExtraDinerPenalty * Math.max(0, partySize - 2));
  if (unitHash(key) < pReservable) {
    const slots = m.slotOffsetsMin
      .map((off) => window + off)
      .filter((t) => unitHash(`${key}|${t}`) < 0.6)
      .filter((t) => openAt(r, withMinute(diningAtIso, t)).status === "open")
      .slice(0, 4)
      .map(minutesToClock);
    if (slots.length) return { ...base, status: "reservable", slots, reason: "tables_available" };
  }
  return r.reservationPolicy === "reservations_and_walk_ins"
    ? { ...base, status: "walk_in", reason: "no_online_tables" }
    : { ...base, status: "unavailable", reason: "fully_booked" };
}

function withMinute(iso: string, minuteOfDay: number): string {
  const m = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:00([+-]\d{2}:\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${m[1]}T${minutesToClock(minuteOfDay)}:00${m[2]}`;
}
