/**
 * Prelabel every scenario from ground truth only (no model calls) and write
 * the dataset manifest: frozen availability fixtures, true feasible sets,
 * expected no-match outcomes, splits, and content hashes.
 *
 *   pnpm exp:labels
 */
import { frozenAvailabilityFor, truthLabels } from "../../src/experiment/truth";
import { DATA_VERSIONS } from "../../src/shared/data";
import { AVAILABILITY_METHOD } from "../../src/server/availability";
import { snapshot } from "../../src/server/snapshot";
import { TRAVEL_METHOD } from "../../src/server/travel";
import { fileHash, loadScenarios, p, ROOT, writeJson } from "./common";

const scenarios = loadScenarios();
const restaurants = snapshot().restaurants;

const entries = scenarios.map((s) => {
  const availability = frozenAvailabilityFor(s, restaurants);
  const labels = truthLabels(s, restaurants, availability);
  const explicitOnly = truthLabels(s, restaurants, availability, new Set());
  return {
    id: s.id,
    baseId: s.baseId,
    family: s.family,
    split: s.split,
    groupSize: s.diners.length,
    diningAt: s.diningAt,
    expectedNoMatch: labels.expectedNoMatch,
    trueFeasibleIds: labels.feasibleIds,
    /** Without any clarification (explicit requirements only, unclear budgets as all-in). */
    explicitOnlyNoMatch: explicitOnly.expectedNoMatch,
    explicitOnlyFeasibleIds: explicitOnly.feasibleIds,
    clarificationFacts: s.diners.flatMap((d) => Object.keys(d.facts).map((k) => `${d.id}:${k}`)),
    nonresponders: s.diners.filter((d) => d.text === null).map((d) => d.id),
    availability: Object.fromEntries(Object.entries(availability).map(([id, a]) => [id, { status: a.status, slots: a.slots, reason: a.reason, key: a.key }])),
  };
});

const manifest = {
  experimentVersion: "exp-v1",
  createdAt: new Date().toISOString(),
  note: "Labels derive only from prelabeled ground truth and frozen data; written before held-out model runs.",
  files: {
    restaurants: { path: "data/v1/restaurants.json", version: snapshot().version, sha256: fileHash(`${ROOT}/data/v1/restaurants.json`) },
    profiles: { path: "data/v1/profiles.json", version: DATA_VERSIONS.profiles, sha256: fileHash(`${ROOT}/data/v1/profiles.json`) },
    meetingAreas: { path: "data/v1/meeting-areas.json", version: DATA_VERSIONS.meetingAreas, sha256: fileHash(`${ROOT}/data/v1/meeting-areas.json`) },
    scenarios: { path: "experiment/scenarios/v1.json", sha256: fileHash(p("scenarios", "v1.json")) },
  },
  methods: { travel: TRAVEL_METHOD, availability: { ...AVAILABILITY_METHOD, seedPrefix: "exp-v1:<scenarioId>" } },
  splits: {
    dev: entries.filter((e) => e.split === "dev").map((e) => e.id),
    test: entries.filter((e) => e.split === "test").map((e) => e.id),
  },
  counts: {
    total: entries.length,
    infeasibleTotal: entries.filter((e) => e.expectedNoMatch).length,
    infeasibleTest: entries.filter((e) => e.expectedNoMatch && e.split === "test").length,
    infeasibleExplicitOnlyTotal: entries.filter((e) => e.explicitOnlyNoMatch).length,
    infeasibleExplicitOnlyTest: entries.filter((e) => e.explicitOnlyNoMatch && e.split === "test").length,
  },
  scenarios: entries,
};
writeJson(p("dataset_manifest.json"), manifest);

for (const e of entries) {
  console.log(`${e.id} ${e.split.padEnd(4)} ${e.family.padEnd(22)} n=${e.groupSize} feasible=${String(e.trueFeasibleIds.length).padStart(2)} explicitOnly=${String(e.explicitOnlyFeasibleIds.length).padStart(2)} ${e.expectedNoMatch ? "NO-MATCH" : ""}`);
}
console.log(manifest.counts);
