# Beli Group Taste-Match Explore

**Product requirements and coding-agent handoff**  
Version 1.1 · October 4, 2026 · NYC prototype · Mobile-first web app

## 1. Product decision

Build a small prototype that helps 2–6 diners agree on where to eat. A host creates a room, shares its link, and starts the session. Each diner describes what they want, preferably by speaking. The system resolves consequential ambiguities, asks the host for one final call only when needed, and chooses **one restaurant**.

Build two interchangeable decision methods: a Clef-based pipeline and a simple general-purpose LLM baseline. Follow the separate [Decision-Pipeline Experiment Plan](Beli_Group_Explore_Experiment_Plan.md) to compare them fairly, choose a method from the evidence, and generate a founder-facing results report. A Clef win is a hypothesis, not a requirement.

This document authorizes implementation, local verification, evaluation runs using available credentials, and report generation. It specifies an independent concept prototype, not an official Beli integration. Do not claim to have performed experiments, obtained user feedback, or accessed Beli systems without evidence.

## 2. Problem, goals, and scope

Groups currently translate several people's tastes, budgets, travel preferences, and availability into a decision themselves. A list of recommendations leaves that work with the group. This feature should make a reasonable, explainable decision while protecting each person's explicit requirements.

The prototype has three goals:

- Reduce coordination: one initial submission per diner, at most one private clarification per affected diner, and one conditional host decision.
- Produce a grounded restaurant choice that respects requirements and avoids sacrificing one diner for a higher group average.
- Demonstrate technical judgment through reproducible evaluation, honest failure analysis, and a justified architecture choice.

| In the MVP | Outside the MVP |
| --- | --- |
| Mobile web rooms for 2–6 diners, including the host | Native apps, persistent accounts, Beli authentication |
| Invite links, a lobby, and a host-controlled Start button | Group chat, voting, ranked lists, ongoing room management |
| Voice recording, editable transcripts, and typing | A real-time spoken assistant or voice conversation |
| Real, sourced NYC restaurant records | Nationwide search, live browsing during a decision |
| Synthetic Beli-style profiles and ordered restaurant histories | Real Beli user information or proprietary scores |
| Simulated reservation availability | Live OpenTable access or making bookings |
| One clarification round and a conditional final host call | Unlimited adjustments or post-result regeneration |
| Clef-versus-LLM evaluation and a results report | Training model weights, broad agent frameworks, a reporting dashboard |

Product success is a completed group decision with little effort, not time spent in the app. The initial technical latency target is p95 ≤15 seconds per automated decision phase, excluding user response time. Measure it; do not present it as achieved before testing. Benchmarks are evidence about this prototype, not a forecast of Beli adoption or retention.

## 3. Confirmed decisions and implementation defaults

The user has confirmed: mobile-first web; NYC; 2–6 diners; voice as the intended input with typing available; real restaurant data; mock taste histories; simulated reservations; one restaurant; natural assumption explanations; parallel private clarifications; neutral group status; host intervention only after clarification when a meaningful decision remains uncertain; host-configurable time limits; and room-creation confirmation of date/time and meeting area.

Use these implementation defaults without reopening the settled scope:

- No sign-in. A participant enters a display name and chooses a supplied demo taste profile. Assign a sensible default so profile selection takes one tap or can be skipped.
- Host confirms date, time, and a named NYC meeting area, then optionally changes timers. Display suggested values, require confirmation, and store dates in `America/New_York` with an explicit offset.
- A participant may supply an approximate starting neighborhood when joining. Browser geolocation is optional and requested only after a tap. If omitted, use the confirmed meeting area; explain this assumption privately and in the collective result without revealing individual origins.
- Initial response: 90 seconds, configurable to 60/90/120. Clarification: 45 seconds, configurable to 30/45/60. Host final call: 30 seconds, configurable to 15/30/45. Timers are fixed after Start.
- No default hard budget. Missing budget means unknown, not unlimited. Use the profile's price preferences as a soft signal and disclose the selected restaurant's estimate.
- Standard price display is an estimated meal cost per person, with its included items and tax/tip assumptions visible. Do not silently reinterpret a stated budget as food-only or all-in when that distinction affects feasibility.
- Start with full Clef. Clef-flash is an optional later development comparison, not a third required experiment arm.
- Use a configurable general LLM and speech-to-text provider. Record exact providers, model identifiers, and settings in the experiment. Keep credentials on the server.

