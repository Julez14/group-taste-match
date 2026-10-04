import { describe, expect, it } from "vitest";
import {
  ackTranscription,
  applyOutcome,
  createRoom,
  failEvaluation,
  join,
  MachineError,
  nextWakeAt,
  type Outcome,
  removeParticipant,
  resolveTranscription,
  retry,
  start,
  submit,
  tick,
} from "../src/shared/room-machine";
import { DEFAULT_TIMERS, type ResultCard, type RoomState } from "../src/shared/types";

const T0 = Date.parse("2026-10-04T18:00:00-04:00");
const sec = (s: number) => T0 + s * 1000;

function newRoom(): RoomState {
  return createRoom({
    id: "room1",
    host: { id: "h", name: "Hana", profileId: "p1", startAreaId: null, startLatLng: null },
    config: { diningAt: "2026-10-04T19:30:00-04:00", meetingAreaId: "union-square", timers: DEFAULT_TIMERS },
    method: "clef",
    now: T0,
  });
}

function withDiners(n: number): RoomState {
  let s = newRoom();
  for (let i = 1; i < n; i++) {
    s = join(s, { id: `d${i}`, name: `Diner ${i}`, profileId: "p2", startAreaId: null, startLatLng: null }, T0);
  }
  return s;
}

const say = (key: string, text = "Something cozy, any cuisine") =>
  ({ kind: "initial", text, source: "typed", idempotencyKey: key }) as const;

