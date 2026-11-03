# @lmzhen/dsh-evolution-core

Shared library for the evolution family: skill and memory stores, write kernels and mutation units, prompts, projections, event types, composition helpers, HTTP route helpers, history, recovery, and parameter definitions.

The root entry is a library, not a user-facing command. The package also exposes `./composition`, `./subagent`, `./http-routes`, and `./restrictor` subpaths.

`./restrictor` is a function plugin for restricted presets. It requires a `presetId` and a non-empty `allow` or `deny` set, then applies `tools.restrict()` in matching child-agent scopes. It constrains inherited tools, not the preset mount scope itself.

## Events (the family's own, process-local)

| Event | the `@mode` | Purpose |
|---|---|---|
| `evolution/skill-mutated` | emit (one-way) | Invalidate catalog state after a skill-tree write. |
| `evolution/skills-refresh` | emit (one-way) | Explicitly refresh the catalog after `/evolution skills refresh`. |
| `evolution/review-scheduled` | emit (one-way) | A review was scheduled. |
| `evolution/review-completed` | emit (one-way) | A branch review completed, including failure/timeout status when known. |
| `evolution/review-error` | emit (one-way) | The review pipeline failed. |
| `evolution/plan-applied` | emit (one-way) | A reviewed plan produced an execution result. |
| `evolution/memory-applied` | emit (one-way) | A memory write succeeded through the registry sink. |
| `evolution/memory-provider-registered` | emit (one-way) | A memory provider became available. |

Preset ids: `evolution`, `evolution-ptc`, `evolution-cordis`, `evolution-minimal`, `evolution-reviewer-readonly`, `evolution-maintainer-readonly`.

## Error codes

(`E-301`–`E-326`) identify unavailable services and command/settings failures. Exact message templates live in `src/errors.ts`.

| Code | Meaning |
|---|---|
| `E-301` | Approval service is not mounted. |
| `E-302` | Curator service is not mounted. |
| `E-303` | Replay service is not mounted. |
| `E-304` | Approval service is too old. |
| `E-305` | Invocation has no agent or delivery channel. |
| `E-306` | Foreground write cannot be replayed. |
| `E-307` | Settings namespace or revision cannot be read. |
| `E-308` | Unknown parameter group. |
| `E-309` | Parameter revision conflict. |
| `E-310` | Settings service rejected the write. |
| `E-311` | Settings service is unavailable. |
| `E-312` | Parameter write failed. |
| `E-313` | Unknown parameter id. |
| `E-314` | Deployment parameter cannot be written from a session. |
| `E-315` | Parameter has no user layer. |
| `E-316` | Namespace is not registered. |
| `E-317` | Skill write was not confirmed. |
| `E-318` | Skill was not read before writing. |
| `E-319` | Confirmation timed out and cancelled the write. |
| `E-320` | Profile home is unavailable. |
| `E-321` | Evolution IO is unavailable. |
| `E-322` | Parameter cross-field constraint failed. |
| `E-323` | Subagent channel is unavailable. |
| `E-324` | Restricted preset is unavailable. |
| `E-325` | Host data plane is unavailable. |
| `E-326` | Support file was not read before writing. |
