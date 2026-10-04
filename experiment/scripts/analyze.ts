/**
 * Independent evaluation and aggregate metrics. Uses ground-truth labels and
 * frozen data for constraints, and model-judged (kimi-k2.6) per-diner fit for
 * quality — never Clef scores or a method's self-assessment.
 *
 *   pnpm exp:analyze --split=test            (writes experiment/results/metrics.csv + summary.json)
 *   pnpm exp:analyze --split=dev --tag=iter2
 */
import fs from "node:fs";
import type { JudgeResult } from "../../src/experiment/judge";
import { judgeKey } from "../../src/experiment/judge";
import type { Scenario } from "../../src/experiment/scenario";
import type { RunRecord } from "../../src/experiment/simulate";
import { type FactsGiven, truthLabels, truthViolations } from "../../src/experiment/truth";
import type { DecisionMethod } from "../../src/shared/types";
import type { AiCallRecord } from "../../src/server/ai";
import type { Availability } from "../../src/server/availability";
import { snapshot } from "../../src/server/snapshot";
import { args, loadScenarios, p, readJson, readJsonl, writeJson } from "./common";

/** Workers AI list prices from the account model catalog API, retrieved 2026-10-04. */
export const PRICING = {
  retrieved: "2026-10-04",
  source: "Cloudflare API GET /accounts/{id}/ai/models/search (model properties: price)",
  perMillion: {
    "@cf/cloudflare/clef": { input: 0.24, output: 0 },
    "@cf/openai/gpt-oss-120b": { input: 0.35, output: 0.75 },
    "@cf/moonshotai/kimi-k2.6": { input: 0.95, output: 4.0 },
  } as Record<string, { input: number; output: number }>,
  perAudioMinute: { "@cf/deepgram/nova-3": 0.0052 },
};

export const BOOTSTRAP = { iterations: 10000, seed: 20261004, method: "percentile, paired, resampling whole scenarios" };

const a = args();
const split = (a.split ?? "dev") as "dev" | "test";
const tag = a.tag ? `.${a.tag}` : "";
const runsFile = split === "test" ? p("results", "runs.jsonl") : p("results", "dev", `runs${tag}.jsonl`);
const judgeFile = split === "test" ? p("results", "judgments.jsonl") : p("results", "dev", "judgments.jsonl");
const outDir = split === "test" ? p("results") : p("results", "dev");

type Manifest = { scenarios: { id: string; family: string; groupSize: number; availability: Record<string, Availability> }[] };
const manifest = readJson<Manifest>(p("dataset_manifest.json"));
const scenarios = new Map<string, Scenario>(loadScenarios().map((s) => [s.id, s]));
const restaurants = snapshot().restaurants;
const judgments = new Map(readJsonl<JudgeResult>(judgeFile).map((j) => [j.key, j]));
const runs = readJsonl<RunRecord & { wallMs?: number }>(runsFile);

function cost(calls: AiCallRecord[]): number {
  return calls.reduce((sum, c) => {
    const price = PRICING.perMillion[c.model];
    if (!price) return sum;
    return sum + ((c.usage.promptTokens ?? 0) * price.input + (c.usage.completionTokens ?? 0) * price.output) / 1e6;
  }, 0);
}

const isDecisionCall = (c: AiCallRecord) => !c.purpose.startsWith("interpret") && c.purpose !== "transcription";

export type Evaluated = {
  run: RunRecord & { wallMs?: number };
  scenario: Scenario;
  family: string;
  groupSize: number;
  expectedNoMatch: boolean;
  outcome: "result" | "no_match" | "error";
  restaurantId: string | null;
  deliveredViolations: string[];
  rawViolations: string[];
  rawUnknownIds: number;
  guardRejections: number;
  privacyLeaks: number;
  schemaRepairs: number;
  judged: boolean;
  dinerScores: number[];
  acceptable: boolean | null; // null on infeasible scenarios
  weakest: number | null;
  mean: number | null;
  correctNoMatch: boolean | null;
  falseNoMatch: boolean | null;
  questions: number;
  needlessQuestions: number;
  hostCall: boolean;
  decisionMs: number;
  automatedMs: number;
  phaseMs: number[];
  cost: number;
  decisionCost: number;
};

