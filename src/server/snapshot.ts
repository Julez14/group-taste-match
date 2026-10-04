import snapshotJson from "../../data/v1/restaurants.json";
import { type Restaurant, type Snapshot, SnapshotSchema } from "../shared/restaurant";

let cached: Snapshot | null = null;

/** The bundled restaurant snapshot, validated once per isolate. */
export function snapshot(): Snapshot {
  cached ??= SnapshotSchema.parse(snapshotJson);
  return cached;
}

export const restaurants = (): Restaurant[] => snapshot().restaurants;

export function restaurantById(id: string): Restaurant | undefined {
  return restaurants().find((r) => r.id === id);
}
