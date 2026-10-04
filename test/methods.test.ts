import { describe, expect, it } from "vitest";
import type { AiClient } from "../src/server/ai";
import { CLEF_MAX_QUESTIONS, parseScore, scoreFits } from "../src/server/clef";
import { DecisionRejected, decideWithGuard } from "../src/server/decide";
import type { DecisionInput } from "../src/server/decision-context";
import { evaluateAll } from "../src/server/feasibility";
import { illegalReason } from "../src/server/methods/baseline-method";
import type { DecisionMethodImpl } from "../src/server/methods/types";
import type { Decision } from "../src/shared/decision";
import { diner, group, src, testRestaurant } from "./helpers";

const probs = { "0": 0.05, "1": 0.1, "2": 0.3, "3": 0.35, "4": 0.2 };

/** Fake Clef that echoes a deterministic score for every requested question. */
function fakeClef(scoreFor: (key: string) => number = () => 2.5): AiClient & { batches: number[] } {
  const batches: number[] = [];
  return {
    calls: [],
    batches,
    async run<T>(_model: string, input: unknown) {
      const qs = (input as { questions: Record<string, unknown> }).questions;
      batches.push(Object.keys(qs).length);
      const answers = Object.fromEntries(Object.keys(qs).map((k) => [k, { type: "score", score: scoreFor(k), probabilities: probs, confidence: 0.3 }]));
      return { answers } as T;
    },
  };
}

function input(nRestaurants: number, nDiners: number, over: Partial<DecisionInput> = {}): DecisionInput {
  const restaurants = Array.from({ length: nRestaurants }, (_, i) => testRestaurant({ id: `r${String(i).padStart(2, "0")}`, name: `R${i}` }));
  const g = group(Array.from({ length: nDiners }, (_, i) => diner(String.fromCharCode(97 + i))));
  return {
    phase: "FIXED_STATE",
    group: g,
    facts: evaluateAll({ group: g, restaurants, availabilitySeed: "seed", frozenAvailability: Object.fromEntries(restaurants.map((r) => [r.id, { restaurantId: r.id, status: "walk_in" as const, slots: [], reason: "walk_in_only" as const, key: "k" }])) }),
    restaurants,
    allowClarify: false,
    allowHost: false,
    ...over,
  };
}

describe("Clef scoring", () => {
  it("asks every diner × restaurant pair in batches of at most 64, without truncation", async () => {
    const ai = fakeClef();
    const inp = input(30, 6);
    const { table, calls } = await scoreFits(ai, inp);
    expect(calls).toBe(Math.ceil(180 / CLEF_MAX_QUESTIONS));
    expect(ai.batches.every((n) => n <= CLEF_MAX_QUESTIONS)).toBe(true);
    expect(ai.batches.reduce((a, b) => a + b, 0)).toBe(180);
    expect(Object.keys(table)).toHaveLength(30);
    expect(Object.keys(table.r00!)).toHaveLength(6);
  });

  it("validates answer type, range, and probability distributions", () => {
    expect(parseScore("k", { type: "score", score: 2.1, probabilities: probs, confidence: 0.2 }).probabilities).toHaveLength(5);
    expect(() => parseScore("k", undefined)).toThrow(/missing/);
    expect(() => parseScore("k", { type: "choice", score: 2 })).toThrow();
    expect(() => parseScore("k", { type: "score", score: 4.5, probabilities: probs })).toThrow(/range/);
    expect(() => parseScore("k", { type: "score", score: 2, probabilities: { ...probs, "4": 0.6 } })).toThrow(/sum/);
  });

  it("fails loudly when Clef omits a requested answer", async () => {
    const ai: AiClient = {
      calls: [],
      async run<T>() {
        return { answers: {} } as T;
      },
    };
    await expect(scoreFits(ai, input(2, 2))).rejects.toThrow(/missing/);
  });
});

describe("shared guard and recovery", () => {
  const scripted = (proposals: Decision[]): DecisionMethodImpl => ({
    id: "llm_baseline",
    async decide() {
      return { proposal: proposals.shift()!, trace: {} };
    },
  });

  it("rejects a pick outside the eligible list, then accepts one recovery", async () => {
    const inp = input(3, 2);
    const res = await decideWithGuard(
      scripted([
        { kind: "recommend", restaurantId: "made-up-place", evidenceIds: [], assumptions: [], explanation: "x".repeat(20) },
        { kind: "recommend", restaurantId: "r01", evidenceIds: [], assumptions: [], explanation: "A fine pick for everyone." },
      ]),
      inp,
      { ai: fakeClef(), availabilitySeed: "seed", frozenAvailability: {} },
    );
    expect(res.records.map((r) => r.accepted)).toEqual([false, true]);
    expect(res.records[0]!.reason).toMatch(/not in eligibleRestaurants/);
    expect(res.outcome.kind).toBe("result");
  });

  it("gives up after two rejected proposals and keeps both raw proposals", async () => {
    const inp = input(2, 2);
    const clarify: Decision = { kind: "clarify", questions: [{ participantId: "a", topicId: "x", question: "?" }] };
    await expect(decideWithGuard(scripted([clarify, clarify]), inp, { ai: fakeClef(), availabilitySeed: "s" })).rejects.toSatisfy(
      (e: unknown) => e instanceof DecisionRejected && e.records.length === 2,
    );
  });
});

describe("baseline legality", () => {
  it("only allows clarification topics from the asked diner's own ambiguities, one per diner", () => {
    const g = group([
      diner("a", { ambiguities: [{ topicId: "a:budget_basis", kind: "budget_basis", term: "$30", relatesTo: null, source: src("$30") }] }),
      diner("b"),
    ]);
    const inp = { ...input(2, 2), group: g, allowClarify: true };
    const ok: Decision = { kind: "clarify", questions: [{ participantId: "a", topicId: "a:budget_basis", question: "Is $30 including tip?" }] };
    expect(illegalReason(inp, ok)).toBeNull();
    const wrongOwner: Decision = { kind: "clarify", questions: [{ participantId: "b", topicId: "a:budget_basis", question: "?" }] };
    expect(illegalReason(inp, wrongOwner)).toMatch(/not one of b's/);
    expect(illegalReason({ ...inp, allowClarify: false }, ok)).toMatch(/not allowed/);
  });

  it("forbids recommending when nothing is eligible", () => {
    const inp = input(1, 2, { phase: "FIXED_STATE" });
    const none = { ...inp, facts: inp.facts.map((f) => ({ ...f, feasible: false })) };
    expect(illegalReason(none, { kind: "recommend", restaurantId: "r00", evidenceIds: [], assumptions: [], explanation: "x".repeat(20) })).toMatch(/not allowed/);
  });
});
