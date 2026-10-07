# Agent handoff: Beli Group Taste-Match

> **This file is temporary.** It hands context from one AI agent session to the next. Once its contents are absorbed (or out of date), delete it in its own commit: `git rm AGENT_HANDOFF.md && git commit -m "Remove agent handoff notes"`. Don't let it go stale: if you keep it for a while, update it at the end of your session.

Written 2026-10-06.

## Project
- **Repo:** `/Users/julianlaxman/repos/github/julez14/group-taste-match` (GitHub `Julez14/group-taste-match`, branch `main`). The previous agent couldn't `git push` (blocked by permissions). Check `git rev-list --count origin/main..HEAD` and ask the user to push.
- **Specs (source of truth):** `Beli_Group_Taste_Match_Explore_PRD.md`, `Beli_Group_Explore_Experiment_Plan.md`.
- **Live:** https://group-taste-match.juelzlax.workers.dev, in live mode with `DECISION_METHOD=llm_baseline`.
- **Cloudflare:** account `5123e5b48cbca84dedd3925e6085c866`; AI Gateway `group-taste-match` (caching off, logs on); Wrangler is signed in.
- **What it is:** a mobile web app styled as an official Beli feature that picks one restaurant for 2–6 NYC diners. The README and report state it's an independent concept, and the site sends `noindex`.

## Stack (decided, don't reopen)
- One Cloudflare Worker serving React + Vite (`@cloudflare/vite-plugin`).
- One Durable Object per room: SQLite storage, alarms for deadlines, evaluation and 24-hour expiry, hibernatable WebSockets. No Agents SDK.
- pnpm, TypeScript 7, zod 4.
- Vitest 4 with `@cloudflare/vitest-plugin` (the renamed `vitest-pool-workers`), always fixture mode. Playwright for e2e.
- Models, all via the AI Gateway:
  - `@cf/cloudflare/clef`
  - `@cf/openai/gpt-oss-120b`: interpretation, wording, and the baseline
  - `@cf/deepgram/nova-3`: speech-to-text
  - `@cf/moonshotai/kimi-k2.6`: experiment judge only
- Data is versioned JSON in `data/v1/`: 30 real NYC restaurants with dated evidence, 8 synthetic profiles, meeting areas.

## Key files
| What | Where |
| --- | --- |
| Room rules (pure state machine) | `src/shared/room-machine.ts`, `src/shared/types.ts` |
| Durable Object, API, dev-only routes | `src/worker/room.ts`, `src/worker/index.ts`, `src/worker/dev-routes.ts` |
| Interpretation + safeguards (grounding, backstop, budget basis), clarification patches | `src/server/interpret.ts`, `interpret-schema.ts`, `clarify-patch.ts` |
| Hard-constraint guard | `src/server/feasibility.ts` |
| **Baseline prompt** (`BASELINE_SYSTEM`) | `src/server/methods/baseline-method.ts` |
| **Clef rubric** (`FIT_CRITERIA`, `fitInstructions`) + scoring | `src/server/clef.ts` |
| Clef method, fairness policy (`POLICY`), clarification gating | `src/server/methods/clef-method.ts`, `src/server/policy.ts`, `src/server/clarify.ts` |
| Shared enforcement, privacy filter, result card | `src/server/decide.ts`, `src/server/privacy.ts`, `src/server/card.ts` |
| What the models see (diner/candidate views) | `src/server/decision-context.ts` |
| Client (Beli-style screens, voice) | `src/client/` |
| Experiment harness | `src/experiment/` (scenario, truth, simulate, judge) and `experiment/scripts/` |

## Commands
- `pnpm dev` (port 5199 used in experiments), `pnpm test` (105 pass), `pnpm typecheck`, `pnpm e2e`, `pnpm run deploy`.
- `.dev.vars` is gitignored and needs `PROVIDER_MODE=live`, `DECISION_METHOD=…`, `AI_GATEWAY_ID=group-taste-match`, and `DEV_ROUTES=on`. `DEV_ROUTES` enables `/api/__exp/*` and `/traces`; never set it in deployed config.
- Experiment scripts call the **running local dev server**, so start `pnpm dev` first:
  - `pnpm exp:labels`, `exp:freeze --split=dev|test [--force]`, `exp:run --split --track=fixed|flow [--repeats=3] [--tag=x] [--concurrency=3]`
  - `exp:judge`, `exp:analyze`, `exp:charts`, `exp:pdf`, `exp:packet`, `review` (port 5300), `exp:human`, `exp:protocol`
