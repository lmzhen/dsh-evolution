# dsh-evolution-all

**DEFAULT install** — full-functionality evolution bundle for the
`@lmzhen/dsh-evolution` plugin family.

```bash
dsh plugin --profile web add @lmzhen/dsh-evolution-all@<ver>
```

## Model surface

- **Model-visible:** its profile-root rows (`memory`, `skill_manage`, `session_search`, the skill catalog (feeding the `skill` tool's catalog section), the SKILLS/MEMORY guidance injection, plus `maintenance_probe`) active in **every** session.
- **Prompt prefix / KV cache:** those rows enter the request prefix (the guidance sections in particular); this bundle itself adds no prompt; family-level rules: `packages/README.md` §"Model-visible prompt prefix and the KV cache".
- **Mount it?** yes — this IS the mount at profile-root level: the host automation (review, curator, approval, threat checks, memory/skill storage, observability) plus the model rows, with no agent-preset step and no session choice; exclusive with `evolution-host`, the one-click `evolution-preset` bundle and the layered preset.

## Package selection = the shrink path

| Bundle | Row set | Notes |
|---|---|---|
| `@lmzhen/dsh-evolution-all` | infra + 4 model tools (+ read-only `maintenance_probe`) | **DEFAULT** — most complete first |
| `@lmzhen/dsh-evolution-host` | infra only | Same automation, no memory/skill model tools (evolution without exposing `memory`/`skill_manage`); `maintenance_probe` ships with it |
| `@lmzhen/dsh-evolution-preset` | ≡ all row set | one-click **compatibility** form, kept for legacy |

## Known limitations

- **These are ALTERNATIVE install targets.** Mounting two (e.g. `all` + `host`) fails loud at startup (`invariants: already registered`): install exactly one; to drop the memory/skill tools, uninstall `all` and install `host`.

## Advanced: per-session tools (layered)

For tools only in *selected* sessions, use the layered path: install `@lmzhen/dsh-evolution-host`, then `/evolution preset install` (or `install-layered --mode agent`) to generate the Evolution agent preset, and pick it per session. **`all` and the layered preset are also exclusive** — mounting both double-mounts the model rows.

For fine-grained control (e.g. a profile overlay), see the family README — `packages/README.md` in the source repository (named, not linked: a repo-relative link would be dead inside the npm published tree).

**Runtime invariant:** No companion is published. The platform auto-assembles nothing and the family mounts no `<pkg>/invariant` cordis row, so a companion here would never execute (v37 S2.1 / I-3).