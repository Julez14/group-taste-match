import type { NormalizedGroup } from "../shared/normalized";

export type Leak = { kind: "name" | "budget" | "origin" | "allergen"; term: string };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Find private details that a group-facing sentence must not contain:
 * diner names, stated budget amounts, non-default starting points, and
 * allergens. Deterministic and applied identically to every method.
 */
export function findLeaks(text: string, group: NormalizedGroup, chosen?: { name: string; neighborhood: string }): Leak[] {
  const leaks: Leak[] = [];
  let lower = text.toLowerCase();
  // The chosen restaurant's own name and neighborhood are public facts, not origins.
  if (chosen) for (const s of [chosen.name, chosen.neighborhood]) lower = lower.split(s.toLowerCase()).join(" ");
  for (const d of group.diners) {
    if (d.name.length >= 2 && new RegExp(`\\b${escape(d.name.toLowerCase())}\\b`).test(lower)) leaks.push({ kind: "name", term: d.name });
    for (const h of d.hard) {
      if (h.type === "budget_max") {
        const n = String(Math.round(h.amount));
        if (new RegExp(`\\$\\s?${n}\\b|\\b${n}\\s?(dollars|bucks)\\b`).test(lower)) leaks.push({ kind: "budget", term: `$${n}` });
      }
      if (h.type === "dietary" && (h.severity === "allergy" || h.severity === "medical")) {
        // Collective diet words ("gluten-free options") are fine; allergy/medical specifics are not.
        if (/\ballerg|\bceliac|\bcoeliac|anaphyla|epipen/.test(lower)) leaks.push({ kind: "allergen", term: "allergy/medical detail" });
        const allergen = h.allergen?.toLowerCase();
        if (allergen && allergen.length >= 3 && !h.tag && lower.includes(allergen)) leaks.push({ kind: "allergen", term: allergen });
      }
    }
    for (const s of d.soft) {
      if (s.kind !== "price") continue;
      const n = /\$?(\d{2,4})/.exec(s.value)?.[1];
      if (n && new RegExp(`\\$\\s?${n}\\b`).test(lower)) leaks.push({ kind: "budget", term: `$${n}` });
    }
    if (d.origin.source !== "default_meeting_area" && d.origin.label !== group.meetingArea.name) {
      const label = d.origin.label.toLowerCase();
      if (d.origin.source === "stated_area" && lower.includes(label)) leaks.push({ kind: "origin", term: d.origin.label });
    }
  }
  return leaks;
}

/** Keep only sentences without leaks. */
export function scrubList(items: string[], group: NormalizedGroup, chosen?: { name: string; neighborhood: string }): { kept: string[]; leaks: Leak[] } {
  const leaks: Leak[] = [];
  const kept = items.filter((s) => {
    const l = findLeaks(s, group, chosen);
    leaks.push(...l);
    return l.length === 0;
  });
  return { kept, leaks };
}
