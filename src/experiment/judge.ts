import { z } from "zod";
import { profile } from "../shared/data";
import type { Restaurant } from "../shared/restaurant";
import type { AiClient } from "../server/ai";
import type { Availability } from "../server/availability";
import { FIT_CRITERIA } from "../server/clef";
import { clockLabel } from "../server/hours";
import { arr, enumOf, obj, str } from "../server/json-schema";
import { chatJson } from "../server/llm";
import { describeTravel, estimateTravel } from "../server/travel";
import { meetingArea } from "../shared/data";
import type { Scenario } from "./scenario";

export const JUDGE_MODEL = "@cf/moonshotai/kimi-k2.6";
export const JUDGE_PROMPT_VERSION = "judge-v1";
export const JUDGE_SETTINGS = { model: JUDGE_MODEL, reasoningEffort: "high" as const, maxTokens: 6000, temperature: 0 };

const SYSTEM = `You are an independent evaluator for a group restaurant picker. For ONE proposed restaurant, rate how well it fits EACH diner, separately, on this 0–4 rubric:
${FIT_CRITERIA.map((c, i) => `${i} = ${c}`).join("\n")}

Rules:
- Judge each diner from their own words and clarification first; their synthetic ranked history (#1 = favorite) is a weak secondary signal. A request for somewhere new outranks familiar favorites.
- Consider cuisine and dish wants, atmosphere, price relative to what they said, dietary needs (menu evidence only), and their travel time.
- If the restaurant breaks a diner's stated hard requirement, that diner's score is 0.
- If a diner gave no request, judge only from history and travel; don't assume they're unhappy.
- Use only the facts provided. You are not told how this restaurant was chosen.
Return JSON {"scores":[{"dinerId","score","reason"}]} with one entry per diner; score is an integer 0–4; reason under 25 words.`;

const JudgeSchema = z.object({
  scores: z.array(z.object({ dinerId: z.string(), score: z.number().int().min(0).max(4), reason: z.string() })),
});

export type JudgeResult = { key: string; scenarioId: string; restaurantId: string; scores: Record<string, { score: number; reason: string }>; model: string; promptVersion: string };

export const judgeKey = (scenarioId: string, restaurantId: string) => `${JUDGE_PROMPT_VERSION}|${scenarioId}|${restaurantId}`;

export function judgeItem(s: Scenario, r: Restaurant, availability: Availability) {
  const area = meetingArea(s.meetingAreaId)!;
  return {
    occasion: { diningAt: s.diningAt, meetingArea: area.name, partySize: s.diners.length },
    restaurant: {
      name: r.name,
      neighborhood: `${r.neighborhood}, ${r.borough}`,
      cuisines: r.cuisines,
      estimatePerPerson: `$${r.mealEstimate.low}–$${r.mealEstimate.high} all-in (${r.mealEstimate.basis})`,
      sampleOrders: r.sampleOrders.map((o) => `${o.description}: $${o.foodOnlyPrice} before tax/tip`),
      atmosphere: r.atmosphere.map((a) => a.tag),
      dietaryOptions: r.menuOptions.map((o) => `${o.dietaryTag}: ${o.description}`),
      allergyPolicy: r.allergyPolicy?.statement ?? "none published",
      availability: availability.status === "reservable" ? `simulated slots ${availability.slots.map(clockLabel).join(", ")}` : availability.status,
    },
    diners: s.diners.map((d) => {
      const start = d.startAreaId ? meetingArea(d.startAreaId)! : area;
      const p = profile(d.profileId);
      return {
        dinerId: d.id,
        request: d.text ?? "(no response)",
        clarifications: Object.values(d.facts),
        travel: describeTravel(estimateTravel(start, r)),
        history: (p?.history ?? []).slice(0, 8).map((h) => `#${h.rank} ${h.name} (${h.cuisines.join("/")})`),
      };
    }),
  };
}

/** Blinded per-diner fit judgment by a separate model family. */
export async function judge(ai: AiClient, s: Scenario, r: Restaurant, availability: Availability): Promise<JudgeResult> {
  const { value } = await chatJson(ai, {
    system: SYSTEM,
    user: JSON.stringify(judgeItem(s, r, availability)),
    schema: JudgeSchema,
    jsonSchema: {
      name: "judgment",
      schema: obj({ scores: arr(obj({ dinerId: enumOf(s.diners.map((d) => d.id)), score: { type: "integer", minimum: 0, maximum: 4 }, reason: str(200) }), 6) }),
    },
    purpose: "judge",
    settings: JUDGE_SETTINGS,
    timeoutMs: 180_000,
  });
  const scores = Object.fromEntries(value.scores.map((x) => [x.dinerId, { score: x.score, reason: x.reason }]));
  for (const d of s.diners) if (!scores[d.id]) throw new Error(`judge omitted diner ${d.id}`);
  return { key: judgeKey(s.id, r.id), scenarioId: s.id, restaurantId: r.id, scores, model: JUDGE_MODEL, promptVersion: JUDGE_PROMPT_VERSION };
}
