import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type Scenario, ScenarioFileSchema } from "../../src/experiment/scenario";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const EXP = path.join(ROOT, "experiment");
export const p = (...parts: string[]) => path.join(EXP, ...parts);

export const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
export const fileHash = (file: string) => sha256(fs.readFileSync(file));

export function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

export function writeJson(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

export function loadScenarios(): Scenario[] {
  return ScenarioFileSchema.parse(readJson(p("scenarios", "v1.json"))).scenarios;
}

export function args(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of process.argv.slice(2)) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) out[m[1]!] = m[2]!;
    else if (a.startsWith("--")) out[a.slice(2)] = "true";
  }
  return out;
}

export const BASE = process.env.EXP_BASE ?? "http://localhost:5199";

export async function post<T>(route: string, body: unknown, timeoutMs = 600_000): Promise<T> {
  const res = await fetch(`${BASE}/api/__exp/${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(`${route} ${res.status}: ${data.error ?? "error"}`);
  return data;
}

/** Run tasks with bounded concurrency, preserving order of results. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!, i);
      }
    }),
  );
  return out;
}

export function appendJsonl(file: string, row: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`);
}

export function readJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T);
}
