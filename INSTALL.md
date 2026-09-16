# Installing dsh-evolution

Four supported install forms. **`dsh-evolution-all` is the DEFAULT** (most
complete, no preset step); the other three are alternatives. Never mount two
of the bundles in one profile — they insert the same infrastructure rows and
the cordis loader fails loud on duplicate ids.

| Form | Bundle / preset | Model tools | Notes |
|---|---|---|---|
| **All (default)** | `dsh-evolution-all` | profile-wide | infra + `memory`/`skill_manage` + guidance, no preset step |
| Host + agent preset | `dsh-evolution-host` + `Evolution` agent preset | only sessions selecting the preset | recommended when tools must be opt-in |
| One-click | `dsh-evolution-preset` compatibility bundle | profile-wide | one-shot compatibility form |
| Agent only | `Evolution` agent preset | only sessions selecting the preset | requires the host bundle (or the agent-preset packages) installed separately |

> ⚠️ **`dsh-evolution-all`, `dsh-evolution-host` and `dsh-evolution-preset`
> are mutually exclusive in one profile**, and the layered `Evolution` agent
> preset is exclusive with `dsh-evolution-all` / `dsh-evolution-preset` (the
> same four model rows would double-mount). They share the self-evolution
> infrastructure rows, so mounting two double-registers that infrastructure
> and the loader aborts at startup. Choose ONE form per profile; the repo's
> `packages/scripts/verify-profile-bundles.mjs` checks the bundle rows.
>
> Note (S3-A2): installing `dsh-evolution-all` also pulls in the
> `dsh-evolution-agent-preset` container as a hard dependency. That package is
> an install-form EXCLUSIVE with `all` — its rows are never mounted in an
> `all` profile; the dependency exists only as a forward dependency-closure
> guard (pinned by `packages/evolution-all/tests/all.spec.ts`), and the
> layered installer refuses to combine the two forms regardless.

The install-form semantics — what each form does to a session — and the
per-form verification status against the validated platform line are
single-sourced in `packages/INSTALL.md` ("Install forms"); this root copy
owns the source-install commands and the scope details. The installer also
accepts the product-form aliases `--mode variant` (= `layered`) and
`--mode attach` (= `oneclick`).

## Production install (published bundles)

Community bundles under the personal scope `@lmzhen` — `all` is the DEFAULT
form, `host` is the shrink path, and the one-click `preset` is the legacy
compatibility path:

```bash
dsh plugin --profile web add @lmzhen/dsh-evolution-all
dsh plugin --profile web add @lmzhen/dsh-evolution-host
dsh plugin --profile web add @lmzhen/dsh-evolution-preset
```

> Community-published `@lmzhen/*` packages are not official DeepSeek
> releases.

Inside a source/overlay checkout the same bundles live under the `@deepseek-ai`
scope (publishing rewrites the scope to `@lmzhen`); those names resolve only
there, never from npm:

```bash
dsh plugin --profile web add @deepseek-ai/dsh-evolution-host
```

The agent preset is assembled by the installer (`install-layered.mjs`) or the
host-runner's preset generation — V6-03 (0.3.34): do NOT hand-copy
`evolution-agent/agent.cordis.yml` into `$DSH_HOME/.agent-presets/evolution/`.
That file is a DELTA (4 model-tool rows, see its own header) and the
`.agent-presets` discovery mounts whichever `agent.cordis.yml` it finds as the
COMPLETE composition — a hand-copied delta would mount an agent missing every
standard row. Use `dsh plugin add` + the installer (or copy only a
standard+delta SYNTHESIZED composition when a manual path is truly needed).
The npm-only path is `/evolution preset install [--base <name>[,<name>...]]`,
which reads the same `evolution-agent/bases.json` table and generates one
variant per named base in a single pass (each base's preset id and metadata
file come from that table).

## Prerequisites

- **Validated platform line: DSH `0.1.5-rc.2`.** The published
  `@deepseek-ai/dsh-*` dependency ranges are `^0.1.5-rc.2`, and node-semver's
  prerelease rule does not admit an earlier prerelease line, so an older
  platform fails at dependency resolution rather than at runtime. The anchor
  is defined once in `.github/workflows/release.yml` (`PLATFORM_VERSION`)
  and re-derived by `packages/scripts/verify-platform-ranges.mjs`.
- A DeepSeek Harness checkout that resolves the evolution workspace packages,
  or the published community bundle `@lmzhen/dsh-evolution-host` available to
  pnpm (see **Production install**).
- For the local installer below: Node 22.19+ or 24+ (the repository's
  `engines` floor: `^22.19.0 || >=24.0.0`) and the source checkout.

## Layered install (host + agent preset — local development)

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
   `<home>/.agent-presets/evolution/` (`--base ptc` installs the ptc variant to
   `<home>/.agent-presets/evolution-ptc/` instead — the base names the runtime
   platform composition and the installed directory, and the table behind both
   is `evolution-agent/bases.json`).

The copied scope comes from `EVOLUTION_SCOPE` (default `@deepseek-ai`, the
overlay scope). With `EVOLUTION_SCOPE=@lmzhen` the installer reads the
`prepare-release.mjs --scope @lmzhen` staging under
`packages/.release-staging` and refuses a staging that is missing, stale, or
built for another scope.

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

