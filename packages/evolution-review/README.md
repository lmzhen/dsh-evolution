# @lmzhen/dsh-evolution-review

Session review orchestration. It measures completed turns, defers due reviews to the appropriate task boundary, and delivers a memory or skill review prompt.

## Trigger model

Review is enabled by default. The memory and skill cadence intervals both default to 10 tool calls. A turn advances by its tool-call count, with the minimum/skill-use rules implemented by the shared review signal fold.

A cadence threshold reached during a task is latched; the review runs when the conversation completes rather than interrupting in the middle of the task. The default `skillReviewTrigger` is `cadence`. `completion` or `both` additionally allows one completion-channel skill review after a qualifying long session. Both channels are mutually exclusive at one boundary.

Subagent-origin, background-visibility, and review-child sessions are excluded. Variant deployments also require the session to carry the family model rows.

## Delivery modes

| Mode | Behavior | Recorded history |
|---|---|---|
| `aux` (default) | Runs a plugin-owned manual loop over the frozen parent request prefix. Native tools execute against the real parent agent; PTC runs against a detached review child Session so `run_code` dispatch never touches the parent log. Memory and skill are independent tasks with independent leases; `review_done` is the only success terminal. | Emits `review-scheduled` and `review-completed`; the completion record includes task/kind/status, requests, toolCalls, waitCount, round limit, partial reason and the structured report. |
| `inject` (debug) | Sends the kind-specific foreground review prompt into the parent session as an ordinary turn. `reviewWakeInject=true` uses a waking follow-up when available. | Emits `review-scheduled`; does **not** emit `plan-applied`, so plan-based activity/replay stays empty. |

`reviewNotice=true` allows result notices for the inject path. Aux results are audit-only: `finalText` lands in the bounded activity review record and never becomes a parent message or a new parent turn. Aux never uses the combined prompt: memory and skill each get their own prompt and task. A no-op review must still finish with `review_done`; stopping without it is recorded as partial, not completed. The model sees only the review allowlist (or `run_code` in PTC mode), and unavailable tools/paths must be reported rather than silently ignored.

## Events and limits

The package emits `evolution/review-scheduled`, `evolution/review-completed`, `evolution/review-error`, and an aux `evolution/plan-applied` ledger entry. `reviewTimeoutMs` bounds the aux loop; `reviewMaxRounds` (default 12) and `reviewMaxToolCalls` (default 50) bound model rounds and tool calls. Reaching any bound records `partial`/`timeout` with `hitRoundLimit` and `partialReason`, never `completed`. Review cadence state is persisted when `evolution-state` is available; without it, cadence can reset between turns.

**Removed metadata:** `reviewProvider`, `reviewContextMessages`, `reviewMessageChars`, `reviewMaxDepth` and `reviewToolAllow` were declared but never read, so they are gone from the registry and the bundles. Provider/model come from the parent session header; the tool allowlist is the parent's tools intersected with the family allowlist.
`memoryInterval` and `skillInterval` were removed from the live row schema in 0.48 (G0/S0.3). They survive only in the family's old-document migration table and doctor's old-key report; a deployment config that still spells them must be rewritten to `reviewMemoryInterval` and `reviewSkillInterval`.


## Known limitations and migration

Step-by-step upgrade instructions: [docs/UPGRADE-0.39.md](../../docs/UPGRADE-0.39.md).

- **PTC sessions:** aux uses the detached review child channel. `run_code` and its `tool/ptc-dispatch*` frames land on the child Session, never the parent; `review_done`/`review_wait` are registered only while that review task executes. The PTC executor is an optional platform capability (base bundle ships it disabled; the PTC preset enables it), so a host without PTC mode reports `PTC_UNAVAILABLE` instead of silently falling back. Real-host PTC memory and skill reviews both completed; see `plugins/README` and the acceptance ledger for the exact version.
- **0.39 migration:** `branch` was removed from the closed `reviewMode` union. An existing `reviewMode: branch` profile patch now fails validation and deactivates the policy row; rewrite it to `aux` before restarting. Old branch activity records remain readable through `branchSessionId`; no new branch run is produced.
