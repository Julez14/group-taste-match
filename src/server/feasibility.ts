import type { HardConstraint, NormalizedDiner, NormalizedGroup } from "../shared/normalized";
import type { Restaurant } from "../shared/restaurant";
import { type Availability, simulateAvailability } from "./availability";
import { openAt } from "./hours";
import { estimateTravel, type TravelEstimate } from "./travel";

export const NYC_SALES_TAX = 0.08875;
export const DEFAULT_TIP = 0.2;
export const allInFromFood = (food: number) => food * (1 + NYC_SALES_TAX + DEFAULT_TIP);

export type CheckResult = "pass" | "fail" | "unverified";

export type Check = {
  scope: "group" | "diner";
  participantId: string | null;
  constraintId: string | null;
  type: HardConstraint["type"] | "open_hours" | "availability";
  result: CheckResult;
  note: string;
};

export type CandidateFacts = {
  restaurantId: string;
  feasible: boolean;
  checks: Check[];
  availability: Availability;
  travel: Record<string, TravelEstimate>;
  /** Highest upper-bound trip in minutes across diners. */
  maxTravelHigh: number;
  /** Budget notes that should be disclosed as assumptions if selected. */
  assumptions: string[];
};

export type FeasibilityContext = {
  group: NormalizedGroup;
  restaurants: Restaurant[];
  availabilitySeed: string;
  /** Frozen availability (experiment fixtures). Overrides simulation when present. */
  frozenAvailability?: Record<string, Availability>;
};

function checkBudget(c: Extract<HardConstraint, { type: "budget_max" }>, r: Restaurant): { result: CheckResult; note: string; assumption?: string } {
  const est = r.mealEstimate;
  const allInLow = est.low;
  const allInHigh = est.high;
  const foodLow = est.foodOnlyLow;
  const foodHigh = est.foodOnlyHigh;
  // A specific cheaper order can make a cap credible when the menu prices it.
  const cheapestOrder = r.sampleOrders.length ? Math.min(...r.sampleOrders.map((o) => o.foodOnlyPrice)) : null;

  const judge = (cap: number, low: number, high: number, orderPrice: number | null, label: string) => {
    if (high <= cap) return { result: "pass" as const, note: `${label} estimate $${low}–$${high} fits $${cap}` };
    if (orderPrice !== null && orderPrice <= cap) {
      return {
        result: "pass" as const,
        note: `${label} typical order $${Math.round(orderPrice)} fits $${cap}`,
        assumption: `Fits a $${cap} budget if you stick to a single main without extras.`,
      };
    }
    if (low > cap) return { result: "fail" as const, note: `${label} estimate starts at $${low}, above $${cap}` };
    return { result: "fail" as const, note: `${label} estimate $${low}–$${high} may exceed $${cap}; not credible` };
  };

  if (c.basis === "food_only") {
    return judge(c.amount, foodLow, foodHigh, cheapestOrder, "Food-only");
  }
  const orderAllIn = cheapestOrder === null ? null : Math.round(allInFromFood(cheapestOrder));
  const allIn = judge(c.amount, allInLow, allInHigh, orderAllIn, "All-in");
  if (c.basis === "all_in" || allIn.result === "pass") {
    return c.basis === "unspecified" && allIn.result === "pass"
      ? { ...allIn, assumption: allIn.assumption ?? "We treated a stated budget as including tax and tip." }
      : allIn;
  }
  // Unspecified basis: only all-in is safe. Food-only would pass → ambiguity, not a pass.
  const food = judge(c.amount, foodLow, foodHigh, cheapestOrder, "Food-only");
  return food.result === "pass"
    ? { result: "fail", note: `Fits only if $${c.amount} excludes tax and tip (unconfirmed)` }
    : allIn;
}

function checkDietary(c: Extract<HardConstraint, { type: "dietary" }>, r: Restaurant): { result: CheckResult; note: string; assumption?: string } {
  const strict = c.severity === "allergy" || c.severity === "medical";
  if (strict) {
    if (!r.allergyPolicy) return { result: "unverified", note: "No published allergy policy; can't verify safe preparation" };
    if (c.tag) {
      const opt = r.menuOptions.find((o) => o.dietaryTag === c.tag && o.verificationStatus !== "menu_inferred");
      if (!opt) return { result: "unverified", note: `No labeled ${c.tag} options` };
    }
    return {
      result: "pass",
      note: "Restaurant publishes an allergy policy",
      assumption: "Tell your server about any allergy — we can't confirm how the kitchen prepares food.",
    };
  }
  if (!c.tag) return { result: "unverified", note: `Can't verify "${c.allergen ?? "requirement"}" from menus` };
  const accepted = c.severity === "religious" ? ["menu_labeled", "restaurant_statement"] : ["menu_labeled", "restaurant_statement", "menu_inferred"];
  const opt = r.menuOptions.find((o) => o.dietaryTag === c.tag && accepted.includes(o.verificationStatus));
  if (opt) return { result: "pass", note: `${c.tag}: ${opt.description}` };
  // Vegan dishes satisfy a vegetarian requirement.
  if (c.tag === "vegetarian" && r.menuOptions.some((o) => o.dietaryTag === "vegan" && accepted.includes(o.verificationStatus))) {
    return { result: "pass", note: "vegetarian via vegan options" };
  }
  return { result: "unverified", note: `No ${c.tag} evidence in the snapshot` };
}