## Host-only install

```bash
node packages/scripts/install-layered.mjs \
  --profile web --mode host
```

Sessions get background evolution automation, approval, review, curator, and
observability, but no `memory`/`skill_manage` tools.

## Agent-only install

```bash
node packages/scripts/install-layered.mjs \
  --profile web --mode agent --force
```

Assumes the host bundle is already installed or the tool services resolve from
another source.

## One-click compatibility install (legacy)

```bash
node packages/scripts/install-layered.mjs \
  --profile web --mode oneclick
```

Equivalent to the legacy `dsh-evolution-preset` profile bundle.

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

With staging on, the three destructive curator writes that the skill runner
cannot replay — `/evolution consolidate`, `/evolution restore` (whole tree) and
`/evolution skill restore <name>` — answer `E-306` instead of writing straight
through the gate; since 0.3.83 `/evolution restructure` answers the same code
when the invocation carries no session to attribute a staged record to. Set
`stageForeground: false` (or use a session whose approval policy is `never`) to
run them directly and deliberately.

### Override memory/skill roots

The skill tree is read/written by EIGHT rows. Since 0.3.64 they all read the
SAME key `root`. The old `skillsRoot` key (`evolution-commands`,
`evolution-review` and `evolution-maintenance-tools` still declare it) was
retired at 0.3.65: setting it now FAILS THE LOAD with "config \"skillsRoot\"
was removed after 0.3.65 — rename the key to \"root\"", so a deployment cannot
keep pointing at a root nobody reads. Setting only
`skill-usage.root` moves the `.usage.json` sidecar but NOT the skill tree, so
telemetry silently targets a different directory. Keep every row below on the
same path (and set `memory-files.root` for the memory files):

```yaml
- id: memory-files
  config:
    root: /srv/agent-data/memories

- id: tool-skill-manage
  config: { root: /srv/agent-data/skills }
- id: evolution-skill-catalog
  config: { root: /srv/agent-data/skills }
- id: skill-usage
  config: { root: /srv/agent-data/skills }
- id: evolution-curator
  config: { root: /srv/agent-data/skills }
- id: evolution-learning-graph
  config: { root: /srv/agent-data/skills }
- id: evolution-commands
  config: { root: /srv/agent-data/skills }
- id: evolution-review
  config: { root: /srv/agent-data/skills }
- id: evolution-maintenance-tools
  config: { root: /srv/agent-data/skills }
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

Runtime tests (run them in the merged upstream checkout, not in this mirror):

```bash
vitest run packages/evolution/evolution-host/tests/installation-matrix.spec.ts
vitest run packages/evolution/tool-memory/tests/anchored-compat.spec.ts
vitest run packages/evolution/evolution-review/tests/anchored-smoke.spec.ts
```

> Dual-layout note (G5.5): the installer commands above run HERE, in the flat
> mirror (`packages/scripts/...`). The vitest paths are the merged-tree form:
> type-checking and the suites run in the upstream checkout (the CI overlay
> built from the platform tag), which hosts the same sources under
> `packages/evolution/<pkg>/` and whose `tsconfig.base.json` /
> `tsconfig.host.json` carry the alias lines those paths need (see
> `packages/README.md`, "Development: the two layouts and their tsconfigs").
> This mirror ships no
> toolchain of its own. The mirror is the authoring AND publication tree since
> 0.3.83 and the publish chain no longer copies a second tree over it; the
> former dev tree `D:/dsh/deepseek-harness` is stale and carries an
> `AUTHORING-MOVED.md` marker. `packages/scripts/**` is the one cross-tree
> obligation left: the publish chain's version guard compares it byte-for-byte
> against that stale checkout's copy, so a script change here is mirrored
> there before a release (0.3.83 reconciled 58 drifted files).

Uninstalling only removes the profile row or preset directory; memory, skills,
state, reports, and approval history remain under `$DSH_HOME`.

## Capability evolution (retired in 0.3.66)

`evolution-capability` was removed from this repository. It staged a Creator-mode
capability package — an object carrying `code.host` / `code.client` halves — into
the same pending queue as memory and skills, without executing anything:
approval recorded intent only, and activation stayed a manual Creator-mode step.

It was retired because that split cannot work. An approval that does not gate
execution is a log, and the owner of the log is not the owner of the effect; the
dynamic-package lifecycle (`cordis_define` / `cordis_run`, its approval, and its
run history) belongs to the platform Creator mode, which is where a capability is
created and activated. The package never had a production consumer either — no
bundle mounted it, no model-facing tool reached it, and its only in-tree caller
was the install document.

The last published version, `@lmzhen/dsh-evolution-capability@0.3.65`, remains
installable from npm; no later version is published. Do not add the row to a
profile — nothing maintains it. Records staged by an install that used it
(≤0.3.65) stay readable: they still appear in `/evolution pending`, where approve
records intent and reject drops them. Capability-shaped work belongs either in
Creator mode or, when the durable artifact is knowledge rather than code, in
`memory` and `skills`.
