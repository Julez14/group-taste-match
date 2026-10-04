import { judge } from "../experiment/judge";
import { type Scenario, ScenarioSchema } from "../experiment/scenario";
import { freezeNormalized, runFixedState, runFullFlow } from "../experiment/simulate";
import type { NormalizedGroup } from "../shared/normalized";
import type { DecisionMethod } from "../shared/types";
import { bindingClient } from "../server/ai";
import type { Availability } from "../server/availability";
import { restaurants } from "../server/snapshot";

/**
 * Experiment endpoints for the local Node orchestrator. They exist only when
 * the Worker runs with DEV_ROUTES=on (local .dev.vars); never deployed.
 * Calls go through the Workers AI binding and AI Gateway, so no API tokens
 * are handled by the experiment scripts.
 */
export async function devRoute(req: Request, env: Env, action: string): Promise<Response> {
  const body = (await req.json()) as {
    scenario: Scenario;
    method?: DecisionMethod;
    repeat?: number;
    frozenGroup?: NormalizedGroup;
    frozenAvailability?: Record<string, Availability>;
    restaurantId?: string;
  };
  const parsed = ScenarioSchema.safeParse(body.scenario);
  if (!parsed.success) return Response.json({ error: "invalid scenario" }, { status: 400 });
  const scenario = parsed.data;
  const ai = bindingClient(env, { experiment: "v1", scenario: scenario.id, action });
  const all = restaurants();
  const frozen = body.frozenAvailability ?? {};
  try {
    switch (action) {
      case "freeze":
        return Response.json({ group: await freezeNormalized({ scenario, ai }), aiCalls: ai.calls });
      case "fixed":
        return Response.json(
          await runFixedState({ scenario, method: body.method!, repeat: body.repeat ?? 0, frozenGroup: body.frozenGroup!, ai, restaurants: all, frozen }),
        );
      case "flow":
        return Response.json(await runFullFlow({ scenario, method: body.method!, ai, restaurants: all, frozen }));
      case "judge": {
        const r = all.find((x) => x.id === body.restaurantId);
        if (!r) return Response.json({ error: "unknown restaurant" }, { status: 400 });
        return Response.json({ result: await judge(ai, scenario, r, frozen[r.id]!), aiCalls: ai.calls });
      }
      default:
        return Response.json({ error: "unknown action" }, { status: 404 });
    }
  } catch (e) {
    return Response.json({ error: (e as Error).message, aiCalls: ai.calls }, { status: 500 });
  }
}
