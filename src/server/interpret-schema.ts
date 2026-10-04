import { z } from "zod";
import { MEETING_AREAS } from "../shared/data";
import { AMBIGUITY_KINDS, type HardConstraint, type Interpretation, MISSING_KEYS, type SoftPreference } from "../shared/normalized";
import { DIETARY_TAGS } from "../shared/restaurant";
import { arr, bool, enumOf, nullableEnum, nullableNum, nullableStr, obj, str } from "./json-schema";

const HARD_TYPES = ["budget_max", "dietary", "exclude_cuisine", "travel_max_minutes", "reservation_required", "exclude_restaurant"] as const;
const SOFT_KINDS = ["cuisine", "atmosphere", "price", "dish", "travel", "novelty", "occasion", "dietary", "other"] as const;
export const SEVERITIES = ["allergy", "medical", "religious", "ethical", "preference"] as const;
export const BASES = ["all_in", "food_only", "unspecified"] as const;
const STATUSES = ["stated", "inferred"] as const;

/**
 * Compact, all-fields-required shape for constrained decoding of a diner's
 * initial request. `amount` is dollars for budget_max or minutes for
 * travel_max_minutes; `value` is the cuisine, allergen, or restaurant name.
 */
export const INTERPRETATION_JSON_SCHEMA = obj({
  hard: arr(
    obj({
      id: str(10),
      type: enumOf(HARD_TYPES),
      amount: nullableNum,
      basis: nullableEnum(BASES),
      tag: nullableEnum(DIETARY_TAGS),
      severity: nullableEnum(SEVERITIES),
      value: nullableStr(80),
      quote: str(200),
      status: enumOf(STATUSES),
    }),
    12,
  ),
  soft: arr(
    obj({
      id: str(10),
      kind: enumOf(SOFT_KINDS),
      direction: enumOf(["want", "avoid"]),
      strength: enumOf(["strong", "mild"]),
      value: str(120),
      quote: str(200),
    }),
    16,
  ),
  ambiguities: arr(obj({ topicId: str(40), kind: enumOf(AMBIGUITY_KINDS), term: str(120), relatesTo: nullableStr(10) }), 6),
  missing: arr(enumOf(MISSING_KEYS), 5),
  noveltyRequested: bool,
  originAreaId: nullableEnum(MEETING_AREAS.map((a) => a.id)),
  ignoredInstructions: arr(str(300), 5),
});

const FlatInterpretation = z.object({
  hard: z.array(
    z.object({
      id: z.string(),
      type: z.enum(HARD_TYPES),
      amount: z.number().nullable(),
      basis: z.enum(BASES).nullable(),
      tag: z.enum(DIETARY_TAGS).nullable(),
      severity: z.enum(SEVERITIES).nullable(),
      value: z.string().nullable(),
      quote: z.string(),
      status: z.enum(STATUSES),
    }),
  ),
  soft: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(SOFT_KINDS),
      direction: z.enum(["want", "avoid"]),
      strength: z.enum(["strong", "mild"]),
      value: z.string(),
      quote: z.string(),
    }),
  ),
  ambiguities: z.array(z.object({ topicId: z.string(), kind: z.enum(AMBIGUITY_KINDS), term: z.string(), relatesTo: z.string().nullable() })),
  missing: z.array(z.enum(MISSING_KEYS)),
  noveltyRequested: z.boolean(),
  originAreaId: z.string().nullable(),
  ignoredInstructions: z.array(z.string()),
});

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** Convert the flat model output into strict constraints, dropping incomplete items. */
export function fromFlat(flat: z.infer<typeof FlatInterpretation>): Interpretation & { dropped: string[] } {
  const dropped: string[] = [];
  const hard: HardConstraint[] = [];
  for (const h of flat.hard) {
    const base = { id: h.id, source: { text: h.quote.slice(0, 400), status: h.status, from: "initial" as const } };
    switch (h.type) {
      case "budget_max":
        if (h.amount && h.amount > 0) hard.push({ ...base, type: "budget_max", amount: h.amount, basis: h.basis ?? "unspecified" });
        else dropped.push(`budget_max without amount: ${h.quote}`);
        break;
      case "dietary":
        if (h.tag || h.value) hard.push({ ...base, type: "dietary", tag: h.tag, allergen: h.value, severity: h.severity ?? "preference" });
        else dropped.push(`dietary without tag: ${h.quote}`);
        break;
      case "exclude_cuisine":
        if (h.value) hard.push({ ...base, type: "exclude_cuisine", cuisine: h.value.toLowerCase() });
        else dropped.push(`exclude_cuisine without cuisine: ${h.quote}`);
        break;
      case "travel_max_minutes":
        if (h.amount && h.amount > 0) hard.push({ ...base, type: "travel_max_minutes", minutes: h.amount });
        else dropped.push(`travel_max_minutes without minutes: ${h.quote}`);
        break;
      case "reservation_required":
        hard.push({ ...base, type: "reservation_required" });
        break;
      case "exclude_restaurant":
        if (h.value) hard.push({ ...base, type: "exclude_restaurant", restaurantId: slug(h.value) });
        else dropped.push(`exclude_restaurant without name: ${h.quote}`);
        break;
    }
  }
  const soft: SoftPreference[] = flat.soft.map((s) => ({
    id: s.id,
    kind: s.kind,
    direction: s.direction,
    strength: s.strength,
    value: s.value,
    source: { text: s.quote.slice(0, 400), status: "stated", from: "initial" },
  }));
  const ids = new Set([...hard.map((h) => h.id), ...soft.map((s) => s.id)]);
  return {
    hard,
    soft,
    ambiguities: flat.ambiguities.map((a) => ({
      topicId: a.topicId,
      kind: a.kind,
      term: a.term,
      relatesTo: a.relatesTo && ids.has(a.relatesTo) ? a.relatesTo : null,
      source: { text: a.term.slice(0, 400), status: "stated", from: "initial" },
    })),
    missing: flat.missing,
    noveltyRequested: flat.noveltyRequested,
    originAreaId: flat.originAreaId && MEETING_AREAS.some((m) => m.id === flat.originAreaId) ? flat.originAreaId : null,
    ignoredInstructions: flat.ignoredInstructions,
    dropped,
  };
}

export const InterpretationFromFlat = FlatInterpretation.transform(fromFlat);
