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

The package is deliberately passive: no composition rows of its own.

## V10-08 (H-08): what `plugin add` does and does not do

Installing this package mounts **only the host bundle**. The model-facing tool
rows (`memory`, `skill_manage`, the skill catalog) live in the Evolution agent
preset delta — and **no mechanism registers that preset for you**. Until you
make one of the two moves below, sessions see the host control plane only: no
memory tool, no skill write tool, no skill catalog.

After installing, do one of:

1. **Layered install (recommended)** — run
   `install-layered --mode agent`
   to generate the Evolution agent preset from the runtime `standard`
   composition, then select it in the session switcher.
2. **Manual preset** — run `/evolution preset install` in a session to compose
   the runtime standard + delta into `~/.dsh/.agent-presets/evolution`, restart
   the session switcher, and select the **Evolution** preset for the sessions
   that should expose the self-evolution tools.

For fine-grained installs (host only, or host + selected tools), install the
packages individually — see the family [README](../README.md).
