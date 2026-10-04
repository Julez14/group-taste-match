export const MIN_DINERS = 2;
export const MAX_DINERS = 6;
export const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
export const TRANSCRIPTION_GRACE_MS = 20_000;
export const MAX_RECORDING_SEC = 60;
export const MAX_TEXT_CHARS = 1000;
export const MAX_NAME_CHARS = 24;

export const TIMER_OPTIONS = {
  initialSec: [60, 90, 120],
  clarifySec: [30, 45, 60],
  hostSec: [15, 30, 45],
} as const;

export type Timers = {
  initialSec: (typeof TIMER_OPTIONS.initialSec)[number];
  clarifySec: (typeof TIMER_OPTIONS.clarifySec)[number];
  hostSec: (typeof TIMER_OPTIONS.hostSec)[number];
};

export const DEFAULT_TIMERS: Timers = { initialSec: 90, clarifySec: 45, hostSec: 30 };

export type Phase =
  | "LOBBY"
  | "COLLECTING"
  | "EVALUATING"
  | "CLARIFYING"
  | "REEVALUATING"
  | "HOST_FINAL_CALL"
  | "FINALIZING"
  | "RESULT"
  | "NO_FEASIBLE_MATCH";

export type ProcessingPhase = "EVALUATING" | "REEVALUATING" | "FINALIZING";
export type InputPhase = "COLLECTING" | "CLARIFYING" | "HOST_FINAL_CALL";
export type SubmissionKind = "initial" | "clarify" | "host";

export const INPUT_PHASE_KIND: Record<InputPhase, SubmissionKind> = {
  COLLECTING: "initial",
  CLARIFYING: "clarify",
  HOST_FINAL_CALL: "host",
};

export const TERMINAL_PHASES: readonly Phase[] = ["RESULT", "NO_FEASIBLE_MATCH"];

export type DecisionMethod = "clef" | "llm_baseline";

export type RoomConfig = {
  /** ISO 8601 local dining time in America/New_York with explicit offset. */
  diningAt: string;
  meetingAreaId: string;
  timers: Timers;
};

export type Participant = {
  id: string;
  name: string;
  profileId: string;
  isHost: boolean;
  /** Approximate starting area id, or null to use the meeting area. */
  startAreaId: string | null;
  /** Rounded browser location, only when the participant opted in. */
  startLatLng: { lat: number; lng: number } | null;
  joinedAt: number;
};

export type Submission = {
  kind: SubmissionKind;
  text: string;
  source: "typed" | "voice";
  /** For host answers chosen from the two offered priorities. */
  choiceId?: string;
  submittedAt: number;
  revision: number;
  idempotencyKey: string;
};

export type PendingTranscription = {
  id: string;
  kind: SubmissionKind;
  ackAt: number;
};

export type ClarifyQuestion = { participantId: string; topicId: string; question: string };

export type HostCall = {
  topicId: string;
  question: string;
  options: { id: string; label: string }[];
};

export type ResultCard = {
  restaurantId: string;
  name: string;
  cuisines: string[];
  neighborhood: string;
  address: string;
  mealEstimate: { low: number; high: number; basis: string; assumptions: string[] };
  travel: { summary: string; maxMinutes: number | null };
  diningAt: string;
  partySize: number;
  availability: { status: "reservable" | "walk_in" | "unknown"; slot: string | null; label: string };
  explanation: string;
  assumptions: string[];
  links: { label: string; url: string; kind: "website" | "booking" | "directions" | "menu" }[];
};

export type NoMatch = { reasonCodes: string[]; message: string };

export type OperationalError = {
  stage: ProcessingPhase;
  message: string;
  attempts: number;
  at: number;
};

export type RoomState = {
  schemaVersion: 1;
  id: string;
  createdAt: number;
  expiresAt: number;
  config: RoomConfig;
  method: DecisionMethod;
  phase: Phase;
  phaseStartedAt: number;
  /** Server deadline (epoch ms) for the current input phase. */
  deadline: number | null;
  hostId: string;
  participants: Participant[];
  /** Party size frozen at Start. */
  partySize: number | null;
  submissions: Record<string, Partial<Record<SubmissionKind, Submission>>>;
  pendingTranscriptions: Record<string, PendingTranscription>;
  clarification: { questions: ClarifyQuestion[]; askedAt: number } | null;
  hostCall: HostCall | null;
  clarifyRoundUsed: boolean;
  hostCallUsed: boolean;
  result: ResultCard | null;
  noMatch: NoMatch | null;
  opError: OperationalError | null;
  /** Monotonic counter that changes whenever processing inputs change. */
  evaluationSeq: number;
};
