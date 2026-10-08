import { describe, expect, it } from "vitest";
import { applyHostPriority, hostCallUseful, POLICY, selectAverage } from "../src/server/policy";

describe("average-fit selection", () => {
  it("selects the highest average even when another restaurant has a better minimum", () => {
    const fits = {
      crowdPleaser: { a: 3.9, b: 3.8, c: 0.9 },
      fairPick: { a: 2.6, b: 2.7, c: 2.5 },
    };
    const sel = selectAverage(fits, { crowdPleaser: 20, fairPick: 20 })!;
    expect(sel.choice.restaurantId).toBe("crowdPleaser");
    expect(sel.choice.weakest).toBe(0.9);
  });

  it("breaks exact average ties by shorter worst trip, then restaurant id", () => {
    const fits = {
      b_place: { a: 2.5, b: 3.5 }, // mean 3.0
      a_place: { a: 2.6, b: 2.8 }, // mean 2.7
      c_place: { a: 2.0, b: 4.0 }, // mean 3.0
    };
    const sel = selectAverage(fits, { a_place: 30, b_place: 30, c_place: 10 })!;
    expect(sel.choice.restaurantId).toBe("c_place");

    const tied = selectAverage({ y: { a: 3, b: 3 }, x: { a: 3, b: 3 } }, { x: 25, y: 25 })!;
    expect(tied.choice.restaurantId).toBe("x");
    const travelTie = selectAverage({ y: { a: 3, b: 3 }, x: { a: 3, b: 3 } }, { x: 40, y: 25 })!;
    expect(travelTie.choice.restaurantId).toBe("y");
  });

  it("returns null with no candidates", () => {
    expect(selectAverage({}, {})).toBeNull();
  });
});

describe("host-call gating", () => {
  it("skips the host when the choice is adequate", () => {
    const fits = { p: { a: 3, b: 2.8 }, q: { a: 2.9, b: 2.9 } };
    const sel = selectAverage(fits, { p: 50, q: 10 })!;
    expect(hostCallUseful(sel, fits)).toMatchObject({ useful: false, reason: "adequate" });
  });

  it("asks only when a weak choice could change with the host's priority", () => {
    const fits = { near: { a: 1.1, b: 1.0 }, apt: { a: 0.9, b: 1.9 } };
    const travel = { near: 15, apt: 45 };
    const sel = selectAverage(fits, travel)!;
    const g = hostCallUseful(sel, fits);
    expect(g.useful).toBe(true);
    expect(applyHostPriority(g.band, "shorter_trip")!.restaurantId).toBe("near");
    expect(applyHostPriority(g.band, "best_match")!.restaurantId).toBe("apt");
  });

  it("does not ask when both priorities lead to the same restaurant", () => {
    const fits = { p: { a: 1.0, b: 0.9 }, q: { a: 0.2, b: 0.3 } };
    const sel = selectAverage(fits, { p: 10, q: 50 })!;
    expect(hostCallUseful(sel, fits)).toMatchObject({ useful: false, reason: "answer_would_not_change_choice" });
  });

  it("limits a host tradeoff to candidates near the best average", () => {
    const fits = { best: { a: 0.8, b: 2.2 }, near: { a: 1.0, b: 1.4 }, distant: { a: 0.9, b: 0.3 } };
    const sel = selectAverage(fits, { best: 40, near: 20, distant: 5 })!;
    const gate = hostCallUseful(sel, fits);
    expect(gate.band.map(r => r.restaurantId)).toEqual(["best", "near"]);
    expect(gate.band.every(r => r.mean >= sel.bestMean - POLICY.hostBand)).toBe(true);
  });
});
