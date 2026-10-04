import { z } from "zod";
import type { HardConstraint, Interpretation } from "../shared/normalized";
import { DIETARY_TAGS } from "../shared/restaurant";
import { BASES, SEVERITIES } from "./interpret-schema";
import { arr, bool, enumOf, nullableEnum, nullableNum, nullableStr, obj, str } from "./json-schema";

export const PATCH_OPS = [
  "set_budget_basis",
  "set_budget_amount",
  "budget_to_hard",
  "budget_to_soft",
  "set_dietary_severity",
  "dietary_to_soft",
  "add_travel_limit",
  "travel_to_soft",
] as const;

/** A diner's clarification expressed as explicit edits to their own requirements. */
export const PATCH_JSON_SCHEMA = obj({
  resolved: bool,
  changes: arr(
    obj({
      op: enumOf(PATCH_OPS),
      targetId: nullableStr(40),
      amount: nullableNum,
      basis: nullableEnum(BASES),
      severity: nullableEnum(SEVERITIES),
      tag: nullableEnum(DIETARY_TAGS),
      quote: str(200),
    }),
    4,
  ),
});

export const PatchSchema = z.object({
  resolved: z.boolean(),
  changes: z.array(
    z.object({
      op: z.enum(PATCH_OPS),
      targetId: z.string().nullable(),
      amount: z.number().nullable(),
      basis: z.enum(BASES).nullable(),
      severity: z.enum(SEVERITIES).nullable(),
      tag: z.enum(DIETARY_TAGS).nullable(),
      quote: z.string(),
    }),
  ),
});
export type Patch = z.infer<typeof PatchSchema>;

const OP_RESOLVES: Record<(typeof PATCH_OPS)[number], string> = {
  set_budget_basis: "budget_basis",
  set_budget_amount: "budget_basis",
  budget_to_hard: "budget_firmness",
  budget_to_soft: "budget_firmness",
  set_dietary_severity: "dietary_severity",
  dietary_to_soft: "dietary_severity",
  add_travel_limit: "travel_limit",
  travel_to_soft: "travel_limit",
};

export type AppliedChange = { op: string; targetId: string | null; quote: string; applied: boolean; note: string };

/**
 * Apply a clarification patch deterministically. Only the owner's own items
 * change; every change is marked from: "clarification" with their quote.
 */
export function applyPatch(interp: Interpretation, patch: Patch, topicId: string | null): { interp: Interpretation; log: AppliedChange[] } {
  let hard = [...interp.hard];
  let soft = [...interp.soft];
  const log: AppliedChange[] = [];
  const src = (quote: string) => ({ text: quote.slice(0, 400), status: "stated" as const, from: "clarification" as const });
  const find = (id: string | null) => (id ? hard.find((h) => h.id === id) : undefined);
  const firstOf = <T extends HardConstraint["type"]>(type: T) => hard.find((h): h is Extract<HardConstraint, { type: T }> => h.type === type);

  for (const c of patch.changes) {
    const entry: AppliedChange = { op: c.op, targetId: c.targetId, quote: c.quote, applied: false, note: "" };
    switch (c.op) {
      case "set_budget_basis":
      case "set_budget_amount": {
        const t = find(c.targetId) ?? firstOf("budget_max");
        if (t?.type === "budget_max") {
          const next = { ...t, source: src(c.quote), ...(c.op === "set_budget_basis" && c.basis ? { basis: c.basis } : {}), ...(c.op === "set_budget_amount" && c.amount ? { amount: c.amount } : {}) };
          hard = hard.map((h) => (h.id === t.id ? next : h));
          entry.applied = true;
        } else entry.note = "no budget to update";
        break;
      }
      case "budget_to_hard": {
        if (!c.amount) {
          entry.note = "missing amount";
          break;
        }
        hard = hard.filter((h) => h.type !== "budget_max");
        hard.push({ id: "c-budget", type: "budget_max", amount: c.amount, basis: c.basis ?? "unspecified", source: src(c.quote) });
        soft = soft.filter((s) => s.kind !== "price");
        entry.applied = true;
        break;
      }
      case "budget_to_soft": {
        const t = find(c.targetId) ?? firstOf("budget_max");
        if (t?.type === "budget_max") {
          hard = hard.filter((h) => h.id !== t.id);
          soft.push({ id: "c-price", kind: "price", direction: "want", strength: "mild", value: `around $${t.amount}`, source: src(c.quote) });
          entry.applied = true;
        } else entry.note = "no budget to relax";
        break;
      }
      case "set_dietary_severity": {
        const t = find(c.targetId) ?? firstOf("dietary");
        if (t?.type === "dietary" && c.severity) {
          hard = hard.map((h) => (h.id === t.id ? { ...t, severity: c.severity!, ...(c.tag ? { tag: c.tag } : {}), source: src(c.quote) } : h));
          entry.applied = true;
        } else entry.note = "no dietary requirement to update";
        break;
      }
      case "dietary_to_soft": {
        const t = find(c.targetId) ?? firstOf("dietary");
        if (t?.type === "dietary") {
          hard = hard.filter((h) => h.id !== t.id);
          soft.push({ id: "c-diet", kind: "dietary", direction: "avoid", strength: "mild", value: t.tag ?? t.allergen ?? "dietary preference", source: src(c.quote) });
          entry.applied = true;
        } else entry.note = "no dietary requirement to relax";
        break;
      }
      case "add_travel_limit": {
        if (!c.amount) {
          entry.note = "missing minutes";
          break;
        }
        hard = hard.filter((h) => h.type !== "travel_max_minutes");
        hard.push({ id: "c-travel", type: "travel_max_minutes", minutes: c.amount, source: src(c.quote) });
        entry.applied = true;
        break;
      }
      case "travel_to_soft": {
        const t = find(c.targetId) ?? firstOf("travel_max_minutes");
        if (t) {
          hard = hard.filter((h) => h.id !== t.id);
          entry.applied = true;
        } else entry.note = "no travel limit to relax";
        break;
      }
    }
    log.push(entry);
  }
  // An applied change resolves open ambiguities of the matching kind, plus the asked topic.
  const resolvedKinds = new Set(log.filter((l) => l.applied).map((l) => OP_RESOLVES[l.op as (typeof PATCH_OPS)[number]]));
  const ambiguities = interp.ambiguities.filter(
    (a) => !resolvedKinds.has(a.kind) && !(patch.resolved && topicId !== null && a.topicId === topicId),
  );
  return { interp: { ...interp, hard, soft, ambiguities }, log };
}