## 4. User flow and state rules

| Stage | Participant experience | Transition and rules |
| --- | --- | --- |
| Create | Host confirms meeting basics and optional timers | Generate a room and a shareable invite link. Host is the first diner. |
| Lobby | Join by link, enter name, choose demo profile; see who has joined | Host starts with 2–6 diners. Freeze the participant roster and party size at Start. |
| Collect | Prompt: “Tell us what you're in the mood for.” Record is the primary action; typing remains visible | End early when all diners submit, otherwise use the initial deadline. |
| Evaluate | Neutral shared progress message | Interpret inputs, check requirements, evaluate restaurant candidates, and decide whether a clarification would matter. |
| Clarify, optional | Affected diners receive one private question each; others see “We're checking a couple of details.” | Ask questions in parallel. One question per affected diner and one clarification round per room. |
| Re-evaluate | Neutral shared progress | Apply only that diner's submitted clarification. Recheck feasibility and fit. |
| Host final call, conditional | Host receives one focused question about a remaining soft tradeoff; others see neutral progress | Skip if the system can choose adequately. One host response or timeout; no second adjustment. |
| Result | Everyone receives the same single restaurant card | Terminal result. Booking/directions actions open external pages. No regenerate button. |
| No feasible match | Explain that the supplied restaurant set cannot meet the requirements | Terminal outcome, with a short reason and an explicit option to create a new room. No fabricated recommendation. |

Use a server-authoritative state machine. Suggested states are `LOBBY`, `COLLECTING`, `EVALUATING`, `CLARIFYING`, `REEVALUATING`, `HOST_FINAL_CALL`, `FINALIZING`, `RESULT`, and `NO_FEASIBLE_MATCH`. API/provider errors are recoverable operational states, not evidence that no restaurant exists. A safe Retry repeats the same computation with unchanged inputs; it does not grant a new preference adjustment.

### Timing, membership, and recovery

- Advance immediately when all required responses arrive. Do not make a completed group wait for the clock.
- An unsubmitted draft or recording is never silently submitted at timeout. Preserve already submitted information and mark missing information as unknown.
- Diners who fail to respond still count toward party size. Nonresponse does not mean they waived requirements already recorded in the session.
- A clarification timeout keeps the original requirements. It does not accept a suggested budget increase or other relaxation.
- A host timeout uses the frozen deterministic selection policy over feasible candidates. If there are none, return an honest no-match outcome.
- Host disconnection does not stop clocks. Permit refresh/rejoin with the same participant identity. After Start, block new diners; reconnecting existing diners remains allowed.
- During the lobby, host may remove an accidental duplicate. After Start, do not remove a diner to improve feasibility or reset the timer.
- Accept submissions atomically up to the server deadline. Make retries idempotent. Reject late edits once the relevant phase has closed.
- A participant may edit and replace their own submission until the phase closes; edits do not extend the deadline. The host cannot inspect or edit anyone else's private input.
- Expire rooms after 24 hours. Store transcripts and decision traces only for the prototype's documented retention window. Do not retain raw audio by default.

### Voice interaction

Tapping Record captures audio. The diner can submit directly, or stop recording, inspect/edit the transcript, and submit. Submitting directly must still show the resulting transcript and processing status. Transcription failure returns the diner to their own draft with typing available. Do not interpret an empty or failed transcript as a successful preference submission.

Use clear permission-denied, unsupported-browser, and network-failure states. A microphone failure must not block typing. Cap recordings at 60 seconds, show the room deadline, and do not extend room timing during transcription. A recording submitted and acknowledged before the deadline gets at most 20 seconds of server transcription processing from acknowledgment. Evaluate after pending transcriptions complete or reach that limit. A failed transcription remains missing input; it does not create another response round.

### Final restaurant card

Show the restaurant name, cuisine, neighborhood, estimated per-person cost and basis, approximate travel information, dining date/time and party size, concise group-fit explanation, natural assumptions, and directions/restaurant or booking-page links. Label availability **“Simulated availability — prototype”**. A booking link does not confirm a reservation.

