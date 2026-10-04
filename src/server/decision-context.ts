import { profile } from "../shared/data";
import type { NormalizedDiner, NormalizedGroup } from "../shared/normalized";
import type { Restaurant } from "../shared/restaurant";
import { clockLabel } from "./hours";
import { type CandidateFacts, dinerHardSummary } from "./feasibility";
import { describeTravel } from "./travel";

export type DecisionPhase = "EVALUATING" | "REEVALUATING" | "FINALIZING" | "FIXED_STATE";

/**
 * Everything a decision method may see. Both methods receive the same
 * object; candidate and diner order are part of the input so experiment
 * permutations are reproducible.
 */
export type DecisionInput = {
  phase: DecisionPhase;
  group: NormalizedGroup;
  /** All evaluated candidates in candidate order. */
  facts: CandidateFacts[];
  restaurants: Restaurant[];
  allowClarify: boolean;
  allowHost: boolean;
};

export const eligible = (input: DecisionInput) => input.facts.filter((f) => f.feasible);

export function restaurantFor(input: DecisionInput, id: string): Restaurant {
  const r = input.restaurants.find((x) => x.id === id);
  if (!r) throw new Error(`unknown restaurant ${id}`);
  return r;
}

/** Compact, evidence-referenced candidate description shared by both methods. */
export function candidateView(input: DecisionInput, f: CandidateFacts) {
  const r = restaurantFor(input, f.restaurantId);
  return {
    id: r.id,
    name: r.name,
    neighborhood: `${r.neighborhood}, ${r.borough}`,
    cuisines: r.cuisines,
    priceTier: r.priceTier,
    estimatePerPerson: `$${r.mealEstimate.low}–$${r.mealEstimate.high} all-in (${r.mealEstimate.basis})`,
    sampleOrders: r.sampleOrders.map((o) => `${o.description}: $${o.foodOnlyPrice} before tax/tip`),
    atmosphere: r.atmosphere.map((a) => a.tag),
    dietaryOptions: r.menuOptions.map((o) => `${o.dietaryTag} (${o.verificationStatus}): ${o.description}`),
    allergyPolicy: r.allergyPolicy ? "published" : "none published",
    availability:
      f.availability.status === "reservable"
        ? `simulated reservable slots: ${f.availability.slots.map(clockLabel).join(", ")}`
        : f.availability.status === "walk_in"
          ? "walk-in (no simulated reservation)"
          : f.availability.status,
    travel: Object.fromEntries(Object.entries(f.travel).map(([pid, t]) => [pid, describeTravel(t)])),
    evidenceIds: [...new Set([...r.mealEstimate.evidenceIds, ...r.hours.evidenceIds])],
  };
}

export function dinerView(d: NormalizedDiner) {
  const p = profile(d.profileId);
  return {
    id: d.participantId,
    currentRequest: d.noResponse ? null : d.originalText,
    clarification: d.clarificationText,
    responded: !d.noResponse,
    hardRequirements: dinerHardSummary(d),
    softPreferences: d.soft.map((s) => `${s.direction} ${s.kind}: ${s.value} (${s.strength})`),
    openAmbiguities: d.ambiguities.map((a) => `${a.topicId} [${a.kind}]: "${a.term}"`),
    missing: d.missing,
    wantsSomewhereNew: d.noveltyRequested,
    startingPoint: d.origin.source === "default_meeting_area" ? "not given (assume meeting area)" : d.origin.label,
    tasteProfile: p ? `${p.label} — ${p.blurb}` : null,
    syntheticHistoryRanked: (p?.history ?? []).slice(0, 10).map((h) => `#${h.rank} ${h.name} (${h.cuisines.join("/")}, ${h.neighborhood})${h.note ? ` — ${h.note}` : ""}`),
  };
}

export function roomView(input: DecisionInput) {
  return {
    diningAt: input.group.diningAt,
    meetingArea: input.group.meetingArea.name,
    partySize: input.group.partySize,
  };
}

/** Summary of why candidates were excluded, so both methods can judge clarify vs no-match. */
export function exclusionSummary(input: DecisionInput) {
  const counts: Record<string, number> = {};
  for (const f of input.facts) {
    if (f.feasible) continue;
    for (const c of f.checks) {
      if (c.result === "pass") continue;
      const key = c.scope === "diner" ? `${c.participantId}:${c.type}:${c.result}` : `group:${c.type}:${c.result}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return { totalCandidates: input.facts.length, eligible: eligible(input).length, failedChecks: counts };
}
