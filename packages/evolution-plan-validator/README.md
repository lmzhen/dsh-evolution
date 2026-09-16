# @deepseek-ai/dsh-evolution-plan-validator

Deterministic validator for model-produced evolution plans: it exports the plan types
(`EvolutionPlan`, `MemoryOp`, `SkillOp`) and the single `validateEvolutionPlan(plan,
context)` entry point.

## Model surface

- **Model-visible:** nothing of its own: no prompt, no tool schema and no service; consumers own the model-visible effects.
- **Prompt prefix / KV cache:** independent of request-prefix construction — it does not alter the assembled prompt or tool list; family-level rules: `packages/README.md` §"Model-visible prompt prefix and the KV cache".
- **Mount it?** no: a library/seam consumed by the review pipeline.

## Known limitations

- No known durable consumer gaps at this time. Runtime contracts are covered by package and boundary tests.

**Runtime invariant:** No companion is published. The platform auto-assembles nothing and the family mounts no `<pkg>/invariant` cordis row, so a companion here would never execute (v37 S2.1 / I-3).
