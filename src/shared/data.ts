import meetingAreasJson from "../../data/v1/meeting-areas.json";
import profilesJson from "../../data/v1/profiles.json";

export type MeetingArea = (typeof meetingAreasJson.areas)[number];

export type HistoryEntry = {
  /** Rank 1 = this diner's favorite among their visited places. */
  rank: number;
  name: string;
  neighborhood: string;
  cuisines: string[];
  /** Set when the place is also in the restaurant snapshot. */
  restaurantId?: string;
  note?: string;
};

export type Profile = {
  id: string;
  label: string;
  blurb: string;
  history: HistoryEntry[];
};

export const MEETING_AREAS: MeetingArea[] = meetingAreasJson.areas;
export const PROFILES: Profile[] = profilesJson.profiles as Profile[];
export const DATA_VERSIONS = {
  meetingAreas: meetingAreasJson.version,
  profiles: profilesJson.version,
};

export const meetingArea = (id: string) => MEETING_AREAS.find((a) => a.id === id);
export const profile = (id: string) => PROFILES.find((p) => p.id === id);

/** One-tap default: rotate through profiles by join order. */
export const defaultProfileId = (joinIndex: number) => PROFILES[joinIndex % PROFILES.length]!.id;
