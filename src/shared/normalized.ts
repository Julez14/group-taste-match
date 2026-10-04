import { z } from "zod";
import { DIETARY_TAGS } from "./restaurant";

/** Where an interpreted item came from. Confidence is never consent to relax it. */
export const SourceSchema = z.object({
  text: z.string().max(400),
  status: z.enum(["stated", "inferred", "default"]),
  /** "clarification" when it came from the owner's submitted clarification. */
  from: z.enum(["initial", "clarification", "default"]).default("initial"),
});
export type Source = z.infer<typeof SourceSchema>;

const base = { id: z.string().max(40), source: SourceSchema };

export const HardConstraintSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("budget_max"), amount: z.number().positive().max(2000), basis: z.enum(["all_in", "food_only", "unspecified"]) }),
  z.object({
    ...base,
    type: z.literal("dietary"),
    tag: z.enum(DIETARY_TAGS).nullable(),
    /** Free-text allergen when it is outside the tag vocabulary, e.g. "shellfish". */
    allergen: z.string().max(40).nullable(),
    severity: z.enum(["allergy", "medical", "religious", "ethical", "preference"]),
  }),
  z.object({ ...base, type: z.literal("exclude_cuisine"), cuisine: z.string().max(40) }),
  z.object({ ...base, type: z.literal("travel_max_minutes"), minutes: z.number().positive().max(240) }),
  z.object({ ...base, type: z.literal("reservation_required") }),
  z.object({ ...base, type: z.literal("exclude_restaurant"), restaurantId: z.string().max(80) }),
]);
export type HardConstraint = z.infer<typeof HardConstraintSchema>;

export const SoftPreferenceSchema = z.object({
  ...base,
  kind: z.enum(["cuisine", "atmosphere", "price", "dish", "travel", "novelty", "occasion", "dietary", "other"]),
  direction: z.enum(["want", "avoid"]),
  strength: z.enum(["strong", "mild"]),
  value: z.string().max(120),
});
export type SoftPreference = z.infer<typeof SoftPreferenceSchema>;

export const AMBIGUITY_KINDS = ["budget_basis", "budget_firmness", "dietary_severity", "travel_limit", "vague_quality", "other"] as const;

export const AmbiguitySchema = z.object({
  topicId: z.string().max(40),
  kind: z.enum(AMBIGUITY_KINDS),
  term: z.string().max(120),
  /** Related constraint/preference id, when the ambiguity is about one. */
  relatesTo: z.string().max(40).nullable(),
  source: SourceSchema,
});
export type Ambiguity = z.infer<typeof AmbiguitySchema>;

export const MISSING_KEYS = ["budget", "location", "cuisine", "dietary", "atmosphere"] as const;

/** Model output for one diner, before the server attaches ids, origin, and profile. */
export const InterpretationSchema = z.object({
  hard: z.array(HardConstraintSchema).max(12),
  soft: z.array(SoftPreferenceSchema).max(16),
  ambiguities: z.array(AmbiguitySchema).max(6),
  missing: z.array(z.enum(MISSING_KEYS)),
  noveltyRequested: z.boolean(),
  /** Meeting-area id the diner said they're coming from, if any. */
  originAreaId: z.string().max(40).nullable().default(null),
  /** Text that tried to change product rules or reach others' data; kept, never obeyed. */
  ignoredInstructions: z.array(z.string().max(300)).max(5),
});
export type Interpretation = z.infer<typeof InterpretationSchema>;

export type DinerOrigin = {
  lat: number;
  lng: number;
  label: string;
  source: "stated_area" | "geolocation" | "default_meeting_area";
};

export type NormalizedDiner = Interpretation & {
  participantId: string;
  name: string;
  profileId: string;
  isHost: boolean;
  originalText: string | null;
  clarificationText: string | null;
  origin: DinerOrigin;
  /** True when the diner submitted nothing before the deadline. */
  noResponse: boolean;
};

export type NormalizedGroup = {
  diningAt: string;
  meetingArea: { id: string; name: string; lat: number; lng: number };
  partySize: number;
  diners: NormalizedDiner[];
  hostAnswer: { text: string; choiceId: string | null } | null;
};
