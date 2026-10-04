/**
 * Build the method-blinded human review packet from each method's FIRST
 * pre-scheduled fixed-state run (repeat 0) on the held-out scenarios.
 * A/B order is randomized with a fixed seed; the unblinding key is written
 * to a separate file that the review page never loads.
 *
 *   pnpm exp:packet
 */
import fs from "node:fs";
import type { RunRecord } from "../../src/experiment/simulate";
import { meetingArea } from "../../src/shared/data";
import { formatDiningTime } from "../../src/shared/time";
import { clockLabel } from "../../src/server/hours";
import { snapshot } from "../../src/server/snapshot";
import { args, loadScenarios, p, readJson, readJsonl, writeJson } from "./common";

const a = args();
const track = (a.track ?? "fixed") as "fixed" | "flow";
const runs = readJsonl<RunRecord>(p("results", "runs.jsonl")).filter((r) => r.track === track && r.repeat === 0);
const manifest = readJson<{ scenarios: { id: string; availability: Record<string, { status: string; slots: string[] }> }[] }>(p("dataset_manifest.json"));
const restaurants = snapshot().restaurants;
const scenarios = loadScenarios().filter((s) => s.split === "test");

let seed = 20261004;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

function card(run: RunRecord | undefined, scenarioId: string) {
  if (!run || !run.ok || !run.outcome) return { kind: "error" as const, text: "No valid outcome (operational failure)." };
  if (run.outcome.kind === "no_match") return { kind: "no_match" as const, text: "No restaurant in the prototype's list meets everyone's must-haves." };
  const r = restaurants.find((x) => x.id === run.outcome!.restaurantId)!;
  const av = manifest.scenarios.find((m) => m.id === scenarioId)!.availability[r.id];
  return {
    kind: "result" as const,
    name: r.name,
    neighborhood: `${r.neighborhood}, ${r.borough}`,
    cuisines: r.cuisines,
    price: `$${r.mealEstimate.low}–$${r.mealEstimate.high} per person all-in`,
    atmosphere: r.atmosphere.map((x) => x.tag.replace(/_/g, " ")),
    dietary: [...new Set(r.menuOptions.map((o) => o.dietaryTag.replace(/_/g, " ")))],
    availability: av?.status === "reservable" ? `Simulated slots ${av.slots.map(clockLabel).join(", ")}` : (av?.status ?? "unknown"),
    explanation: run.outcome.explanation,
    assumptions: run.outcome.assumptions,
    website: r.websiteUrl,
  };
}

const items = scenarios.map((s) => {
  const clef = runs.find((r) => r.scenarioId === s.id && r.method === "clef");
  const base = runs.find((r) => r.scenarioId === s.id && r.method === "llm_baseline");
  const clefIsA = rand() < 0.5;
  const area = meetingArea(s.meetingAreaId)!;
  return {
    item: {
      scenarioId: s.id,
      when: formatDiningTime(s.diningAt),
      meetingArea: area.name,
      partySize: s.diners.length,
      diners: s.diners.map((d) => ({
        id: d.id,
        name: d.name,
        request: d.text ?? "(didn't respond in time)",
        clarifications: Object.values(d.facts),
        startingPoint: d.startAreaId ? meetingArea(d.startAreaId)!.name : `${area.name} (default)`,
      })),
      A: card(clefIsA ? clef : base, s.id),
      B: card(clefIsA ? base : clef, s.id),
    },
    key: { scenarioId: s.id, A: clefIsA ? "clef" : "llm_baseline", B: clefIsA ? "llm_baseline" : "clef", runIds: { clef: clef?.runId ?? null, llm_baseline: base?.runId ?? null } },
  };
});

writeJson(p("review", "packet.json"), { track, createdAt: new Date().toISOString(), items: items.map((i) => i.item) });
writeJson(p("review", "unblinding_key.json"), { note: "Do not open before review responses are final.", seed: 20261004, keys: items.map((i) => i.key) });

const md: string[] = [
  "# Blinded review packet — Group Taste-Match decision methods",
  "",
  `Held-out scenarios: ${items.length}. For each, two outcomes (A and B) produced by different methods from identical inputs (${track === "fixed" ? "fixed-state track, first pre-scheduled run" : "complete-flow track"}). Method names and internal scores are withheld; A/B order is randomized.`,
  "",
  "For each scenario record: overall preference (A, B, tie, neither acceptable), each diner's fit for A and B on the 0–4 rubric (0 poor · 1 weak · 2 acceptable · 3 good · 4 excellent), explanation quality (1–5), and a short reason. Use the local review page (`pnpm review`) to save responses to `experiment/review/responses.json`.",
  "",
  "Disclosure: there is a single human reviewer, who is also the developer.",
  "",
];
for (const { item } of items) {
  md.push(`## ${item.scenarioId} — ${item.when}, near ${item.meetingArea}, party of ${item.partySize}`, "");
  for (const d of item.diners) {
    md.push(`- **${d.name}** (from ${d.startingPoint}): “${d.request}”${d.clarifications.length ? ` — clarified: “${d.clarifications.join(" ")}”` : ""}`);
  }
  for (const side of ["A", "B"] as const) {
    const c = item[side];
    md.push("", `**${side}:** ${c.kind === "result" ? `${c.name} — ${c.cuisines.join(", ")}, ${c.neighborhood}. ${c.price}. ${c.atmosphere.join(", ")}. Dietary: ${c.dietary.join(", ") || "none listed"}. ${c.availability}.` : c.text}`);
    if (c.kind === "result") {
      md.push(`  - Explanation: ${c.explanation}`);
      if (c.assumptions.length) md.push(`  - Assumptions: ${c.assumptions.join(" / ")}`);
    }
  }
  md.push("", "Preference: ☐ A ☐ B ☐ Tie ☐ Neither acceptable · Reason: ________", "");
}
fs.writeFileSync(p("review", "blinded_review_packet.md"), `${md.join("\n")}\n`);
console.log(`wrote packet for ${items.length} scenarios`);
