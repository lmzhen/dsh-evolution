# dsh-evolution-all

**DEFAULT install** — full-functionality evolution bundle for the
`@lmzhen/dsh-evolution` plugin family.

```bash
dsh plugin --profile web add @lmzhen/dsh-evolution-all@<ver>
```

Installing this bundle mounts everything at **profile-root** level in one step:

- **Host automation** — review, curator, approval, threat checks, memory/skill
  storage, observability (its `cordis.patch.yml` carries the infra rows).
- **Model tools** — `memory`, `skill_manage`, `session_search` and the skill
  catalog, plus the SKILLS/MEMORY guidance injection, active in **every
  session**. No agent preset step, no session choice.

## Package selection = the shrink path

| Bundle | Row set | Notes |
|---|---|---|
| `@lmzhen/dsh-evolution-all` | infra + 4 model tools | **DEFAULT** — most complete first |
| `@lmzhen/dsh-evolution-host` | infra only | Same automation, no model tools (a profile can run evolution without exposing `memory`/`skill_manage`) |
| `@lmzhen/dsh-evolution-preset` | ≡ all row set | one-click **compatibility** form, kept for legacy |

**These are ALTERNATIVE install targets.** Mounting two of them (e.g. `all` +
`host`) fails loud at startup (`invariants: already registered`) — install
exactly one. Removing the model tools = uninstall `all`, install `host`.

## Advanced: per-session tools (layered)

If you want model tools only in *selected* sessions, use the layered path
instead of `all`: install `@lmzhen/dsh-evolution-host`, then
`/evolution preset install` (or `install-layered --mode agent`) to generate
the Evolution agent preset, and pick it per session. **`all` and the layered
preset are also exclusive** — mounting both double-mounts the model rows.

For fine-grained control (e.g. a custom profile overlay), see the family
[README](../README.md).
