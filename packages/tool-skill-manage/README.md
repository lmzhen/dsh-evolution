# @deepseek-ai/dsh-tool-skill-manage

Model-facing `skill_manage` tool: it exposes skill-library mutations to the model and
routes them through the evolution approval seam when one is mounted; it owns neither the
library nor its lifecycle rules.

## Model surface

- **Model-visible:** the `skill_manage` tool schema and its success/validation messages; result tokens scale with what is returned.
- **Prompt prefix / KV cache:** the tool schema is prefix-stable, and skill writes do not alter the current request prompt; catalog invalidation affects the next request; family rules: `packages/README.md` §"Model-visible prompt prefix and the KV cache".
- **Mount it?** yes — the `tool-skill-manage` row, carried by the `evolution-all` and one-click `evolution-preset` bundles and the Evolution agent preset delta.

## Safety model

### Write gates

Every mutation passes ONE ordered admission sequence (`src/write-gates.ts`): the scalar argument
shape, the required arguments per action, the policy's protected list, and read-before-write. The
ADMISSION point runs the sequence before the approval seam, so a write that is refused is never
staged for approval and never spends the operator's attention; the EXECUTION point (`executeCore`)
re-runs the gates a replay or a direct write can still fail, because a replay's stored arguments
passed no schema and the protected list can change while a record sits pending. Both points read the
same table, so they cannot diverge.

Read-before-write is admission-only (the replayed record has no writing session): a non-foreground
write whose target the session never read is refused with `E-318`, and only a read that did not fail
counts. A session log the tool cannot read proceeds with one warning rather than blocking every
autonomous write.

### Approval seam

Mutations (create/edit/update/patch/delete/write_file/remove_file/restructure) pass through the evolution approval seam when `evolution-approval` is mounted; approved/staged writes are replayed by the registered runner with the library origin preserved. The admission gates run BEFORE that boundary, so a write that cannot execute is refused, never staged for approval.

### pin/unpin: explicit exception

`pin` and `unpin` are deliberately **outside** the approval seam. Pinning only lifts/restores the curator-lifecycle freeze (a lifecycle flag, never content) and is fully reversible by the same tool. Routing it through `policy:'ask'` would let a staged-but-never-approved request hold the library in a pinned state invisibly. Tradeoff accepted: no approval on a lifecycle-flag flip; if product policy changes, pin/unpin should be wired into the same staging path as `patch`.

## Configuration

- `maxSkillContentChars` / `maxSkillFileBytes` bound SKILL.md reads and support-file writes on this row.
- Deprecated name (G0/S0.3): `maxSkillContentChars` is the legacy spelling of the
  policy row's `skillContentChars` (canonical id). The two are not auto-synchronised with it: this row's value is what
  the write paths use, and since 0.6.0 the user settings layer can override it
  per user. Reading the legacy name still works; writing it is refused. Removal was planned for 0.7.0 and is deferred:
  the alias still ships, so no later version is claimed here.

## Known limitations

- No known durable consumer gaps at this time. Runtime contracts are covered by package and boundary tests.

**Runtime invariant:** No companion is published. The platform auto-assembles nothing and the family mounts no `<pkg>/invariant` cordis row, so a companion here would never execute (v37 S2.1 / I-3).

## Notes and history

- pin/unpin: explicit exception (0.3.18, E-70)