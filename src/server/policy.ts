/** Current product selection policy. The exp-v1 policy remains in its frozen protocol. */
export const POLICY = {
  version: "average-v1",
  /** Prototype host-call threshold for the selected restaurant's weakest fit. */
  acceptableFit: 1.25,
  /** A spread at least this large between a diner's fit levels may justify a host call. */
  materialSpread: 2.5,
  /** Candidates this close to the best mean fit may be swapped by the host's priority. */
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

/** Total order: mean fit desc, then travel burden asc, then id asc. */
function averageOrder(a: Ranked, b: Ranked): number {
  if (b.mean !== a.mean) return b.mean - a.mean;
  if (a.maxTravelHigh !== b.maxTravelHigh) return a.maxTravelHigh - b.maxTravelHigh;
  return a.restaurantId < b.restaurantId ? -1 : a.restaurantId > b.restaurantId ? 1 : 0;
}

export type Selection = {
  choice: Ranked;
  bestMean: number;
  ranked: Ranked[];
};

export function selectAverage(fits: FitMatrix, travelHigh: Record<string, number>): Selection | null {
  const ranked = rankCandidates(fits, travelHigh).sort(averageOrder);
  if (!ranked.length) return null;
  return { choice: ranked[0]!, bestMean: ranked[0]!.mean, ranked };
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
  const weak = sel.choice.weakest < POLICY.acceptableFit;
  const uneven = spread >= POLICY.materialSpread;
  const band = sel.ranked.filter((r) => r.mean >= sel.bestMean - POLICY.hostBand - 1e-9);
  if (!weak && !uneven) return { useful: false, reason: "adequate", band };
  const byTrip = applyHostPriority(band, "shorter_trip");
  const byMatch = applyHostPriority(band, "best_match");
  if (!byTrip || !byMatch || byTrip.restaurantId === byMatch.restaurantId) {
    return { useful: false, reason: "answer_would_not_change_choice", band };
  }
  return { useful: true, reason: weak ? "weak_chosen_fit" : "uneven_fit", band };
}

export function applyHostPriority(band: Ranked[], priority: HostPriority): Ranked | null {
  if (!band.length) return null;
  const sorted = [...band].sort((a, b) =>
    priority === "shorter_trip"
      ? a.maxTravelHigh - b.maxTravelHigh || b.mean - a.mean || (a.restaurantId < b.restaurantId ? -1 : a.restaurantId > b.restaurantId ? 1 : 0)
      : averageOrder(a, b),
  );
  return sorted[0]!;
}