Use collective explanations, for example: “I picked somewhere relaxed with several vegetarian options and a manageable trip from your meeting area.” Do not expose a diner's private budget, location, allergy, or clarification. Do not display a numerical enjoyment probability. Keep evidence-backed tradeoffs visible without turning the card into a technical log.

## 5. Restaurant data, profiles, and availability

### Restaurant snapshot

Target 30 actual NYC restaurants across multiple neighborhoods, cuisines, price levels, and dining styles. Begin with a smaller verified set for the vertical slice, then complete the snapshot before freezing the benchmark. A limited corpus must be identified as such; “no match” refers to this corpus, not every restaurant in NYC.

Prefer official restaurant websites and menus for factual fields. Use a permitted source for coordinates. Cite sources at the field or evidence-record level and record retrieval dates. Atmosphere tags are evidence-backed editorial judgments, not guaranteed facts. Keep unknowns explicit. Never generate fake NYC restaurants to fill a gap in the real-data requirement.

Minimum record shape:

```ts
type Restaurant = {
  id: string; name: string; neighborhood: string;
  cuisines: string[]; lat: number; lng: number;
  mealEstimate: { low: number; high: number; currency: "USD";
    basis: string; assumptions: string[]; evidenceIds: string[] };
  menuOptions: { dietaryTag: string; description: string;
    evidenceIds: string[]; verificationStatus: string }[];
  atmosphere: { tag: string; evidenceIds: string[] }[];
  hours: unknown; // implement a validated local-time schedule, not free text
  websiteUrl: string; bookingUrl?: string;
  evidence: { id: string; url: string; retrievedAt: string;
    field: string; note: string }[];
};
```

Dietary menu options do not prove allergy-safe preparation. If a hard requirement needs evidence the snapshot lacks, the restaurant is unverified for that requirement. Do not claim medical safety. An explicit budget cap requires a credible compatible meal estimate, not a dollar-sign category or optimistic minimum. If a diner specifies a particular order, estimate that order when evidence permits.

Compute approximate travel consistently from approximate starting areas. For the MVP, use documented geographic estimates/ranges rather than pretending to have live transit routing. For an explicit hard travel limit that cannot be verified with the chosen method, retain the uncertainty and resolve it conservatively. Both experiment arms receive exactly the same travel estimates.

### Synthetic taste histories

Create at least six distinct demo profiles with an ordered history of roughly 8–12 real restaurants each, plus optional notes about dishes or occasions. Make all profile history explicitly synthetic. Use rank order as a within-person taste signal; do not pretend arbitrary ranks are comparable ratings across diners. Include histories outside the current candidate set if useful for inference.

Current requests and submitted clarifications outrank historical preferences. A diner who usually likes ramen but currently asks for vegetarian Italian food should not be redirected to ramen. Novelty requests also override familiar favorites. Unknown preferences remain unknown.

### Simulated availability

Materialize deterministic availability fixtures keyed by restaurant, local date/time window, party size, and fixture seed. Distinguish reservable, walk-in-only, unavailable, and unknown. Respect known opening hours. Never simulate a usable reservation at a restaurant known to be closed.

Do not change availability between methods or after seeing a method's answer. Freeze the actual fixture values for every benchmark scenario. Room defaults may allow walk-ins; when a diner explicitly requires a reservation, only a matching simulated reservable slot qualifies. No live availability queries are necessary.

## 6. Shared interpretation and safeguards

Both methods use a common validated input representation. Preserve original transcripts alongside structured interpretations so important nuances are available to both. Treat restaurant text and diner text as data; neither can override product rules or obtain another person's private information.

For each diner, distinguish explicit hard constraints, soft preferences, ambiguous terms, and missing information. Each interpreted item records its source text, owner, and whether it was stated, inferred, or supplied as a visible default. Confidence in interpretation is not consent to relax a requirement.

Examples:

- “$20 maximum, including tip” is a hard cap with a defined basis.
- “Around $20” is an approximate preference unless the diner makes it a limit.
- “Somewhere nicer” is ambiguous; do not automatically equate it to expensive.
- “No peanuts” requires careful interpretation and evidence; absence of a menu mention is not proof of accommodation.
- Missing location uses the confirmed meeting area as a disclosed default.

