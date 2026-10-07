/**
 * Exportable SVG charts for the report from analyze.ts outputs.
 *
 *   pnpm exp:charts            (held-out results)
 */
import fs from "node:fs";
import { p, readJson } from "./common";

type Rate = { numerator: number; denominator: number; value: number; ciLow: number; ciHigh: number };
type Summary = {
  tracks: Record<string, { perMethod: Record<string, { acceptable: Rate; byFamily: Record<string, Rate> }>; acceptableDiff: { value: number; ciLow: number; ciHigh: number; scenarios: number } }>;
};
type Evaluated = { track: string; method: string; decisionMs: number; automatedMs: number; cost: number; outcome: string }[];

const dir = p("..", "report", "figures");
fs.mkdirSync(dir, { recursive: true });
const summary = readJson<Summary>(p("results", "summary.json"));
const evaluated = readJson<Evaluated>(p("results", "evaluated.json"));

const TEAL = "#144f5c";
const SAND = "#c7856b";
const INK = "#18181a";
const MUTED = "#8b8f93";
const font = `font-family="-apple-system, Helvetica Neue, Arial, sans-serif"`;
const LABEL: Record<string, string> = { clef: "Clef pipeline", llm_baseline: "LLM baseline" };
const COLOR: Record<string, string> = { clef: TEAL, llm_baseline: SAND };

