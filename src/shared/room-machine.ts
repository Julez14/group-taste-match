import {
  type ClarifyQuestion,
  type DecisionMethod,
  type HostCall,
  INPUT_PHASE_KIND,
  type InputPhase,
  MAX_DINERS,
  MAX_NAME_CHARS,
  MAX_TEXT_CHARS,
  MIN_DINERS,
  type NoMatch,
  type Participant,
  type Phase,
  type ProcessingPhase,
  type ResultCard,
  ROOM_TTL_MS,
  type RoomConfig,
  type RoomState,
  type SubmissionKind,
  TERMINAL_PHASES,
  TRANSCRIPTION_GRACE_MS,
} from "./types";

export type MachineErrorCode =
  | "not_found"
  | "forbidden"
  | "wrong_phase"
  | "room_full"
  | "too_few_diners"
  | "deadline_passed"
  | "invalid_input"
  | "expired"
  | "illegal_action"
  | "stale_evaluation";

export class MachineError extends Error {
  constructor(
    readonly code: MachineErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const fail = (code: MachineErrorCode, message: string): never => {
  throw new MachineError(code, message);
};

const NEXT_PROCESSING: Record<InputPhase, ProcessingPhase> = {
  COLLECTING: "EVALUATING",
  CLARIFYING: "REEVALUATING",
  HOST_FINAL_CALL: "FINALIZING",
};

export const isInputPhase = (p: Phase): p is InputPhase =>
  p === "COLLECTING" || p === "CLARIFYING" || p === "HOST_FINAL_CALL";

export const isProcessingPhase = (p: Phase): p is ProcessingPhase =>
  p === "EVALUATING" || p === "REEVALUATING" || p === "FINALIZING";

export const isTerminal = (p: Phase) => TERMINAL_PHASES.includes(p);

type JoinInput = Pick<Participant, "id" | "name" | "profileId" | "startAreaId" | "startLatLng">;

export function createRoom(args: {
  id: string;
  host: JoinInput;
  config: RoomConfig;
  method: DecisionMethod;
  now: number;
}): RoomState {
  const host = validateJoin(args.host, args.now, true);
  return {
    schemaVersion: 1,
    id: args.id,
    createdAt: args.now,
    expiresAt: args.now + ROOM_TTL_MS,
    config: args.config,
    method: args.method,
    phase: "LOBBY",
    phaseStartedAt: args.now,
    deadline: null,
    hostId: host.id,
    participants: [host],
    partySize: null,
    submissions: {},
    pendingTranscriptions: {},
    clarification: null,
    hostCall: null,
    clarifyRoundUsed: false,
    hostCallUsed: false,
    result: null,
    noMatch: null,
    opError: null,
    evaluationSeq: 0,
  };
}

function validateJoin(input: JoinInput, now: number, isHost: boolean): Participant {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name || name.length > MAX_NAME_CHARS) fail("invalid_input", "Name must be 1–24 characters.");
  return {
    id: input.id,
    name,
    profileId: input.profileId,
    isHost,
    startAreaId: input.startAreaId,
    startLatLng: input.startLatLng
      ? { lat: round3(input.startLatLng.lat), lng: round3(input.startLatLng.lng) }
      : null,
    joinedAt: now,
  };
}

/** About 100 m precision; enough for approximate travel, not a precise origin. */
const round3 = (n: number) => Math.round(n * 1000) / 1000;

function assertLive(state: RoomState, now: number) {
  if (now >= state.expiresAt) fail("expired", "This room has expired.");
}

function participant(state: RoomState, id: string): Participant {
  return state.participants.find((p) => p.id === id) ?? fail("forbidden", "Not a member of this room.");
}

export function join(state: RoomState, input: JoinInput, now: number): RoomState {
  assertLive(state, now);
  if (state.participants.some((p) => p.id === input.id)) return state;
  if (state.phase !== "LOBBY") fail("wrong_phase", "This group has already started.");
  if (state.participants.length >= MAX_DINERS) fail("room_full", "This group is full.");
  return { ...state, participants: [...state.participants, validateJoin(input, now, false)] };
}

export function removeParticipant(state: RoomState, actorId: string, targetId: string, now: number): RoomState {
  assertLive(state, now);
  if (actorId !== state.hostId) fail("forbidden", "Only the host can remove someone.");
  if (state.phase !== "LOBBY") fail("wrong_phase", "Diners can't be removed after Start.");
  if (targetId === state.hostId) fail("invalid_input", "The host can't be removed.");
  return { ...state, participants: state.participants.filter((p) => p.id !== targetId) };
}

export function start(state: RoomState, actorId: string, now: number): RoomState {
  assertLive(state, now);
  if (actorId !== state.hostId) fail("forbidden", "Only the host can start.");
  if (state.phase !== "LOBBY") {
    if (state.partySize !== null) return state;
    fail("wrong_phase", "Already started.");
  }
  if (state.participants.length < MIN_DINERS) fail("too_few_diners", "At least two diners are needed.");
  return {
    ...state,
    phase: "COLLECTING",
    phaseStartedAt: now,
    deadline: now + state.config.timers.initialSec * 1000,
    partySize: state.participants.length,
  };
}

/** Participants who must respond in the current input phase. */
export function requiredResponders(state: RoomState): string[] {
  switch (state.phase) {
    case "COLLECTING":
      return state.participants.map((p) => p.id);
    case "CLARIFYING":
      return state.clarification?.questions.map((q) => q.participantId) ?? [];
    case "HOST_FINAL_CALL":
      return [state.hostId];
    default:
      return [];
  }
}

function assertCanRespond(state: RoomState, actorId: string, kind: SubmissionKind) {
  participant(state, actorId);
  if (!isInputPhase(state.phase) || INPUT_PHASE_KIND[state.phase] !== kind) {
    fail("wrong_phase", "That step has closed.");
  }
  if (!requiredResponders(state).includes(actorId)) fail("forbidden", "No response is needed from you here.");
}

export type SubmitInput = {
  kind: SubmissionKind;
  text: string;
  source: "typed" | "voice";
  choiceId?: string;
  idempotencyKey: string;
};

/**
 * Accept or replace a participant's response. `acceptedAt` lets a transcription
 * acknowledged before the deadline land during its grace window.
 */
export function submit(
  state: RoomState,
  actorId: string,
  input: SubmitInput,
  now: number,
  acceptedAt: number = now,
): RoomState {
  assertLive(state, now);
  const previous = state.submissions[actorId]?.[input.kind];
  if (previous?.idempotencyKey === input.idempotencyKey) return state;
  assertCanRespond(state, actorId, input.kind);
  if (state.deadline !== null && acceptedAt > state.deadline) fail("deadline_passed", "Time's up for this step.");

  let text = input.text.trim();
  if (input.kind === "host" && input.choiceId) {
    const option = state.hostCall?.options.find((o) => o.id === input.choiceId);
    if (!option) fail("invalid_input", "Unknown choice.");
    if (!text) text = option!.label;
  }
  if (!text) fail("invalid_input", "Please say or type something first.");
  if (text.length > MAX_TEXT_CHARS) fail("invalid_input", "That's a bit long — keep it under 1000 characters.");

  const mine = state.submissions[actorId] ?? {};
  const next: RoomState = {
    ...state,
    submissions: {
      ...state.submissions,
      [actorId]: {
        ...mine,
        [input.kind]: {
          kind: input.kind,
          text,
          source: input.source,
          ...(input.choiceId ? { choiceId: input.choiceId } : {}),
          submittedAt: now,
          revision: (previous?.revision ?? 0) + 1,
          idempotencyKey: input.idempotencyKey,
        },
      },
    },
  };
  return maybeClosePhase(next, now);
}

export function ackTranscription(
  state: RoomState,
  actorId: string,
  args: { id: string; kind: SubmissionKind },
  now: number,
): RoomState {
  assertLive(state, now);
  assertCanRespond(state, actorId, args.kind);
  if (state.deadline !== null && now > state.deadline) fail("deadline_passed", "Time's up for this step.");
  return {
    ...state,
    pendingTranscriptions: { ...state.pendingTranscriptions, [actorId]: { id: args.id, kind: args.kind, ackAt: now } },
  };
}

/**
 * Finish a direct voice submission. A failed or empty transcript stays missing
 * input; it never counts as a preference.
 */
export function resolveTranscription(
  state: RoomState,
  actorId: string,
  args: { id: string; text: string | null },
  now: number,
): { state: RoomState; accepted: boolean; reason?: string } {
  const pending = state.pendingTranscriptions[actorId];
  if (!pending || pending.id !== args.id) return { state, accepted: false, reason: "not_pending" };
  const { [actorId]: _done, ...rest } = state.pendingTranscriptions;
  let next: RoomState = { ...state, pendingTranscriptions: rest };
  const inGrace = now <= pending.ackAt + TRANSCRIPTION_GRACE_MS;
  const stillOpen = isInputPhase(next.phase) && INPUT_PHASE_KIND[next.phase] === pending.kind;
  if (!args.text?.trim() || !inGrace || !stillOpen) {
    return { state: maybeClosePhase(next, now), accepted: false, reason: !inGrace ? "grace_expired" : "empty" };
  }
  try {
    next = submit(
      next,
      actorId,
      { kind: pending.kind, text: args.text, source: "voice", idempotencyKey: `voice:${pending.id}` },
      now,
      pending.ackAt,
    );
    return { state: next, accepted: true };
  } catch (e) {
    return { state: maybeClosePhase(next, now), accepted: false, reason: (e as Error).message };
  }
}

function pendingBlocksClose(state: RoomState, now: number): boolean {
  return Object.values(state.pendingTranscriptions).some((p) => now <= p.ackAt + TRANSCRIPTION_GRACE_MS);
}

function maybeClosePhase(state: RoomState, now: number): RoomState {
  if (!isInputPhase(state.phase)) return state;
  const kind = INPUT_PHASE_KIND[state.phase];
  const allIn = requiredResponders(state).every((id) => state.submissions[id]?.[kind]);
  const timedOut = state.deadline !== null && now >= state.deadline;
  if (!allIn && !timedOut) return state;
  if (pendingBlocksClose(state, now)) return state;
  return {
    ...state,
    phase: NEXT_PROCESSING[state.phase],
    phaseStartedAt: now,
    deadline: null,
    pendingTranscriptions: {},
    opError: null,
    evaluationSeq: state.evaluationSeq + 1,
  };
}

/** Advance on deadlines. Safe to call repeatedly. */
export function tick(state: RoomState, now: number): RoomState {
  return maybeClosePhase(state, now);
}

/** Next instant at which `tick` could change the state, if any. */
export function nextWakeAt(state: RoomState): number | null {
  if (!isInputPhase(state.phase) || state.deadline === null) return null;
  const graceEnds = Object.values(state.pendingTranscriptions).map((p) => p.ackAt + TRANSCRIPTION_GRACE_MS);
  return Math.max(state.deadline, ...graceEnds);
}

export type Outcome =
  | { kind: "result"; card: ResultCard }
  | { kind: "no_match"; noMatch: NoMatch }
  | { kind: "clarify"; questions: ClarifyQuestion[] }
  | { kind: "host_final_call"; hostCall: HostCall };

export function legalOutcomeKinds(state: RoomState): Outcome["kind"][] {
  switch (state.phase) {
    case "EVALUATING":
      return [
        "result",
        "no_match",
        ...(state.clarifyRoundUsed ? [] : (["clarify"] as const)),
        ...(state.hostCallUsed ? [] : (["host_final_call"] as const)),
      ];
    case "REEVALUATING":
      return ["result", "no_match", ...(state.hostCallUsed ? [] : (["host_final_call"] as const))];
    case "FINALIZING":
      return ["result", "no_match"];
    default:
      return [];
  }
}

export function applyOutcome(state: RoomState, outcome: Outcome, evaluationSeq: number, now: number): RoomState {
  if (!isProcessingPhase(state.phase)) fail("wrong_phase", "Not evaluating.");
  if (evaluationSeq !== state.evaluationSeq) fail("stale_evaluation", "Inputs changed during evaluation.");
  if (!legalOutcomeKinds(state).includes(outcome.kind)) {
    fail("illegal_action", `${outcome.kind} is not allowed during ${state.phase}.`);
  }
  const base = { ...state, phaseStartedAt: now, opError: null };
  switch (outcome.kind) {
    case "result":
      return { ...base, phase: "RESULT", deadline: null, result: outcome.card };
    case "no_match":
      return { ...base, phase: "NO_FEASIBLE_MATCH", deadline: null, noMatch: outcome.noMatch };
    case "clarify": {
      const questions = sanitizeQuestions(state, outcome.questions);
      if (questions.length === 0) fail("illegal_action", "No valid clarification questions.");
      return {
        ...base,
        phase: "CLARIFYING",
        deadline: now + state.config.timers.clarifySec * 1000,
        clarification: { questions, askedAt: now },
        clarifyRoundUsed: true,
      };
    }
    case "host_final_call": {
      const q = outcome.hostCall.question.trim();
      if (!q || q.length > 300) fail("illegal_action", "Invalid host question.");
      if (outcome.hostCall.options.length > 2) fail("illegal_action", "At most two host choices.");
      return {
        ...base,
        phase: "HOST_FINAL_CALL",
        deadline: now + state.config.timers.hostSec * 1000,
        hostCall: { ...outcome.hostCall, question: q },
        hostCallUsed: true,
      };
    }
  }
}

function sanitizeQuestions(state: RoomState, questions: ClarifyQuestion[]): ClarifyQuestion[] {
  const seen = new Set<string>();
  const out: ClarifyQuestion[] = [];
  for (const q of questions) {
    const text = q.question.trim();
    if (!state.participants.some((p) => p.id === q.participantId)) continue;
    if (seen.has(q.participantId) || !text || text.length > 300) continue;
    seen.add(q.participantId);
    out.push({ ...q, question: text });
  }
  return out;
}

export function failEvaluation(state: RoomState, message: string, evaluationSeq: number, now: number): RoomState {
  if (!isProcessingPhase(state.phase) || evaluationSeq !== state.evaluationSeq) return state;
  return {
    ...state,
    opError: { stage: state.phase, message, attempts: (state.opError?.attempts ?? 0) + 1, at: now },
  };
}

/** Clear an operational error so the same computation runs again with unchanged inputs. */
export function retry(state: RoomState, actorId: string, now: number): RoomState {
  assertLive(state, now);
  participant(state, actorId);
  if (!state.opError) return state;
  return { ...state, opError: null };
}