function evaluate(run: RunRecord & { wallMs?: number }): Evaluated {
  const s = scenarios.get(run.scenarioId)!;
  const m = manifest.scenarios.find((x) => x.id === s.id)!;
  const frozen = m.availability;
  const given: FactsGiven = run.track === "fixed" ? "all" : new Set(run.questions.filter((q) => q.answered && q.kind).map((q) => `${q.participantId}:${q.kind}`));
  const expectedNoMatch = truthLabels(s, restaurants, frozen, given).expectedNoMatch;
  const outcome = run.ok && run.outcome ? run.outcome.kind : "error";
  const restaurantId = run.outcome?.restaurantId ?? null;
  const deliveredViolations =
    outcome === "result" ? truthViolations(s, restaurants.find((r) => r.id === restaurantId), frozen, given).violations.map((v) => v.type) : [];
  const proposals = run.phases.flatMap((ph) => ph.records.map((r) => r.proposal));
  const rawViolations: string[] = [];
  let rawUnknownIds = 0;
  for (const pr of proposals) {
    if (pr.kind !== "recommend") continue;
    const r = restaurants.find((x) => x.id === pr.restaurantId);
    if (!r) rawUnknownIds++;
    rawViolations.push(...truthViolations(s, r, frozen, given).violations.map((v) => v.type));
  }
  const records = run.phases.flatMap((ph) => ph.records);
  const j = restaurantId ? judgments.get(judgeKey(s.id, restaurantId)) : undefined;
  const dinerScores = j ? s.diners.map((d) => j.scores[d.id]?.score ?? 0) : [];
  const feasible = !expectedNoMatch;
  const delivered = outcome === "result" && deliveredViolations.length === 0;
  let acceptable: boolean | null = null;
  let weakest: number | null = null;
  let mean: number | null = null;
  if (feasible) {
    if (delivered && j) {
      weakest = Math.min(...dinerScores);
      mean = dinerScores.reduce((x, y) => x + y, 0) / dinerScores.length;
      acceptable = dinerScores.every((x) => x >= 2);
    } else if (!delivered) {
      weakest = 0;
      mean = 0;
      acceptable = false;
    }
  }
  const decisionMs = run.phases.reduce((t, ph) => t + ph.decisionMs, 0);
  const automatedMs = run.phases.reduce((t, ph) => t + ph.totalMs, 0);
  return {
    run,
    scenario: s,
    family: s.family,
    groupSize: s.diners.length,
    expectedNoMatch,
    outcome,
    restaurantId,
    deliveredViolations,
    rawViolations,
    rawUnknownIds,
    guardRejections: records.filter((r) => !r.accepted).length,
    privacyLeaks: records.reduce((t, r) => t + (r.privacyLeaks?.length ?? 0), 0),
    schemaRepairs: run.aiCalls.filter((c) => c.purpose.endsWith(":repair")).length,
    judged: Boolean(j),
    dinerScores,
    acceptable,
    weakest,
    mean,
    correctNoMatch: expectedNoMatch ? outcome === "no_match" : null,
    falseNoMatch: feasible ? outcome === "no_match" : null,
    questions: run.questions.length,
    needlessQuestions: run.questions.filter((q) => !q.answered).length,
    hostCall: Boolean(run.hostCall),
    decisionMs,
    automatedMs,
    phaseMs: run.phases.map((ph) => ph.totalMs),
    cost: cost(run.aiCalls),
    decisionCost: cost(run.aiCalls.filter(isDecisionCall)),
  };
}

const evaluated = runs.map(evaluate);

// ---------- statistics ----------
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function quantile(sorted: number[], q: number) {
  if (!sorted.length) return Number.NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

const pct = (xs: number[], q: number) => quantile([...xs].sort((x, y) => x - y), q);

/** Mean over runs, scenario-clustered bootstrap CI. */
function clusteredRate(rows: Evaluated[], value: (e: Evaluated) => number | null) {
  const byScenario = new Map<string, number[]>();
  for (const e of rows) {
    const v = value(e);
    if (v === null) continue;
    byScenario.set(e.scenario.id, [...(byScenario.get(e.scenario.id) ?? []), v]);
  }
  const ids = [...byScenario.keys()];
  const all = ids.flatMap((id) => byScenario.get(id)!);
  const point = all.length ? all.reduce((x, y) => x + y, 0) / all.length : Number.NaN;
  const rand = mulberry32(BOOTSTRAP.seed);
  const stats: number[] = [];
  for (let b = 0; b < BOOTSTRAP.iterations && ids.length; b++) {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < ids.length; i++) {
      const vs = byScenario.get(ids[Math.floor(rand() * ids.length)]!)!;
      for (const v of vs) {
        sum += v;
        n++;
      }
    }
    stats.push(sum / n);
  }
  return { numerator: all.reduce((x, y) => x + y, 0), denominator: all.length, scenarios: ids.length, value: point, ciLow: pct(stats, 0.025), ciHigh: pct(stats, 0.975) };
}

