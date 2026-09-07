# @deepseek-ai/dsh-evolution-review

Background review orchestration

## Model Experience

### Indirect model surface

#### What the model sees

`@deepseek-ai/dsh-evolution-review` registers no direct prompt or tool schema itself. Model-visible effects are owned by the packages that consume this service.

#### Token effect

Zero direct token effect from this package; consumers add any model-visible tokens.

#### KV Cache effect

Independent of request-prefix construction. This package does not alter the assembled prompt or tool list.

## Known Limitations and Deferred Work


- Review subagents are spawned with the plain `skill` tool only (`reviewToolAllow` default and the host/preset config both = `[skill]` — the DSH tool catalog has no `skill_search`/`skill_load` discovery pair, so the Hermes-lineage Anchored Standard `skill_search`/`skill_load` allow-list does not exist here).
- Review subagents run as `spawn` children on the deployment default preset rather than inheriting the parent agent's composition (`fork`): a fork child is always promoted by the Anchored Standard bootstrap and its narrowed resident catalog would drop the plain `skill` tool from the review allow-list.
- The review request text is redacted for credential-shaped patterns before it reaches the subagent, but redaction is pattern-based and best-effort, not a security boundary.
- Read-before-write tracks only reads through the `skill` tool. `skill_manage` has no per-skill read action (`list`/`review` are whole-library, not targeted at one name), so a skill that was only listed via `skill_manage` is not marked as read — a background review may still reject a patch to it until it is actually loaded.
- The completion-channel counters (`cumulativeToolCalls` / `completionInjected`) are in-memory only. A process restart resets them, which is accepted behavior: the completion review is a one-per-session post-task adaptation and a restart is treated as a fresh conversation boundary. The cadence state (`turnsSinceMemory` / `turnsSinceSkill`) is persisted via `ReviewState` and survives restart.
- `evolution/review-scheduled` and `evolution/review-error` are emitted for platform/user wiring only — this family has no in-repo production `ctx.on` consumer for them. They are declared externally owned (the platform side wires consumption), which matches the `EXEMPT_ORPHANS` set in `scripts/verify-event-pairing.mjs`.
- When the `evolution-state` service is not mounted, the memory/skill cadence state is not persisted and every turn restarts from a clean `{ turnsSinceMemory: 0, turnsSinceSkill: 0 }` baseline — the review schedule is stateless and re-decided each turn rather than accumulating across the conversation. The loss is surfaced once per process as a logger warning at the first turn/end.

## Configuration

`reviewProvider` selects the LLM provider for review subagents. When omitted, the subagent inherits the deployment default route instead of a hardcoded provider name. Model selection stays on the policy (`memoryReviewModel` / `skillReviewModel`).

`reviewTimeoutMs` bounds each review subagent run (an `AbortSignal.timeout`; `0` aborts immediately). `executionTimeoutMs` is a leftover declaration and is **not consumed** — it is kept only as a code comment and has no effect; configure `reviewTimeoutMs` instead.

### Review delivery contract (0.3.38-0.3.42)

- **Both channels execute at conversation end only** (a `turn/end` with `reason.kind === 'completed'`): a cadence threshold fire mid-task merely latches the kind — no subagent spawn, no inject. The flush runs BEFORE the latch block (the completing turn may itself be a threshold-firing turn). `reviewMode` (`'subagent'` default / `'inject'`) selects how the flush delivers; the explicit `'inject'` mode's historical "immediate on threshold" contract was superseded in 0.3.39 — both modes are end-of-conversation.
- **`skillReviewTrigger`** (default `'cadence'`): `'cadence'` runs one end-of-conversation review from the cadence latch; `'completion'` uses the separate long-session completion gate (session-cumulative tool-call threshold); `'both'` enables both (note: with the deferred cadence execution the `'both'` combination would inject a second task-complete prompt at the same boundary — prefer `'cadence'`).
- **`reviewWakeInject`** (default `true`): deliveries use `agent.followup` (next-turn + wake — the model starts processing immediately) instead of the non-waking `agent.inject` (which waits for the next driver wake). The host falls back to `inject` when it has no followup or the option is `false`. The woken turn's own cadence fire is suppressed once (an injected review prompt alone must not re-trigger a review under `interval=1`); a restart clears the queue, so the loop cannot survive it.
- **Counting window = injection-to-injection**: the `turnsSinceMemory`/`turnsSinceSkill` counters are monotonic across threshold fires (`resetOnFire: false`) and are zeroed at the flush delivery — a continued conversation starts a fresh segment from the injection. A threshold fire on the completing turn is caught by the flush (`pendingKind = latch ?? kind`). All deliveries (review prompt AND result notices) share the same waking channel; a failed counter-reset persist warns once per session (a stateful reload may re-deliver).