Deterministic code enforces supplied constraints, known opening hours, party size, and applicable simulated availability. Critical unknown evidence is not a pass. Normalization errors are tested separately because a perfect downstream filter cannot recover a constraint that was dropped during interpretation.

The system may ask a diner to clarify or explicitly reconsider their own requirement, but it must never do so automatically. Avoid defaulting to “increase your budget” when a cheaper compatible choice exists. Host decisions change soft group priorities only; they cannot waive somebody else's hard requirement.

Use a shared hard-constraint validator before candidate selection and again before delivery. Log both the proposed result and any rejection. A guard that blocks a bad recommendation is a useful safeguard, not proof that the proposing model understood the constraint.

## 7. Clef pipeline

### Responsibilities

Use a general LLM to interpret free text and generate concise natural wording. Use **Clef to evaluate diner–restaurant fit** and, where useful, to select a consequential clarification topic from bounded options. Use application code to enforce constraints, aggregate group fit, control stages, and choose a restaurant.

Clef accepts a state and typed questions; it does not write the natural explanation. The documented Workers AI endpoint is `@cf/cloudflare/clef`. Its question types are `score`, `choice`, and `noul`, with 1–64 questions per request. See the official sources in Section 13. Verify the current contract when implementing; do not invent SDK behavior.

### Candidate evaluation

1. Normalize submitted input and apply deterministic feasibility checks.
2. Supply all eligible candidates, all diners' current input and relevant history, travel estimates, and frozen availability. Use explicit IDs throughout.
3. Ask Clef for one fit score per diner per eligible restaurant, using the same rubric. Batch questions within the documented limit; do not silently truncate data. For 30 candidates and 6 diners, multiple calls are expected.
4. Preserve full score distributions, not just a chosen score. Validate returned IDs, types, ranges, and probabilities.
5. Apply the group policy in code. Evaluate whether an ambiguity could change feasibility or a meaningful choice before asking for clarification.
6. Re-evaluate after submitted clarification or the host's final call. Do not reuse stale scores when relevant inputs changed.
7. Validate the final choice again, then render it from verified restaurant facts. Generate only the concise fit and assumption explanation.

Illustrative request shape, not a measured result:

```ts
const response = await env.AI.run("@cf/cloudflare/clef", {
  model: "clef",
  state: { room, diners, restaurants },
  questions: {
    r17_d2_fit: {
      type: "score",
      instructions: "Assess restaurant r17 for diner d2. Prioritize their " +
        "current request over history. Use only the supplied evidence.",
      criteria: [
        "Poor fit: substantially misses important stated preferences",
        "Weak fit: a consequential preference is poorly served",
        "Acceptable fit: needs met with an understandable compromise",
        "Good fit: matches most important preferences",
        "Excellent fit: particularly strong for this diner's request"
      ]
    }
  }
});
```

The API's score is an expectation over rubric levels; its `confidence` describes its answer distribution. Neither is a measured probability that the group will enjoy dinner. Do not gate host intervention on raw `confidence` alone or use Clef scores as the evaluation ground truth.

### Fair group selection

After hard constraints pass, find the best weakest-diner fit. Form a shortlist of candidates whose weakest-diner fit is within 0.15 points of that best value on the 0–4 scale. Select within that shortlist by highest mean fit, then lowest group maximum estimated travel burden, then stable restaurant ID. This avoids an unstable pairwise sorting comparator. Freeze the exact tie policy before evaluation and test its behavior. Tune only on development scenarios.

This policy intentionally values an acceptable outcome for everyone over an excellent outcome for most diners and a poor one for somebody else. Record individual scores privately for debugging. Do not expose them to the group or give the host a private override of the fairness rule.

### Clarification and host gating

Generate bounded clarification topics from actual ambiguities. Clef may choose which topic is most consequential; the general LLM writes the private question. Ask only when different plausible answers would alter feasibility or a meaningful selection. The application owns the one-round limit.

After clarification, a host final call is allowed only when feasible choices remain and a resolvable **soft** tradeoff or consequential uncertainty prevents an adequate decision. Examples include travel versus atmosphere. The host sees one neutral, focused question, not a restaurant list. Permit a short voice/text answer or two plain-language priority choices.