/** Paired difference A − B over scenarios present for both, resampling whole scenarios. */
function pairedDiff(rowsA: Evaluated[], rowsB: Evaluated[], value: (e: Evaluated) => number | null) {
  const collect = (rows: Evaluated[]) => {
    const m = new Map<string, number[]>();
    for (const e of rows) {
      const v = value(e);
      if (v !== null) m.set(e.scenario.id, [...(m.get(e.scenario.id) ?? []), v]);
    }
    return m;
  };
  const A = collect(rowsA);
  const B = collect(rowsB);
  const ids = [...A.keys()].filter((id) => B.has(id));
  const meanOf = (xs: number[]) => xs.reduce((x, y) => x + y, 0) / xs.length;
  const diffs = ids.map((id) => meanOf(A.get(id)!) - meanOf(B.get(id)!));
  const point = diffs.length ? meanOf(diffs) : Number.NaN;
  const rand = mulberry32(BOOTSTRAP.seed + 1);
  const stats: number[] = [];
  for (let b = 0; b < BOOTSTRAP.iterations && ids.length; b++) {
    let sum = 0;
    for (let i = 0; i < ids.length; i++) sum += diffs[Math.floor(rand() * ids.length)]!;
    stats.push(sum / ids.length);
  }
  return { scenarios: ids.length, value: point, ciLow: pct(stats, 0.025), ciHigh: pct(stats, 0.975) };
}

// ---------- aggregate ----------
type Row = { track: string; method: string; metric: string; numerator: number | string; denominator: number | string; value: number; ciLow?: number; ciHigh?: number; note?: string };
const rows: Row[] = [];
const methods: DecisionMethod[] = ["clef", "llm_baseline"];
const tracks = ["fixed", "flow"] as const;
const summary: Record<string, unknown> = { split, generatedAt: new Date().toISOString(), pricing: PRICING, bootstrap: BOOTSTRAP, tracks: {} };

