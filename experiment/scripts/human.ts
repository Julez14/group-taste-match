/**
 * Unblind the human review after responses are final and compare with the
 * model-judged scores. Writes experiment/review/human_results.json.
 *
 *   pnpm exp:human
 */
import fs from "node:fs";
import { judgeKey, type JudgeResult } from "../../src/experiment/judge";
import type { RunRecord } from "../../src/experiment/simulate";
import { p, readJson, readJsonl, writeJson } from "./common";

type Response = { preference?: "A" | "B" | "tie" | "neither"; fit?: Record<"A" | "B", Record<string, number>>; explanation?: Record<"A" | "B", number | null>; reason?: string };
const responsesFile = p("review", "responses.json");
if (!fs.existsSync(responsesFile)) {
  console.log("No human responses yet (experiment/review/responses.json). Human review: not collected.");
  writeJson(p("review", "human_results.json"), { collected: false, reviewers: 0 });
  process.exit(0);
}
const { reviewer, responses } = readJson<{ reviewer: string | null; responses: Record<string, Response> }>(responsesFile);
const { keys } = readJson<{ keys: { scenarioId: string; A: string; B: string; runIds: Record<string, string | null> }[] }>(p("review", "unblinding_key.json"));
const runs = new Map(readJsonl<RunRecord>(p("results", "runs.jsonl")).map((r) => [r.runId, r]));
const judgments = new Map(readJsonl<JudgeResult>(p("results", "judgments.jsonl")).map((j) => [j.key, j]));

const tally = { clef: 0, llm_baseline: 0, tie: 0, neither: 0, missing: 0 };
const disagreements: unknown[] = [];
const perScenario = keys.map((k) => {
  const r = responses[k.scenarioId];
  if (!r?.preference) {
    tally.missing++;
    return { scenarioId: k.scenarioId, preference: null };
  }
  const pref = r.preference === "A" ? k.A : r.preference === "B" ? k.B : r.preference;
  tally[pref as keyof typeof tally]++;
  // Model-judged preference: higher weakest fit, then mean.
  const modelScore = (method: string) => {
    const run = k.runIds[method] ? runs.get(k.runIds[method]!) : undefined;
    const rid = run?.outcome?.restaurantId;
    const j = rid ? judgments.get(judgeKey(k.scenarioId, rid)) : undefined;
    if (!j) return null;
    const xs = Object.values(j.scores).map((x) => x.score);
    return { weakest: Math.min(...xs), mean: xs.reduce((a, b) => a + b, 0) / xs.length };
  };
  const mc = modelScore("clef");
  const mb = modelScore("llm_baseline");
  let modelPref: string | null = null;
  if (mc && mb) modelPref = mc.weakest !== mb.weakest ? (mc.weakest > mb.weakest ? "clef" : "llm_baseline") : Math.abs(mc.mean - mb.mean) < 0.25 ? "tie" : mc.mean > mb.mean ? "clef" : "llm_baseline";
  if (modelPref && pref !== "neither" && modelPref !== pref) disagreements.push({ scenarioId: k.scenarioId, human: pref, model: modelPref, reason: r.reason ?? null });
  return { scenarioId: k.scenarioId, preference: pref, modelPreference: modelPref, reason: r.reason ?? null };
});

const decided = tally.clef + tally.llm_baseline;
writeJson(p("review", "human_results.json"), {
  collected: true,
  reviewers: 1,
  reviewer,
  disclosure: "Single human reviewer, who is also the developer.",
  sample: keys.length,
  tally,
  clefWinShareOfDecided: decided ? tally.clef / decided : null,
  disagreementsWithModelJudge: disagreements,
  perScenario,
});
console.log(tally, `${disagreements.length} disagreements with the model judge`);
