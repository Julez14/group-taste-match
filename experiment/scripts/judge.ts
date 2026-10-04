/**
 * Model-judged per-diner fit (kimi-k2.6) for every distinct scenario ×
 * selected restaurant in the run log. Identical items are judged once.
 *
 *   pnpm exp:judge --split=dev
 */
import { judgeKey, type JudgeResult } from "../../src/experiment/judge";
import type { RunRecord } from "../../src/experiment/simulate";
import { appendJsonl, args, loadScenarios, p, pool, post, readJson, readJsonl } from "./common";

type Manifest = { scenarios: { id: string; availability: Record<string, unknown> }[] };

const a = args();
const split = (a.split ?? "dev") as "dev" | "test";
const runsFile = split === "test" ? p("results", "runs.jsonl") : p("results", "dev", "runs.jsonl");
const out = split === "test" ? p("results", "judgments.jsonl") : p("results", "dev", "judgments.jsonl");
const manifest = readJson<Manifest>(p("dataset_manifest.json"));
const scenarios = new Map(loadScenarios().map((s) => [s.id, s]));
const done = new Set(readJsonl<JudgeResult>(out).map((j) => j.key));

const items = new Map<string, { scenarioId: string; restaurantId: string }>();
for (const r of readJsonl<RunRecord>(runsFile)) {
  const rid = r.outcome?.restaurantId;
  if (!rid) continue;
  const key = judgeKey(r.scenarioId, rid);
  if (!done.has(key)) items.set(key, { scenarioId: r.scenarioId, restaurantId: rid });
}
console.log(`${items.size} items to judge (${done.size} cached)`);
await pool([...items.values()], Number(a.concurrency ?? 4), async (item) => {
  const s = scenarios.get(item.scenarioId)!;
  const frozenAvailability = manifest.scenarios.find((m) => m.id === s.id)!.availability;
  try {
    const res = await post<{ result: JudgeResult; aiCalls: unknown[] }>("judge", { scenario: s, restaurantId: item.restaurantId, frozenAvailability });
    appendJsonl(out, { ...res.result, aiCalls: res.aiCalls, judgedAt: new Date().toISOString() });
    console.log(`${item.scenarioId} ${item.restaurantId}: ${Object.values(res.result.scores).map((x) => x.score).join(",")}`);
  } catch (e) {
    console.log(`${item.scenarioId} ${item.restaurantId}: JUDGE ERROR ${(e as Error).message}`);
  }
});