Initial development thresholds can include a weakest-diner expected fit below “acceptable” or a material spread between poor and strong fit levels. These are provisional policy settings, not calibrated enjoyment probabilities. Consider evidence coverage and whether a host answer can actually change the choice. Similar scores between two good candidates are handled by the tie policy, not another question.

If a hard conflict remains after clarification, a host cannot resolve it by disregarding a diner. Return a no-match outcome when no verified feasible candidate exists. If feasible candidates exist but all involve soft compromises, make the best supported choice after the one permitted final call and explain the compromise.

## 8. Simple LLM baseline

The baseline uses one well-written general LLM prompt per decision phase to read the identical validated state and candidate facts, choose one restaurant or the correct non-result action, and produce a short evidence-backed explanation. Give it the same hierarchy of current requests, history, hard constraints, weakest-diner fairness, and tie rules. Allow ordinary structured-output validation and one bounded schema-repair attempt. Do not deliberately weaken its prompt.

The baseline has no Clef calls, separate diner scoring pipeline, search agent, self-consistency voting, or recursive model debate. A clarification or host response creates a new product phase, so another call is allowed. “Simple baseline” does not mean denying it the interaction stages available to Clef.

Both methods share recording/transcription, normalization, restaurant snapshot, available profile information, travel calculation, availability fixtures, feasibility guards, room timers, output card, and stage limits. In the fixed-state comparison, the baseline receives the exact same normalized state and candidate set as Clef. In the full-flow comparison, both start from the same inputs and have the same truthful clarification-answer source, although their questions may differ.

Define a shared decision interface, for example:

```ts
type Decision =
  | { kind: "recommend"; restaurantId: string; evidenceIds: string[];
      assumptions: string[]; explanation: string }
  | { kind: "clarify"; questions: { participantId: string;
      topicId: string; question: string }[] }
  | { kind: "host_final_call"; topicId: string; question: string }
  | { kind: "no_feasible_match"; reasonCodes: string[] };
```

The state machine rejects illegal actions, duplicate questions, unknown restaurant IDs, and attempts to restart a completed phase. Capture raw proposals before enforcement for both methods. During the formal comparison, never silently fall back from Clef to the baseline or vice versa; failures count against the originating method.

## 9. Implementation shape

Use a compact TypeScript project: a mobile web client, one backend, and small modules for interpretation, feasibility, decision adapters, explanation, and evaluation. A React client and Cloudflare Worker backend are reasonable defaults; a room-scoped durable state store can own membership and timers. Use server events or polling appropriate to the chosen runtime. Check current official documentation before choosing platform-specific APIs.

Provide two adapters implementing the same interface, selected by server configuration such as `DECISION_METHOD=clef|llm_baseline`. Keep method selection out of the participant UI. After the experiment, set the default based on the selection policy, retaining both adapters for reproduction. If evidence is inconclusive, mark that choice provisional.

Protect the host capability separately from the invite capability. Join links must not confer host privileges. Validate all writes on the server, rate-limit room creation/provider calls, and keep participant input private in shared events. Bound concurrency, input size, processing deadlines, and retries. Operational retries must not turn into unlimited preference refinement.

Keep provider credentials in environment variables and ship an example environment file containing names only. Implement clearly labeled fixture mode for local UI development, plus real provider mode for experimentation. Fixture outputs are not benchmark results. If provider access is unavailable, finish the application, evaluator, and pending report scaffold, then identify the specific blocker; never fabricate measurements.

## 10. Evaluation handoff

The required experiment is specified in the companion [Decision-Pipeline Experiment Plan](Beli_Group_Explore_Experiment_Plan.md). Follow that document for shared test conditions, scenario splits, metrics, independent evaluation, architecture selection, and the founder-facing results report.

Implementation is complete only when both decision adapters are available and the required experiment/report work is finished or its specific access blockers are documented. Choose the shipped default from the evidence; Clef is not required to win. Keep both methods available for reproduction. Do not add experiment controls or reporting surfaces to the participant UX.

## 11. Acceptance criteria

### Product

