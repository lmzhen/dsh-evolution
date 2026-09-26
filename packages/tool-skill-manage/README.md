# @deepseek-ai/dsh-tool-skill-manage

Model-facing `skill_manage` tool: it exposes skill-library mutations to the model and
routes them through the evolution approval seam when one is mounted; it owns neither the
library nor its lifecycle rules.

## Model surface

- **Model-visible:** the `skill_manage` tool schema and its success/validation messages; result tokens scale with what is returned. The skills-guidance section (`evolution-skills-guidance`) ends with the policy's protected-skill list, carried by the prompt variable `evolution_skill_guard`: the provider runs at EVERY assembly (a policy change needs no reload), and an empty list leaves the section byte-identical to the guidance alone, so the guidance's prefix-cache behaviour is unchanged.
- **Prompt prefix / KV cache:** the tool schema is prefix-stable, and skill writes do not alter the current request prompt; catalog invalidation affects the next request; family rules: `packages/README.md` §"Model-visible prompt prefix and the KV cache".
- **Mount it?** yes — the `tool-skill-manage` row, carried by the `evolution-all` and one-click `evolution-preset` bundles and the Evolution agent preset delta.

## Safety model

### Write gates

Every mutation THROUGH THIS TOOL passes ONE ordered admission sequence (`src/write-gates.ts`): the
scalar argument shape, the required arguments per action, the policy's protected list,
read-before-write, and the operator confirmation. The
ADMISSION point runs the sequence before the approval seam, so a write that is refused is never
staged for approval and never spends the operator's attention; the EXECUTION point (`executeCore`)
re-runs the gates a replay or a direct write can still fail, because a replay's stored arguments
passed no schema and the protected list can change while a record sits pending. Both points read the
same table, so they cannot diverge.

The sequence covers the MODEL tool path. The family's other writers reach their own library
handles: the `/evolution` and `/graph` command face writes what the operator typed (the operator is
the authority there), the review's plan executor writes a plan its own filter already screened
(`filterUnreadSkillOps`), and a record staged outside this tool replays into the execution point
without re-deciding the admission-only gates — there is no writing session to read.

Read-before-write is admission-only (the replayed record has no writing session): a non-foreground
write whose target the session never read is refused with `E-318`, and only a read that did not fail
counts. A session log the tool cannot read proceeds with one warning rather than blocking every
autonomous write.

A foreground `create`, or a bare foreground `delete`, asks the operator once before it writes and is
refused with `E-317` when the answer is not the confirm label; a `delete` carrying `absorbed_into` is the
merge protocol and does not ask. This gate is UX, not a security door: it is admission-only (a
replayed record already carries the human release that staged it), and an unmounted question
service, a caller that is not the registry's exact live root agent, or a failing ask all PROCEED
with one warning — the operator's own session stays the authority that asked for the write.

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

### Description length: the three numbers

A skill description is measured against three different bounds. They are not interchangeable, and
only the second one refuses a write:

| Bound | Value | Source | What it does |
|---|---|---|---|
| Authoring bar | 60 chars | `AUTHORING_DESCRIPTION_BAR` (the upstream 60-char rule) | advisory feedback on every create/edit/update; `descriptionStrict: true` turns it into a refusal |
| Family storage ceiling | 1024 chars | `MAX_DESCRIPTION_LENGTH`, lowered per deployment by this row's `maxDescriptionLength` | the hard validation limit — the ONLY refusal threshold of the three |
| Platform catalog view | 500 chars by default | `catalogDescriptionMaxLength` on the platform's `tool-skill` row (`PLATFORM_CATALOG_DESCRIPTION_DEFAULT`) | truncates the description in the skill catalog the model reads; the family's own rows set that field to 60 (`evolution-host`, `evolution-all` and `evolution-preset` each carry it, and the composer injects it onto a generated preset row too), so 500 governs only a composition that overrides none of them; `packages/README.md` states which of those rows takes effect per install form |

The third row is a view, not a rule: a description the family accepts can still be cut in a catalog
viewer, which is why the authoring feedback names the bar rather than treating the cut as a limit.

## Known limitations

- No known durable consumer gaps at this time. Runtime contracts are covered by package and boundary tests.

**Runtime invariant:** No companion is published. The platform auto-assembles nothing and the family mounts no `<pkg>/invariant` cordis row, so a companion here would never execute (v37 S2.1 / I-3).

## Notes and history

- pin/unpin: explicit exception (0.3.18, E-70)