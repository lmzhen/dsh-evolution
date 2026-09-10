# Installing dsh-evolution

Four supported install forms (P2-23, v19 — a companion to the repository
root `INSTALL.md`, focused on the bundle/preset matrix; the root copy is
canonical for the source-install and scope details. `dsh-evolution-all` is
the DEFAULT and the other three are alternatives):

| Form | Bundle / preset | Model tools | Notes |
|---|---|---|---|
| **All (default)** | `dsh-evolution-all` | profile-wide | infra + `memory`/`skill_manage` + guidance, no preset step |
| Host + agent preset | `dsh-evolution-host` + `Evolution` agent preset | only sessions selecting the preset | recommended when tools must be opt-in |
| One-click | `dsh-evolution-preset` compatibility bundle | profile-wide | one-shot compatibility form |
| Agent only | `Evolution` agent preset | only sessions selecting the preset | requires the host bundle (or the agent-preset packages) installed separately |

The full `all` bundle is the new-install default; `host` is the shrink path
(same automation, no memory/skill model tools — the read-only
`maintenance_probe` diagnostic remains). Shrinking = uninstall `all`, install `host`.

> ⚠️ **`dsh-evolution-all`, `dsh-evolution-host` and `dsh-evolution-preset` are
> mutually exclusive install targets — never add more than one of these bundles
> to the same profile.** `all` and the preset expose the model tools
> profile-wide; `host` is infrastructure only (plus the read-only
> `maintenance_probe` diagnostic). They share the self-evolution
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

Family bundles in the overlay `@deepseek-ai` scope (community-maintained;
publishing rewrites the scope to `@lmzhen` — the `@deepseek-ai` names below
resolve only from a source/overlay checkout, not from npm):

```bash
dsh plugin --profile web add @deepseek-ai/dsh-evolution-host
```

Community bundles under the personal scope `@lmzhen` (what npm actually
serves today):

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

## Capability evolution (retired in 0.3.66)

`evolution-capability` was removed. It staged a Creator-mode capability package
(an object with `code.host`/`code.client` halves) into the same pending queue as
memory and skills, without executing anything — approval recorded intent only,
and activation stayed a manual Creator-mode step.

Retired because that split cannot work: an approval that does not gate execution
is a log, and the log's owner is not the effect's owner. The dynamic-package
lifecycle — `cordis_define` / `cordis_run`, its approval, and its run history —
belongs to the platform Creator mode, which is where a capability is created.
The package never had a production consumer: no bundle mounted it, no model-facing
tool reached it, and its only in-tree caller was this document.

`@lmzhen/dsh-evolution-capability@0.3.65` (the last published version) stays
installable from npm; no later version will be published. Records staged by an
install that used it (≤0.3.65) stay readable: they still appear in
`/evolution pending`, where approve records intent and reject drops them.
Capability-shaped work belongs either in Creator mode or, when the durable
artifact is knowledge rather than code, in `memory` and `skills`.
