export const NY_TZ = "America/New_York";

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: NY_TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  weekday: "short",
});

export type NyParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday */
  weekday: number;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function nyParts(epochMs: number): NyParts {
  const p = Object.fromEntries(partsFmt.formatToParts(new Date(epochMs)).map((x) => [x.type, x.value]));
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    weekday: WEEKDAYS.indexOf(p.weekday ?? ""),
  };
}

/** Offset of New York from UTC in minutes at the given instant (e.g. -240 for EDT). */
export function nyOffsetMinutes(epochMs: number): number {
  const p = nyParts(epochMs);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return Math.round((asUtc - Math.floor(epochMs / 60000) * 60000) / 60000);
}

const pad = (n: number) => String(Math.abs(n)).padStart(2, "0");

function formatOffset(mins: number) {
  const sign = mins <= 0 ? "-" : "+";
  return `${sign}${pad(Math.trunc(mins / 60))}:${pad(mins % 60)}`;
}

/** Convert a New York wall-clock date ("2026-10-09") and time ("19:30") to ISO with offset. */
export function nyLocalToIso(date: string, time: string): string {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dm || !tm) throw new Error("Invalid date or time.");
  const [y, mo, d, h, mi] = [dm[1], dm[2], dm[3], tm[1], tm[2]].map(Number) as [number, number, number, number, number];
  const naiveUtc = Date.UTC(y, mo - 1, d, h, mi);
  let offset = nyOffsetMinutes(naiveUtc - 5 * 3600_000);
  offset = nyOffsetMinutes(naiveUtc - offset * 60000);
  return `${date}T${time}:00${formatOffset(offset)}`;
}

/** Parse our ISO-with-offset back to New York wall-clock parts. */
export function isoToNyParts(iso: string): NyParts {
  return nyParts(Date.parse(iso));
}

export function formatDiningTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: NY_TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** Suggested default: the next 7:30 PM in New York that is at least two hours away. */
export function suggestDiningTime(now: number): { date: string; time: string } {
  const p = nyParts(now);
  const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
  const today = ymd(p.year, p.month, p.day);
  if (p.hour * 60 + p.minute <= 17 * 60 + 30) return { date: today, time: "19:30" };
  const t = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  return { date: ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()), time: "19:30" };
}
