/**
 * Render the founder-facing report Markdown to a presentation-ready PDF
 * (and page PNGs for visual inspection) with Playwright Chromium.
 *
 *   pnpm exp:pdf
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { marked } from "marked";
import { ROOT } from "./common";

const mdFile = path.join(ROOT, "Beli_Group_Explore_Experiment_Report.md");
const pdfFile = path.join(ROOT, "Beli_Group_Explore_Experiment_Report.pdf");
const md = fs.readFileSync(mdFile, "utf8");

// Inline SVG figures so the PDF is self-contained.
const html = (await marked.parse(md)).replace(/<img src="([^"]+\.svg)" alt="([^"]*)">/g, (_m, src: string, alt: string) => {
  const svg = fs.readFileSync(path.join(ROOT, src), "utf8");
  return `<figure>${svg}<figcaption>${alt}</figcaption></figure>`;
});

const page = `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: Letter; margin: 0.6in 0.65in 0.7in; }
body { font: 10.5pt/1.45 -apple-system, "Helvetica Neue", Arial, sans-serif; color: #18181a; }
h1 { font: 800 25pt/1.1 Georgia, "Playfair Display", serif; color: #144f5c; margin: 0 0 6pt; }
h2 { font: 700 15pt/1.2 Georgia, serif; color: #144f5c; margin: 16pt 0 6pt; break-after: avoid; }
h3 { font-size: 11.5pt; margin: 12pt 0 4pt; break-after: avoid; }
p, li { orphans: 3; widows: 3; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0 10pt; font-size: 9pt; break-inside: avoid; }
th, td { border-bottom: 1px solid #e2e4e5; padding: 4pt 6pt; text-align: left; vertical-align: top; }
th { background: #f3f6f6; color: #144f5c; }
blockquote { margin: 8pt 0; padding: 8pt 12pt; background: #eef4f4; border-left: 4px solid #144f5c; border-radius: 4px; }
figure { margin: 8pt 0 12pt; break-inside: avoid; text-align: center; }
figure svg { max-width: 100%; height: auto; }
figcaption { font-size: 8.5pt; color: #6b7073; margin-top: 2pt; }
code { font-size: 8.5pt; background: #f3f4f4; padding: 0 3pt; border-radius: 3px; }
hr { border: 0; border-top: 1px solid #e2e4e5; margin: 14pt 0; }
.pagebreak { break-before: page; }
</style></head><body>${html}</body></html>`;

const browser = await chromium.launch();
const tab = await browser.newPage();
await tab.setContent(page, { waitUntil: "load" });
await tab.pdf({
  path: pdfFile,
  format: "Letter",
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: "<span></span>",
  footerTemplate: `<div style="font-size:7pt;color:#8b8f93;width:100%;padding:0 0.65in;display:flex;justify-content:space-between"><span>Group Taste-Match · Decision-pipeline experiment</span><span class="pageNumber"></span></div>`,
  margin: { top: "0.6in", bottom: "0.7in", left: "0.65in", right: "0.65in" },
});
// Page previews for visual review.
const previewDir = path.join(ROOT, "report", "preview");
fs.mkdirSync(previewDir, { recursive: true });
await tab.setViewportSize({ width: 816, height: 1056 });
await tab.screenshot({ path: path.join(previewDir, "full.png"), fullPage: true });
await browser.close();
console.log(`wrote ${pdfFile}`);
