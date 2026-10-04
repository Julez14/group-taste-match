import type { NormalizedGroup } from "../shared/normalized";
import type { Restaurant } from "../shared/restaurant";
import type { NoMatch, ResultCard } from "../shared/types";
import { clockLabel } from "./hours";
import type { CandidateFacts } from "./feasibility";

function nearestSlot(slots: string[], diningAt: string): string | null {
  const m = /T(\d{2}):(\d{2})/.exec(diningAt);
  if (!m || !slots.length) return slots[0] ?? null;
  const want = Number(m[1]) * 60 + Number(m[2]);
  const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  return [...slots].sort((a, b) => Math.abs(toMin(a) - want) - Math.abs(toMin(b) - want))[0]!;
}

function travelSummary(facts: CandidateFacts): { summary: string; maxMinutes: number | null } {
  const trips = Object.values(facts.travel);
  if (!trips.length) return { summary: "Travel time unknown.", maxMinutes: null };
  const lo = Math.min(...trips.map((t) => t.minutesLow));
  const hi = Math.max(...trips.map((t) => t.minutesHigh));
  const allWalk = trips.every((t) => t.mode === "walk");
  const summary = allWalk
    ? `A short walk for everyone — about ${lo}–${hi} minutes.`
    : `Trips range from about ${lo} to ${hi} minutes by walking or subway (approximate, not live transit).`;
  return { summary, maxMinutes: hi };
}

/** Collective assumptions that never identify a diner. */
export function groupAssumptions(group: NormalizedGroup, facts: CandidateFacts): string[] {
  const out: string[] = [];
  if (group.diners.some((d) => d.origin.source === "default_meeting_area")) {
    out.push(`Anyone who didn't share a starting point is assumed to be coming from ${group.meetingArea.name}.`);
  }
  if (group.diners.some((d) => d.noResponse)) {
    out.push("Not everyone answered in time, so we kept any earlier requirements and leaned on usual tastes.");
  }
  if (group.diners.some((d) => d.missing.includes("budget") && !d.noResponse)) {
    out.push("Where no budget was given, we treated it as unknown and leaned on usual price habits.");
  }
  out.push(...facts.assumptions);
  return out;
}

export function buildCard(args: {
  restaurant: Restaurant;
  facts: CandidateFacts;
  group: NormalizedGroup;
  explanation: string;
  extraAssumptions: string[];
}): ResultCard {
  const { restaurant: r, facts, group } = args;
  const a = facts.availability;
  const slot = a.status === "reservable" ? nearestSlot(a.slots, group.diningAt) : null;
  const links: ResultCard["links"] = [{ label: "Website", url: r.websiteUrl, kind: "website" }];
  if (r.menuUrl) links.push({ label: "Menu", url: r.menuUrl, kind: "menu" });
  links.push({
    label: "Directions",
    url: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${r.name}, ${r.address}`)}`,
    kind: "directions",
  });
  if (r.bookingUrl) links.push({ label: "Reserve", url: r.bookingUrl, kind: "booking" });

  const assumptions = [...new Set([...groupAssumptions(group, facts), ...args.extraAssumptions])].slice(0, 6);
  return {
    restaurantId: r.id,
    name: r.name,
    cuisines: r.cuisines,
    neighborhood: `${r.neighborhood}, ${r.borough}`,
    address: r.address,
    mealEstimate: { low: r.mealEstimate.low, high: r.mealEstimate.high, basis: r.mealEstimate.basis, assumptions: r.mealEstimate.assumptions },
    travel: travelSummary(facts),
    diningAt: group.diningAt,
    partySize: group.partySize,
    availability: {
      status: a.status === "reservable" ? "reservable" : a.status === "walk_in" ? "walk_in" : "unknown",
      slot: slot ? clockLabel(slot) : null,
      label:
        a.status === "reservable"
          ? `Table for ${group.partySize} shows open near your time`
          : a.status === "walk_in"
            ? r.reservationPolicy === "walk_in_only"
              ? "Walk-in only — no reservations"
              : "No online tables right now; walk-ins accepted"
            : "Availability unknown",
    },
    explanation: args.explanation,
    assumptions,
    links,
  };
}

const REASON_TEXT: Record<string, string> = {
  budget_max: "budget limits",
  dietary: "a dietary need we couldn't verify on the menus",
  travel_max_minutes: "travel-time limits",
  reservation_required: "needing a guaranteed reservation",
  exclude_cuisine: "cuisines someone ruled out",
  exclude_restaurant: "places someone ruled out",
  open_hours: "opening hours at your time",
  availability: "availability at your time",
};

/** Deterministic, non-identifying no-match message from failed check types. */
export function noMatchFromFacts(facts: CandidateFacts[], reasonCodes: string[] = []): NoMatch {
  const counts: Record<string, number> = {};
  for (const f of facts) for (const c of f.checks) if (c.result !== "pass") counts[c.type] = (counts[c.type] ?? 0) + 1;
  const top = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k]) => REASON_TEXT[k] ?? k);
  const why = top.length ? ` — mainly ${top.join(" and ")}` : "";
  return {
    reasonCodes: reasonCodes.length ? reasonCodes : Object.keys(counts),
    message: `None of the ${facts.length} restaurants in this prototype's list can meet everyone's must-haves${why}.`,
  };
}
