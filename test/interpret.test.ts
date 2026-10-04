import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { AiClient } from "../src/server/ai";
import { applyPatch } from "../src/server/clarify-patch";
import { type Clarifier, enforceBudgetBasis, fixtureClarifier, fixtureInterpreter, normalizeGroup } from "../src/server/interpret";
import { chatJson, SchemaError } from "../src/server/llm";
import { createRoom, join, start, submit } from "../src/shared/room-machine";
import { DEFAULT_TIMERS, type RoomState } from "../src/shared/types";

function fakeAi(replies: string[]): AiClient & { seen: unknown[] } {
  const seen: unknown[] = [];
  return {
    calls: [],
    seen,
    async run<T>(_model: string, input: unknown) {
      seen.push(input);
      const content = replies.shift();
      if (content === undefined) throw new Error("no more replies");
      return { choices: [{ message: { content } }] } as T;
    },
  };
}

describe("chatJson", () => {
  const schema = z.object({ ok: z.boolean(), n: z.number() });

  it("returns valid JSON without repair", async () => {
    const ai = fakeAi(['{"ok":true,"n":3}']);
    const r = await chatJson(ai, { system: "s", user: "u", schema, purpose: "t" });
    expect(r).toMatchObject({ value: { ok: true, n: 3 }, repaired: false });
  });

  it("allows exactly one repair attempt with the validation errors", async () => {
    const ai = fakeAi(['{"ok":"yes"}', '```json\n{"ok":true,"n":1}\n```']);
    const r = await chatJson(ai, { system: "s", user: "u", schema, purpose: "t" });
    expect(r.repaired).toBe(true);
    const second = ai.seen[1] as { messages: { content: string }[] };
    expect(second.messages.at(-1)?.content).toMatch(/did not validate/);
  });

  it("fails after a second invalid response", async () => {
    const ai = fakeAi(["nope", '{"ok":1}']);
    await expect(chatJson(ai, { system: "s", user: "u", schema, purpose: "t" })).rejects.toBeInstanceOf(SchemaError);
  });
});

function room(): RoomState {
  let s = createRoom({
    id: "r",
    host: { id: "a", name: "Ana", profileId: "plant-forward", startAreaId: null, startLatLng: null },
    config: { diningAt: "2026-10-06T19:30:00-04:00", meetingAreaId: "union-square", timers: DEFAULT_TIMERS },
    method: "clef",
    now: 0,
  });
  s = join(s, { id: "b", name: "Ben", profileId: "noodle-regular", startAreaId: "astoria", startLatLng: null }, 0);
  s = join(s, { id: "c", name: "Cy", profileId: "spice-seeker", startAreaId: null, startLatLng: { lat: 40.7171, lng: -73.9566 } }, 0);
  s = start(s, "a", 0);
  return s;
}

describe("normalizeGroup", () => {
  it("resolves origins: stated area, geolocation, else the disclosed meeting-area default", async () => {
    let s = room();
    s = submit(s, "a", { kind: "initial", text: "Vegetarian please, max $40 including tip", source: "typed", idempotencyKey: "k1" }, 1);
    s = submit(s, "b", { kind: "initial", text: "ramen, around $25", source: "typed", idempotencyKey: "k2" }, 1);
    const g = await normalizeGroup(s, { interpret: fixtureInterpreter, clarify: fixtureClarifier });
    const [a, b, c] = g.diners;
    expect(a!.origin.source).toBe("default_meeting_area");
    expect(b!.origin).toMatchObject({ source: "stated_area", label: "Astoria" });
    expect(c!.origin.source).toBe("geolocation");
    expect(c!.noResponse).toBe(true);
    expect(c!.hard).toEqual([]);
    expect(g.partySize).toBe(3);
  });

  it("namespaces ids by owner and keeps ambiguity links", async () => {
    let s = room();
    s = submit(s, "a", { kind: "initial", text: "max $35", source: "typed", idempotencyKey: "k1" }, 1);
    const g = await normalizeGroup(s, { interpret: fixtureInterpreter, clarify: fixtureClarifier });
    const a = g.diners[0]!;
    expect(a.hard[0]!.id).toBe("a:h1");
    expect(a.ambiguities[0]).toMatchObject({ topicId: "a:budget_basis", relatesTo: "a:h1" });
  });

  it("applies a clarification only for the diner who was asked, as an audited patch", async () => {
    const seen: { question: string; answer: string }[] = [];
    const spy: Clarifier = async (args) => {
      seen.push({ question: args.question, answer: args.answer });
      return fixtureClarifier(args);
    };
    let s = room();
    for (const id of ["a", "b", "c"]) s = submit(s, id, { kind: "initial", text: "max $30", source: "typed", idempotencyKey: id }, 1);
    s = {
      ...s,
      phase: "CLARIFYING",
      clarification: { questions: [{ participantId: "b", topicId: "b:budget_basis", question: "Is $30 including tip?" }], askedAt: 2 },
      deadline: 100,
    };
    s = submit(s, "b", { kind: "clarify", text: "Yes, all in", source: "typed", idempotencyKey: "c" }, 3);
    const g = await normalizeGroup(s, { interpret: fixtureInterpreter, clarify: spy });
    expect(seen).toEqual([{ question: "Is $30 including tip?", answer: "Yes, all in" }]);
    const b = g.diners.find((d) => d.participantId === "b")!;
    expect(b.hard[0]).toMatchObject({ type: "budget_max", basis: "all_in", source: { from: "clarification" } });
    expect(b.ambiguities.some((a) => a.kind === "budget_basis")).toBe(false);
    const a = g.diners.find((d) => d.participantId === "a")!;
    expect(a.hard[0]).toMatchObject({ basis: "unspecified" });
    expect(g.clarificationLog.b?.[0]).toMatchObject({ op: "set_budget_basis", applied: true });
  });
});

