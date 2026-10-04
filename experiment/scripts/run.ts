/**
 * Execute experiment runs against the local dev Worker (DEV_ROUTES=on).
 * Resumable: run ids already in the output file are skipped. Failures are
 * recorded as runs and stay in every denominator.
 *
 *   pnpm exp:run --split=dev --track=fixed --repeats=3
 *   pnpm exp:run --split=test --track=flow
 */
import type { RunRecord } from "../../src/experiment/simulate";
import type { NormalizedGroup } from "../../src/shared/normalized";
import type { DecisionMethod } from "../../src/shared/types";
import { appendJsonl, args, loadScenarios, p, pool, post, readJson, readJsonl } from "./common";

type Manifest = { scenarios: { id: string; availability: Record<string, unknown> }[] };

const a = args();
const split = (a.split ?? "dev") as "dev" | "test";
const track = (a.track ?? "fixed") as "fixed" | "flow";
const repeats = track === "fixed" ? Number(a.repeats ?? 3) : 1;
const concurrency = Number(a.concurrency ?? 4);
const only = a.scenarios ? new Set(a.scenarios.split(",")) : null;
const methods: DecisionMethod[] = (a.methods ?? "clef,llm_baseline").split(",") as DecisionMethod[];

const tag = a.tag ? `.${a.tag}` : "";
const out = split === "test" ? p("results", "runs.jsonl") : p("results", "dev", `runs${tag}.jsonl`);
const done = new Set(readJsonl<RunRecord>(out).map((r) => r.runId));
const manifest = readJson<Manifest>(p("dataset_manifest.json"));
const frozenInputs: Record<string, NormalizedGroup> = track === "fixed" ? readJson(p("frozen", `fixed_state_inputs.${split}.json`)) : {};
const scenarios = loadScenarios().filter((s) => s.split === split && (!only || only.has(s.id)));

type Job = { scenarioIndex: number; repeat: number; method: DecisionMethod };
const jobs: Job[] = [];
scenarios.forEach((s, i) => {
  for (let r = 0; r < repeats; r++) {
    // Balance execution order: alternate which method runs first per scenario × repeat.
    const order = (i + r) % 2 === 0 ? methods : [...methods].reverse();
    for (const m of order) {
      const runId = track === "fixed" ? `fixed:${s.id}:${m}:${r}` : `flow:${s.id}:${m}`;
      if (!done.has(runId)) jobs.push({ scenarioIndex: i, repeat: r, method: m });
    }
  }
});

console.log(`${jobs.length} ${track} runs to do on ${split} (${done.size} already recorded) → ${out}`);
let finished = 0;
await pool(jobs, concurrency, async (job) => {
  const s = scenarios[job.scenarioIndex]!;
  const frozenAvailability = manifest.scenarios.find((m) => m.id === s.id)!.availability;
  const started = Date.now();
  let rec: RunRecord;
  try {
    rec = await post<RunRecord>(track, {
      scenario: s,
      method: job.method,
      repeat: job.repeat,
      frozenAvailability,
      ...(track === "fixed" ? { frozenGroup: frozenInputs[s.id] } : {}),
    });
  } catch (e) {
    rec = {
      runId: track === "fixed" ? `fixed:${s.id}:${job.method}:${job.repeat}` : `flow:${s.id}:${job.method}`,
      track,
      scenarioId: s.id,
      split,
      method: job.method,
      repeat: job.repeat,
      permutation: null,
      startedAt: new Date(started).toISOString(),
      ok: false,
      error: `harness:${(e as Error).message}`,
      outcome: null,
      phases: [],
      questions: [],
      hostCall: null,
      aiCalls: [],
    };
  }
  appendJsonl(out, { ...rec, wallMs: Date.now() - started, experimentVersion: "exp-v1" });
  finished++;
  const o = rec.outcome;
  console.log(`[${finished}/${jobs.length}] ${rec.runId} ${rec.ok ? (o?.kind === "result" ? o.restaurantId : o?.kind) : `ERROR ${rec.error}`} ${Date.now() - started}ms`);
});
