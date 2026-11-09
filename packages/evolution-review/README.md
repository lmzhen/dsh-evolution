# @lmzhen/dsh-evolution-review

Session review orchestration. It measures completed turns, defers due reviews to the appropriate task boundary, and delivers a memory or skill review prompt.

## Trigger model

Review is enabled by default. The memory and skill cadence intervals both default to 10 tool calls. A turn advances by its tool-call count, with the minimum/skill-use rules implemented by the shared review signal fold.

A cadence threshold reached during a task is latched; the review runs when the conversation completes rather than interrupting in the middle of the task. The default `skillReviewTrigger` is `cadence`. `completion` or `both` additionally allows one completion-channel skill review after a qualifying long session. Both channels are mutually exclusive at one boundary.

Subagent-origin, background-visibility, and review-child sessions are excluded. Variant deployments also require the session to carry the family model rows.

## Delivery modes

| Mode | Behavior | Recorded history |
|---|---|---|
| `aux` (default) | Runs a plugin-owned manual loop over the parent request prefix: parent Agent, no child Session, no parent append, allowlisted parent-visible tools executed without a log; a disallowed call returns a tool error instead of aborting the review. | Emits `review-scheduled` and `review-completed`; the completion event is folded into the bounded activity review list (preview + actions + usage). |
| `inject` (debug) | Sends the kind-specific foreground review prompt into the parent session as an ordinary turn. `reviewWakeInject=true` uses a waking follow-up when available. | Emits `review-scheduled`; does **not** emit `plan-applied`, so plan-based activity/replay stays empty. |

`reviewNotice=true` allows result notices for the inject path. Aux results are audit-only: `finalText` lands in the bounded activity review record and never becomes a parent message or a new parent turn. The aux path uses background-specific prompts; a skill or combined aux pass includes the memory review, so a background review cannot silently drop memory.

## Events and limits

The package emits `evolution/review-scheduled`, `evolution/review-completed`, `evolution/review-error`, and an aux `evolution/plan-applied` ledger entry. `reviewTimeoutMs` bounds the aux loop. Review cadence state is persisted when `evolution-state` is available; without it, cadence can reset between turns.

**Unimplemented metadata:** `reviewProvider`, `reviewContextMessages`, `reviewMessageChars`, `reviewMaxDepth`, and `reviewToolAllow` may still appear in generated parameter/bundle metadata, but this plugin does not read them. Do not rely on them for provider selection, context limits, delegation depth, or tool restrictions. `reviewTimeoutMs` is implemented.

`memoryInterval` and `skillInterval` remain readable deprecated aliases of `reviewMemoryInterval` and `reviewSkillInterval`; writes to the old names are refused (G0/S0.3).


## Known limitations and migration

Step-by-step upgrade instructions: [docs/UPGRADE-0.39.md](../../docs/UPGRADE-0.39.md).

- **PTC sessions:** their parent request header exposes only `run_code`. Aux review deliberately rejects `run_code` to keep the parent log append-free, so a PTC review cannot inspect the skill library and may return an empty/degraded result. Use a standard Agent preset for semantic review; do not report a PTC empty review as success.
- **0.39 migration:** `branch` was removed from the closed `reviewMode` union. An existing `reviewMode: branch` profile patch now fails validation and deactivates the policy row; rewrite it to `aux` before restarting. Old branch activity records remain readable through `branchSessionId`; no new branch run is produced.
