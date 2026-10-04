import { z } from "zod";

export const DIETARY_TAGS = ["vegetarian", "vegan", "gluten_free", "pescatarian", "halal", "kosher", "dairy_free", "nut_free"] as const;
export type DietaryTag = (typeof DIETARY_TAGS)[number];

export const ATMOSPHERE_TAGS = [
  "casual",
  "lively",
  "quiet",
  "romantic",
  "cozy",
  "upscale",
  "group_friendly",
  "counter_seating",
  "quick",
  "bar_scene",
  "outdoor_seating",
  "date_night",
  "family_friendly",
  "special_occasion",
  "late_night",
] as const;
export type AtmosphereTag = (typeof ATMOSPHERE_TAGS)[number];

const hhmm = z.string().regex(/^([01]\d|2[0-9]):[0-5]\d$/, "HH:MM, hours ≥ 24 mean after midnight");
const interval = z.tuple([hhmm, hhmm]).refine(([a, b]) => a < b, "open must be before close");
const day = z.array(interval).nullable();

const evidenceIds = z.array(z.string()).min(1);

export const RestaurantSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
    neighborhood: z.string().min(1),
    borough: z.enum(["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island"]),
    address: z.string().min(5),
    cuisines: z.array(z.string().min(1)).min(1),
    lat: z.number().min(40.49).max(40.92),
    lng: z.number().min(-74.27).max(-73.68),
    priceTier: z.enum(["$", "$$", "$$$", "$$$$"]),
    mealEstimate: z.object({
      low: z.number().positive(),
      high: z.number().positive(),
      currency: z.literal("USD"),
      basis: z.string().min(10),
      assumptions: z.array(z.string()),
      foodOnlyLow: z.number().positive(),
      foodOnlyHigh: z.number().positive(),
      evidenceIds,
    }),
    sampleOrders: z.array(z.object({ description: z.string(), foodOnlyPrice: z.number().positive(), evidenceIds })),
    menuOptions: z.array(
      z.object({
        dietaryTag: z.enum(DIETARY_TAGS),
        description: z.string(),
        evidenceIds,
        verificationStatus: z.enum(["menu_labeled", "restaurant_statement", "menu_inferred"]),
      }),
    ),
    allergyPolicy: z.object({ statement: z.string(), evidenceIds }).nullable(),
    atmosphere: z.array(z.object({ tag: z.enum(ATMOSPHERE_TAGS), evidenceIds })),
    hours: z.object({
      timezone: z.literal("America/New_York"),
      weekly: z.object({ sun: day, mon: day, tue: day, wed: day, thu: day, fri: day, sat: day }),
      lastSeatingNote: z.string().nullable(),
      evidenceIds: z.array(z.string()),
    }),
    reservationPolicy: z.enum(["reservations", "walk_in_only", "reservations_and_walk_ins", "unknown"]),
    partySizeNote: z.string().nullable(),
    websiteUrl: z.string().url(),
    menuUrl: z.string().url().nullable(),
    bookingUrl: z.string().url().nullable(),
    evidence: z
      .array(
        z.object({
          id: z.string(),
          url: z.string().url(),
          retrievedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          field: z.string(),
          note: z.string(),
        }),
      )
      .min(1),
  })
  .superRefine((r, ctx) => {
    const ids = new Set(r.evidence.map((e) => e.id));
    if (ids.size !== r.evidence.length) ctx.addIssue({ code: "custom", message: "duplicate evidence id" });
    const refs = [
      ...r.mealEstimate.evidenceIds,
      ...r.sampleOrders.flatMap((o) => o.evidenceIds),
      ...r.menuOptions.flatMap((o) => o.evidenceIds),
      ...(r.allergyPolicy?.evidenceIds ?? []),
      ...r.atmosphere.flatMap((a) => a.evidenceIds),
      ...r.hours.evidenceIds,
    ];
    for (const ref of refs) if (!ids.has(ref)) ctx.addIssue({ code: "custom", message: `unknown evidence id ${ref}` });
    if (r.mealEstimate.low > r.mealEstimate.high) ctx.addIssue({ code: "custom", message: "meal low > high" });
    if (r.mealEstimate.foodOnlyLow > r.mealEstimate.foodOnlyHigh) ctx.addIssue({ code: "custom", message: "food-only low > high" });
  });

export type Restaurant = z.infer<typeof RestaurantSchema>;

export const SnapshotSchema = z.object({
  version: z.string(),
  note: z.string(),
  restaurants: z.array(RestaurantSchema),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

export const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
