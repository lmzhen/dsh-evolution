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

## Configuration

`reviewProvider` selects the LLM provider for review subagents. When omitted, the subagent inherits the deployment default route instead of a hardcoded provider name. Model selection stays on the policy (`memoryReviewModel` / `skillReviewModel`).