for (const track of tracks) {
  const trackRows = evaluated.filter((e) => e.run.track === track);
  if (!trackRows.length) continue;
  const perMethod: Record<string, unknown> = {};
  for (const m of methods) {
    const R = trackRows.filter((e) => e.run.method === m);
    if (!R.length) continue;
    const add = (metric: string, r: { numerator: number; denominator: number; value: number; ciLow?: number; ciHigh?: number }, note?: string) =>
      rows.push({ track, method: m, metric, ...r, ...(note ? { note } : {}) });
    const acc = clusteredRate(R, (e) => (e.acceptable === null ? null : e.acceptable ? 1 : 0));
    add("acceptable_group_rate", acc, "feasible scenarios; failures count; model-judged ≥2/4 for every diner");
    const weakest = clusteredRate(R, (e) => e.weakest);
    add("weakest_diner_fit", weakest, "feasible scenarios; failures = 0; model-judged");
    const meanFit = clusteredRate(R, (e) => e.mean);
    add("mean_group_fit", meanFit, "feasible scenarios; failures = 0; model-judged");
    const unjudged = R.filter((e) => e.outcome === "result" && !e.judged).length;
    add("unjudged_results", { numerator: unjudged, denominator: R.filter((e) => e.outcome === "result").length, value: unjudged });
    const correct = clusteredRate(R, (e) => (e.correctNoMatch === null ? null : e.correctNoMatch ? 1 : 0));
    add("correct_no_match_rate", correct, "infeasible under effective requirements");
    const falseNm = clusteredRate(R, (e) => (e.falseNoMatch === null ? null : e.falseNoMatch ? 1 : 0));
    add("false_no_match_rate", falseNm, "feasible scenarios");
    const delivered = R.filter((e) => e.deliveredViolations.length > 0).length;
    add("delivered_hard_violation_runs", { numerator: delivered, denominator: R.length, value: delivered / R.length });
    const rawRuns = R.filter((e) => e.rawViolations.length > 0).length;
    add("raw_proposal_violation_runs", { numerator: rawRuns, denominator: R.length, value: rawRuns / R.length }, "before the shared guard");
    const byType: Record<string, number> = {};
    for (const e of R) for (const t of e.rawViolations) byType[t] = (byType[t] ?? 0) + 1;
    for (const [t, n] of Object.entries(byType)) add(`raw_violations:${t}`, { numerator: n, denominator: R.length, value: n });
    add("guard_rejections", { numerator: R.reduce((t, e) => t + e.guardRejections, 0), denominator: R.length, value: R.reduce((t, e) => t + e.guardRejections, 0) / R.length });
    add("unknown_restaurant_ids", { numerator: R.reduce((t, e) => t + e.rawUnknownIds, 0), denominator: R.length, value: R.reduce((t, e) => t + e.rawUnknownIds, 0) });
    add("privacy_leaks_caught", { numerator: R.reduce((t, e) => t + e.privacyLeaks, 0), denominator: R.length, value: R.reduce((t, e) => t + e.privacyLeaks, 0) });
    const okRuns = R.filter((e) => e.outcome !== "error").length;
    add("completed_valid_outcomes", { numerator: okRuns, denominator: R.length, value: okRuns / R.length });
    add("schema_repairs", { numerator: R.reduce((t, e) => t + e.schemaRepairs, 0), denominator: R.length, value: R.reduce((t, e) => t + e.schemaRepairs, 0) });
    const dms = R.filter((e) => e.outcome !== "error").map((e) => e.decisionMs);
    add("decision_latency_p50_ms", { numerator: "", denominator: dms.length, value: pct(dms, 0.5) } as never);
    add("decision_latency_p95_ms", { numerator: "", denominator: dms.length, value: pct(dms, 0.95) } as never);
    if (track === "flow") {
      const phases = R.filter((e) => e.outcome !== "error").flatMap((e) => e.phaseMs);
      add("phase_latency_p50_ms", { numerator: "", denominator: phases.length, value: pct(phases, 0.5) } as never, "automated time per processing phase incl. interpretation");
      add("phase_latency_p95_ms", { numerator: "", denominator: phases.length, value: pct(phases, 0.95) } as never);
      const auto = R.filter((e) => e.outcome !== "error").map((e) => e.automatedMs);
      add("session_automated_p50_ms", { numerator: "", denominator: auto.length, value: pct(auto, 0.5) } as never);
      add("session_automated_p95_ms", { numerator: "", denominator: auto.length, value: pct(auto, 0.95) } as never);
      const q = R.reduce((t, e) => t + e.questions, 0);
      const diners = R.reduce((t, e) => t + e.groupSize, 0);
      add("questions_per_session", { numerator: q, denominator: R.length, value: q / R.length });
      add("questions_per_diner", { numerator: q, denominator: diners, value: q / diners });
      add("unanswerable_questions", { numerator: R.reduce((t, e) => t + e.needlessQuestions, 0), denominator: q, value: q ? R.reduce((t, e) => t + e.needlessQuestions, 0) / q : 0 }, "asked about something with no prewritten fact");
      const host = R.filter((e) => e.hostCall).length;
      add("host_call_rate", { numerator: host, denominator: R.length, value: host / R.length });
    }
    const costs = R.map((e) => e.cost);
    add("cost_per_run_usd", { numerator: costs.reduce((x, y) => x + y, 0), denominator: R.length, value: costs.reduce((x, y) => x + y, 0) / R.length }, "estimated from token usage × dated list prices");
    const dcost = R.map((e) => e.decisionCost);
    add("decision_cost_per_run_usd", { numerator: dcost.reduce((x, y) => x + y, 0), denominator: R.length, value: dcost.reduce((x, y) => x + y, 0) / R.length });
    if (track === "fixed") {
      const byScenario = new Map<string, string[]>();
      for (const e of R) byScenario.set(e.scenario.id, [...(byScenario.get(e.scenario.id) ?? []), e.restaurantId ?? e.outcome]);
      const agreements = [...byScenario.values()].filter((v) => v.length > 1).map((v) => {
        const counts = new Map<string, number>();
        for (const x of v) counts.set(x, (counts.get(x) ?? 0) + 1);
        return Math.max(...counts.values()) / v.length;
      });
      if (agreements.length) add("repeat_agreement", { numerator: agreements.reduce((x, y) => x + y, 0), denominator: agreements.length, value: agreements.reduce((x, y) => x + y, 0) / agreements.length }, "share of repeats matching the modal choice (permuted order)");
    }
    perMethod[m] = {
      runs: R.length,
      acceptable: acc,
      weakest,
      meanFit,
      correctNoMatch: correct,
      falseNoMatch: falseNm,
      byFamily: Object.fromEntries(
        [...new Set(R.map((e) => e.family))].map((f) => [f, clusteredRate(R.filter((e) => e.family === f), (e) => (e.acceptable === null ? null : e.acceptable ? 1 : 0))]),
      ),
      bySize: Object.fromEntries(
        [2, 3, 4, 5, 6].map((n) => [n, clusteredRate(R.filter((e) => e.groupSize === n), (e) => (e.acceptable === null ? null : e.acceptable ? 1 : 0))]),
      ),
    };
  }
  const C = trackRows.filter((e) => e.run.method === "clef");
  const B = trackRows.filter((e) => e.run.method === "llm_baseline");
  const diff = pairedDiff(C, B, (e) => (e.acceptable === null ? null : e.acceptable ? 1 : 0));
  rows.push({ track, method: "clef_minus_baseline", metric: "acceptable_group_rate_diff", numerator: "", denominator: diff.scenarios, value: diff.value, ciLow: diff.ciLow, ciHigh: diff.ciHigh, note: "paired by scenario" });
  const wdiff = pairedDiff(C, B, (e) => e.weakest);
  rows.push({ track, method: "clef_minus_baseline", metric: "weakest_diner_fit_diff", numerator: "", denominator: wdiff.scenarios, value: wdiff.value, ciLow: wdiff.ciLow, ciHigh: wdiff.ciHigh });
  (summary.tracks as Record<string, unknown>)[track] = { perMethod, acceptableDiff: diff, weakestDiff: wdiff };
}

