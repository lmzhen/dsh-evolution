# @lmzhen/dsh-evolution-review

Session review orchestration. It measures completed turns, defers due reviews to the appropriate task boundary, and delivers a memory or skill review prompt.

## Trigger model

Review is enabled by default. The memory and skill cadence intervals both default to 10 tool calls. A turn advances by its tool-call count, with the minimum/skill-use rules implemented by the shared review signal fold.

A cadence threshold reached during a task is latched; the review runs when the conversation completes rather than interrupting in the middle of the task. The default `skillReviewTrigger` is `cadence`. `completion` or `both` additionally allows one completion-channel skill review after a qualifying long session. Both channels are mutually exclusive at one boundary.

Subagent-origin, background-visibility, and review-child sessions are excluded. Variant deployments also require the session to carry the family model rows.

## Delivery modes

| Mode | Behavior | Recorded history |
|---|---|---|
| `inject` (default) | Sends the review prompt into the parent session. `reviewWakeInject=true` uses a waking follow-up when available. | Emits `review-scheduled`; does **not** emit `plan-applied`, so plan-based activity/replay stays empty. |
| `branch` | Creates a child agent with a seed from the live session log and delivers the result to the parent. | Emits `review-completed` and `plan-applied`, including failure/timeout status when known. |

Branch mode requires `agents`. It is a temporary platform-gap path with trade-offs among durable-log governance, parent prefix-cache reuse, and workspace pollution; it is not the default product path.

`reviewNotice=true` allows result notices. It does not suppress an inject-mode review prompt, because that prompt is the review itself.

## Events and limits

The package emits `evolution/review-scheduled`, `evolution/review-completed` (branch), `evolution/review-error`, and branch-mode `evolution/plan-applied`. `reviewTimeoutMs` bounds the branch run. Review cadence state is persisted when `evolution-state` is available; without it, cadence can reset between turns.

**Unimplemented metadata:** `reviewProvider`, `reviewContextMessages`, `reviewMessageChars`, `reviewMaxDepth`, and `reviewToolAllow` may still appear in generated parameter/bundle metadata, but this plugin does not read them. Do not rely on them for provider selection, context limits, delegation depth, or tool restrictions. `reviewTimeoutMs` is implemented.

`memoryInterval` and `skillInterval` remain readable deprecated aliases of `reviewMemoryInterval` and `reviewSkillInterval`; writes to the old names are refused.
