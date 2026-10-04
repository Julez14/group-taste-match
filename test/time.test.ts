import { describe, expect, it } from "vitest";
import { isoToNyParts, nyLocalToIso, suggestDiningTime } from "../src/shared/time";

describe("New York time", () => {
  it("uses EDT offset in October and EST in December", () => {
    expect(nyLocalToIso("2026-10-09", "19:30")).toBe("2026-10-09T19:30:00-04:00");
    expect(nyLocalToIso("2026-12-04", "19:30")).toBe("2026-12-04T19:30:00-05:00");
  });

  it("round-trips wall-clock parts including weekday", () => {
    const p = isoToNyParts(nyLocalToIso("2026-10-09", "19:30"));
    expect(p).toMatchObject({ year: 2026, month: 10, day: 9, hour: 19, minute: 30, weekday: 5 });
  });

  it("handles the day after the fall-back transition", () => {
    expect(nyLocalToIso("2026-11-02", "08:00")).toBe("2026-11-02T08:00:00-05:00");
  });

  it("suggests tonight before 5:30 PM and tomorrow after", () => {
    expect(suggestDiningTime(Date.parse("2026-10-04T12:00:00-04:00"))).toEqual({ date: "2026-10-04", time: "19:30" });
    expect(suggestDiningTime(Date.parse("2026-10-04T21:00:00-04:00"))).toEqual({ date: "2026-10-05", time: "19:30" });
  });
});
