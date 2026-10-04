import type { AiClient } from "./ai";
import { ProviderError } from "./ai";
import { candidateView, type DecisionInput, dinerView, eligible, roomView } from "./decision-context";

export const CLEF_MODEL = "@cf/cloudflare/clef";
export const CLEF_MAX_QUESTIONS = 64;
export const CLEF_RUBRIC_VERSION = "fit-rubric-v1";

export const FIT_CRITERIA = [
  "Poor fit: substantially misses important stated preferences",
  "Weak fit: a consequential preference is poorly served",
  "Acceptable fit: needs met with an understandable compromise",
  "Good fit: matches most important preferences",
  "Excellent fit: particularly strong for this diner's request",
];

export function fitInstructions(restaurantId: string, restaurantName: string, participantId: string): string {
  return (
    `Assess restaurant ${restaurantId} (${restaurantName}) for diner ${participantId}. ` +
    `Prioritize the diner's current request and any clarification over their history; the ranked history is synthetic and only a weak taste signal, and a request for somewhere new outranks familiar favorites. ` +
    `Consider cuisine and dish wants/avoids, atmosphere, price leaning, and this diner's travel time. ` +
    `Hard requirements were already verified by the app, so do not re-judge them. If the diner gave no request, judge only from history and travel. ` +
    `Use only the supplied evidence.`
  );
}

export type ScoreAnswer = { score: number; probabilities: number[]; confidence: number };
export type ScoreTable = Record<string, Record<string, ScoreAnswer>>; // restaurantId → participantId → answer

type RawAnswer = {
  type?: string;
  score?: number;
  probabilities?: Record<string, number>;
  confidence?: number;
  choice?: string;
};
type ClefResponse = { answers?: Record<string, RawAnswer>; usage?: { input_tokens?: number } };

export function questionKey(restaurantId: string, participantId: string) {
  return `fit__${restaurantId}__${participantId}`;
}

/** Validate one score answer: type, range, five levels, probabilities summing to ~1. */
export function parseScore(key: string, a: RawAnswer | undefined): ScoreAnswer {
  if (!a || a.type !== "score") throw new ProviderError(`Clef answer ${key} missing or not a score`, CLEF_MODEL);
  if (typeof a.score !== "number" || a.score < -1e-6 || a.score > 4 + 1e-6) {
    throw new ProviderError(`Clef score out of range for ${key}`, CLEF_MODEL);
  }
  const probs = [0, 1, 2, 3, 4].map((i) => a.probabilities?.[String(i)]);
  if (probs.some((p) => typeof p !== "number" || p < 0 || p > 1)) throw new ProviderError(`Clef probabilities invalid for ${key}`, CLEF_MODEL);
  const sum = (probs as number[]).reduce((x, y) => x + y, 0);
  if (Math.abs(sum - 1) > 0.02) throw new ProviderError(`Clef probabilities for ${key} sum to ${sum.toFixed(3)}`, CLEF_MODEL);
  return { score: a.score, probabilities: probs as number[], confidence: typeof a.confidence === "number" ? a.confidence : 0 };
}

export function buildClefState(input: DecisionInput) {
  return {
    room: roomView(input),
    diners: input.group.diners.map(dinerView),
    restaurants: eligible(input).map((f) => candidateView(input, f)),
  };
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * One fit score per diner per eligible restaurant, batched within Clef's
 * 64-question limit. Nothing is truncated: every pair is asked and every
 * answer is validated.
 */
export async function scoreFits(ai: AiClient, input: DecisionInput, opts: { concurrency?: number } = {}): Promise<{ table: ScoreTable; calls: number }> {
  const state = buildClefState(input);
  const pairs = eligible(input).flatMap((f) => input.group.diners.map((d) => ({ rid: f.restaurantId, pid: d.participantId })));
  const names = Object.fromEntries(input.restaurants.map((r) => [r.id, r.name]));
  const batches = chunk(pairs, CLEF_MAX_QUESTIONS);
  const table: ScoreTable = {};

  const runBatch = async (batch: typeof pairs) => {
    const questions = Object.fromEntries(
      batch.map(({ rid, pid }) => [
        questionKey(rid, pid),
        { type: "score", instructions: fitInstructions(rid, names[rid] ?? rid, pid), criteria: FIT_CRITERIA },
      ]),
    );
    const res = await ai.run<ClefResponse>(CLEF_MODEL, { model: "clef", state, questions }, { purpose: "clef:fit", timeoutMs: 30_000 });
    for (const { rid, pid } of batch) {
      const key = questionKey(rid, pid);
      (table[rid] ??= {})[pid] = parseScore(key, res.answers?.[key]);
    }
  };

  const limit = Math.max(1, opts.concurrency ?? 4);
  for (let i = 0; i < batches.length; i += limit) {
    await Promise.all(batches.slice(i, i + limit).map(runBatch));
  }
  return { table, calls: batches.length };
}

export type ChoiceAnswer = { choice: string; probabilities: Record<string, number>; confidence: number };

export async function clefChoice(
  ai: AiClient,
  state: unknown,
  instructions: string,
  criteria: Record<string, string>,
  purpose: string,
): Promise<ChoiceAnswer> {
  const res = await ai.run<ClefResponse>(
    CLEF_MODEL,
    { model: "clef", state, questions: { pick: { type: "choice", instructions, criteria } } },
    { purpose, timeoutMs: 20_000 },
  );
  const a = res.answers?.pick;
  if (!a || a.type !== "choice" || typeof a.choice !== "string" || !(a.choice in criteria)) {
    throw new ProviderError("Clef choice answer invalid", CLEF_MODEL);
  }
  return { choice: a.choice, probabilities: a.probabilities ?? {}, confidence: a.confidence ?? 0 };
}
