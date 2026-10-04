import { describe, expect, it } from "vitest";
import type { HardConstraint } from "../src/shared/normalized";
import { evaluateCandidate, guardRecommendation } from "../src/server/feasibility";
import { diner, group, src, testRestaurant } from "./helpers";

const budget = (amount: number, basis: "all_in" | "food_only" | "unspecified"): HardConstraint => ({
  id: "b1",
  type: "budget_max",
  amount,
  basis,
  source: src(`$${amount} max`),
});

const facts = (hard: HardConstraint[], over = {}, diningAt?: string) =>
  evaluateCandidate(testRestaurant(over), {
    group: group([diner("a", { hard }), diner("b")], diningAt),
    restaurants: [],
    availabilitySeed: "t",
  });

const dinerCheck = (f: ReturnType<typeof facts>) => f.checks.find((c) => c.scope === "diner");

describe("budget caps", () => {
  it("passes when the all-in estimate fits and fails when it starts above the cap", () => {
    expect(dinerCheck(facts([budget(50, "all_in")]))?.result).toBe("pass");
    expect(dinerCheck(facts([budget(25, "all_in")]))?.result).toBe("fail");
  });

  it("does not treat an optimistic minimum as credible", () => {
    // Estimate $30–45 all-in; a $40 cap only covers part of the range.
    expect(dinerCheck(facts([budget(40, "all_in")]))?.result).toBe("fail");
  });

  it("uses a priced single order when the menu supports it", () => {
    const f = facts([budget(30, "all_in")], { sampleOrders: [{ description: "One pasta", foodOnlyPrice: 22, evidenceIds: ["e1"] }] });
    expect(dinerCheck(f)?.result).toBe("pass");
    expect(f.assumptions.join(" ")).toMatch(/single main/);
  });

  it("does not silently reinterpret an unspecified budget as food-only", () => {
    // Food-only $23–35 fits $36, but all-in $30–45 does not.
    const f = facts([budget(36, "unspecified")]);
    expect(dinerCheck(f)?.result).toBe("fail");
    expect(dinerCheck(f)?.note).toMatch(/excludes tax and tip/);
    expect(dinerCheck(facts([budget(36, "food_only")]))?.result).toBe("pass");
  });
});

describe("dietary requirements", () => {
  const veg: HardConstraint = { id: "d1", type: "dietary", tag: "vegetarian", allergen: null, severity: "preference", source: src("vegetarian") };
  const nutAllergy: HardConstraint = { id: "d2", type: "dietary", tag: "nut_free", allergen: "peanuts", severity: "allergy", source: src("allergic to peanuts") };

  it("needs menu evidence; absence of evidence is not a pass", () => {
    expect(dinerCheck(facts([veg]))?.result).toBe("unverified");
    const withVeg = facts([veg], { menuOptions: [{ dietaryTag: "vegetarian", description: "Eggplant parm", evidenceIds: ["e1"], verificationStatus: "menu_inferred" }] });
    expect(dinerCheck(withVeg)?.result).toBe("pass");
  });

  it("passes ingredient preferences without a tag but keeps religious needs strict", () => {
    const noPork: HardConstraint = { id: "p", type: "dietary", tag: null, allergen: "pork", severity: "preference", source: src("no pork for me") };
    expect(dinerCheck(facts([noPork]))?.result).toBe("pass");
    const religious: HardConstraint = { ...noPork, severity: "religious" };
    expect(dinerCheck(facts([religious]))?.result).toBe("unverified");
  });

  it("counts vegan options for a vegetarian", () => {
    const f = facts([veg], { menuOptions: [{ dietaryTag: "vegan", description: "Vegan bowl", evidenceIds: ["e1"], verificationStatus: "menu_labeled" }] });
    expect(dinerCheck(f)?.result).toBe("pass");
  });

  it("treats allergies as unverified without a published allergy policy, even with a labeled dish", () => {
    const labeled = { menuOptions: [{ dietaryTag: "nut_free" as const, description: "Nut-free menu", evidenceIds: ["e1"], verificationStatus: "menu_labeled" as const }] };
    expect(dinerCheck(facts([nutAllergy], labeled))?.result).toBe("unverified");
    const withPolicy = facts([nutAllergy], { ...labeled, allergyPolicy: { statement: "Please inform us of allergies", evidenceIds: ["e1"] } });
    expect(dinerCheck(withPolicy)?.result).toBe("pass");
    expect(withPolicy.assumptions.join(" ")).toMatch(/can't confirm/);
  });
});

describe("travel, hours, reservations", () => {
  it("resolves an uncertain travel limit conservatively", () => {
    const far = diner("a", {
      origin: { lat: 40.7628, lng: -73.9255, label: "Astoria", source: "stated_area" },
      hard: [{ id: "t1", type: "travel_max_minutes", minutes: 30, source: src("max 30 minutes") }],
    });
    const f = evaluateCandidate(testRestaurant(), { group: group([far, diner("b")]), restaurants: [], availabilitySeed: "t" });
    expect(["unverified", "fail"]).toContain(dinerCheck(f)?.result);
    expect(f.feasible).toBe(false);
  });

  it("is infeasible when closed and when hours are unknown", () => {
    expect(facts([], {}, "2026-10-05T19:30:00-04:00").feasible).toBe(false); // Monday closed
    expect(facts([], {}, "2026-10-10T19:30:00-04:00").feasible).toBe(false); // Saturday unknown
  });

  it("allows an open restaurant with an unknown table policy, with a call-ahead caveat, unless a reservation is required", () => {
    const unknown = facts([], { reservationPolicy: "unknown" });
    expect(unknown.feasible).toBe(true);
    expect(unknown.assumptions.join(" ")).toMatch(/call ahead/);
    const need: HardConstraint = { id: "r1", type: "reservation_required", source: src("need a reservation") };
    expect(facts([need], { reservationPolicy: "unknown" }).feasible).toBe(false);
  });

  it("requires a simulated reservable slot when a diner needs a reservation", () => {
    const need: HardConstraint = { id: "r1", type: "reservation_required", source: src("we need a reservation") };
    const walkIn = facts([need], { reservationPolicy: "walk_in_only" });
    expect(dinerCheck(walkIn)?.result).toBe("fail");
  });
});

describe("final guard", () => {
  it("rejects unknown ids and infeasible picks, accepts feasible ones", () => {
    const r = testRestaurant();
    const ctx = { group: group([diner("a"), diner("b")]), restaurants: [r], availabilitySeed: "t" };
    expect(guardRecommendation("nope", ctx)).toMatchObject({ ok: false, reason: "unknown_restaurant:nope" });
    const closed = { ...ctx, group: group([diner("a"), diner("b")], "2026-10-05T19:30:00-04:00") };
    expect(guardRecommendation(r.id, closed).ok).toBe(false);
    const res = guardRecommendation(r.id, ctx);
    expect(res.ok || res.reason.includes("availability")).toBe(true);
  });
});
