import { describe, expect, it } from "vitest";
import { cachedInterpreter, type InterpretCache, type Interpreter } from "../src/server/interpret";
import { findLeaks, scrubList } from "../src/server/privacy";
import type { Interpretation } from "../src/shared/normalized";
import { diner, group, src } from "./helpers";

describe("privacy filter", () => {
  const g = group([
    diner("a", { name: "Ana", hard: [{ id: "a:h1", type: "budget_max", amount: 60, basis: "unspecified", source: src("max $60") }] }),
    diner("b", {
      name: "Ben",
      origin: { lat: 40.7171, lng: -73.9566, label: "Williamsburg", source: "stated_area" },
      hard: [{ id: "b:h1", type: "dietary", tag: "nut_free", allergen: "peanuts", severity: "allergy", source: src("peanut allergy") }],
    }),
  ]);

  it("flags names, private budgets, stated origins, and allergens", () => {
    const leaks = findLeaks("Ana stays within $60, Ben's trip from Williamsburg is short, and it's safe for a peanut allergy.", g);
    expect([...new Set(leaks.map((l) => l.kind))].sort()).toEqual(["allergen", "budget", "name", "origin"]);
  });

  it("ignores the chosen restaurant's own name and collective diet words", () => {
    expect(findLeaks("Peter Luger Williamsburg has gluten-free sides.", g, { name: "Peter Luger Williamsburg", neighborhood: "Williamsburg" })).toEqual([]);
  });

  it("allows collective wording", () => {
    expect(findLeaks("I picked somewhere relaxed that fits everyone's budget and a manageable trip from Union Square.", g)).toEqual([]);
  });

  it("drops only the leaking sentences from a list", () => {
    const r = scrubList(["Fits everyone's budget.", "The $60 budget includes tip."], g);
    expect(r.kept).toEqual(["Fits everyone's budget."]);
    expect(r.leaks).toHaveLength(1);
  });
});

describe("interpretation cache", () => {
  const empty: Interpretation = { hard: [], soft: [], ambiguities: [], missing: [], noveltyRequested: false, originAreaId: null, ignoredInstructions: [] };

  it("reuses work for unchanged inputs and recomputes after an edit", async () => {
    const store = new Map<string, unknown>();
    const cache: InterpretCache = { get: (k) => store.get(k) ?? null, put: (k, v) => void store.set(k, v) };
    let calls = 0;
    const inner: Interpreter = async () => {
      calls++;
      return empty;
    };
    const interp = cachedInterpreter(inner, cache);
    const args = { text: "ramen", meetingAreaName: "SoHo", diningAt: "2026-10-06T19:30:00-04:00" };
    await Promise.all([interp(args), interp(args)]);
    await interp(args);
    expect(calls).toBe(1);
    await interp({ ...args, text: "actually tacos" });
    expect(calls).toBe(2);
    await interp({ ...args, meetingAreaName: "Astoria" });
    expect(calls).toBe(3);
  });
});
