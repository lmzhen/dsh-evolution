# Installing dsh-evolution

Four supported install forms (P2-23, v19 — this copy mirrors the repository
root `INSTALL.md`; `dsh-evolution-all` is the DEFAULT and the other three are
alternatives):

| Form | Bundle / preset | Model tools | Notes |
|---|---|---|---|
| **All (default)** | `dsh-evolution-all` | profile-wide | infra + `memory`/`skill_manage` + guidance, no preset step |
| Host + agent preset | `dsh-evolution-host` + `Evolution` agent preset | only sessions selecting the preset | recommended when tools must be opt-in |
| One-click | `dsh-evolution-preset` compatibility bundle | profile-wide | one-shot compatibility form |
| Agent only | `Evolution` agent preset | only sessions selecting the preset | requires the host bundle (or the agent-preset packages) installed separately |

The full `all` bundle is the new-install default; `host` is the shrink path
(same automation, no model tools). Shrinking = uninstall `all`, install `host`.

> ⚠️ **`dsh-evolution-all`, `dsh-evolution-host` and `dsh-evolution-preset` are
> mutually exclusive install targets — never add more than one of these bundles
> to the same profile.** `all` and the preset expose the model tools
> profile-wide; `host` is infrastructure only. They share the self-evolution
> infrastructure rows, so mounting two double-registers that infrastructure
> and fails loud at startup (invariants: already registered). The layered
> layout (host + Evolution agent preset) is ALSO exclusive with `all` — the
> preset scope's model rows would double-mount the tools. Choose one:
> full (`all`), layered (`host` + preset), or one-click (`preset`).

## Prerequisites

- A DeepSeek Harness checkout that resolves the evolution workspace packages,
  or a published `@deepseek-ai/dsh-evolution-host` bundle available to pnpm.
- For the local installer below: Node 22+ and the source checkout.

## 1. Layered install (local development)

```bash
node packages/scripts/install-layered.mjs \
  --profile web \
  --mode layered \
  --home "$DSH_HOME"
```

Omit `--home` to use `$DSH_HOME` or `~/.dsh`.

This performs:

1. copies every evolution package (including a built `lib/` when present) into
   `<home>/profiles/<profile>/node_modules/@deepseek-ai/...`;
2. adds `@deepseek-ai/dsh-evolution-host` to
   `<home>/profiles/<profile>/package.json` `dsh.profile.bundles`;
3. copies the `Evolution` agent preset to
   `<home>/.agent-presets/evolution/`.

The installer is source-layout aware: if a package's `lib/index.js` has not
been built yet it prints an `unbuilt:` warning. Boot such a profile with the
TS loader used by the source checkout, or build the evolution packages first.
Published-bundle installs are unaffected.

Dry run:

```bash
node packages/scripts/install-layered.mjs \
  --profile web --mode layered --dry-run
```

Uninstall the layered layout while keeping user data:

```bash
node packages/scripts/install-layered.mjs --profile web --mode layered --uninstall
```

Only the profile rows, copied packages, and the agent preset directory are
removed. Memory, skills, state, reports, and approval history remain.

## 2. Host-only install

```bash
node packages/scripts/install-layered.mjs \
  --profile web --mode host
```

Sessions get background evolution automation, approval, review, curator, and
observability, but no `memory`/`skill_manage` tools.

## 3. Agent-only install

```bash
node packages/scripts/install-layered.mjs \
  --profile web --mode agent --force
```

Assumes the host bundle is already installed or the tool services resolve from
another source.

## 4. One-click compatibility install

```bash
node packages/scripts/install-layered.mjs \
  --profile web --mode oneclick
```

Equivalent to the legacy `dsh-evolution-preset` profile bundle.

## 5. Production install

Official upstream bundles, when published by DeepSeek:

```bash
dsh plugin --profile web add @deepseek-ai/dsh-evolution-host
```

Community bundles under the personal scope `@lmzhen`:

```bash
pnpm dsh plugin --profile web add @lmzhen/dsh-evolution-host
pnpm dsh plugin --profile web add @lmzhen/dsh-evolution-preset
```

> Community-published `@lmzhen/*` packages are not official DeepSeek
> releases.

The agent preset is assembled by the installer (`install-layered.mjs`) or the
host-runner's preset generation — V6-03 (0.3.34): do NOT hand-copy
`evolution-agent/agent.cordis.yml` into `$DSH_HOME/.agent-presets/evolution/`.
That file is a DELTA (4 model-tool rows, see its own header) and the
`.agent-presets` discovery mounts whichever `agent.cordis.yml` it finds as the
COMPLETE composition — a hand-copied delta would mount an agent missing every
standard row. Use `dsh plugin add` + the installer (or copy only a
standard+delta SYNTHESIZED composition when a manual path is truly needed).

## Profile override examples

Add these to `<home>/profiles/<profile>/cordis.patch.yml`.

### Disable background review

```yaml
- id: evolution-review
  disabled: true
```

### Enable staged approval

```yaml
- id: evolution-approval
  config:
    enabled: true
    stageForeground: true
```

### Override memory/skill roots

```yaml
- id: memory-files
  config:
    root: /srv/agent-data/memories

- id: skill-usage
  config:
    root: /srv/agent-data/skills
```

### Use JSON state even when a storage-domain exists

```yaml
- id: evolution-state
  config:
    provider: json
```

### Extend review subagent tools

The default `reviewToolAllow` is exactly `[skill]` (the DSH tool catalog exposes
the plain `skill` tool only). Extending it adds tools to the review subagent's
filter:

```yaml
- id: evolution-review
  config:
    # V5-25 (0.3.32): the DSH tool catalog exposes the plain `skill` tool only —
    # `skill_search`/`skill_load` (Hermes-era) do not exist on this platform.
    reviewToolAllow: [skill]
```

## Verification

**Fastest check — run the built-in doctor:**

```bash
/evolution doctor          # human-readable self-check
/evolution doctor --json   # script-friendly
```

It reports the install form (full / host / preset / layered / none), flags
all/host/preset or all-vs-layered conflicts, checks the `DSH_EVOLUTION_*`
environment variables, and ends with suggested next steps.

Composed profile tree:

```bash
dsh --profile <profile> --dump-config
```

Runtime tests:

```bash
vitest run packages/evolution/evolution-host/tests/installation-matrix.spec.ts
vitest run packages/evolution/tool-memory/tests/anchored-compat.spec.ts
vitest run packages/evolution/evolution-review/tests/anchored-smoke.spec.ts
```

Uninstalling only removes the profile row or preset directory; memory, skills,
state, reports, and approval history remain under `$DSH_HOME`.

## Capability governance (optional package)

`evolution-capability` is a staged, non-executing adapter for Creator mode. It
validates a capability package shape and submits it through the same pending
audit trail as memory/skills. Activation remains in Creator mode:

```ts
await ctx.evolutionCapability.submit({
  name: 'my-capability',
  purpose: 'One sentence purpose.',
  code: { host: 'export function apply() {}' },
})
```

It **is not mounted by the evolution-host bundle** (rc.51 D-9): the host stays
minimal, and deployments that use Creator mode add the row themselves:

```yaml
- id: evolution-capability
  name: '@deepseek-ai/dsh-evolution-capability'
```

It fails closed while `evolution-approval` is disabled, and it never executes
`code` itself.
