import { consequentialTopics, type Topic } from "../clarify";
import { buildClefState, clefChoice, scoreFits } from "../clef";
import { eligible } from "../decision-context";
import { writeClarifyQuestions, writeExplanation } from "../explain";
import { applyHostPriority, type FitMatrix, HOST_OPTIONS, type HostPriority, hostCallUseful, POLICY, selectAverage } from "../policy";
import type { DecisionMethodImpl } from "./types";

export const HOST_TOPIC_ID = "trip_vs_match";
export const HOST_QUESTION = "Last call: should we favor a shorter trip for everyone, or the best match for what people asked for?";

/**
 * Clef pipeline: application code finds consequential ambiguities and
 * enforces feasibility; Clef scores every diner × eligible restaurant and
 * picks among bounded options; code selects the highest average fit; the
 * general LLM only writes wording.
 */
export const clefMethod: DecisionMethodImpl = {
  id: "clef",
  async decide(input, deps) {
    const trace: Record<string, unknown> = {};

    if (input.allowClarify) {
      const topics = consequentialTopics({
        group: input.group,
        restaurants: input.restaurants,
        availabilitySeed: deps.availabilitySeed,
        ...(deps.frozenAvailability ? { frozenAvailability: deps.frozenAvailability } : {}),
      });
      trace.topics = topics;
      if (topics.length) {
        const chosen: Topic[] = [];
        const byDiner = new Map<string, Topic[]>();
        for (const t of topics) byDiner.set(t.participantId, [...(byDiner.get(t.participantId) ?? []), t]);
        const state = buildClefState(input);
        for (const [pid, list] of byDiner) {
          if (list.length === 1) {
            chosen.push(list[0]!);
            continue;
          }
          const pick = await clefChoice(
            deps.ai,
            state,
            `Diner ${pid} can be asked one private question. Which single question would most change whether the group gets a restaurant everyone can accept?`,
            Object.fromEntries(list.map((t) => [t.topicId, `"${t.term}" — alternative reading: ${t.alternative}`])),
            "clef:clarify_topic",
          );
          trace[`topicChoice:${pid}`] = pick;
          chosen.push(list.find((t) => t.topicId === pick.choice)!);
        }
        const questions = await writeClarifyQuestions(
          deps.ai,
          chosen.map((t) => ({ ...t, dinerText: input.group.diners.find((d) => d.participantId === t.participantId)?.originalText ?? null })),
        );
        if (questions.length) return { proposal: { kind: "clarify", questions }, trace };
      }
    }

    const candidates = eligible(input);
    if (!candidates.length) return { proposal: { kind: "no_feasible_match", reasonCodes: ["no_verified_candidate"] }, trace };

    const { table, calls } = await scoreFits(deps.ai, input);
    trace.clefCalls = calls;
    trace.scores = table;
    const fits: FitMatrix = Object.fromEntries(
      Object.entries(table).map(([rid, byDiner]) => [rid, Object.fromEntries(Object.entries(byDiner).map(([pid, a]) => [pid, a.score]))]),
    );
    const travel = Object.fromEntries(candidates.map((f) => [f.restaurantId, f.maxTravelHigh]));
    const sel = selectAverage(fits, travel)!;
    trace.selection = { policyVersion: POLICY.version, choice: sel.choice, bestMean: sel.bestMean };
    let choice = sel.choice;
    let hostPriority: HostPriority | null = null;

    const hostAnswer = input.group.hostAnswer;
    if (input.phase === "FINALIZING" && hostAnswer) {
      if (hostAnswer.choiceId === "shorter_trip" || hostAnswer.choiceId === "best_match") hostPriority = hostAnswer.choiceId;
      else {
        const mapped = await clefChoice(
          deps.ai,
          { hostAnswer: hostAnswer.text, question: HOST_QUESTION },
          "Which priority did the host express?",
          { shorter_trip: "Prefer a shorter trip for everyone", best_match: "Prefer the best match for what people asked for", no_preference: "No clear preference" },
          "clef:host_answer",
        );
        trace.hostAnswerMapping = mapped;
        if (mapped.choice !== "no_preference") hostPriority = mapped.choice as HostPriority;
      }
      if (hostPriority) {
        const band = sel.ranked.filter((r) => r.mean >= sel.bestMean - POLICY.hostBand - 1e-9);
        choice = applyHostPriority(band, hostPriority) ?? choice;
      }
    } else if (input.allowHost) {
      const gate = hostCallUseful(sel, fits);
      trace.hostGate = { useful: gate.useful, reason: gate.reason };
      if (gate.useful) {
        return { proposal: { kind: "host_final_call", topicId: HOST_TOPIC_ID, question: HOST_QUESTION, options: HOST_OPTIONS }, trace };
      }
    }

    const facts = candidates.find((f) => f.restaurantId === choice.restaurantId)!;
    const chosenScores = Object.values(fits[choice.restaurantId] ?? {});
    const compromise =
      chosenScores.length && Math.min(...chosenScores) < POLICY.acceptableFit ? "This is the strongest overall match, though it may not fit every preference equally." : undefined;
    const { explanation, assumptions } = await writeExplanation(deps.ai, input, facts, {
      ...(compromise ? { compromise } : {}),
      ...(hostPriority ? { hostPriority: HOST_OPTIONS.find((o) => o.id === hostPriority)!.label } : {}),
    });
    return {
      proposal: { kind: "recommend", restaurantId: choice.restaurantId, evidenceIds: [], assumptions, explanation },
      trace,
    };
  },
};