function expectCode(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(MachineError);
    expect((e as MachineError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
}

const card = { restaurantId: "r1" } as ResultCard;

describe("lobby and start", () => {
  it("only the host can start, and needs at least two diners", () => {
    const solo = newRoom();
    expectCode(() => start(solo, "h", T0), "too_few_diners");
    const s = withDiners(2);
    expectCode(() => start(s, "d1", T0), "forbidden");
    const started = start(s, "h", T0);
    expect(started.phase).toBe("COLLECTING");
    expect(started.partySize).toBe(2);
    expect(started.deadline).toBe(sec(90));
  });

  it("caps rooms at six and blocks new diners after start", () => {
    const six = withDiners(6);
    expectCode(
      () => join(six, { id: "x", name: "X", profileId: "p1", startAreaId: null, startLatLng: null }, T0),
      "room_full",
    );
    const started = start(withDiners(3), "h", T0);
    expectCode(
      () => join(started, { id: "late", name: "Late", profileId: "p1", startAreaId: null, startLatLng: null }, T0),
      "wrong_phase",
    );
  });

  it("lets existing diners rejoin after start", () => {
    const started = start(withDiners(3), "h", T0);
    const again = join(started, { id: "d1", name: "Diner 1", profileId: "p2", startAreaId: null, startLatLng: null }, sec(10));
    expect(again).toBe(started);
  });

  it("host may remove a duplicate in the lobby only", () => {
    const s = withDiners(3);
    expect(removeParticipant(s, "h", "d2", T0).participants).toHaveLength(2);
    expectCode(() => removeParticipant(s, "d1", "d2", T0), "forbidden");
    expectCode(() => removeParticipant(start(s, "h", T0), "h", "d2", T0), "wrong_phase");
  });

  it("start is idempotent once started", () => {
    const started = start(withDiners(2), "h", T0);
    expect(start(started, "h", sec(5))).toBe(started);
  });
});

describe("collecting", () => {
  it("advances immediately when everyone has submitted", () => {
    let s = start(withDiners(2), "h", T0);
    s = submit(s, "h", say("k1"), sec(5));
    expect(s.phase).toBe("COLLECTING");
    s = submit(s, "d1", say("k2"), sec(6));
    expect(s.phase).toBe("EVALUATING");
    expect(s.evaluationSeq).toBe(1);
  });

  it("allows edits until the phase closes and treats retries idempotently", () => {
    let s = start(withDiners(3), "h", T0);
    s = submit(s, "h", say("k1", "ramen"), sec(5));
    const retried = submit(s, "h", say("k1", "ramen"), sec(6));
    expect(retried).toBe(s);
    s = submit(s, "h", say("k2", "actually vegetarian italian"), sec(7));
    expect(s.submissions.h?.initial).toMatchObject({ text: "actually vegetarian italian", revision: 2 });
  });

  it("rejects late submissions and closes at the deadline with missing input unknown", () => {
    let s = start(withDiners(3), "h", T0);
    s = submit(s, "h", say("k1"), sec(5));
    expectCode(() => submit(s, "d1", say("k2"), sec(91)), "deadline_passed");
    s = tick(s, sec(90));
    expect(s.phase).toBe("EVALUATING");
    expect(s.submissions.d1).toBeUndefined();
    expect(s.partySize).toBe(3);
  });

  it("rejects empty text and edits after the phase closed", () => {
    let s = start(withDiners(2), "h", T0);
    expectCode(() => submit(s, "h", say("k", "   "), sec(1)), "invalid_input");
    s = submit(s, "h", say("k1"), sec(2));
    s = submit(s, "d1", say("k2"), sec(3));
    expectCode(() => submit(s, "h", say("k3", "changed"), sec(4)), "wrong_phase");
  });

  it("non-members cannot submit", () => {
    const s = start(withDiners(2), "h", T0);
    expectCode(() => submit(s, "stranger", say("k"), sec(1)), "forbidden");
  });
});

describe("voice transcription grace", () => {
  it("waits up to 20s after an acknowledged recording, then accepts it", () => {
    let s = start(withDiners(2), "h", T0);
    s = submit(s, "h", say("k1"), sec(10));
    s = ackTranscription(s, "d1", { id: "t1", kind: "initial" }, sec(85));
    s = tick(s, sec(90));
    expect(s.phase).toBe("COLLECTING");
    expect(nextWakeAt(s)).toBe(sec(105));
    const r = resolveTranscription(s, "d1", { id: "t1", text: "tacos please" }, sec(97));
    expect(r.accepted).toBe(true);
    expect(r.state.phase).toBe("EVALUATING");
    expect(r.state.submissions.d1?.initial?.source).toBe("voice");
  });

  it("drops transcripts that finish after the grace window or come back empty", () => {
    let s = start(withDiners(2), "h", T0);
    s = ackTranscription(s, "d1", { id: "t1", kind: "initial" }, sec(85));
    const late = resolveTranscription(s, "d1", { id: "t1", text: "tacos" }, sec(106));
    expect(late.accepted).toBe(false);
    expect(late.state.submissions.d1).toBeUndefined();
    const empty = resolveTranscription(s, "d1", { id: "t1", text: "  " }, sec(86));
    expect(empty.accepted).toBe(false);
  });

  it("cannot acknowledge a recording after the deadline", () => {
    const s = start(withDiners(2), "h", T0);
    expectCode(() => ackTranscription(s, "d1", { id: "t", kind: "initial" }, sec(91)), "deadline_passed");
  });
});

function evaluating(): RoomState {
  let s = start(withDiners(3), "h", T0);
  for (const id of ["h", "d1", "d2"]) s = submit(s, id, say(`k-${id}`), sec(5));
  return s;
}

const clarify: Outcome = {
  kind: "clarify",
  questions: [
    { participantId: "d1", topicId: "budget", question: "Is $25 a hard limit?" },
    { participantId: "d1", topicId: "dup", question: "Duplicate?" },
    { participantId: "ghost", topicId: "x", question: "Not in room" },
  ],
};
const hostCall: Outcome = {
  kind: "host_final_call",
  hostCall: {
    topicId: "travel_vs_vibe",
    question: "Shorter trip or nicer room?",
    options: [
      { id: "a", label: "Shorter trip" },
      { id: "b", label: "Nicer room" },
    ],
  },
};

describe("clarification and host limits", () => {
  it("asks one question per affected diner and drops unknown or duplicate targets", () => {
    const s = applyOutcome(evaluating(), clarify, 1, sec(10));
    expect(s.phase).toBe("CLARIFYING");
    expect(s.clarification?.questions).toEqual([
      { participantId: "d1", topicId: "budget", question: "Is $25 a hard limit?" },
    ]);
    expect(s.deadline).toBe(sec(10 + 45));
  });

  it("only asked diners can answer; clarification timeout keeps original requirements", () => {
    let s = applyOutcome(evaluating(), clarify, 1, sec(10));
    expectCode(() => submit(s, "d2", { ...say("c"), kind: "clarify" }, sec(11)), "forbidden");
    s = tick(s, sec(55));
    expect(s.phase).toBe("REEVALUATING");
    expect(s.submissions.d1?.clarify).toBeUndefined();
  });

  it("never allows a second clarification round", () => {
    let s = applyOutcome(evaluating(), clarify, 1, sec(10));
    s = submit(s, "d1", { kind: "clarify", text: "Yes, hard limit", source: "typed", idempotencyKey: "c1" }, sec(12));
    expect(s.phase).toBe("REEVALUATING");
    expectCode(() => applyOutcome(s, clarify, s.evaluationSeq, sec(13)), "illegal_action");
  });

  it("allows exactly one host call, answered only by the host", () => {
    let s = applyOutcome(evaluating(), hostCall, 1, sec(10));
    expect(s.phase).toBe("HOST_FINAL_CALL");
    expectCode(
      () => submit(s, "d1", { kind: "host", text: "", source: "typed", choiceId: "a", idempotencyKey: "x" }, sec(11)),
      "forbidden",
    );
    s = submit(s, "h", { kind: "host", text: "", source: "typed", choiceId: "a", idempotencyKey: "hc" }, sec(12));
    expect(s.phase).toBe("FINALIZING");
    expect(s.submissions.h?.host?.text).toBe("Shorter trip");
    expectCode(() => applyOutcome(s, hostCall, s.evaluationSeq, sec(13)), "illegal_action");
    expectCode(() => applyOutcome(s, clarify, s.evaluationSeq, sec(13)), "illegal_action");
  });

  it("host timeout moves to finalizing without an answer", () => {
    let s = applyOutcome(evaluating(), hostCall, 1, sec(10));
    s = tick(s, sec(40));
    expect(s.phase).toBe("FINALIZING");
    expect(s.submissions.h?.host).toBeUndefined();
  });
});

describe("evaluation results and errors", () => {
  it("rejects stale evaluations and terminal restarts", () => {
    const s = evaluating();
    expectCode(() => applyOutcome(s, { kind: "result", card }, 0, sec(10)), "stale_evaluation");
    const done = applyOutcome(s, { kind: "result", card }, 1, sec(10));
    expect(done.phase).toBe("RESULT");
    expectCode(() => applyOutcome(done, { kind: "result", card }, 1, sec(11)), "wrong_phase");
  });

  it("treats provider errors as recoverable without changing inputs", () => {
    let s = evaluating();
    s = failEvaluation(s, "Workers AI timeout", 1, sec(10));
    expect(s.phase).toBe("EVALUATING");
    expect(s.opError?.attempts).toBe(1);
    s = retry(s, "d1", sec(11));
    expect(s.opError).toBeNull();
    expect(s.evaluationSeq).toBe(1);
    expect(s.clarifyRoundUsed).toBe(false);
  });

  it("no-match is terminal", () => {
    const s = applyOutcome(evaluating(), { kind: "no_match", noMatch: { reasonCodes: ["budget"], message: "x" } }, 1, sec(10));
    expect(s.phase).toBe("NO_FEASIBLE_MATCH");
    expectCode(() => submit(s, "h", say("again"), sec(11)), "wrong_phase");
  });

  it("expires rooms after 24 hours", () => {
    const s = withDiners(2);
    expectCode(() => start(s, "h", T0 + 24 * 3600_000), "expired");
  });
});
