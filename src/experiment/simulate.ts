import type { NormalizedGroup } from "../shared/normalized";
import type { Restaurant } from "../shared/restaurant";
import {
  applyOutcome,
  createRoom,
  isProcessingPhase,
  join,
  type Outcome,
  start,
  submit,
  tick,
} from "../shared/room-machine";
import type { DecisionMethod, RoomState } from "../shared/types";
import type { AiCallRecord, AiClient } from "../server/ai";
import type { Availability } from "../server/availability";
import { type DecisionRejected, decideWithGuard, type GuardRecord } from "../server/decide";
import type { DecisionInput } from "../server/decision-context";
import { evaluateAll } from "../server/feasibility";
import { cachedClarifier, cachedInterpreter, type InterpretCache, llmClarifier, llmInterpreter, normalizeGroup } from "../server/interpret";
import { METHODS } from "../server/live-pipeline";
import type { Scenario } from "./scenario";

export type PhaseRecord = {
  phase: string;
  normalizeMs: number;
  decisionMs: number;
  totalMs: number;
  outcomeKind: Outcome["kind"] | "error";
  records: GuardRecord[];
  methodTrace: Record<string, unknown>;
  aiCalls: AiCallRecord[];
  error?: string;
};

export type RunRecord = {
  runId: string;
  track: "fixed" | "flow";
  scenarioId: string;
  split: "dev" | "test";
  method: DecisionMethod;
  repeat: number;
  permutation: { candidateOrder: string[]; dinerOrder: string[] } | null;
  startedAt: string;
  ok: boolean;
  error: string | null;
  outcome: { kind: "result" | "no_match"; restaurantId: string | null; explanation: string | null; assumptions: string[]; reasonCodes: string[] } | null;
  phases: PhaseRecord[];
  questions: { participantId: string; topicId: string; kind: string | null; question: string; answered: boolean }[];
  hostCall: { question: string; options: { id: string; label: string }[]; answered: boolean; answer: string | null } | null;
  aiCalls: AiCallRecord[];
};

function trackingClient(inner: AiClient): AiClient & { drain(): AiCallRecord[] } {
  let mark = 0;
  return {
    get calls() {
      return inner.calls;
    },
    run: inner.run.bind(inner),
    drain() {
      const out = inner.calls.slice(mark);
      mark = inner.calls.length;
      return out;
    },
  };
}

function memoryCache(): InterpretCache {
  const m = new Map<string, unknown>();
  return { get: (k) => m.get(k) ?? null, put: (k, v) => void m.set(k, v), inflight: new Map() };
}

