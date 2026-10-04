import type { Decision } from "../shared/decision";
import type { Outcome } from "../shared/room-machine";
import { buildCard, noMatchFromFacts } from "./card";
import { type DecisionInput, restaurantFor } from "./decision-context";
import { guardRecommendation } from "./feasibility";
import { illegalReason } from "./methods/baseline-method";
import type { DecisionMethodImpl, MethodDeps } from "./methods/types";

export type GuardRecord = { attempt: number; proposal: Decision; accepted: boolean; reason: string | null };

export class DecisionRejected extends Error {
  constructor(
    message: string,
    readonly records: GuardRecord[],
  ) {
    super(message);
  }
}

/** Shared enforcement for every method: legality, then the independent hard-constraint guard. */
export function finalize(input: DecisionInput, deps: Pick<MethodDeps, "availabilitySeed" | "frozenAvailability">, proposal: Decision): { outcome: Outcome } | { rejected: string } {
  const illegal = illegalReason(input, proposal);
  if (illegal) return { rejected: `illegal:${illegal}` };
  switch (proposal.kind) {
    case "recommend": {
      const g = guardRecommendation(proposal.restaurantId, {
        group: input.group,
        restaurants: input.restaurants,
        availabilitySeed: deps.availabilitySeed,
        ...(deps.frozenAvailability ? { frozenAvailability: deps.frozenAvailability } : {}),
      });
      if (!g.ok) return { rejected: g.reason };
      const card = buildCard({
        restaurant: restaurantFor(input, proposal.restaurantId),
        facts: g.facts,
        group: input.group,
        explanation: proposal.explanation,
        extraAssumptions: proposal.assumptions,
      });
      return { outcome: { kind: "result", card } };
    }
    case "clarify":
      return { outcome: { kind: "clarify", questions: proposal.questions } };
    case "host_final_call":
      return { outcome: { kind: "host_final_call", hostCall: { topicId: proposal.topicId, question: proposal.question, options: proposal.options } } };
    case "no_feasible_match":
      return { outcome: { kind: "no_match", noMatch: noMatchFromFacts(input.facts, proposal.reasonCodes) } };
  }
}

/**
 * Run a method, enforce the shared guard, and allow one bounded recovery
 * attempt with the rejection reason. Raw proposals and rejections are kept.
 */
export async function decideWithGuard(
  method: DecisionMethodImpl,
  input: DecisionInput,
  deps: MethodDeps,
): Promise<{ outcome: Outcome; proposal: Decision; records: GuardRecord[]; trace: Record<string, unknown> }> {
  const records: GuardRecord[] = [];
  let feedback: string | undefined;
  let lastTrace: Record<string, unknown> = {};
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { proposal, trace } = await method.decide(input, { ...deps, ...(feedback ? { feedback } : {}) });
    lastTrace = trace;
    const result = finalize(input, deps, proposal);
    if ("outcome" in result) {
      records.push({ attempt, proposal, accepted: true, reason: null });
      return { outcome: result.outcome, proposal, records, trace: lastTrace };
    }
    records.push({ attempt, proposal, accepted: false, reason: result.rejected });
    feedback = `Your previous proposal was rejected: ${result.rejected}. Choose a legal action.`;
  }
  throw new DecisionRejected(`${method.id} proposal rejected twice`, records);
}
