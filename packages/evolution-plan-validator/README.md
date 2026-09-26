# @deepseek-ai/dsh-evolution-plan-validator

Deterministic validator for model-produced evolution plans: it exports the plan types
(`EvolutionPlan`, `MemoryOp`, `SkillOp`) and the single `validateEvolutionPlan(plan,
context)` entry point.

The per-op questions are the named, ordered table `PLAN_RULES` (one table per op kind, same form
as the tool path's write gates): the first refusing rule names the reason, and every id is pinned
by the suite, so a rename or a reorder is a visible change. Container-level rejections (a
non-array `skillOps`, a malformed entry) stay outside the tables — they judge the container, not
an operation.

One row is **report-only**: `EVIDENCE_CLASS` records into `ValidationResult.reports` and never
refuses. It reads `ValidationContext.substantiveEvidenceSeqs` (core `evidenceKindIndex`) and
reports an op whose entire citation list is a turn/step boundary frame — the range rule cannot
tell such a frame from a real exchange. It is phase 1 of the evidence-consistency rule: an
observation window before anyone decides to refuse on it, and `undefined` (a log that cannot be
classified) stays silent rather than reporting every op.

## Model surface

- **Model-visible:** nothing of its own: no prompt, no tool schema and no service; consumers own the model-visible effects.
- **Prompt prefix / KV cache:** independent of request-prefix construction — it does not alter the assembled prompt or tool list; family-level rules: `packages/README.md` §"Model-visible prompt prefix and the KV cache".
- **Mount it?** no: a library/seam consumed by the review pipeline.

## Known limitations

- No known durable consumer gaps at this time. Runtime contracts are covered by package and boundary tests.

**Runtime invariant:** No companion is published. The platform auto-assembles nothing and the family mounts no `<pkg>/invariant` cordis row, so a companion here would never execute (v37 S2.1 / I-3).