/** Seeded Fisher–Yates for reproducible candidate/diner order permutations. */
export function seededShuffle<T>(items: T[], seed: string): T[] {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const rand = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 2 ** 32;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function roomFor(s: Scenario, method: DecisionMethod, t0: number): RoomState {
  const host = s.diners.find((d) => d.isHost) ?? s.diners[0]!;
  let state = createRoom({
    id: `${s.id}-${method}`,
    host: { id: host.id, name: host.name, profileId: host.profileId, startAreaId: host.startAreaId, startLatLng: null },
    config: { diningAt: s.diningAt, meetingAreaId: s.meetingAreaId, timers: { initialSec: 90, clarifySec: 45, hostSec: 30 } },
    method,
    now: t0,
  });
  for (const d of s.diners) {
    if (d.id === host.id) continue;
    state = join(state, { id: d.id, name: d.name, profileId: d.profileId, startAreaId: d.startAreaId, startLatLng: null }, t0);
  }
  return start(state, host.id, t0);
}

function outcomeSummary(o: Outcome): RunRecord["outcome"] {
  if (o.kind === "result") {
    return { kind: "result", restaurantId: o.card.restaurantId, explanation: o.card.explanation, assumptions: o.card.assumptions, reasonCodes: [] };
  }
  if (o.kind === "no_match") return { kind: "no_match", restaurantId: null, explanation: null, assumptions: [], reasonCodes: o.noMatch.reasonCodes };
  return null;
}

function hostChoice(s: Scenario, options: { id: string; label: string }[]): { choiceId?: string; text: string } | null {
  if (!s.host.priority) return null;
  const direct = options.find((o) => o.id === s.host.priority);
  if (direct) return { choiceId: direct.id, text: "" };
  const keyword = s.host.priority === "shorter_trip" ? /trip|short|close|near|travel|distance/i : /match|taste|vibe|food|prefer|fit|atmosphere|asked/i;
  const byLabel = options.find((o) => keyword.test(o.label));
  if (byLabel) return { choiceId: byLabel.id, text: "" };
  return { text: s.host.text ?? (s.host.priority === "shorter_trip" ? "Let's keep the trip short for everyone." : "Go with the best match for what people asked for.") };
}

/**
 * Complete product flow for one scenario, using the real state machine and
 * pipeline functions. The simulator answers only from prewritten facts.
 */
export async function runFullFlow(args: {
  scenario: Scenario;
  method: DecisionMethod;
  ai: AiClient;
  restaurants: Restaurant[];
  frozen: Record<string, Availability>;
}): Promise<RunRecord> {
  const { scenario: s, method, restaurants, frozen } = args;
  const ai = trackingClient(args.ai);
  const cache = memoryCache();
  const interpreters = { interpret: cachedInterpreter(llmInterpreter(ai), cache), clarify: cachedClarifier(llmClarifier(ai), cache) };
  let clock = Date.parse("2026-10-04T12:00:00Z");
  let state = roomFor(s, method, clock);
  for (const d of s.diners) {
    if (d.text) state = submit(state, d.id, { kind: "initial", text: d.text, source: "typed", idempotencyKey: `${d.id}-i` }, (clock += 1000));
  }
  state = tick(state, (clock = state.deadline ?? clock));

  const record: RunRecord = {
    runId: `flow:${s.id}:${method}`,
    track: "flow",
    scenarioId: s.id,
    split: s.split,
    method,
    repeat: 0,
    permutation: null,
    startedAt: new Date().toISOString(),
    ok: false,
    error: null,
    outcome: null,
    phases: [],
    questions: [],
    hostCall: null,
    aiCalls: [],
  };

  for (let guard = 0; guard < 6 && isProcessingPhase(state.phase); guard++) {
    const phase = state.phase;
    const t0 = Date.now();
    let group: NormalizedGroup;
    try {
      group = await normalizeGroup(state, interpreters);
    } catch (e) {
      record.phases.push({ phase, normalizeMs: Date.now() - t0, decisionMs: 0, totalMs: Date.now() - t0, outcomeKind: "error", records: [], methodTrace: {}, aiCalls: ai.drain(), error: (e as Error).message });
      record.error = `normalize:${(e as Error).message}`;
      break;
    }
    const t1 = Date.now();
    const input: DecisionInput = {
      phase: phase as DecisionInput["phase"],
      group,
      facts: evaluateAll({ group, restaurants, availabilitySeed: "frozen", frozenAvailability: frozen }),
      restaurants,
      allowClarify: phase === "EVALUATING" && !state.clarifyRoundUsed,
      allowHost: phase !== "FINALIZING" && !state.hostCallUsed,
    };
    try {
      const res = await decideWithGuard(METHODS[method], input, { ai, availabilitySeed: "frozen", frozenAvailability: frozen });
      record.phases.push({ phase, normalizeMs: t1 - t0, decisionMs: Date.now() - t1, totalMs: Date.now() - t0, outcomeKind: res.outcome.kind, records: res.records, methodTrace: res.trace, aiCalls: ai.drain() });
      state = applyOutcome(state, res.outcome, state.evaluationSeq, (clock += 1000));
    } catch (e) {
      const rejected = e as DecisionRejected;
      record.phases.push({
        phase,
        normalizeMs: t1 - t0,
        decisionMs: Date.now() - t1,
        totalMs: Date.now() - t0,
        outcomeKind: "error",
        records: rejected.records ?? [],
        methodTrace: {},
        aiCalls: ai.drain(),
        error: (e as Error).message,
      });
      record.error = `decide:${(e as Error).message}`;
      break;
    }

    if (state.phase === "CLARIFYING") {
      for (const q of state.clarification?.questions ?? []) {
        const diner = s.diners.find((d) => d.id === q.participantId)!;
        const kind = group.diners.find((d) => d.participantId === q.participantId)?.ambiguities.find((a) => a.topicId === q.topicId)?.kind ?? null;
        const fact = kind ? diner.facts[kind] : undefined;
        record.questions.push({ participantId: q.participantId, topicId: q.topicId, kind, question: q.question, answered: Boolean(fact) });
        if (fact) state = submit(state, q.participantId, { kind: "clarify", text: fact, source: "typed", idempotencyKey: `${q.participantId}-c` }, (clock += 1000));
      }
      if (state.phase === "CLARIFYING") state = tick(state, (clock = state.deadline!));
    }
    if (state.phase === "HOST_FINAL_CALL") {
      const hc = state.hostCall!;
      const answer = hostChoice(s, hc.options);
      record.hostCall = { question: hc.question, options: hc.options, answered: Boolean(answer), answer: answer ? (answer.choiceId ?? answer.text) : null };
      if (answer) {
        state = submit(
          state,
          state.hostId,
          { kind: "host", text: answer.text, source: "typed", idempotencyKey: "host", ...(answer.choiceId ? { choiceId: answer.choiceId } : {}) },
          (clock += 1000),
        );
      } else state = tick(state, (clock = state.deadline!));
    }
  }
  record.aiCalls = record.phases.flatMap((p) => p.aiCalls);
  if (state.phase === "RESULT" && state.result) {
    record.ok = true;
    record.outcome = outcomeSummary({ kind: "result", card: state.result });
  } else if (state.phase === "NO_FEASIBLE_MATCH" && state.noMatch) {
    record.ok = true;
    record.outcome = outcomeSummary({ kind: "no_match", noMatch: state.noMatch });
  }
  return record;
}

/** Normalize a scenario once, after truthful clarification of every listed fact (fixed-state freeze). */
export async function freezeNormalized(args: { scenario: Scenario; ai: AiClient }): Promise<NormalizedGroup> {
  const { scenario: s } = args;
  const cache = memoryCache();
  const interpreters = { interpret: cachedInterpreter(llmInterpreter(args.ai), cache), clarify: cachedClarifier(llmClarifier(args.ai), cache) };
  let state = roomFor(s, "clef", 0);
  for (const d of s.diners) if (d.text) state = submit(state, d.id, { kind: "initial", text: d.text, source: "typed", idempotencyKey: `${d.id}-i` }, 1);
  state = tick(state, state.deadline!);
  const withFacts = s.diners.filter((d) => d.text && Object.keys(d.facts).length);
  if (withFacts.length) {
    state = {
      ...state,
      phase: "CLARIFYING",
      deadline: 10_000_000,
      clarification: {
        askedAt: 2,
        questions: withFacts.map((d) => ({ participantId: d.id, topicId: "supplied", question: `Could you clarify: ${Object.keys(d.facts).join(", ").replace(/_/g, " ")}?` })),
      },
    };
    for (const d of withFacts) {
      state = submit(state, d.id, { kind: "clarify", text: Object.values(d.facts).join(" "), source: "typed", idempotencyKey: `${d.id}-c` }, 3);
    }
  }
  const { clarificationLog: _log, ...group } = await normalizeGroup(state, interpreters);
  return group;
}

/** Fixed-state decision: identical frozen input for both methods, no extra questions. */
export async function runFixedState(args: {
  scenario: Scenario;
  method: DecisionMethod;
  repeat: number;
  frozenGroup: NormalizedGroup;
  ai: AiClient;
  restaurants: Restaurant[];
  frozen: Record<string, Availability>;
}): Promise<RunRecord> {
  const { scenario: s, method, repeat, restaurants, frozen } = args;
  const ai = trackingClient(args.ai);
  const candidateOrder = seededShuffle(restaurants.map((r) => r.id), `${s.id}:cand:${repeat}`);
  const dinerOrder = seededShuffle(args.frozenGroup.diners.map((d) => d.participantId), `${s.id}:diner:${repeat}`);
  const group: NormalizedGroup = {
    ...args.frozenGroup,
    diners: dinerOrder.map((id) => args.frozenGroup.diners.find((d) => d.participantId === id)!),
  };
  const ordered = candidateOrder.map((id) => restaurants.find((r) => r.id === id)!);
  const input: DecisionInput = {
    phase: "FIXED_STATE",
    group,
    facts: evaluateAll({ group, restaurants: ordered, availabilitySeed: "frozen", frozenAvailability: frozen }),
    restaurants: ordered,
    allowClarify: false,
    allowHost: false,
  };
  const record: RunRecord = {
    runId: `fixed:${s.id}:${method}:${repeat}`,
    track: "fixed",
    scenarioId: s.id,
    split: s.split,
    method,
    repeat,
    permutation: { candidateOrder, dinerOrder },
    startedAt: new Date().toISOString(),
    ok: false,
    error: null,
    outcome: null,
    phases: [],
    questions: [],
    hostCall: null,
    aiCalls: [],
  };
  const t0 = Date.now();
  try {
    const res = await decideWithGuard(METHODS[method], input, { ai, availabilitySeed: "frozen", frozenAvailability: frozen });
    record.phases.push({ phase: "FIXED_STATE", normalizeMs: 0, decisionMs: Date.now() - t0, totalMs: Date.now() - t0, outcomeKind: res.outcome.kind, records: res.records, methodTrace: res.trace, aiCalls: ai.drain() });
    record.ok = res.outcome.kind === "result" || res.outcome.kind === "no_match";
    record.outcome = outcomeSummary(res.outcome);
  } catch (e) {
    record.phases.push({
      phase: "FIXED_STATE",
      normalizeMs: 0,
      decisionMs: Date.now() - t0,
      totalMs: Date.now() - t0,
      outcomeKind: "error",
      records: (e as DecisionRejected).records ?? [],
      methodTrace: {},
      aiCalls: ai.drain(),
      error: (e as Error).message,
    });
    record.error = (e as Error).message;
  }
  record.aiCalls = record.phases.flatMap((p) => p.aiCalls);
  return record;
}