// Judge cost (evaluation, separate from serving cost).
const judgeCost = [...judgments.values()].reduce((t, j) => t + cost(((j as unknown as { aiCalls?: AiCallRecord[] }).aiCalls ?? []) as AiCallRecord[]), 0);
rows.push({ track: "evaluation", method: "kimi_judge", metric: "judge_cost_usd", numerator: judgments.size, denominator: "items", value: judgeCost });
summary.judgeCost = judgeCost;
summary.totalServingCost = evaluated.reduce((t, e) => t + e.cost, 0);
summary.runCounts = Object.fromEntries(tracks.map((t) => [t, evaluated.filter((e) => e.run.track === t).length]));

const csvCell = (v: unknown) => (typeof v === "number" ? (Number.isFinite(v) ? String(Math.round(v * 10000) / 10000) : "") : `"${String(v ?? "").replace(/"/g, '""')}"`);
const header = ["track", "method", "metric", "numerator", "denominator", "value", "ci_low", "ci_high", "note"];
const csv = [header.join(","), ...rows.map((r) => [r.track, r.method, r.metric, r.numerator, r.denominator, r.value, r.ciLow ?? "", r.ciHigh ?? "", r.note ?? ""].map(csvCell).join(","))].join("\n");
fs.writeFileSync(`${outDir}/metrics${split === "dev" ? tag : ""}.csv`, `${csv}\n`);
writeJson(`${outDir}/summary${split === "dev" ? tag : ""}.json`, summary);
writeJson(
  `${outDir}/evaluated${split === "dev" ? tag : ""}.json`,
  evaluated.map((e) => ({
    runId: e.run.runId,
    track: e.run.track,
    method: e.run.method,
    scenarioId: e.scenario.id,
    family: e.family,
    groupSize: e.groupSize,
    expectedNoMatch: e.expectedNoMatch,
    outcome: e.outcome,
    restaurantId: e.restaurantId,
    deliveredViolations: e.deliveredViolations,
    rawViolations: e.rawViolations,
    dinerScores: e.dinerScores,
    acceptable: e.acceptable,
    weakest: e.weakest,
    questions: e.questions,
    hostCall: e.hostCall,
    decisionMs: e.decisionMs,
    automatedMs: e.automatedMs,
    cost: e.cost,
    error: e.run.error,
  })),
);

for (const r of rows.filter((x) => !x.metric.startsWith("raw_violations:"))) {
  const v = Number.isFinite(r.value) ? (Math.abs(r.value) < 10 ? r.value.toFixed(3) : r.value.toFixed(0)) : "—";
  const ci = r.ciLow !== undefined && Number.isFinite(r.ciLow) ? ` [${r.ciLow.toFixed(3)}, ${r.ciHigh!.toFixed(3)}]` : "";
  console.log(`${r.track.padEnd(10)} ${r.method.padEnd(19)} ${r.metric.padEnd(32)} ${String(r.numerator).padStart(8)}/${String(r.denominator).padEnd(5)} ${v}${ci}`);
}
