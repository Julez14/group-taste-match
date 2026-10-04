/**
 * Frozen group-selection policy (PRD §7 "Fair group selection"). Tune only on
 * development scenarios; any change after the protocol freeze is a new
 * experiment version.
 */
export const POLICY = {
  version: "fair-v2",
  /** Shortlist candidates within this distance of the best weakest-diner fit (0–4 scale). */
  shortlistDelta: 0.15,
  /**
   * Below this weakest-diner expected fit, a host call may help. Calibrated on
   * development scenarios: Clef's expected scores cluster low (best weakest
   * fit mostly 0.4–1.7), so 2.0 asked the host in 40% of sessions.
   */
  acceptableFit: 1.25,
  /** A spread at least this large between a diner's fit levels may justify a host call. */
  materialSpread: 2.5,
  /** Candidates this close to the best weakest fit may be swapped by the host's priority. */
  hostBand: 0.5,
} as const;

export type FitMatrix = Record<string, Record<string, number>>; // restaurantId → participantId → expected fit

export type Ranked = {
  restaurantId: string;
  weakest: number;
  mean: number;
  maxTravelHigh: number;
};

export function rankCandidates(fits: FitMatrix, travelHigh: Record<string, number>): Ranked[] {
  return Object.entries(fits).map(([restaurantId, byDiner]) => {
    const values = Object.values(byDiner);
    return {
      restaurantId,
      weakest: values.length ? Math.min(...values) : 0,
      mean: values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0,
      maxTravelHigh: travelHigh[restaurantId] ?? Number.POSITIVE_INFINITY,
    };
  });
}

/** Total order for the shortlist: mean fit desc, then travel burden asc, then id asc. */
function shortlistOrder(a: Ranked, b: Ranked): number {
  if (b.mean !== a.mean) return b.mean - a.mean;
  if (a.maxTravelHigh !== b.maxTravelHigh) return a.maxTravelHigh - b.maxTravelHigh;
  return a.restaurantId < b.restaurantId ? -1 : a.restaurantId > b.restaurantId ? 1 : 0;
}

export type Selection = {
  choice: Ranked;
  bestWeakest: number;
  shortlist: Ranked[];
  ranked: Ranked[];
};

export function selectFair(fits: FitMatrix, travelHigh: Record<string, number>): Selection | null {
  const ranked = rankCandidates(fits, travelHigh);
  if (!ranked.length) return null;
  const bestWeakest = Math.max(...ranked.map((r) => r.weakest));
  const shortlist = ranked.filter((r) => r.weakest >= bestWeakest - POLICY.shortlistDelta - 1e-9).sort(shortlistOrder);
  return { choice: shortlist[0]!, bestWeakest, shortlist, ranked };
}

export type HostPriority = "shorter_trip" | "best_match";

export const HOST_OPTIONS: { id: HostPriority; label: string }[] = [
  { id: "shorter_trip", label: "Shorter trip for everyone" },
  { id: "best_match", label: "Best match for what people asked for" },
];

/**
 * Should the host be asked one soft-priority question? Only when the choice
 * is weak or uneven AND the host's answer could actually change it.
 */
export function hostCallUseful(sel: Selection, fits: FitMatrix): { useful: boolean; reason: string; band: Ranked[] } {
  const chosen = Object.values(fits[sel.choice.restaurantId] ?? {});
  const spread = chosen.length ? Math.max(...chosen) - Math.min(...chosen) : 0;
  const weak = sel.bestWeakest < POLICY.acceptableFit;
  const uneven = spread >= POLICY.materialSpread;
  const band = sel.ranked.filter((r) => r.weakest >= sel.bestWeakest - POLICY.hostBand);
  if (!weak && !uneven) return { useful: false, reason: "adequate", band };
  const byTrip = applyHostPriority(band, "shorter_trip");
  const byMatch = applyHostPriority(band, "best_match");
  if (!byTrip || !byMatch || byTrip.restaurantId === byMatch.restaurantId) {
    return { useful: false, reason: "answer_would_not_change_choice", band };
  }
  return { useful: true, reason: weak ? "weak_weakest_fit" : "uneven_fit", band };
}

export function applyHostPriority(band: Ranked[], priority: HostPriority): Ranked | null {
  if (!band.length) return null;
  const sorted = [...band].sort((a, b) =>
    priority === "shorter_trip"
      ? a.maxTravelHigh - b.maxTravelHigh || b.weakest - a.weakest || b.mean - a.mean || (a.restaurantId < b.restaurantId ? -1 : 1)
      : b.mean - a.mean || b.weakest - a.weakest || a.maxTravelHigh - b.maxTravelHigh || (a.restaurantId < b.restaurantId ? -1 : 1),
  );
  return sorted[0]!;
}
