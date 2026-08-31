# Design Review 005: Per-skill tool declarations

Status: proposed (updated after independent review)
Review verdict: approve-with-changes

## Context

Users ask whether a skill can declare and restrict its own tool set. Today
`dsh-skill` has no per-skill tool list; tool availability is owned by scoped
`ctx.tools` registries and agent presets; skills are prompt bodies and loading
one does not change the tool catalog. This is an upstream platform-model
question first, and a plugin feature second.

## Architectural analysis

```text
model request -> agent preset scope -> tool registry -> tool executor
                                      ^
                              skill catalog only injects prompt text
```

Dynamic per-skill changes to the shared tool catalog would invalidate the
request tool catalog and prompt KV cache, which DSH deliberately keeps stable.
Therefore enforcement must live in an explicit scope boundary (subagent spawn,
preset), never in skill loading.

## Proposed design

Phase A - reserve namespaced metadata:
- Use a single private top-level key `x-dsh` in SKILL.md frontmatter:

```yaml
x-dsh:
  allowedTools: [skill, skill_search, skill_load]
  requiredTools: [skill]
```

- Replace `evolution-core` line-oriented frontmatter parsing with a real YAML
  parser that supports lists and rejects unknown keys under `x-dsh`.
- `evolution-skill-catalog` publishes the parsed value as
  `SkillDefinition.metadata['x-dsh']` and strips it from rendered content.
- Validation: array of non-empty tool-name strings; no wildcards; unknown
  `x-dsh` keys are an error; names are informational only.
- `requiredTools` never triggers installation or automatic unlock.

Phase B - do NOT enforce in general; optional intersection experiment:
- Keep review/curator subagent `toolFilter.allow` unchanged.
- A future experiment may compute `allow ∩ declaredTools` (narrow only) and
  warn when a required tool is unavailable. Declarations must never add tools
  to `allow`.
- Default decision for now: skip Phase B to avoid divergent semantics.

Phase C - upstream proposal:
- Propose `SkillToolPolicy { allow?: string[]; require?: string[] }`.
- Add `tools?: SkillToolPolicy` to `SkillSummary`, `SkillCandidate` and
  `SkillDefinition` (not inside `SkillInvocationPolicy`).
- Loader parses a future upstream `tools` field and treats invalid values as
  "ignore skill" or "omit field", never as an error that breaks unrelated
  skills.
- Loader and `tool-skill` never modify the global tool catalog. `allow` is an
  upper bound intersected with the existing tool set at a scope boundary.
- Cache rules: skill tool declarations never enter prompt KV cache keys.

## Explicit non-goals

- No automatic tool installation when a skill declares a missing tool.
- No skill-controlled widening of the agent tool set.
- No per-turn changes to `ctx.tools` or KV-cache keys.
- No divergent enforcement between regular agents and review subagents in the
  first release.

## Review questions

- Does stripping frontmatter metadata from catalog content break existing
  prompt rendering or snapshot expectations?
- Should `requiredTools` be omitted entirely until upstream defines semantics?
- Which upstream package owns the `tools` field proposal: `dsh-skill`,
  `skill-filesystem`, or the preset/tool-filter layer?
