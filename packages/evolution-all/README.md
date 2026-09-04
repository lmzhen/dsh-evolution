# dsh-evolution-all

One-command aggregate entry for the `@lmzhen/dsh-evolution` plugin family.

```bash
dsh plugin --profile web add @lmzhen/dsh-evolution-all
```

Installs the complete family through one package:

- `dsh-evolution-host` — infrastructure and control plane (review, curator,
  approval, audit, observability, threat checks; its bundle patch carries the
  profile composition rows).
- `dsh-tool-memory` / `dsh-tool-skill-manage` / `dsh-evolution-skill-catalog` —
  the model-facing tool packages (mounted by the Evolution agent preset).

The package is deliberately passive: no composition rows of its own. Add it,
restart the profile, and select the **Evolution** agent preset for the sessions
that should expose self-evolution tools.

For fine-grained installs (host only, or host + selected tools), install the
packages individually — see the family [README](../README.md).