function quality() {
  const w = 640;
  const h = 300;
  const tracks = Object.keys(summary.tracks);
  const groupW = (w - 120) / tracks.length;
  let bars = "";
  tracks.forEach((t, ti) => {
    const pm = summary.tracks[t]!.perMethod;
    ["clef", "llm_baseline"].forEach((m, mi) => {
      const r = pm[m]?.acceptable;
      if (!r) return;
      const x = 80 + ti * groupW + 30 + mi * 80;
      const y = (v: number) => 240 - v * 200;
      bars += `<rect x="${x}" y="${y(r.value)}" width="60" height="${240 - y(r.value)}" fill="${COLOR[m]}" rx="4"/>`;
      bars += `<line x1="${x + 30}" x2="${x + 30}" y1="${y(r.ciLow)}" y2="${y(r.ciHigh)}" stroke="${INK}" stroke-width="1.5"/>`;
      bars += `<line x1="${x + 22}" x2="${x + 38}" y1="${y(r.ciLow)}" y2="${y(r.ciLow)}" stroke="${INK}"/><line x1="${x + 22}" x2="${x + 38}" y1="${y(r.ciHigh)}" y2="${y(r.ciHigh)}" stroke="${INK}"/>`;
      bars += `<text x="${x + 30}" y="${y(r.value) - 8}" text-anchor="middle" font-size="12" fill="${INK}" ${font}>${Math.round(r.value * 100)}%</text>`;
      bars += `<text x="${x + 30}" y="258" text-anchor="middle" font-size="10" fill="${MUTED}" ${font}>${r.numerator}/${r.denominator}</text>`;
    });
    const d = summary.tracks[t]!.acceptableDiff;
    bars += `<text x="${80 + ti * groupW + 100}" y="280" text-anchor="middle" font-size="12" fill="${INK}" ${font}>${t === "fixed" ? "Fixed-state (runs)" : "Complete flow (sessions)"} · Δ ${d.value >= 0 ? "+" : ""}${Math.round(d.value * 100)} pts [${Math.round(d.ciLow * 100)}, ${Math.round(d.ciHigh * 100)}]</text>`;
  });
  const axis = [0, 0.25, 0.5, 0.75, 1]
    .map((v) => `<line x1="70" x2="${w - 20}" y1="${240 - v * 200}" y2="${240 - v * 200}" stroke="#eee"/><text x="62" y="${244 - v * 200}" text-anchor="end" font-size="10" fill="${MUTED}" ${font}>${v * 100}%</text>`)
    .join("");
  const legend = ["clef", "llm_baseline"].map((m, i) => `<rect x="${80 + i * 130}" y="28" width="12" height="12" fill="${COLOR[m]}" rx="2"/><text x="${97 + i * 130}" y="38" font-size="12" ${font}>${LABEL[m]}</text>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><text x="10" y="18" font-size="14" font-weight="700" ${font}>Acceptable-group rate (model-judged, feasible scenarios, 95% CI)</text>${legend}${axis}${bars}</svg>`;
}

function latencyCost() {
  const w = 640;
  const h = 270;
  const q = (xs: number[], f: number) => {
    const s = [...xs].sort((a, b) => a - b);
    if (!s.length) return 0;
    const pos = (s.length - 1) * f;
    return s[Math.floor(pos)]! + (s[Math.ceil(pos)]! - s[Math.floor(pos)]!) * (pos - Math.floor(pos));
  };
  const rows = ["clef", "llm_baseline"].map((m) => {
    const R = evaluated.filter((e) => e.track === "fixed" && e.method === m && e.outcome !== "error");
    const ms = R.map((e) => e.decisionMs / 1000);
    return { m, p50: q(ms, 0.5), p95: q(ms, 0.95), cost: R.reduce((t, e) => t + e.cost, 0) / Math.max(1, R.length) };
  });
  const maxS = Math.max(...rows.map((r) => r.p95), 1);
  const maxC = Math.max(...rows.map((r) => r.cost), 0.001);
  let body = `<text x="10" y="18" font-size="14" font-weight="700" ${font}>Fixed-state decision latency (s) and estimated cost per decision</text>`;
  rows.forEach((r, i) => {
    const y = 50 + i * 100;
    const sx = (v: number) => (v / maxS) * 270;
    body += `<text x="10" y="${y + 14}" font-size="12" font-weight="600" ${font}>${LABEL[r.m]}</text>`;
    body += `<rect x="130" y="${y}" width="${sx(r.p50)}" height="18" fill="${COLOR[r.m]}" rx="3"/><text x="${136 + sx(r.p50)}" y="${y + 13}" font-size="11" ${font}>p50 ${r.p50.toFixed(1)} s</text>`;
    body += `<rect x="130" y="${y + 24}" width="${sx(r.p95)}" height="18" fill="${COLOR[r.m]}" opacity="0.55" rx="3"/><text x="${136 + sx(r.p95)}" y="${y + 37}" font-size="11" ${font}>p95 ${r.p95.toFixed(1)} s</text>`;
    const cw = (r.cost / maxC) * 90;
    body += `<rect x="480" y="${y + 6}" width="${cw}" height="24" fill="${COLOR[r.m]}" rx="3"/><text x="480" y="${y + 50}" font-size="11" ${font}>$${(r.cost * 1000).toFixed(2)} per 1,000 decisions</text>`;
  });
  body += `<text x="480" y="40" font-size="11" fill="${MUTED}" ${font}>Est. cost (usage × list price)</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`;
}

function families() {
  const fixed = summary.tracks.fixed?.perMethod;
  if (!fixed) return "";
  const fams = Object.keys(fixed.clef?.byFamily ?? {}).filter((f) => (fixed.clef!.byFamily[f]?.denominator ?? 0) > 0);
  const w = 640;
  const rowH = 26;
  const h = 50 + fams.length * rowH;
  let body = `<text x="10" y="18" font-size="14" font-weight="700" ${font}>Acceptable-group rate by scenario family (fixed-state; exploratory, small n)</text>`;
  fams.forEach((f, i) => {
    const y = 40 + i * rowH;
    body += `<text x="10" y="${y + 13}" font-size="11" ${font}>${f.replace(/_/g, " ")}</text>`;
    ["clef", "llm_baseline"].forEach((m, mi) => {
      const r = fixed[m]?.byFamily[f];
      if (!r) return;
      const bw = r.value * 220;
      body += `<rect x="${190 + mi * 225}" y="${y}" width="${Math.max(1, bw)}" height="16" fill="${COLOR[m]}" rx="3"/><text x="${196 + mi * 225 + bw}" y="${y + 12}" font-size="10" ${font}>${r.numerator}/${r.denominator}</text>`;
    });
  });
  body += `<text x="190" y="34" font-size="11" fill="${MUTED}" ${font}>${LABEL.clef}</text><text x="415" y="34" font-size="11" fill="${MUTED}" ${font}>${LABEL.llm_baseline}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`;
}

fs.writeFileSync(`${dir}/quality.svg`, quality());
fs.writeFileSync(`${dir}/latency_cost.svg`, latencyCost());
fs.writeFileSync(`${dir}/families.svg`, families());
console.log(`wrote charts to ${dir}`);
