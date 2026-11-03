# @lmzhen/dsh-evolution-maintenance

Read-only skill-library maintenance scan and evidence probe. It assembles deterministic drift signals, renders a facts block, and can ask a restricted subagent to turn those facts into a validated recommendation plan.

## Surfaces

- `/evolution maintain` starts an asynchronous scan and returns a run id; `status`, `report`, and `cancel` inspect or stop that run.
- `--facts` renders the deterministic evidence preview without spending the model call.
- `maintenance_probe` is a separate read-only model tool for one signal. It is available in host-only installations as well as the full family forms.

The probe supports library-level `dedup_group`, `prefix_cluster`, and `usage_observed`, plus skill-level `stamp_density`, `body_size`, `dup_heading`, `overlong_line`, `pointer_missing`, `citation_resolution`, `demand`, `narrow_name`, `description_chars`, and `quality_low`. Skill-level signals require `target`.

## Limits and side effects

A scan does not edit, archive, or restructure skills. Applying a recommendation is a separate, user-approved write through `skill_manage`. Probe and facts output is redacted before crossing the session boundary, and unreadable skills are reported rather than silently treated as a clean library.

The command surface defaults to a 600,000 ms scan timeout and a 30,000 ms post-settle cooldown. `maintainHandoffOnSettle` defaults to false because automatic handoff spends an extra model turn. `probeTimeoutMs` is a hang guard for the probe, not a promise about normal scan latency.
