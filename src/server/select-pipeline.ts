import type { Outcome } from "../shared/room-machine";
import type { RoomState } from "../shared/types";
import { buildCard, noMatchFromFacts } from "./card";
import { evaluateAll } from "./feasibility";
import { fixtureInterpreter, normalizeGroup } from "./interpret";
import { fixturePipeline } from "./fixture-pipeline";
import { livePipeline } from "./live-pipeline";
import type { DecisionPipeline } from "./pipeline";
import { restaurants } from "./snapshot";

export function selectPipeline(env: Pick<Env, "PROVIDER_MODE">, method: RoomState["method"]): DecisionPipeline {
  return env.PROVIDER_MODE === "live" ? livePipeline(method) : fixturePipeline(fixtureResult);
}

/** Fixture result: first feasible snapshot restaurant under the regex interpreter. */
async function fixtureResult(state: RoomState): Promise<Outcome> {
  const group = await normalizeGroup(state, fixtureInterpreter);
  const all = restaurants();
  const facts = evaluateAll({ group, restaurants: all, availabilitySeed: state.id });
  const pick = facts.find((f) => f.feasible);
  if (!pick) return { kind: "no_match", noMatch: noMatchFromFacts(facts) };
  const restaurant = all.find((r) => r.id === pick.restaurantId)!;
  return {
    kind: "result",
    card: buildCard({
      restaurant,
      facts: pick,
      group,
      explanation: `Fixture pick: ${restaurant.name} fits everyone's must-haves in this development run.`,
      extraAssumptions: [],
    }),
  };
}
