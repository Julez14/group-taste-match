import { z } from "zod";
import type { AiClient } from "./ai";
import type { Topic } from "./clarify";
import { candidateView, type DecisionInput } from "./decision-context";
import type { CandidateFacts } from "./feasibility";
import { arr, obj, str } from "./json-schema";
import { chatJson } from "./llm";

export const EXPLAIN_PROMPT_VERSION = "explain-v2";

export const EXPLANATION_RULES = `Write for the whole group, warm and brief, like a friend who picked the spot: e.g. "I picked somewhere relaxed with several vegetarian options and a manageable trip from your meeting area."
- At most 2 sentences, under 60 words. Collective only: never mention a person's name, private budget amount, starting location, allergy, health detail, or clarification answer. "Fits everyone's budget" is fine; "$30 for Sam" is not.
- Only state facts present in the supplied restaurant data. No invented dishes, prices, hours, ratings, or reservations. Don't promise a table.
- No numeric enjoyment probabilities or scores.
- Mention a real compromise briefly if there is one.`;

const ExplanationSchema = z.object({
  explanation: z.string().min(10).max(600),
  assumptions: z.array(z.string().max(240)).max(4),
});

function groupNeeds(input: DecisionInput) {
  // Anonymized and aggregated: what people asked for, without owners.
  return {
    requests: input.group.diners.filter((d) => !d.noResponse).map((d) => d.originalText),
    notResponded: input.group.diners.filter((d) => d.noResponse).length,
    meetingArea: input.group.meetingArea.name,
  };
}

export async function writeExplanation(
  ai: AiClient,
  input: DecisionInput,
  chosen: CandidateFacts,
  extra: { compromise?: string; hostPriority?: string } = {},
): Promise<{ explanation: string; assumptions: string[] }> {
  const { value } = await chatJson(ai, {
    system: `You explain a group's restaurant pick.\n${EXPLANATION_RULES}\nAlso return up to 3 short natural "assumptions" sentences only if consequential (e.g. a budget treated as including tip). Return JSON {"explanation": string, "assumptions": string[]}.`,
    user: JSON.stringify({
      restaurant: candidateView(input, chosen),
      groupRequests: groupNeeds(input),
      knownAssumptions: chosen.assumptions,
      ...extra,
    }),
    schema: ExplanationSchema,
    jsonSchema: { name: "explanation", schema: obj({ explanation: str(600), assumptions: arr(str(240), 4) }) },
    purpose: "explain",
    settings: { maxTokens: 1500 },
  });
  return value;
}

const QuestionsSchema = z.object({
  questions: z.array(z.object({ participantId: z.string(), topicId: z.string(), question: z.string().max(300) })),
});

export const QUESTION_RULES = `Write ONE short private question (under 25 words) for each listed diner about their own words only. Neutral and friendly. Make it easy to answer quickly (offer the two readings). Never mention other diners, the group's conflict, or restaurants. Don't suggest they relax a requirement.`;

export async function writeClarifyQuestions(
  ai: AiClient,
  topics: (Topic & { dinerText: string | null })[],
): Promise<{ participantId: string; topicId: string; question: string }[]> {
  const { value } = await chatJson(ai, {
    system: `You write private clarification questions for a group dinner picker.\n${QUESTION_RULES}\nReturn JSON {"questions":[{"participantId","topicId","question"}]} with exactly one entry per diner listed.`,
    user: JSON.stringify(
      topics.map((t) => ({ participantId: t.participantId, topicId: t.topicId, theirWords: t.dinerText, unclearTerm: t.term, alternativeReading: t.alternative })),
    ),
    schema: QuestionsSchema,
    jsonSchema: { name: "questions", schema: obj({ questions: arr(obj({ participantId: str(40), topicId: str(80), question: str(300) }), 6) }) },
    purpose: "clarify_questions",
    settings: { maxTokens: 1500 },
  });
  const wanted = new Map(topics.map((t) => [t.participantId, t.topicId]));
  return value.questions.filter((q) => wanted.get(q.participantId) === q.topicId);
}
