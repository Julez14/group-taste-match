/** Offline replay of exp-v1 Clef scores. Run: pnpm exec tsx experiment/scripts/compare-selection.ts */
import assert from "node:assert/strict";
import fs from "node:fs";
import type { RunRecord } from "../../src/experiment/simulate";
import type { NormalizedGroup } from "../../src/shared/normalized";
import { profile } from "../../src/shared/data";
import { snapshot } from "../../src/server/snapshot";
import type { ScoreTable } from "../../src/server/clef";
import { rankCandidates, type Ranked } from "../../src/server/policy";
import { describeTravel, estimateTravel } from "../../src/server/travel";
import { fileHash, loadScenarios, p, readJson, readJsonl, writeJson } from "./common";

const runs = readJsonl<RunRecord>(p("results", "runs.jsonl")).filter(r => r.track === "fixed" && r.method === "clef" && r.split === "test");
const groups = readJson<Record<string, NormalizedGroup>>(p("frozen", "fixed_state_inputs.test.json"));
const restaurants = snapshot().restaurants;
const scenarios = loadScenarios().filter(s => s.split === "test");
const manifest = readJson<{scenarios: {id: string; availability: Record<string, {status: string; reason: string}>}[]}>(p("dataset_manifest.json"));
const sourceHashes = Object.fromEntries(["results/runs.jsonl", "frozen/fixed_state_inputs.test.json", "dataset_manifest.json", "scenarios/v1.json"].map(f => [f, fileHash(p(f))]));
assert.equal(runs.length, 120);
assert.equal(new Set(runs.map(r => r.runId)).size, runs.length);

/** Frozen exp-v1 selector, kept here so its traces remain replayable after product changes. */
function selectExpV1(fits: Record<string, Record<string, number>>, travel: Record<string, number>) {
  const ranked = rankCandidates(fits, travel);
  if (!ranked.length) return null;
  const bestWeakest = Math.max(...ranked.map(r => r.weakest));
  const shortlist = ranked.filter(r => r.weakest >= bestWeakest - 0.15 - 1e-9).sort((a, b) =>
    b.mean - a.mean || a.maxTravelHigh - b.maxTravelHigh || (a.restaurantId < b.restaurantId ? -1 : a.restaurantId > b.restaurantId ? 1 : 0));
  return { choice: shortlist[0]!, bestWeakest, shortlist, ranked };
}