- Two to six diners can create/join a room on separate mobile browser sessions. The host alone can Start and make the one conditional final call.
- Meeting basics are confirmed at creation. Roster, party size, timers, and input ownership are server-enforced.
- Voice supports direct submission and stop/edit/submit. Typing works without microphone access. Timeout, refresh, disconnect, and transcription errors preserve correct state.
- The system asks at most one private clarification per affected diner in one parallel round. Shared status reveals neither the conflict nor the affected people.
- The host stage is skipped when not useful, cannot waive a hard requirement, and cannot be repeated.
- Successful output contains exactly one verified restaurant and the required evidence-backed card fields. No post-result regeneration or hidden result list is present.
- Known infeasibility yields a clear no-match outcome. Operational errors are handled as errors, not no-match judgments.
- Synthetic history, simulated availability, estimates, and consequential assumptions are represented truthfully.

### AI and evaluation

- Both decision adapters run against the same shared interfaces and can be selected without changing the UI.
- Real Clef calls use validated typed questions; batch limits and score distributions are handled correctly.
- Current preferences override history. Unknown evidence cannot satisfy a hard requirement. Every delivered recommendation passes an independent final guard.
- The companion experiment plan's acceptance criteria are met, or specific access blockers are documented.
- The default method follows the report's supported recommendation, with any provisional status explicit.
- Provider access or human-review gaps are explicit. Fixture responses and simulated diners are never presented as live model results or real user feedback.

### Verification

Use meaningful tests for the state machine, authorization, deadlines/idempotency, constraint interpretation/validation, provider response parsing, and evaluation calculations. Include a worked metric example to catch denominator errors. Perform an end-to-end smoke test with at least two real browser sessions and one six-diner scenario; inspect a narrow mobile viewport. Test the one-round and one-host-call limits under retries and reconnects. Do not add superficial tests that merely repeat static UI text.

## 12. Build order and handoff instructions

1. **Vertical slice:** host/create/join/start → typed submissions → fixture-backed single result, with server state and mobile layout. Add recording/transcription/editing without expanding the UX.
2. **Grounded data:** source restaurant facts, build mock profiles and deterministic availability, and implement interpretation/constraint checks. Add targeted clarification and conditional host stages.
3. **Two decision adapters:** connect real Clef and the simple LLM. Add structured traces, limits, final guards, and equivalent result rendering. Keep a fixture mode for development.
4. **Develop and freeze:** follow the companion experiment plan to create development scenarios, tune prompts/rubrics/policies, and freeze the held-out comparison.
5. **Run and analyze:** execute that plan, generate its required results report, and set the default decision method from the evidence.
6. **Deliver:** working prototype, setup instructions, dated data provenance, experiment commands and raw outputs, the founder-facing report/PDF, and a brief account of remaining blockers or limitations.

Do the work rather than stopping after generating a plan. Make routine implementation choices within this scope. Ask for missing provider access only when required for real runs; continue independent implementation and verification meanwhile. Human reviewers cannot be simulated as evidence. Finish a provisional automated report if their feedback has not arrived.

Do not enlarge the app with recommendation feeds, maps as a separate product surface, analytics dashboards, model training, additional voting stages, or live bookings. Spend the implementation effort on grounded selection, fair comparisons, failure handling, and understandable results.

## 13. Primary technical references

Verified October 4, 2026. These establish the Clef API and behavior, not its performance on restaurant selection. Product policies and experimental thresholds above are prototype design choices.

- [Cloudflare: Introducing Clef decision models](https://blog.cloudflare.com/clef-decision-models/) — product announcement and decision-model positioning.
- [Cloudflare Workers AI: Clef model documentation](https://developers.cloudflare.com/workers-ai/models/clef/) — endpoint, request shape, typed question limits, and supported input.
- [Cloudflare Clef model card](https://huggingface.co/Cloudflare/clef) — typed decisions and response fields.
- [Cloudflare Clef response implementation](https://huggingface.co/Cloudflare/clef/blob/main/joint_schema_model.py) — score expectation and answer-confidence semantics.

**Status of this handoff:** product scope is specified here; the required experiment and report are specified in the companion plan. No prototype implementation, model comparison, human review, or results report has been performed by writing these documents.
