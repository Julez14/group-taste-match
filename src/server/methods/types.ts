import type { Decision } from "../../shared/decision";
import type { DecisionMethod } from "../../shared/types";
import type { AiClient } from "../ai";
import type { Availability } from "../availability";
import type { DecisionInput } from "../decision-context";

export type MethodDeps = {
  ai: AiClient;
  availabilitySeed: string;
  frozenAvailability?: Record<string, Availability>;
  /** Set on the single bounded recovery attempt after a guard or legality rejection. */
  feedback?: string;
};

export type MethodResult = {
  proposal: Decision;
  /** Observable intermediate data (scores, topics, selection). Never chain-of-thought. */
  trace: Record<string, unknown>;
};

export interface DecisionMethodImpl {
  id: DecisionMethod;
  decide(input: DecisionInput, deps: MethodDeps): Promise<MethodResult>;
}
