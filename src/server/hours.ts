import { type Restaurant, WEEKDAY_KEYS } from "../shared/restaurant";
import { isoToNyParts } from "../shared/time";

export type OpenCheck =
  | { status: "open"; closesAtMin: number }
  | { status: "closed" }
  | { status: "unknown" };

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return h * 60 + m;
};

/** Minimum time a party needs before close for a seat to count as usable. */
export const MIN_MINUTES_BEFORE_CLOSE = 60;

/**
 * Is the restaurant open at the local dining time with at least an hour
 * before closing? Intervals past 24:00 belong to the previous day.
 */
export function openAt(r: Restaurant, diningAtIso: string): OpenCheck {
  const p = isoToNyParts(diningAtIso);
  const minute = p.hour * 60 + p.minute;
  const today = r.hours.weekly[WEEKDAY_KEYS[p.weekday]!];
  const yesterday = r.hours.weekly[WEEKDAY_KEYS[(p.weekday + 6) % 7]!];

  const windows: [number, number][] = [];
  if (today) for (const [o, c] of today) windows.push([toMin(o), toMin(c)]);
  if (yesterday) for (const [o, c] of yesterday) if (toMin(c) > 1440) windows.push([toMin(o) - 1440, toMin(c) - 1440]);

  for (const [o, c] of windows) {
    if (minute >= o && minute + MIN_MINUTES_BEFORE_CLOSE <= c) return { status: "open", closesAtMin: c };
  }
  if (today === null) return { status: "unknown" };
  return { status: "closed" };
}

export function minutesToClock(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function clockLabel(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 || h >= 24 ? "AM" : "PM"}`;
}
