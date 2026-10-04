import type { NormalizedDiner, NormalizedGroup } from "../src/shared/normalized";
import type { Restaurant } from "../src/shared/restaurant";

/** Test-only record; not part of the restaurant snapshot. */
export function testRestaurant(over: Partial<Restaurant> = {}): Restaurant {
  return {
    id: "test-place",
    name: "Test Place",
    neighborhood: "SoHo",
    borough: "Manhattan",
    address: "1 Test St, New York, NY 10012",
    cuisines: ["italian"],
    lat: 40.7233,
    lng: -74.003,
    priceTier: "$$",
    mealEstimate: { low: 30, high: 45, currency: "USD", basis: "test basis text", assumptions: [], foodOnlyLow: 23, foodOnlyHigh: 35, evidenceIds: ["e1"] },
    sampleOrders: [],
    menuOptions: [],
    allergyPolicy: null,
    atmosphere: [],
    hours: {
      timezone: "America/New_York",
      weekly: {
        sun: [["12:00", "22:00"]],
        mon: [],
        tue: [["17:00", "22:00"]],
        wed: [["17:00", "22:00"]],
        thu: [["17:00", "22:00"]],
        fri: [["17:00", "26:00"]],
        sat: null,
      },
      lastSeatingNote: null,
      evidenceIds: ["e1"],
    },
    reservationPolicy: "reservations_and_walk_ins",
    partySizeNote: null,
    websiteUrl: "https://example.com",
    menuUrl: null,
    bookingUrl: null,
    evidence: [{ id: "e1", url: "https://example.com", retrievedAt: "2026-10-04", field: "all", note: "test" }],
    ...over,
  };
}

export function diner(id: string, over: Partial<NormalizedDiner> = {}): NormalizedDiner {
  return {
    participantId: id,
    name: id.toUpperCase(),
    profileId: "cozy-classics",
    isHost: id === "a",
    originalText: "anything",
    clarificationText: null,
    origin: { lat: 40.7359, lng: -73.9906, label: "Union Square", source: "default_meeting_area" },
    noResponse: false,
    hard: [],
    soft: [],
    ambiguities: [],
    missing: [],
    noveltyRequested: false,
    ignoredInstructions: [],
    ...over,
  };
}

export function group(diners: NormalizedDiner[], diningAt = "2026-10-06T19:30:00-04:00"): NormalizedGroup {
  return {
    diningAt,
    meetingArea: { id: "union-square", name: "Union Square", lat: 40.7359, lng: -73.9906 },
    partySize: diners.length,
    diners,
    hostAnswer: null,
  };
}

export const src = (text: string) => ({ text, status: "stated" as const, from: "initial" as const });
