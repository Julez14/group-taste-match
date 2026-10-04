/**
 * Fixed-state freeze: normalize each scenario once (after supplying its
 * truthful clarification facts) so both methods receive the identical state.
 *
 *   pnpm exp:freeze --split=dev
 */
import fs from "node:fs";
import type { NormalizedGroup } from "../../src/shared/normalized";
import { args, fileHash, loadScenarios, p, pool, post, readJson, writeJson } from "./common";

type Manifest = { scenarios: { id: string; availability: Record<string, unknown> }[] };

const { split = "dev", concurrency = "4", force } = args();
const out = p("frozen", `fixed_state_inputs.${split}.json`);
const existing: Record<string, NormalizedGroup> = fs.existsSync(out) && !force ? readJson(out) : {};
const manifest = readJson<Manifest>(p("dataset_manifest.json"));
const scenarios = loadScenarios().filter((s) => s.split === split && !existing[s.id]);

console.log(`freezing ${scenarios.length} ${split} scenarios`);
await pool(scenarios, Number(concurrency), async (s) => {
  const t = Date.now();
  const frozenAvailability = manifest.scenarios.find((m) => m.id === s.id)!.availability;
  // Freezing inputs is not a method run, so operational retries are allowed here.
  let res: { group: NormalizedGroup } | null = null;
  for (let attempt = 1; attempt <= 3 && !res; attempt++) {
    try {
      res = await post<{ group: NormalizedGroup }>("freeze", { scenario: s, frozenAvailability });
    } catch (e) {
      console.log(`${s.id} freeze attempt ${attempt} failed: ${(e as Error).message}`);
    }
  }
  if (!res) return;
  existing[s.id] = res.group;
  writeJson(out, existing);
  console.log(`${s.id} frozen in ${Date.now() - t} ms`);
});
console.log(`wrote ${out} sha256=${fileHash(out)}`);
