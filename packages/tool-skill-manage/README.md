# @deepseek-ai/dsh-tool-skill-manage

Model-facing `skill_manage` tool: it exposes skill-library mutations to the model and
routes them through the evolution approval seam when one is mounted; it owns neither the
library nor its lifecycle rules.

## Model surface

- **Model-visible:** the `skill_manage` tool schema and its success/validation messages; result tokens scale with what is returned.
- **Prompt prefix / KV cache:** the tool schema is prefix-stable, and skill writes do not alter the current request prompt; catalog invalidation affects the next request; family rules: `packages/README.md` §"Model-visible prompt prefix and the KV cache".
- **Mount it?** yes — the `tool-skill-manage` row, carried by the `evolution-all` and one-click `evolution-preset` bundles and the Evolution agent preset delta.

## Safety model

### Approval seam

Mutations (create/edit/update/patch/delete/write_file/remove_file/restructure) pass through the evolution approval seam when `evolution-approval` is mounted; approved/staged writes are replayed by the registered runner with the library origin preserved. The missing-required-argument pre-check runs BEFORE that boundary — one shared table and one refusal builder with `executeCore`, so the stage boundary and the execution check cannot diverge: a write that cannot execute is refused, never staged for approval.

### pin/unpin: explicit exception

`pin` and `unpin` are deliberately **outside** the approval seam. Pinning only lifts/restores the curator-lifecycle freeze (a lifecycle flag, never content) and is fully reversible by the same tool. Routing it through `policy:'ask'` would let a staged-but-never-approved request hold the library in a pinned state invisibly. Tradeoff accepted: no approval on a lifecycle-flag flip; if product policy changes, pin/unpin should be wired into the same staging path as `patch`.

## Configuration

- `maxSkillContentChars` / `maxSkillFileBytes` bound SKILL.md reads and support-file writes on this row.
- Deprecated name (G0/S0.3): `maxSkillContentChars` is the legacy spelling of the
  policy row's `skillContentChars` (canonical id). The two are not auto-synchronised
  yet — this row's value is what the write paths use (the G3 unification closes
  that gap). Reading the legacy name still works; writing it is refused, and it is
  removed in 0.7.0.

## Known limitations

- No known durable consumer gaps at this time. Runtime contracts are covered by package and boundary tests.

**Runtime invariant:** No companion is published. The platform auto-assembles nothing and the family mounts no `<pkg>/invariant` cordis row, so a companion here would never execute (v37 S2.1 / I-3).

## Notes and history

- pin/unpin: explicit exception (0.3.18, E-70)