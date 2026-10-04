import { describe, expect, it } from "vitest";
import snapshotJson from "../data/v1/restaurants.json";
import profilesJson from "../data/v1/profiles.json";
import { MEETING_AREAS } from "../src/shared/data";
import { SnapshotSchema } from "../src/shared/restaurant";

describe("restaurant snapshot", () => {
  const parsed = SnapshotSchema.safeParse(snapshotJson);

  it("matches the schema, including evidence references", () => {
    if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues.slice(0, 5), null, 2));
    expect(parsed.success).toBe(true);
  });

  it("has unique ids and only real, evidence-backed entries", () => {
    const rs = parsed.success ? parsed.data.restaurants : [];
    expect(new Set(rs.map((r) => r.id)).size).toBe(rs.length);
    for (const r of rs) {
      expect(r.evidence.every((e) => e.url.startsWith("http"))).toBe(true);
      expect(r.mealEstimate.evidenceIds.length).toBeGreaterThan(0);
    }
  });
});

describe("profiles and areas", () => {
  it("marks profiles as synthetic and uses unique ids", () => {
    expect(profilesJson.synthetic).toBe(true);
    expect(new Set(profilesJson.profiles.map((p) => p.id)).size).toBe(profilesJson.profiles.length);
  });

  it("keeps meeting areas inside NYC", () => {
    for (const a of MEETING_AREAS) {
      expect(a.lat).toBeGreaterThan(40.49);
      expect(a.lat).toBeLessThan(40.92);
      expect(a.lng).toBeGreaterThan(-74.27);
      expect(a.lng).toBeLessThan(-73.68);
    }
  });
});
