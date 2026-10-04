import { describe, expect, it } from "vitest";
import { applyHostPriority, hostCallUseful, POLICY, selectFair } from "../src/server/policy";

describe("fair selection", () => {
  it("prefers an acceptable outcome for everyone over a high average with one poor fit", () => {
    const fits = {
      crowdPleaser: { a: 3.9, b: 3.8, c: 0.9 },
      fairPick: { a: 2.6, b: 2.7, c: 2.5 },
    };
    const sel = selectFair(fits, { crowdPleaser: 20, fairPick: 20 })!;
    expect(sel.choice.restaurantId).toBe("fairPick");
  });

  it("breaks near-ties in the weakest fit by mean, then travel, then id", () => {
    const fits = {
      b_place: { a: 2.5, b: 3.5 }, // weakest 2.5, mean 3.0
      a_place: { a: 2.6, b: 2.8 }, // weakest 2.6, mean 2.7
      c_place: { a: 2.0, b: 4.0 }, // outside the 0.15 shortlist
    };
    const sel = selectFair(fits, { a_place: 30, b_place: 30, c_place: 10 })!;
    expect(sel.shortlist.map((r) => r.restaurantId)).toEqual(["b_place", "a_place"]);
    expect(sel.choice.restaurantId).toBe("b_place");

    const tied = selectFair({ y: { a: 3, b: 3 }, x: { a: 3, b: 3 } }, { x: 25, y: 25 })!;
    expect(tied.choice.restaurantId).toBe("x");
    const travelTie = selectFair({ y: { a: 3, b: 3 }, x: { a: 3, b: 3 } }, { x: 40, y: 25 })!;
    expect(travelTie.choice.restaurantId).toBe("y");
  });

  it("uses an inclusive shortlist boundary at exactly the delta", () => {
    const sel = selectFair({ p: { a: 3.0 }, q: { a: 3.0 - POLICY.shortlistDelta } }, { p: 10, q: 10 })!;
    expect(sel.shortlist).toHaveLength(2);
  });

  it("returns null with no candidates", () => {
    expect(selectFair({}, {})).toBeNull();
  });
});

describe("host-call gating", () => {
  it("skips the host when the choice is adequate", () => {
    const fits = { p: { a: 3, b: 2.8 }, q: { a: 2.9, b: 2.9 } };
    const sel = selectFair(fits, { p: 50, q: 10 })!;
    expect(hostCallUseful(sel, fits)).toMatchObject({ useful: false, reason: "adequate" });
  });

  it("asks only when a weak choice could change with the host's priority", () => {
    const fits = { near: { a: 1.1, b: 1.0 }, apt: { a: 1.05, b: 2.0 } };
    const travel = { near: 15, apt: 45 };
    const sel = selectFair(fits, travel)!;
    const g = hostCallUseful(sel, fits);
    expect(g.useful).toBe(true);
    expect(applyHostPriority(g.band, "shorter_trip")!.restaurantId).toBe("near");
    expect(applyHostPriority(g.band, "best_match")!.restaurantId).toBe("apt");
  });

  it("does not ask when both priorities lead to the same restaurant", () => {
    const fits = { p: { a: 1.0, b: 0.9 }, q: { a: 0.2, b: 0.3 } };
    const sel = selectFair(fits, { p: 10, q: 50 })!;
    expect(hostCallUseful(sel, fits)).toMatchObject({ useful: false, reason: "answer_would_not_change_choice" });
  });
});
