# Installing dsh-evolution

Two supported layouts:

| Layout | What is installed | Model tools |
|---|---|---|
| Layered | `dsh-evolution-host` bundle + `Evolution` agent preset | Exposed only to sessions selecting the preset |
| One-click | `dsh-evolution-preset` compatibility bundle | Exposed to every session in the profile |

The layered layout is recommended for production.

> ⚠️ **`dsh-evolution-host` and `dsh-evolution-preset` are mutually exclusive
> install targets — never add both bundles to the same profile.** The host
> bundle is infrastructure only (no profile-wide model tools); the preset bundle
> is the one-click compatibility bundle that also exposes the model tools
> profile-wide. They share the self-evolution infrastructure rows, so mounting
> both double-registers that infrastructure and, if their shared configs ever
> diverged, would produce an ambiguous composition. Choose one per profile: the
> layered host/agent layout (recommended) or the one-click preset layout.

## Prerequisites

- A DeepSeek Harness checkout that resolves the evolution workspace packages,
  or the published community bundle `@lmzhen/dsh-evolution-host` available to
  pnpm (see §5).
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

Composed profile tree:

```bash
dsh --profile <profile> --dump-config
```

Runtime tests:

```bash
vitest run packages/evolution-host/tests/installation-matrix.spec.ts
vitest run packages/tool-memory/tests/anchored-compat.spec.ts
vitest run packages/evolution-review/tests/anchored-smoke.spec.ts
```

> Dual-layout note (G5.5): these vitest paths are written in the flat-mirror
> layout (`packages/<pkg>/tests/...`). Like the tsconfig paths described in
> README.md ("Development: the two layouts"), they resolve ONLY in the full
> upstream checkout — the dev tree or the CI overlay built against it. A
> standalone flat mirror has no standalone toolchain of its own, so the suites
> run via that merged tree, not off the mirror alone.

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
  name: '@lmzhen/dsh-evolution-capability'
```

It fails closed while `evolution-approval` is disabled, and it never executes
`code` itself.
