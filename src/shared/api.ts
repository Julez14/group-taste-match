import { z } from "zod";
import { MAX_NAME_CHARS, MAX_TEXT_CHARS, TIMER_OPTIONS } from "./types";

const oneOf = <T extends readonly number[]>(values: T) =>
  z.number().refine((v): v is T[number] => values.includes(v), { message: `Must be one of ${values.join(", ")}` });

const latLng = z.object({
  lat: z.number().min(40.4).max(41.0),
  lng: z.number().min(-74.4).max(-73.6),
});

export const JoinBody = z.object({
  name: z.string().trim().min(1).max(MAX_NAME_CHARS),
  profileId: z.string().max(64).optional(),
  startAreaId: z.string().max(64).nullable().optional(),
  startLatLng: latLng.nullable().optional(),
});
export type JoinBody = z.infer<typeof JoinBody>;

export const CreateRoomBody = z.object({
  host: JoinBody,
  config: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    time: z.string().regex(/^\d{2}:\d{2}$/),
    meetingAreaId: z.string().max(64),
    timers: z.object({
      initialSec: oneOf(TIMER_OPTIONS.initialSec),
      clarifySec: oneOf(TIMER_OPTIONS.clarifySec),
      hostSec: oneOf(TIMER_OPTIONS.hostSec),
    }),
  }),
});
export type CreateRoomBody = z.infer<typeof CreateRoomBody>;

export const ActionBody = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start") }),
  z.object({ type: z.literal("remove"), targetId: z.string().max(64) }),
  z.object({
    type: z.literal("submit"),
    kind: z.enum(["initial", "clarify", "host"]),
    text: z.string().max(MAX_TEXT_CHARS),
    source: z.enum(["typed", "voice"]),
    choiceId: z.string().max(32).optional(),
    idempotencyKey: z.string().min(8).max(64),
  }),
  z.object({ type: z.literal("retry") }),
]);
export type ActionBody = z.infer<typeof ActionBody>;

export type ApiError = { error: { code: string; message: string } };

export type JoinResponse = { roomId: string; participantId: string; token: string };

export type RoomPeek = {
  roomId: string;
  phase: string;
  hostName: string;
  diningAt: string;
  meetingAreaId: string;
  dinerCount: number;
  joinable: boolean;
};

export type TranscribeResponse =
  | { mode: "draft"; transcript: string }
  | { mode: "direct"; accepted: boolean; transcript: string | null; reason?: string };
