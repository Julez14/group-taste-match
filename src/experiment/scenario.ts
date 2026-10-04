import { z } from "zod";
import { AMBIGUITY_KINDS } from "../shared/normalized";
import { DIETARY_TAGS } from "../shared/restaurant";

export const FAMILIES = [
  "clear_shared",
  "mixed_preferences",
  "budget_vs_atmosphere",
  "dietary_verification",
  "travel_origins",
  "sparse_unknowns",
  "current_vs_history",
  "hours_party_slots",
  "infeasible_timeouts",
  "noisy_injection",
] as const;
export type Family = (typeof FAMILIES)[number];

/**
 * Ground-truth hard requirement after any truthful clarification (prelabeled,
 * not model output). `requiresFact` marks parts that only become effective
 * when that clarification was actually asked and answered in a run.
 */
const requiresFact = { requiresFact: z.enum(AMBIGUITY_KINDS).optional() };
export const TrueRequirementSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("budget_max"), amount: z.number(), basis: z.enum(["all_in", "food_only"]), ...requiresFact }),
  z.object({
    type: z.literal("dietary"),
    tag: z.enum(DIETARY_TAGS).nullable(),
    allergen: z.string().nullable().default(null),
    severity: z.enum(["allergy", "medical", "religious", "ethical", "preference"]),
  }),
  z.object({ type: z.literal("exclude_cuisine"), cuisine: z.string() }),
  z.object({ type: z.literal("travel_max_minutes"), minutes: z.number(), ...requiresFact }),
  z.object({ type: z.literal("reservation_required") }),
  z.object({ type: z.literal("exclude_restaurant"), restaurantId: z.string() }),
]);
export type TrueRequirement = z.infer<typeof TrueRequirementSchema>;

export const ScenarioDinerSchema = z.object({
  id: z.string(),
  name: z.string(),
  profileId: z.string(),
  isHost: z.boolean().default(false),
  startAreaId: z.string().nullable().default(null),
  /** What they said; null = no response before the deadline. */
  text: z.string().nullable(),
  /** Prewritten truthful answers keyed by ambiguity kind; anything else times out. */
  facts: z.partialRecord(z.enum(AMBIGUITY_KINDS), z.string()).default({}),
  truth: z.object({
    hard: z.array(TrueRequirementSchema).default([]),
    /** Key soft wants, used only as judge context. */
    wants: z.array(z.string()).default([]),
  }),
});
export type ScenarioDiner = z.infer<typeof ScenarioDinerSchema>;

export const ScenarioSchema = z.object({
  id: z.string().regex(/^S\d{2}$/),
  baseId: z.string(),
  family: z.enum(FAMILIES),
  split: z.enum(["dev", "test"]),
  diningAt: z.string(),
  meetingAreaId: z.string(),
  diners: z.array(ScenarioDinerSchema).min(2).max(6),
  /** Host's true soft priority for a final call; null = host times out. */
  host: z.object({ priority: z.enum(["shorter_trip", "best_match"]).nullable(), text: z.string().nullable() }),
  notes: z.string(),
});
export type Scenario = z.infer<typeof ScenarioSchema>;

export const ScenarioFileSchema = z.object({
  version: z.string(),
  note: z.string(),
  scenarios: z.array(ScenarioSchema),
});
