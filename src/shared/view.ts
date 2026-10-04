import { isInputPhase, requiredResponders } from "./room-machine";
import {
  type HostCall,
  INPUT_PHASE_KIND,
  type NoMatch,
  type Phase,
  type ResultCard,
  type RoomConfig,
  type RoomState,
  type Submission,
} from "./types";

/**
 * What one participant may see. Shared fields never reveal another diner's
 * input, who is being asked to clarify, or what the host is deciding.
 */
export type RoomView = {
  roomId: string;
  phase: Phase;
  deadline: number | null;
  serverNow: number;
  config: RoomConfig;
  partySize: number | null;
  me: { id: string; name: string; isHost: boolean; profileId: string; startAreaId: string | null };
  participants: { id: string; name: string; isHost: boolean; submitted: boolean | null }[];
  /** True when this participant owes a response in the current input phase. */
  needsMyInput: boolean;
  mySubmission: Pick<Submission, "text" | "source" | "revision" | "choiceId"> | null;
  myTranscriptionPending: boolean;
  myQuestion: string | null;
  hostCall: HostCall | null;
  result: ResultCard | null;
  noMatch: NoMatch | null;
  /** Neutral, non-identifying operational error; any member may retry. */
  error: { message: string; canRetry: boolean } | null;
  fixtureMode: boolean;
};

export function toView(state: RoomState, participantId: string, now: number, fixtureMode: boolean): RoomView {
  const me = state.participants.find((p) => p.id === participantId);
  if (!me) throw new Error("not a participant");
  const inputKind = isInputPhase(state.phase) ? INPUT_PHASE_KIND[state.phase] : null;
  const required = requiredResponders(state);
  const needsMyInput = required.includes(participantId);
  const mine = inputKind ? state.submissions[participantId]?.[inputKind] : undefined;

  return {
    roomId: state.id,
    phase: state.phase,
    deadline: state.deadline,
    serverNow: now,
    config: state.config,
    partySize: state.partySize,
    me: { id: me.id, name: me.name, isHost: me.isHost, profileId: me.profileId, startAreaId: me.startAreaId },
    participants: state.participants.map((p) => ({
      id: p.id,
      name: p.name,
      isHost: p.isHost,
      // Only the initial round shows who's in; later rounds stay neutral.
      submitted: state.phase === "COLLECTING" ? Boolean(state.submissions[p.id]?.initial) : null,
    })),
    needsMyInput,
    mySubmission:
      needsMyInput && mine
        ? { text: mine.text, source: mine.source, revision: mine.revision, ...(mine.choiceId ? { choiceId: mine.choiceId } : {}) }
        : null,
    myTranscriptionPending: Boolean(state.pendingTranscriptions[participantId]),
    myQuestion:
      state.phase === "CLARIFYING"
        ? (state.clarification?.questions.find((q) => q.participantId === participantId)?.question ?? null)
        : null,
    hostCall: state.phase === "HOST_FINAL_CALL" && me.isHost ? state.hostCall : null,
    result: state.phase === "RESULT" ? state.result : null,
    noMatch: state.phase === "NO_FEASIBLE_MATCH" ? state.noMatch : null,
    error: state.opError
      ? { message: "We hit a snag picking a spot. Nothing you said was lost.", canRetry: true }
      : null,
    fixtureMode,
  };
}
