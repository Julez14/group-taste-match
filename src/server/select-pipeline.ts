import type { RoomState } from "../shared/types";
import { fixturePipeline } from "./fixture-pipeline";
import type { DecisionPipeline } from "./pipeline";

export function selectPipeline(env: Pick<Env, "PROVIDER_MODE">): DecisionPipeline {
  if (env.PROVIDER_MODE !== "live") return fixturePipeline(fixtureResult);
  throw new Error("Live decision pipeline not configured yet.");
}

function fixtureResult(_state: RoomState) {
  return {
    kind: "no_match" as const,
    noMatch: { reasonCodes: ["snapshot_pending"], message: "The restaurant snapshot hasn't been loaded yet." },
  };
}