const results = runs.map(run => {
  const trace = run.phases[0]?.methodTrace;
  const scores = trace?.scores as ScoreTable | undefined;
  if (!run.ok || run.outcome?.kind !== "result" || !scores) {
    assert(!run.ok || run.outcome?.kind === "no_match", `Missing scores: ${run.runId}`);
    return {runId: run.runId, scenarioId: run.scenarioId, repeat: run.repeat, status: run.ok ? "no_match" : "failure"} as const;
  }
  const group = groups[run.scenarioId]!;
  const fits = Object.fromEntries(Object.entries(scores).map(([rid, diners]) => {
    assert.deepEqual(Object.keys(diners).sort(), group.diners.map(d => d.participantId).sort());
    for (const answer of Object.values(diners)) assert(Number.isFinite(answer.score) && answer.score >= 0 && answer.score <= 4);
    return [rid, Object.fromEntries(Object.entries(diners).map(([pid, a]) => [pid, a.score]))];
  }));
  const travel = Object.fromEntries(Object.keys(scores).map(rid => {
    const restaurant = restaurants.find(r => r.id === rid)!;
    assert(restaurant);
    return [rid, Math.max(...group.diners.map(d => estimateTravel(d.origin, restaurant).minutesHigh))];
  }));
  const fair = selectExpV1(fits, travel)!;
  const logged = trace!.selection as {choice: Ranked};
  assert.equal(fair.choice.restaurantId, run.outcome.restaurantId, `Replay disagrees: ${run.runId}`);
  assert.deepEqual(fair.choice, logged.choice, `Logged metrics disagree: ${run.runId}`);
  const ranked = [...fair.ranked].sort((a,b) => b.mean - a.mean || a.maxTravelHigh - b.maxTravelHigh || (a.restaurantId < b.restaurantId ? -1 : a.restaurantId > b.restaurantId ? 1 : 0));
  const average = ranked[0]!;
  assert(average.mean >= fair.choice.mean);
  return {runId: run.runId, scenarioId: run.scenarioId, repeat: run.repeat, status: "scored", changed: fair.choice.restaurantId !== average.restaurantId, current: fair.choice, average, scores: fits, ranked} as const;
});
const first = scenarios.map(s => {
  const rows = results.filter(r => r.scenarioId === s.id && r.repeat === 0);
  assert.equal(rows.length, 1);
  return rows[0]!;
});
const count = (rows: typeof results) => ({total: rows.length, scored: rows.filter(r => r.status === "scored").length, changed: rows.filter(r => r.status === "scored" && r.changed).length, unchanged: rows.filter(r => r.status === "scored" && !r.changed).length, noMatch: rows.filter(r => r.status === "no_match").length, failures: rows.filter(r => r.status === "failure").length});
const output = {diagnostic: "exp-v1-clef-average-fit", exploratory: true, sourceHashes, restaurantSnapshotSha256: fileHash(p("..", "data", "v1", "restaurants.json")), rules: {current: "fair-v2: shortlist within 0.15 of best minimum, then highest mean, shortest maximum travel, restaurant ID", alternative: "Highest mean over every scored eligible restaurant, then shortest maximum travel, restaurant ID", review: "First scheduled fixed-state run (repeat 0), including failures; no substitute repeats"}, firstRun: count(first), allRepeats: count(results), results};
writeJson(p("diagnostics", "average-fit.json"), output);

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
const name = (id: string) => restaurants.find(r => r.id === id)!.name;
const n = (v: number) => v.toFixed(2);
const changed = first.filter(r => r.status === "scored" && r.changed);
const sections = changed.map(row => {
  if (row.status !== "scored") return "";
  const group = groups[row.scenarioId]!;
  const scenario = scenarios.find(s => s.id === row.scenarioId)!;
  const av = manifest.scenarios.find(s => s.id === row.scenarioId)!.availability;
  const card = (pick: Ranked, label: string) => {
    const r = restaurants.find(r => r.id === pick.restaurantId)!;
    return `<div class="card"><div class="label">${label}</div><h3>${esc(r.name)}</h3><p>${esc(r.cuisines.join(", "))} · ${esc(r.neighborhood)}</p><p><strong>$${r.mealEstimate.low}–$${r.mealEstimate.high} per person</strong> · estimated all-in</p><p>${esc(r.mealEstimate.basis)}</p><p>${esc(r.atmosphere.map(a => a.tag.replaceAll("_", " ")).join(", "))}</p><p class="metrics">Lowest fit <b>${n(pick.weakest)}</b> · Average fit <b>${n(pick.mean)}</b></p><p>Simulated availability: ${esc(av[r.id]?.status.replaceAll("_", " "))}</p><details><summary>Menu and dietary evidence</summary><ul>${r.sampleOrders.map(o => `<li>${esc(o.description)} — $${o.foodOnlyPrice} before tax/tip</li>`).join("")}</ul><ul>${r.menuOptions.map(o => `<li>${esc(o.dietaryTag)} (${esc(o.verificationStatus)}): ${esc(o.description)}</li>`).join("")}</ul></details></div>`;
  };
  const r1 = restaurants.find(r => r.id === row.current.restaurantId)!;
  const r2 = restaurants.find(r => r.id === row.average.restaurantId)!;
  return `<section id="${row.scenarioId}"><h2>${row.scenarioId} · ${esc(group.meetingArea.name)}</h2><p>${esc(scenario.diningAt)} · ${group.partySize} diners</p><div class="requests">${group.diners.map(d => `<p><strong>${esc(d.name)}:</strong> ${d.noResponse ? "No response" : esc(d.originalText)}${d.clarificationText ? `<br>Clarification: ${esc(d.clarificationText)}` : ""}</p>`).join("")}</div><div class="columns">${card(row.current, "Current fairness rule")}${card(row.average, "Highest average fit")}</div><div class="scroll"><table><thead><tr><th>Diner</th><th>Current: fit</th><th>Average: fit</th><th>Current: trip</th><th>Average: trip</th></tr></thead><tbody>${group.diners.map(d => `<tr><td>${esc(d.name)}</td><td>${n(row.scores[row.current.restaurantId]![d.participantId]!)}</td><td>${n(row.scores[row.average.restaurantId]![d.participantId]!)}</td><td>${esc(describeTravel(estimateTravel(d.origin,r1)))}</td><td>${esc(describeTravel(estimateTravel(d.origin,r2)))}</td></tr>`).join("")}</tbody></table></div><details><summary>Profiles and starting points supplied to Clef</summary>${group.diners.map(d => {const pr = profile(d.profileId);return `<p><b>${esc(d.name)}</b> · ${esc(d.origin.label)} (${esc(d.origin.source)})<br>${esc(pr?.label)}: ${esc(pr?.blurb)}</p><ol>${(pr?.history ?? []).slice(0,10).map(h => `<li>${esc(h.name)} — ${esc(h.cuisines.join(", "))}${h.note ? ` · ${esc(h.note)}` : ""}</li>`).join("")}</ol>`;}).join("")}</details><p class="response">Your preference: <b>current / average / tie / neither</b>. You can reply in chat with “${row.scenarioId}: average” and an optional reason.</p></section>`;
}).join("\n");
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Clef: fairness vs average fit</title><style>
body{font:16px/1.55 system-ui,sans-serif;color:#18332f;background:#f4f5f1;margin:0}main{max-width:1150px;margin:auto;padding:36px 24px}h1{font-size:34px;line-height:1.2}h2{font-size:25px}h3{font-size:23px;margin:8px 0}.intro,section{background:white;padding:26px;border:1px solid #d5dfd8;border-radius:14px;margin:24px 0}.columns{display:grid;grid-template-columns:1fr 1fr;gap:18px}.card{border:1px solid #bacdc2;padding:20px;border-radius:10px}.label{font-size:13px;text-transform:uppercase;letter-spacing:.06em;font-weight:700;color:#496958}.metrics{background:#edf3ee;padding:10px}.requests{background:#f5f6f2;padding:8px 18px;margin-bottom:20px}table{border-collapse:collapse;width:100%;margin:20px 0;font-size:14px}th,td{text-align:left;padding:11px;border-bottom:1px solid #dce4df}th{background:#edf3ee}a{color:#1c644f}.scroll{overflow:auto}details{margin:16px 0}summary{cursor:pointer;font-weight:600}.response{border-top:1px solid #ddd;padding-top:15px;color:#456052}section{scroll-margin-top:20px}@media(max-width:700px){.columns{grid-template-columns:1fr}main{padding:12px}section,.intro{padding:16px}}@media print{section{break-before:page}.response{display:none}}
</style><main><h1>Clef: current fairness rule vs highest average fit</h1><p>Offline diagnostic · exp-v1 held-out scores · no new AI calls</p><div class="intro"><p><b>${output.firstRun.changed} changed choices</b> out of ${output.firstRun.scored} scored first runs. ${output.firstRun.unchanged} choices stay the same; ${output.firstRun.noMatch} no-match outcomes and ${output.firstRun.failures} failed run have no scores to compare.</p><p><b>Left:</b> the actual current rule—keep options within 0.15 of the highest minimum diner score, then choose the highest average. <b>Right:</b> choose the highest average across all scored eligible options. Both use shorter worst trip, then restaurant ID, to break exact average ties.</p><p>Each pair reuses identical Clef scores and eligible candidates. Scores are model assessments on a 0–4 scale, not measured satisfaction. Costs and travel are estimates; availability is simulated. The first scheduled run is used even if it failed. Existing report/results are unchanged. This is an exploratory comparison on previously reviewed test data, not a new held-out experiment.</p><p>Across all three scheduled repeats: ${output.allRepeats.changed}/${output.allRepeats.scored} scored runs change. Repeats are not independent scenarios.</p></div><h2>Choices to review</h2><div class="scroll"><table><thead><tr><th>Case</th><th>Current fairness rule</th><th>Highest average fit</th></tr></thead><tbody>${changed.map(r => r.status === "scored" ? `<tr><td><a href="#${r.scenarioId}">${r.scenarioId}</a></td><td>${esc(name(r.current.restaurantId))}</td><td>${esc(name(r.average.restaurantId))}</td></tr>` : "").join("")}</tbody></table></div>${sections}<section><h2>Unchanged choices and unscored cases</h2><table><thead><tr><th>Case</th><th>Result</th></tr></thead><tbody>${first.filter(r => r.status !== "scored" || !r.changed).map(r => `<tr><td>${r.scenarioId}</td><td>${r.status === "scored" ? esc(name(r.current.restaurantId)) : r.status === "no_match" ? "No feasible match; no scoring comparison" : "Operational failure; no substitute repeat used"}</td></tr>`).join("")}</tbody></table><p>Reproduce: <code>pnpm exec tsx experiment/scripts/compare-selection.ts</code>. Machine-readable scores and selections: <a href="average-fit.json">average-fit.json</a>.</p></section></main></html>`;
fs.writeFileSync(p("diagnostics", "average-fit.html"), html);
console.log(JSON.stringify({firstRun: output.firstRun, allRepeats: output.allRepeats, review: p("diagnostics", "average-fit.html")},null,2));