describe("budget basis safeguard", () => {
  const withBudget = (basis: "all_in" | "food_only" | "unspecified") => ({
    hard: [{ id: "h1", type: "budget_max" as const, amount: 60, basis, source: { text: "max $60", status: "stated" as const, from: "initial" as const } }],
    soft: [],
    ambiguities: [],
    missing: [],
    noveltyRequested: false,
    originAreaId: null,
    ignoredInstructions: [],
  });

  it("downgrades an unsupported basis to unspecified and adds a budget_basis ambiguity", () => {
    const r = enforceBudgetBasis(withBudget("food_only"), "Vegetarian, max $60");
    expect(r.hard[0]).toMatchObject({ basis: "unspecified" });
    expect(r.ambiguities).toEqual([expect.objectContaining({ kind: "budget_basis", relatesTo: "h1" })]);
  });

  it("keeps a basis the diner actually stated", () => {
    expect(enforceBudgetBasis(withBudget("all_in"), "max $60 including tip").hard[0]).toMatchObject({ basis: "all_in" });
    expect(enforceBudgetBasis(withBudget("food_only"), "$60 before tax and tip").hard[0]).toMatchObject({ basis: "food_only" });
  });
});

describe("clarification patches", () => {
  const base = {
    hard: [{ id: "h1", type: "budget_max" as const, amount: 40, basis: "unspecified" as const, source: { text: "max $40", status: "stated" as const, from: "initial" as const } }],
    soft: [{ id: "s1", kind: "travel" as const, direction: "want" as const, strength: "mild" as const, value: "not too far", source: { text: "not too far", status: "stated" as const, from: "initial" as const } }],
    ambiguities: [{ topicId: "travel_limit", kind: "travel_limit" as const, term: "not too far", relatesTo: "s1", source: { text: "not too far", status: "stated" as const, from: "initial" as const } }],
    missing: [],
    noveltyRequested: false,
    originAreaId: null,
    ignoredInstructions: [],
  };
  const change = { targetId: null, amount: null, basis: null, severity: null, tag: null, quote: "q" };

  it("adds a confirmed travel limit and resolves the topic", () => {
    const r = applyPatch(base, { resolved: true, changes: [{ ...change, op: "add_travel_limit", amount: 25, quote: "under 25 minutes" }] }, "travel_limit");
    expect(r.interp.hard.find((h) => h.type === "travel_max_minutes")).toMatchObject({ minutes: 25, source: { from: "clarification", text: "under 25 minutes" } });
    expect(r.interp.ambiguities).toEqual([]);
  });

  it("keeps requirements and the open topic when the answer resolves nothing", () => {
    const r = applyPatch(base, { resolved: false, changes: [] }, "travel_limit");
    expect(r.interp.hard).toEqual(base.hard);
    expect(r.interp.ambiguities).toHaveLength(1);
  });

  it("relaxes a budget only through an explicit owner change", () => {
    const r = applyPatch(base, { resolved: true, changes: [{ ...change, op: "budget_to_soft", quote: "it's flexible" }] }, null);
    expect(r.interp.hard).toEqual([]);
    expect(r.interp.soft.find((s) => s.kind === "price")?.source.from).toBe("clarification");
  });
});
