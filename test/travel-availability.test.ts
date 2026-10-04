import { describe, expect, it } from "vitest";
import { simulateAvailability } from "../src/server/availability";
import { openAt } from "../src/server/hours";
import { estimateTravel, haversineKm } from "../src/server/travel";
import { testRestaurant } from "./helpers";


describe("travel estimates", () => {
  it("computes plausible distances", () => {
    // Union Square → Bedford Av (L) is roughly 4.5 km as the crow flies.
    const km = haversineKm({ lat: 40.7359, lng: -73.9906 }, { lat: 40.7171, lng: -73.9566 });
    expect(km).toBeGreaterThan(3.3);
    expect(km).toBeLessThan(3.8);
  });

  it("uses walking ranges for short hops and transit ranges otherwise", () => {
    const walk = estimateTravel({ lat: 40.7359, lng: -73.9906 }, { lat: 40.7395, lng: -73.9897 });
    expect(walk.mode).toBe("walk");
    expect(walk.minutesHigh).toBeLessThan(15);
    const far = estimateTravel({ lat: 40.7359, lng: -73.9906 }, { lat: 40.7628, lng: -73.9255 });
    expect(far.mode).toBe("transit");
    expect(far.minutesLow).toBeLessThan(far.minutesHigh);
    expect(far.minutesLow).toBeGreaterThan(15);
  });
});

describe("opening hours", () => {
  const r = testRestaurant();
  it("requires an hour before close", () => {
    expect(openAt(r, "2026-10-06T19:30:00-04:00").status).toBe("open"); // Tue
    expect(openAt(r, "2026-10-06T21:30:00-04:00").status).toBe("closed");
  });
  it("treats closed days and unknown days differently", () => {
    expect(openAt(r, "2026-10-05T19:30:00-04:00").status).toBe("closed"); // Mon []
    expect(openAt(r, "2026-10-10T19:30:00-04:00").status).toBe("unknown"); // Sat null
  });
  it("handles intervals past midnight from the previous day", () => {
    expect(openAt(r, "2026-10-10T00:15:00-04:00").status).toBe("open"); // Fri 17:00–26:00
  });
});

describe("simulated availability", () => {
  const r = testRestaurant();
  it("is deterministic for the same key", () => {
    const a = simulateAvailability(r, "2026-10-06T19:30:00-04:00", 4, "seed-1");
    const b = simulateAvailability(r, "2026-10-06T19:30:00-04:00", 4, "seed-1");
    expect(a).toEqual(b);
  });
  it("never offers a seat when the restaurant is closed or hours are unknown", () => {
    for (let i = 0; i < 20; i++) {
      expect(simulateAvailability(r, "2026-10-05T19:30:00-04:00", 2, `s${i}`).status).toBe("unavailable");
      expect(simulateAvailability(r, "2026-10-10T19:30:00-04:00", 2, `s${i}`).status).toBe("unknown");
    }
  });
  it("only offers slots inside opening hours", () => {
    for (let i = 0; i < 50; i++) {
      const a = simulateAvailability(r, "2026-10-06T20:45:00-04:00", 2, `s${i}`);
      for (const s of a.slots) expect(s <= "21:00").toBe(true);
    }
  });
  it("respects walk-in-only policies", () => {
    const w = testRestaurant({ reservationPolicy: "walk_in_only" });
    expect(simulateAvailability(w, "2026-10-06T19:30:00-04:00", 3, "x").status).toBe("walk_in");
  });
  it("produces a mix of outcomes across seeds", () => {
    const statuses = new Set(Array.from({ length: 40 }, (_, i) => simulateAvailability(r, "2026-10-06T19:00:00-04:00", 4, `m${i}`).status));
    expect(statuses.has("reservable")).toBe(true);
    expect(statuses.has("walk_in")).toBe(true);
  });
});
