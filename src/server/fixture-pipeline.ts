import type { Outcome } from "../shared/room-machine";
import type { RoomState } from "../shared/types";
import { ProviderError } from "./ai";
import type { DecisionPipeline } from "./pipeline";

/**
 * Canned decisions for UI development and tests. Hashtags in a diner's text
 * steer it: #clarify, #host, #nomatch, #error. Fixture outputs are never
 * benchmark results.
 */
export function fixturePipeline(pickResult: (state: RoomState) => Outcome): DecisionPipeline {
  return async ({ state, trace }) => {
    const texts = Object.entries(state.submissions).flatMap(([pid, subs]) =>
      Object.values(subs).map((s) => ({ pid, text: s.text.toLowerCase() })),
    );
    const has = (tag: string) => texts.some((t) => t.text.includes(tag));
    trace("fixture_decision", { phase: state.phase });

    if (has("#error")) throw new ProviderError("Fixture provider error", "fixture");
    if (has("#nomatch")) {
      return {
        kind: "no_match",
        noMatch: {
          reasonCodes: ["fixture"],
          message: "None of the restaurants in this prototype's list fit everyone's must-haves.",
        },
      };
    }
    if (state.phase === "EVALUATING" && !state.clarifyRoundUsed && has("#clarify")) {
      const asked = [...new Set(texts.filter((t) => t.text.includes("#clarify")).map((t) => t.pid))];
      return {
        kind: "clarify",
        questions: asked.map((participantId) => ({
          participantId,
          topicId: "budget_basis",
          question: "Quick check — is your budget a firm limit including tax and tip, or just a rough guide?",
        })),
      };
    }
    if (state.phase !== "FINALIZING" && !state.hostCallUsed && has("#host")) {
      return {
        kind: "host_final_call",
        hostCall: {
          topicId: "travel_vs_atmosphere",
          question: "Last call: should we favor a shorter trip for everyone, or a nicer room that's a bit farther?",
          options: [
            { id: "shorter_trip", label: "Shorter trip" },
            { id: "nicer_room", label: "Nicer room" },
          ],
        },
      };
    }
    return pickResult(state);
  };
}
