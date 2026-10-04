import { meetingArea } from "../shared/data";
import type { HardConstraint, NormalizedDiner, NormalizedGroup } from "../shared/normalized";
import type { Restaurant } from "../shared/restaurant";
import { type Availability, simulateAvailability } from "../server/availability";
import { type CandidateFacts, evaluateAll, evaluateCandidate } from "../server/feasibility";
import type { Scenario } from "./scenario";

export const AVAILABILITY_SEED_PREFIX = "exp-v1";

export function frozenAvailabilityFor(s: Scenario, restaurants: Restaurant[]): Record<string, Availability> {
  return Object.fromEntries(
    restaurants.map((r) => [r.id, simulateAvailability(r, s.diningAt, s.diners.length, `${AVAILABILITY_SEED_PREFIX}:${s.id}`)]),
  );
}

function trueHard(s: Scenario, dinerId: string): HardConstraint[] {
  const d = s.diners.find((x) => x.id === dinerId)!;
  return d.truth.hard.map((t, i) => {
    const base = { id: `${dinerId}:truth${i}`, source: { text: "ground truth", status: "stated" as const, from: "initial" as const } };
    switch (t.type) {
      case "budget_max":
        return { ...base, type: "budget_max", amount: t.amount, basis: t.basis };
      case "dietary":
        return { ...base, type: "dietary", tag: t.tag, allergen: t.allergen, severity: t.severity };
      case "exclude_cuisine":
        return { ...base, type: "exclude_cuisine", cuisine: t.cuisine };
      case "travel_max_minutes":
        return { ...base, type: "travel_max_minutes", minutes: t.minutes };
      case "reservation_required":
        return { ...base, type: "reservation_required" };
      case "exclude_restaurant":
        return { ...base, type: "exclude_restaurant", restaurantId: t.restaurantId };
    }
  });
}

/** A group built only from prelabeled truth, independent of any model interpretation. */
export function truthGroup(s: Scenario): NormalizedGroup {
  const area = meetingArea(s.meetingAreaId)!;
  const diners: NormalizedDiner[] = s.diners.map((d) => {
    const start = d.startAreaId ? meetingArea(d.startAreaId) : undefined;
    return {
      participantId: d.id,
      name: d.name,
      profileId: d.profileId,
      isHost: d.isHost,
      originalText: d.text,
      clarificationText: null,
      origin: start
        ? { lat: start.lat, lng: start.lng, label: start.name, source: "stated_area" }
        : { lat: area.lat, lng: area.lng, label: area.name, source: "default_meeting_area" },
      noResponse: d.text === null,
      hard: trueHard(s, d.id),
      soft: [],
      ambiguities: [],
      missing: [],
      noveltyRequested: false,
      originAreaId: d.startAreaId,
      ignoredInstructions: [],
    };
  });
  return {
    diningAt: s.diningAt,
    meetingArea: { id: area.id, name: area.name, lat: area.lat, lng: area.lng },
    partySize: s.diners.length,
    diners,
    hostAnswer: null,
  };
}

export type TruthLabels = {
  feasibleIds: string[];
  expectedNoMatch: boolean;
};

export function truthLabels(s: Scenario, restaurants: Restaurant[], frozen: Record<string, Availability>): TruthLabels {
  const facts = evaluateAll({ group: truthGroup(s), restaurants, availabilitySeed: "unused", frozenAvailability: frozen });
  const feasibleIds = facts.filter((f) => f.feasible).map((f) => f.restaurantId);
  return { feasibleIds, expectedNoMatch: feasibleIds.length === 0 };
}

export type Violation = { type: string; participantId: string | null; result: string; note: string };

/** Independent check of a selected restaurant against ground truth (not the model's reading). */
export function truthViolations(s: Scenario, restaurant: Restaurant | undefined, frozen: Record<string, Availability>): { facts: CandidateFacts | null; violations: Violation[] } {
  if (!restaurant) return { facts: null, violations: [{ type: "unknown_restaurant", participantId: null, result: "fail", note: "not in snapshot" }] };
  const facts = evaluateCandidate(restaurant, { group: truthGroup(s), restaurants: [], availabilitySeed: "unused", frozenAvailability: frozen });
  const violations = facts.checks
    .filter((c) => c.result !== "pass")
    .map((c) => ({ type: c.type, participantId: c.participantId, result: c.result, note: c.note }));
  return { facts, violations };
}
