# @lmzhen/dsh-evolution-policy

Immutable policy snapshot and monotonic tool guard for the family control plane.

For the guarded memory/skill write tools, it rejects arguments containing forbidden control keys, including matching keys inside `operations[]`. This prevents a model plan from changing policy, prompt, routing, or similar control settings through a write payload.

It is not a general sandbox: it protects the declared control keys on the guarded tool calls and does not replace platform permissions or the threat scanner.

Review, memory, curator, and write-stage defaults carried by the snapshot are documented in [PARAMETERS.md](../PARAMETERS.md). There is no direct user command or panel.
