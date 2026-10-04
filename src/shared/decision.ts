import { z } from "zod";

/** Shared decision interface (PRD §8). Both methods propose one of these. */
export const DecisionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("recommend"),
    restaurantId: z.string().max(80),
    evidenceIds: z.array(z.string().max(20)).max(20).default([]),
    assumptions: z.array(z.string().max(240)).max(6).default([]),
    explanation: z.string().max(600),
  }),
  z.object({
    kind: z.literal("clarify"),
    questions: z
      .array(z.object({ participantId: z.string().max(40), topicId: z.string().max(80), question: z.string().max(300) }))
      .min(1)
      .max(6),
  }),
  z.object({
    kind: z.literal("host_final_call"),
    topicId: z.string().max(80),
    question: z.string().max(300),
    options: z.array(z.object({ id: z.string().max(32), label: z.string().max(60) })).max(2).default([]),
  }),
  z.object({ kind: z.literal("no_feasible_match"), reasonCodes: z.array(z.string().max(60)).max(10) }),
]);
export type Decision = z.infer<typeof DecisionSchema>;