- Dev runs write to `experiment/results/dev/*.<tag>.jsonl` (gitignored).

## Experiment exp-v1 (finished)
- **Setup:** 60 scenarios (`experiment/scenarios/v1.json`), 20 dev / 40 held-out. Protocol frozen at commit `6470ba2` (`experiment/protocol.json`), with one dated amendment in `experiment/protocol_amendments.json`.
- **Held-out runs:** 240 fixed-state + 80 complete-flow, Kimi-judged (reasoning off). Cost $1.83 of the $10 cap.
- **Quality tied.**
  - Acceptable-group rate: Clef 21% vs baseline 26% in fixed-state (95% CI for Clef − baseline: −13 to +2), and 26% vs 26% in the flow.
  - Both had 0 rule violations and 27/27 correct "no match" answers.
- **Speed:** Clef 5.2 s vs baseline 23 s median decision. Neither meets the 15 s p95 target in the flow (Clef 21 s, baseline 92 s).
- **Reliability and side effects:** Clef had 3 timeouts and asked the host in 20% of sessions. The baseline had 24 privacy leaks (all caught by the filter) and was more consistent across repeats (87% vs 66%).
- **Human blinded A/B:** lighter pass on the 23 scenarios with different picks; one reviewer, who is the developer. Baseline 15, Clef 5, tie 1, neither 2 (p = 0.04). Main reason: Clef ignored requested cuisines (S09, S11, S03). Clef won on novelty requests (S40, S17).
- **Report:** `Beli_Group_Explore_Experiment_Report.md` / `.pdf`. Raw outputs in `experiment/results/` and `experiment/review/`.

## Next task: tune the prompt and choice logic
- **Problem:**
  - Layer 1 deterministic filters remove anything that breaks a must-have.
  - The baseline prompt orders: must-haves, then tonight's request/clarification over history, then novelty over favorites, then history as a weak signal, then weakest-diner fairness, then average fit, then shorter worst trip, then id.
  - **Within one diner's 0–4 fit there is no ordering** between cuisine, distance, price, atmosphere, and dietary fit; the model decides implicitly. Clef's rubric lists the same factors without weights.
  - There's no rule for using the profile when a request is silent on a dimension, and "unknown stays unknown" may suppress it.
- **Plan:**
  1. The user decides the explicit ordering and the profile-fill rule.
  2. Edit `BASELINE_SYSTEM` (and optionally Clef's `fitInstructions`) and bump the prompt versions.
  3. Tune **only on the 20 dev scenarios**.
  4. Re-freeze and re-run as a **new experiment version** (exp-v2) with a new protocol and a fresh held-out comparison. Don't overwrite exp-v1 results.
- **Other next steps from the report:**
  - Get baseline latency under 15 s p95: try lower reasoning effort, a candidate pre-filter, or a shorter prompt.
  - Make clarification useful: only 3 questions in 80 sessions, all unanswerable.

## Gotchas
- **Permissions:** the previous agent's tools blocked `git push`, `rm`, and `kill`. Use flags like `--force` or `--tag` instead of deleting files.
- **Don't edit `src/` while experiment runs are executing.** Vite hot-reloads the Worker and breaks in-flight runs.
- **Use `--concurrency=3`.** At 6, Workers AI calls time out.
- **Experiment scripts aren't typechecked.** `tsx` runs them; they're excluded from `tsc -b`.
- **Interpretation is stochastic.** After any interpretation change, re-freeze dev inputs and inspect each diner's hard constraints.
- **Mobbin MCP:** it showed "needs auth" in the agent; the workaround was `mcp-remote` with a small MCP client (it lived in `/tmp/mobbin-client`, which may be gone). 462 Beli screens were reachable.
- **User rules:** no new `.md` files unless asked; use `pip3`/`python3`; reach 95% confidence before building and ask questions otherwise; commit in small, readable chunks.
- **Possibly still running:** the review server on port 5300 (`node experiment/review/server.mjs`). The dev server isn't running.
- **Untracked files:** `experiment/frozen/fixed_state_inputs.dev.json` (dev freeze, fine to commit or ignore) and `.cursor/` (user settings, don't commit).
