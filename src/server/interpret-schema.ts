import { z } from "zod";
import { MEETING_AREAS } from "../shared/data";
import { AMBIGUITY_KINDS, type HardConstraint, type Interpretation, MISSING_KEYS, type SoftPreference } from "../shared/normalized";
import { DIETARY_TAGS } from "../shared/restaurant";
import { arr, bool, enumOf, nullableEnum, nullableNum, nullableStr, obj, str } from "./json-schema";

const HARD_TYPES = ["budget_max", "dietary", "exclude_cuisine", "travel_max_minutes", "reservation_required", "exclude_restaurant"] as const;
const SOFT_KINDS = ["cuisine", "atmosphere", "price", "dish", "travel", "novelty", "occasion", "dietary", "other"] as const;
const SEVERITIES = ["allergy", "medical", "religious", "ethical", "preference"] as const;
const BASES = ["all_in", "food_only", "unspecified"] as const;
const STATUSES = ["stated", "inferred"] as const;
const FROM = ["initial", "clarification"] as const;

/**
 * Flat, all-fields-required shape for constrained decoding. Fields that
 * don't apply to an item type are null. Converted to the strict
 * discriminated union by `fromFlat`.
 */
export const INTERPRETATION_JSON_SCHEMA = obj({
  hard: arr(
    obj({
      id: str(10),
      type: enumOf(HARD_TYPES),
      amount: nullableNum,
      basis: nullableEnum(BASES),
      tag: nullableEnum(DIETARY_TAGS),
      allergen: nullableStr(40),
      severity: nullableEnum(SEVERITIES),
      cuisine: nullableStr(40),
      minutes: nullableNum,
      restaurantName: nullableStr(80),
      sourceText: str(200),
      sourceStatus: enumOf(STATUSES),
      sourceFrom: enumOf(FROM),
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
      sourceText: str(200),
      sourceStatus: enumOf(STATUSES),
      sourceFrom: enumOf(FROM),
    }),
    16,
  ),
  ambiguities: arr(
    obj({
      topicId: str(40),
      kind: enumOf(AMBIGUITY_KINDS),
      term: str(120),
      relatesTo: nullableStr(10),
      sourceText: str(200),
    }),
    6,
  ),
  missing: arr(enumOf(MISSING_KEYS), 5),
  noveltyRequested: bool,
  originAreaId: nullableEnum(MEETING_AREAS.map((a) => a.id)),
  ignoredInstructions: arr(str(300), 5),
});

const FlatHard = z.object({
  id: z.string(),
  type: z.enum(HARD_TYPES),
  amount: z.number().nullable(),
  basis: z.enum(BASES).nullable(),
  tag: z.enum(DIETARY_TAGS).nullable(),
  allergen: z.string().nullable(),
  severity: z.enum(SEVERITIES).nullable(),
  cuisine: z.string().nullable(),
  minutes: z.number().nullable(),
  restaurantName: z.string().nullable(),
  sourceText: z.string(),
  sourceStatus: z.enum(STATUSES),
  sourceFrom: z.enum(FROM),
});

const FlatInterpretation = z.object({
  hard: z.array(FlatHard),
  soft: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(SOFT_KINDS),
      direction: z.enum(["want", "avoid"]),
      strength: z.enum(["strong", "mild"]),
      value: z.string(),
      sourceText: z.string(),
      sourceStatus: z.enum(STATUSES),
      sourceFrom: z.enum(FROM),
    }),
  ),
  ambiguities: z.array(
    z.object({ topicId: z.string(), kind: z.enum(AMBIGUITY_KINDS), term: z.string(), relatesTo: z.string().nullable(), sourceText: z.string() }),
  ),
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
    const source = { text: h.sourceText.slice(0, 400), status: h.sourceStatus, from: h.sourceFrom };
    const base = { id: h.id, source };
    switch (h.type) {
      case "budget_max":
        if (h.amount && h.amount > 0) hard.push({ ...base, type: "budget_max", amount: h.amount, basis: h.basis ?? "unspecified" });
        else dropped.push(`budget_max without amount: ${h.sourceText}`);
        break;
      case "dietary":
        if (h.tag || h.allergen) hard.push({ ...base, type: "dietary", tag: h.tag, allergen: h.allergen, severity: h.severity ?? "preference" });
        else dropped.push(`dietary without tag: ${h.sourceText}`);
        break;
      case "exclude_cuisine":
        if (h.cuisine) hard.push({ ...base, type: "exclude_cuisine", cuisine: h.cuisine.toLowerCase() });
        else dropped.push(`exclude_cuisine without cuisine: ${h.sourceText}`);
        break;
      case "travel_max_minutes":
        if (h.minutes && h.minutes > 0) hard.push({ ...base, type: "travel_max_minutes", minutes: h.minutes });
        else dropped.push(`travel_max_minutes without minutes: ${h.sourceText}`);
        break;
      case "reservation_required":
        hard.push({ ...base, type: "reservation_required" });
        break;
      case "exclude_restaurant":
        if (h.restaurantName) hard.push({ ...base, type: "exclude_restaurant", restaurantId: slug(h.restaurantName) });
        else dropped.push(`exclude_restaurant without name: ${h.sourceText}`);
        break;
    }
  }
  const soft: SoftPreference[] = flat.soft.map((s) => ({
    id: s.id,
    kind: s.kind,
    direction: s.direction,
    strength: s.strength,
    value: s.value,
    source: { text: s.sourceText.slice(0, 400), status: s.sourceStatus, from: s.sourceFrom },
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
      source: { text: a.sourceText.slice(0, 400), status: "stated", from: "initial" },
    })),
    missing: flat.missing,
    noveltyRequested: flat.noveltyRequested,
    originAreaId: flat.originAreaId && MEETING_AREAS.some((m) => m.id === flat.originAreaId) ? flat.originAreaId : null,
    ignoredInstructions: flat.ignoredInstructions,
    dropped,
  };
}

export const InterpretationFromFlat = FlatInterpretation.transform(fromFlat);
