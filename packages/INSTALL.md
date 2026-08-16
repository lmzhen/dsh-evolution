# Installing dsh-evolution

Two supported layouts:

| Layout | What is installed | Model tools |
|---|---|---|
| Layered | `dsh-evolution-host` bundle + `Evolution` agent preset | Exposed only to sessions selecting the preset |
| One-click | `dsh-evolution-preset` compatibility bundle | Exposed to every session in the profile |

The layered layout is recommended for production.

## Prerequisites

- A DeepSeek Harness checkout that resolves the evolution workspace packages,
  or a published `@deepseek-ai/dsh-evolution-host` bundle available to pnpm.
- For the local installer below: Node 22+ and the source checkout.

## 1. Layered install (local development)

```bash
node packages/evolution/scripts/install-layered.mjs \
  --profile web \
  --mode layered \
  --home "$DSH_HOME"
```

Omit `--home` to use `$DSH_HOME` or `~/.dsh`.

This performs:

1. copies every evolution package into
   `<home>/profiles/<profile>/node_modules/@deepseek-ai/...`;
2. adds `@deepseek-ai/dsh-evolution-host` to
   `<home>/profiles/<profile>/package.json` `dsh.profile.bundles`;
3. copies the `Evolution` agent preset to
   `<home>/.agent-presets/evolution/`.

Dry run:

```bash
node packages/evolution/scripts/install-layered.mjs \
  --profile web --mode layered --dry-run
```

Uninstall the layered layout while keeping user data:

```bash
node packages/evolution/scripts/install-layered.mjs   --profile web --mode layered --uninstall
```

Only the profile rows, copied packages, and the agent preset directory are
removed. Memory, skills, state, reports, and approval history remain.

## 2. Host-only install

```bash
node packages/evolution/scripts/install-layered.mjs \
  --profile web --mode host
```

Sessions get background evolution automation, approval, review, curator, and
observability, but no `memory`/`skill_manage` tools.

## 3. Agent-only install

```bash
node packages/evolution/scripts/install-layered.mjs \
  --profile web --mode agent --force
```

Assumes the host bundle is already installed or the tool services resolve from
another source.

## 4. One-click compatibility install

```bash
node packages/evolution/scripts/install-layered.mjs \
  --profile web --mode oneclick
```

Equivalent to the legacy `dsh-evolution-preset` profile bundle.

## 5. Production install

When bundles are published:

```bash
dsh plugin --profile web add @deepseek-ai/dsh-evolution-host
```

Then copy `packages/evolution/evolution-agent/` to:

```text
$DSH_HOME/.agent-presets/evolution/
```

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

```yaml
- id: evolution-review
  config:
    reviewToolAllow: [skill, skill_search, skill_load, read]
```

## Verification

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

## Capability governance

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

It fails closed while `evolution-approval` is disabled, and it never executes
`code` itself.