function checkConstraint(c: HardConstraint, r: Restaurant, travel: TravelEstimate, availability: Availability) {
  switch (c.type) {
    case "budget_max":
      return checkBudget(c, r);
    case "dietary":
      return checkDietary(c, r);
    case "exclude_cuisine": {
      const hit = r.cuisines.some((x) => x.toLowerCase().includes(c.cuisine.toLowerCase()));
      return hit ? { result: "fail" as const, note: `Serves ${c.cuisine}` } : { result: "pass" as const, note: "" };
    }
    case "travel_max_minutes":
      if (travel.minutesHigh <= c.minutes) return { result: "pass" as const, note: `${travel.minutesLow}–${travel.minutesHigh} min` };
      if (travel.minutesLow > c.minutes) return { result: "fail" as const, note: `At least ${travel.minutesLow} min, over ${c.minutes}` };
      return { result: "unverified" as const, note: `${travel.minutesLow}–${travel.minutesHigh} min may exceed ${c.minutes}` };
    case "reservation_required":
      return availability.status === "reservable"
        ? { result: "pass" as const, note: `Simulated slots ${availability.slots.join(", ")}` }
        : { result: "fail" as const, note: `No simulated reservable slot (${availability.status})` };
    case "exclude_restaurant":
      return c.restaurantId === r.id ? { result: "fail" as const, note: "Diner excluded this restaurant" } : { result: "pass" as const, note: "" };
  }
}

export function evaluateCandidate(r: Restaurant, ctx: FeasibilityContext): CandidateFacts {
  const { group } = ctx;
  const availability = ctx.frozenAvailability?.[r.id] ?? simulateAvailability(r, group.diningAt, group.partySize, ctx.availabilitySeed);
  const checks: Check[] = [];
  const assumptions = new Set<string>();

  const open = openAt(r, group.diningAt);
  checks.push({
    scope: "group",
    participantId: null,
    constraintId: null,
    type: "open_hours",
    result: open.status === "open" ? "pass" : open.status === "closed" ? "fail" : "unverified",
    note: open.status,
  });
  checks.push({
    scope: "group",
    participantId: null,
    constraintId: null,
    type: "availability",
    result: availability.status === "reservable" || availability.status === "walk_in" ? "pass" : availability.status === "unavailable" ? "fail" : "unverified",
    note: `${availability.status} (${availability.reason})`,
  });

  const travel: Record<string, TravelEstimate> = {};
  for (const d of group.diners) {
    const t = estimateTravel(d.origin, r);
    travel[d.participantId] = t;
    for (const c of d.hard) {
      const res = checkConstraint(c, r, t, availability);
      if ("assumption" in res && res.assumption) assumptions.add(res.assumption);
      checks.push({ scope: "diner", participantId: d.participantId, constraintId: c.id, type: c.type, result: res.result, note: res.note });
    }
  }
  return {
    restaurantId: r.id,
    feasible: checks.every((c) => c.result === "pass"),
    checks,
    availability,
    travel,
    maxTravelHigh: Math.max(0, ...Object.values(travel).map((t) => t.minutesHigh)),
    assumptions: [...assumptions],
  };
}

export function evaluateAll(ctx: FeasibilityContext): CandidateFacts[] {
  return ctx.restaurants.map((r) => evaluateCandidate(r, ctx));
}

/** Independent final guard used before delivery, for every method. */
export function guardRecommendation(restaurantId: string, ctx: FeasibilityContext): { ok: true; facts: CandidateFacts } | { ok: false; reason: string; facts?: CandidateFacts } {
  const r = ctx.restaurants.find((x) => x.id === restaurantId);
  if (!r) return { ok: false, reason: `unknown_restaurant:${restaurantId}` };
  const facts = evaluateCandidate(r, ctx);
  if (!facts.feasible) {
    const failed = facts.checks.filter((c) => c.result !== "pass").map((c) => `${c.type}:${c.result}`);
    return { ok: false, reason: `hard_constraint:${failed.join(",")}`, facts };
  }
  return { ok: true, facts };
}

export function dinerHardSummary(d: NormalizedDiner): string[] {
  return d.hard.map((c) => {
    switch (c.type) {
      case "budget_max":
        return `budget ≤ $${c.amount} (${c.basis.replace("_", " ")})`;
      case "dietary":
        return `${c.severity}: ${c.tag ?? c.allergen}`;
      case "exclude_cuisine":
        return `no ${c.cuisine}`;
      case "travel_max_minutes":
        return `travel ≤ ${c.minutes} min`;
      case "reservation_required":
        return "needs a reservation";
      case "exclude_restaurant":
        return `not ${c.restaurantId}`;
    }
  });
}
