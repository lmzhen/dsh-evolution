# @lmzhen/dsh-evolution-replay

Scores and ranks recorded plan outcomes; it does not re-execute a plan.

`/evolution replay` compares live `evolution/plan-applied` records together with a one-time backfill from the activity sidecar. Scores use accepted/rejected operations, evidence, and estimated input cost. Execution failures and unread-skill skips remain visible in the report rather than being silently scored as clean zero-operation plans.

`maxPlans` defaults to 50. The weight fields are `accepted`, `rejectedPenalty`, `evidence`, and `cost`; see [PARAMETERS.md](../PARAMETERS.md) for their deployment tier and ownership.

## Data availability

Default inject-mode review emits no `plan-applied`, so it produces no plan-based replay data. Branch review emits that event. An empty leaderboard therefore does not prove that no reviews ran.

Unreadable activity bytes and failed backfill reads are carried as explicit report qualifications; neither is presented as a clean empty history.
