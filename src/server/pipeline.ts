import type { Outcome } from "../shared/room-machine";
import type { RoomState } from "../shared/types";
import type { AiClient } from "./ai";
import type { InterpretCache } from "./interpret";

export type TraceFn = (kind: string, data: unknown) => void;

export type PipelineInput = {
  state: RoomState;
  now: number;
  ai: AiClient;
  trace: TraceFn;
  interpretCache?: InterpretCache;
};

/** Computes the next room outcome for the current processing phase. */
export type DecisionPipeline = (input: PipelineInput) => Promise<Outcome>;
