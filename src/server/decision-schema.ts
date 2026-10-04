import { z } from "zod";
import type { Decision } from "../shared/decision";
import { arr, enumOf, nullableStr, obj, str } from "./json-schema";

const KINDS = ["recommend", "clarify", "host_final_call", "no_feasible_match"] as const;

/** Flat decision shape for constrained decoding; unused fields are null or empty. */
export const DECISION_JSON_SCHEMA = obj({
  kind: enumOf(KINDS),
  restaurantId: nullableStr(80),
  evidenceIds: arr(str(20), 20),
  assumptions: arr(str(240), 6),
  explanation: nullableStr(600),
  questions: arr(obj({ participantId: str(40), topicId: str(80), question: str(300) }), 6),
  hostTopicId: nullableStr(80),
  hostQuestion: nullableStr(300),
  hostOptions: arr(obj({ id: str(32), label: str(60) }), 2),
  reasonCodes: arr(str(60), 10),
});

const Flat = z.object({
  kind: z.enum(KINDS),
  restaurantId: z.string().nullable(),
  evidenceIds: z.array(z.string()),
  assumptions: z.array(z.string()),
  explanation: z.string().nullable(),
  questions: z.array(z.object({ participantId: z.string(), topicId: z.string(), question: z.string() })),
  hostTopicId: z.string().nullable(),
  hostQuestion: z.string().nullable(),
  hostOptions: z.array(z.object({ id: z.string(), label: z.string() })).max(2),
  reasonCodes: z.array(z.string()),
});

export const DecisionFromFlat = Flat.transform((f, ctx): Decision => {
  switch (f.kind) {
    case "recommend":
      if (!f.restaurantId || !f.explanation) {
        ctx.addIssue({ code: "custom", message: "recommend needs restaurantId and explanation" });
        return z.NEVER;
      }
      return { kind: "recommend", restaurantId: f.restaurantId, evidenceIds: f.evidenceIds, assumptions: f.assumptions, explanation: f.explanation };
    case "clarify":
      if (!f.questions.length) {
        ctx.addIssue({ code: "custom", message: "clarify needs at least one question" });
        return z.NEVER;
      }
      return { kind: "clarify", questions: f.questions };
    case "host_final_call":
      if (!f.hostQuestion || !f.hostTopicId) {
        ctx.addIssue({ code: "custom", message: "host_final_call needs hostTopicId and hostQuestion" });
        return z.NEVER;
      }
      return { kind: "host_final_call", topicId: f.hostTopicId, question: f.hostQuestion, options: f.hostOptions };
    case "no_feasible_match":
      return { kind: "no_feasible_match", reasonCodes: f.reasonCodes };
  }
});
