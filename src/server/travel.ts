export type LatLng = { lat: number; lng: number };

export type TravelEstimate = {
  km: number;
  mode: "walk" | "transit";
  minutesLow: number;
  minutesHigh: number;
};

/**
 * Documented geographic estimate, not live routing: straight-line distance
 * times a 1.3 street-grid detour factor. Up to 1.3 km is a walk at 4.8 km/h
 * (±15%). Farther trips are transit: 8–14 min to walk to and wait for a train,
 * plus the route at 16–24 km/h effective speed including transfers.
 */
export const TRAVEL_METHOD = {
  id: "geo-v1",
  detourFactor: 1.3,
  walkMaxKm: 1.3,
  walkKmh: 4.8,
  transitAccessMin: [8, 14] as const,
  transitKmh: [24, 16] as const,
};

export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function estimateTravel(from: LatLng, to: LatLng): TravelEstimate {
  const m = TRAVEL_METHOD;
  const routeKm = haversineKm(from, to) * m.detourFactor;
  const km = Math.round(routeKm * 10) / 10;
  if (routeKm <= m.walkMaxKm) {
    const mid = (routeKm / m.walkKmh) * 60;
    return { km, mode: "walk", minutesLow: Math.max(1, Math.round(mid * 0.85)), minutesHigh: Math.max(2, Math.round(mid * 1.15)) };
  }
  return {
    km,
    mode: "transit",
    minutesLow: Math.round(m.transitAccessMin[0] + (routeKm / m.transitKmh[0]) * 60),
    minutesHigh: Math.round(m.transitAccessMin[1] + (routeKm / m.transitKmh[1]) * 60),
  };
}

export function describeTravel(t: TravelEstimate): string {
  return t.mode === "walk"
    ? `about a ${t.minutesLow}–${t.minutesHigh} min walk`
    : `about ${t.minutesLow}–${t.minutesHigh} min by subway`;
}
