/**
 * Write the frozen, machine-readable protocol before held-out runs.
 *
 *   pnpm exp:protocol
 */
import { execSync } from "node:child_process";
import { JUDGE_MODEL, JUDGE_PROMPT_VERSION, JUDGE_SETTINGS } from "../../src/experiment/judge";
import { CLARIFY_POLICY } from "../../src/server/clarify";
import { CLEF_MAX_QUESTIONS, CLEF_MODEL, CLEF_RUBRIC_VERSION, FIT_CRITERIA } from "../../src/server/clef";
import { EXPLAIN_PROMPT_VERSION, EXPLANATION_RULES, QUESTION_RULES } from "../../src/server/explain";
import { INTERPRET_PROMPT_VERSION, INTERPRET_SYSTEM, PATCH_SYSTEM } from "../../src/server/interpret";
import { DEFAULT_LLM_SETTINGS, LLM_MODEL } from "../../src/server/llm";
import { BASELINE_PROMPT_VERSION, BASELINE_SETTINGS, BASELINE_SYSTEM } from "../../src/server/methods/baseline-method";
import { POLICY } from "../../src/server/policy";
import { STT_MODEL } from "../../src/server/transcribe";
import { fileHash, p, sha256, writeJson } from "./common";

const commit = execSync("git rev-parse HEAD").toString().trim();
const dirty = execSync("git status --porcelain -- src data experiment/scenarios").toString().trim().length > 0;

writeJson(p("protocol.json"), {
  experimentVersion: "exp-v1",
  frozenAt: new Date().toISOString(),
  codeCommit: commit,
  workingTreeDirtyForFrozenPaths: dirty,
  purpose: "Compare the Clef pipeline with a simple general-purpose LLM baseline for single-restaurant group decisions (PRD + experiment plan v1.0).",
  dataset: {
    manifest: "experiment/dataset_manifest.json",
    manifestSha256: fileHash(p("dataset_manifest.json")),
    scenarios: "experiment/scenarios/v1.json",
    split: { dev: 20, test: 40 },
    tuningPolicy: "Prompts, rubric, safeguards, and thresholds were tuned only on the 20 development scenarios. The held-out test set is run once under this protocol; any later change is a new experiment version.",
  },
  sharedPipeline: {
    interpretation: { model: LLM_MODEL, settings: DEFAULT_LLM_SETTINGS, promptVersion: INTERPRET_PROMPT_VERSION, promptSha256: sha256(INTERPRET_SYSTEM), clarificationPatchPromptSha256: sha256(PATCH_SYSTEM), safeguards: ["groundHardConstraints", "backstopHardConstraints", "enforceBudgetBasis"] },
    speechToText: STT_MODEL,
    feasibilityGuard: "src/server/feasibility.ts (hours, simulated availability, budget basis, dietary verification, travel, reservations); applied before selection and again before delivery",
    privacyFilter: "src/server/privacy.ts (names, stated budget amounts, non-default origins, allergy/medical details); leaking explanations replaced by a neutral template, counted per method",
    gateway: "group-taste-match (caching off)",
  },
  methods: {
    clef: {
      model: CLEF_MODEL,
      rubricVersion: CLEF_RUBRIC_VERSION,
      rubric: FIT_CRITERIA,
      maxQuestionsPerCall: CLEF_MAX_QUESTIONS,
      policy: POLICY,
      clarifyPolicy: CLARIFY_POLICY,
      wordingModel: LLM_MODEL,
      explainPromptVersion: EXPLAIN_PROMPT_VERSION,
      explanationRulesSha256: sha256(EXPLANATION_RULES),
      questionRulesSha256: sha256(QUESTION_RULES),
    },
    llm_baseline: { model: LLM_MODEL, settings: { ...DEFAULT_LLM_SETTINGS, ...BASELINE_SETTINGS }, promptVersion: BASELINE_PROMPT_VERSION, promptSha256: sha256(BASELINE_SYSTEM) },
  },
  retryPolicy: {
    schemaRepair: "one bounded repair per LLM call (both methods)",
    guardRecovery: "one re-proposal with the rejection reason (both methods)",
    crossMethodFallback: "never; failures count against the originating method",
    operationalRetries: "none inside the harness; failed runs stay in denominators",
  },
  tracks: {
    fixedState: { scenarios: 40, repeatsPerMethod: 3, totalRuns: 240, clarificationAndHostDisabled: true, permutations: "seeded candidate and diner order per scenario × repeat, identical for both methods", executionOrder: "alternating method order by scenario index + repeat" },
    completeFlow: { scenarios: 40, sessionsPerMethod: 1, totalSessions: 80, simulator: "answers only from prewritten facts; anything else times out; host answers from the scenario's true soft priority" },
  },
  evaluation: {
    hardConstraints: "deterministic, against prelabeled ground truth for each run's effective requirements (fixed-state: all clarifications supplied; flow: explicit + actually-answered clarifications; unclarified budget basis judged as all-in)",
    subjectiveFit: { model: JUDGE_MODEL, settings: JUDGE_SETTINGS, promptVersion: JUDGE_PROMPT_VERSION, blinded: true, label: "model-judged", cache: "one judgment per scenario × restaurant" },
    human: { reviewers: 1, disclosure: "single human reviewer, who is also the developer", material: "experiment/review/blinded_review_packet.md (first pre-scheduled fixed-state run, randomized A/B)", role: "decides the shipped method (per project owner); the model-judged scorer is secondary and disagreements are reported" },
  },
  metrics: {
    primary: "acceptable group rate: among feasible scenarios, share of runs returning a valid restaurant with model-judged fit ≥2/4 for every diner; abstention or failure counts as failure",
    secondary: ["raw and delivered hard-constraint violations by type", "weakest-diner fit (failures = 0) and mean fit", "correct no-match and false no-match", "evidence grounding (unknown ids, privacy leaks caught)", "clarification burden and host-call rate (flow)", "reliability (valid outcomes, errors, schema repairs, guard rejections)", "p50/p95 latency", "estimated cost (decision-only and total; judge separate)", "repeat agreement"],
    statistics: { ci: "95% percentile bootstrap, paired, resampling whole scenarios (repeats kept together)", iterations: 10000, seed: 20261004 },
  },
  selectionRule: {
    safetyGate: "any delivered hard-constraint violation or invented restaurant requires diagnosis before a method is declared demo-ready",
    practicalDifference: 0.05,
    rule: "prefer a method for quality when its paired acceptable-rate advantage is ≥5 points with a 95% CI excluding zero and no material regression in correct no-match; otherwise prefer the simpler/cheaper/faster method on operational evidence; complete-flow results can veto for burden or failures; automated-only evidence is provisional",
    humanOverride: "per the project owner, the blinded human A/B review on the 40 held-out scenarios decides the shipped method; the report explains any disagreement with the automated rule",
  },
  budget: { capUsd: 10, scope: "held-out serving runs (fixed + flow) and model judging; development spend tracked separately", stopRule: "stop and report actual sample if estimated spend reaches the cap" },
});
console.log(`protocol frozen at ${commit}${dirty ? " (dirty)" : ""}`);
