import type { Ambiguity, HardConstraint, NormalizedDiner, NormalizedGroup } from "../shared/normalized";
import type { Restaurant } from "../shared/restaurant";
import type { Availability } from "./availability";
import { evaluateAll } from "./feasibility";

export const CLARIFY_POLICY = {
  version: "clarify-v1",
  /** With this many verified options or more, an extra question isn't worth the diner's time. */
  enoughOptions: 4,
  /** A soft→hard reading matters when it would remove at least this share of options. */
  materialShrink: 0.3,
};

export type Topic = {
  participantId: string;
  topicId: string;
  kind: Ambiguity["kind"];
  term: string;
  /** Plain description of the alternative reading, for Clef and the question writer. */
  alternative: string;
  feasibleDefault: number;
  feasibleAlternative: number;
};

/** Apply the alternative reading of one ambiguity to a copy of the diner. */
function alternativeReading(d: NormalizedDiner, a: Ambiguity): { diner: NormalizedDiner; description: string } | null {
  const related = a.relatesTo;
  const src = { text: a.source.text, status: "inferred" as const, from: "default" as const };
  switch (a.kind) {
    case "budget_basis": {
      const hard = d.hard.map((h) => (h.id === related && h.type === "budget_max" ? { ...h, basis: "food_only" as const } : h));
      const changed = hard.some((h, i) => h !== d.hard[i]);
      return changed ? { diner: { ...d, hard }, description: "the budget excludes tax and tip (food only)" } : null;
    }
    case "budget_firmness": {
      const soft = d.soft.find((s) => s.id === related);
      const amount = Number(/\$?(\d{2,4})/.exec(soft?.value ?? a.term)?.[1]);
      if (!amount) return null;
      const cap: HardConstraint = { id: `${d.participantId}:alt-cap`, type: "budget_max", amount, basis: "all_in", source: src };
      return { diner: { ...d, hard: [...d.hard, cap] }, description: `$${amount} is a firm all-in limit` };
    }
    case "dietary_severity": {
      const hard = d.hard.map((h) => (h.id === related && h.type === "dietary" ? { ...h, severity: "allergy" as const } : h));
      const changed = hard.some((h, i) => h !== d.hard[i]);
      return changed ? { diner: { ...d, hard }, description: "the dietary need is an allergy" } : null;
    }
    case "travel_limit": {
      const cap: HardConstraint = { id: `${d.participantId}:alt-travel`, type: "travel_max_minutes", minutes: 30, source: src };
      return { diner: { ...d, hard: [...d.hard, cap] }, description: "they won't travel more than 30 minutes" };
    }
    default:
      return null;
  }
}

/**
 * Ambiguities whose plausible readings would change which restaurants are
 * feasible in a way that matters. Pure application code: no model calls.
 */
export function consequentialTopics(args: {
  group: NormalizedGroup;
  restaurants: Restaurant[];
  availabilitySeed: string;
  frozenAvailability?: Record<string, Availability>;
}): Topic[] {
  const base = evaluateAll({ ...args });
  const baseIds = new Set(base.filter((f) => f.feasible).map((f) => f.restaurantId));
  const topics: Topic[] = [];
  for (const d of args.group.diners) {
    for (const a of d.ambiguities) {
      const alt = alternativeReading(d, a);
      if (!alt) continue;
      const group = { ...args.group, diners: args.group.diners.map((x) => (x.participantId === d.participantId ? alt.diner : x)) };
      const altIds = new Set(evaluateAll({ ...args, group }).filter((f) => f.feasible).map((f) => f.restaurantId));
      const sameSet = altIds.size === baseIds.size && [...altIds].every((id) => baseIds.has(id));
      if (sameSet) continue;
      const loosens = altIds.size > baseIds.size;
      const matters = loosens
        ? baseIds.size < CLARIFY_POLICY.enoughOptions
        : altIds.size > 0 && (baseIds.size - altIds.size) / Math.max(1, baseIds.size) >= CLARIFY_POLICY.materialShrink;
      // A possible allergy always matters when it changes the set: safety outranks convenience.
      if (!matters && a.kind !== "dietary_severity") continue;
      topics.push({
        participantId: d.participantId,
        topicId: a.topicId,
        kind: a.kind,
        term: a.term,
        alternative: alt.description,
        feasibleDefault: baseIds.size,
        feasibleAlternative: altIds.size,
      });
    }
  }
  return topics;
}
