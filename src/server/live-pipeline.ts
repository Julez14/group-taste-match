import type { DecisionMethod, RoomState } from "../shared/types";
import { decideWithGuard } from "./decide";
import type { DecisionInput } from "./decision-context";
import { evaluateAll } from "./feasibility";
import { cachedInterpreter, llmInterpreter, normalizeGroup } from "./interpret";
import { baselineMethod } from "./methods/baseline-method";
import { clefMethod } from "./methods/clef-method";
import type { DecisionMethodImpl } from "./methods/types";
import type { DecisionPipeline } from "./pipeline";
import { restaurants } from "./snapshot";

export const METHODS: Record<DecisionMethod, DecisionMethodImpl> = {
  clef: clefMethod,
  llm_baseline: baselineMethod,
};

export function decisionInputFor(state: RoomState, group: DecisionInput["group"]): DecisionInput {
  const all = restaurants();
  const phase = state.phase as DecisionInput["phase"];
  return {
    phase,
    group,
    facts: evaluateAll({ group, restaurants: all, availabilitySeed: state.id }),
    restaurants: all,
    allowClarify: phase === "EVALUATING" && !state.clarifyRoundUsed,
    allowHost: phase !== "FINALIZING" && !state.hostCallUsed,
  };
}

/** Live decision pipeline: shared interpretation → shared feasibility → method → shared guard. */
export function livePipeline(method: DecisionMethod): DecisionPipeline {
  return async ({ state, ai, trace, interpretCache }) => {
    const t0 = Date.now();
    const interpreter = interpretCache ? cachedInterpreter(llmInterpreter(ai), interpretCache) : llmInterpreter(ai);
    const group = await normalizeGroup(state, interpreter);
    trace("normalized", { ms: Date.now() - t0, group });
    const input = decisionInputFor(state, group);
    trace("feasibility", {
      eligible: input.facts.filter((f) => f.feasible).map((f) => f.restaurantId),
      rejected: input.facts.filter((f) => !f.feasible).map((f) => ({ id: f.restaurantId, failed: f.checks.filter((c) => c.result !== "pass") })),
    });
    const t1 = Date.now();
    const res = await decideWithGuard(METHODS[method], input, { ai, availabilitySeed: state.id });
    trace("decision", { method, ms: Date.now() - t1, records: res.records, methodTrace: res.trace });
    return res.outcome;
  };
}
