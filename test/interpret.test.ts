import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { AiClient } from "../src/server/ai";
import { fixtureInterpreter, type Interpreter, normalizeGroup } from "../src/server/interpret";
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
    const g = await normalizeGroup(s, fixtureInterpreter);
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
    const g = await normalizeGroup(s, fixtureInterpreter);
    const a = g.diners[0]!;
    expect(a.hard[0]!.id).toBe("a:h1");
    expect(a.ambiguities[0]).toMatchObject({ topicId: "a:budget_basis", relatesTo: "a:h1" });
  });

  it("passes the clarification question and answer only for the diner who was asked", async () => {
    const seen: { clarification: unknown }[] = [];
    const spy: Interpreter = async (args) => {
      seen.push({ clarification: args.clarification });
      return fixtureInterpreter(args);
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
    await normalizeGroup(s, spy);
    expect(seen.filter((x) => x.clarification)).toEqual([{ clarification: { question: "Is $30 including tip?", answer: "Yes, all in" } }]);
  });
});
