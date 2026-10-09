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

**Where to start.** The DEFAULT form — and the only one with a real-install
verification on this platform line — is §5:
`dsh plugin --profile web add @lmzhen/dsh-evolution-all`. The other forms exist
for shrinking (`host`), per-session tools (the layered variant), or
compatibility (the one-click preset). The matrix below says which of them have
actually been exercised on `0.2.0-rc.2` — read the status column as evidence,
not as expectation.

### Install-form status against the validated platform line (`0.2.0-rc.2`)

Column 2 names the install mode; the M1–M4 vocabulary — what each number means —
is defined once in the root `README.md` §Install modes (M1-M4) and is cited here,
not restated. Column 3 says whether the form was EXERCISED on `0.2.0-rc.2` or
only judged from the source diff — a form is "已验证" only when an install ran
against that line.

**Known boundary of the SOURCE-CHECKOUT installer on a bare CLI host** (measured 2026-10-09):
`install-layered.mjs` copies the family's own 31 packages into the profile; rows whose `name`
points at a PLATFORM package (the `all` bundle's `tool-session-query`, for one) resolve only if
that package is reachable from the profile. Under the desktop app it is (the platform rides the
app payload); under a bare `dsh` CLI home it is not, and the loader reports it the way it should:
`dsh: warning: 1 entry did not activate — tool-session-query … failed to import`. A production
install (`dsh plugin add @lmzhen/dsh-evolution-all`) does not have this boundary — the published
bundle manifest declares those platform packages as dependencies, so pnpm installs them into the
profile. If you installed from a source checkout onto a CLI-only host and see that warning, add
the named package to the profile or switch to the production path.

| Form | Install mode | Status on `0.2.0-rc.2` | Basis |
|---|---|---|---|
| §1 ① Variant — layered (`--mode variant` / `layered`, source checkout) | M4 | **已验证**（lab，2026-10-09） | install into an isolated `DSH_HOME`: 31 packages copied into `profiles/<p>/node_modules`, the `preset-evolution` row written into the profile patch, `/evolution doctor` reported `install form: layered (deployment: variant …)`, and the desktop host booted clean with the family rows mounted |
| §2 Host-only (`--mode host`) | M3 | **已验证**（lab，2026-10-09） | the Plugins page listed `@deepseek-ai/dsh-evolution-host` as `20 个 · 19 运行中` (per-row state visible, `evolution-state-domain` off by design); the two platform rows it overrides (`session-query-sqlite`, `tool-skill`) have their key sets recomputed from the platform source by `verify-declared-config.mjs --upstream` |
| §3 Agent-only (`--mode agent`) | M4 (preset half — the host side is §2) | **部分已验证** | same preset-resolution coverage as §1 |
| §4 ② Attach — one-click (`--mode attach` / `oneclick`, `@lmzhen/dsh-evolution-preset`) | M1 (compatibility spelling of the same profile-root plane — NOT the host-only M3) | **未验证**（源码级判定） | the bundle's row set is §2's plus the four model rows, and the only platform row it inserts is `tool-session-query`; this BUNDLE has not been installed on `0.2.0-rc.2` — the same profile-root plane is exercised through §5, which mounts the same rows |
| §5 Production (`dsh plugin add @lmzhen/dsh-evolution-all`) | M1 | **部分已验证**（0.2.x：同一 profile-root 平面由本地安装器在 lab 上装过并跑通客户端半侧；`dsh plugin add` 这条命令本身尚未在 `0.2.0-rc.2` 上跑过——历史证据见右列） | real installs on a `0.1.5-rc.2` host: `dsh plugin --profile web add @lmzhen/dsh-evolution-all@0.3.70` (2026-09-12) `…@0.3.83` → exit 0 (2026-09-16, pnpm 8.3s) `…@0.4.0` → exit 0 (2026-09-16, pnpm 6.7s) and `…@0.4.1` → exit 0 (2026-09-17, pnpm 8.1s); in each case the profile resolved the bundle's closure to that version's installed family packages (`0.4.0`: 28/28 `import()` ok, 773-line dump; `0.4.1`: 28/28 `import()` ok, 784-line dump; `0.6.1`, 2026-09-18, pnpm 29.1s: 29 packages under `node_modules/@lmzhen` all at `0.6.1` with no mixed versions, 29/29 `import()` ok — the closure carries the runtime plugins, while `@lmzhen/dsh-evolution-preset` ships as an agent-preset artifact and does not land in `node_modules`), and `dsh --profile web --dump-config` is exit 0 with no duplicate (207 ids through 0.4.1; `0.6.1`: 209 ids / 787 lines, including the composed card row `- id: evolution-settings-ui`; `0.7.0`, 2026-09-19, pnpm 8.9s: 29 packages all at `0.7.0`, 29/29 `import()` ok, 801 lines / 210 ids; **`0.8.0`, 2026-09-22, pnpm 14.6s: 29 packages all at `0.8.0` (histogram `{0.8.0: 29}`, zero mixed versions), 29/29 `import()` ok, 801 lines / 210 ids — the same id set as `0.7.0`, so the convergence batch moved no row and no parameter**). Published ranges: see [README.md](./README.md) §Installation — the validated platform line and the floor it declares have ONE home there (`scripts/verify-platform-ranges.mjs` asserts the window) |

Reading the matrix: "未验证" is a statement about evidence, not about expected
behaviour — the source-level judgement for the still-open cells is that the
family inserts no platform row of its own beyond `tool-session-query` and
overrides only two base rows, so the 0.1.1→0.1.5 platform delta does not touch
the install surface. §5 is the one cell a real install has closed; the remaining
cells are the checklist for their own first real 0.1.5 install.

> ⚠️ **`dsh-evolution-all`, `dsh-evolution-host` and `dsh-evolution-preset` are
> mutually exclusive install targets — never add more than one of these bundles
> to the same profile.** `all` and the preset expose the model tools
> profile-wide; `host` is infrastructure only (plus the read-only
> `maintenance_probe` diagnostic). They share the self-evolution
> infrastructure rows, so mounting two double-registers that infrastructure
> and fails loud at startup (invariants: already registered). The layered
> layout (host + Evolution agent preset) is ALSO exclusive with `all` — the
> preset scope's model rows would double-mount the tools. For the same
> reason the one-click `preset` bundle is ALSO exclusive with the layered
> layout (its model rows would double-mount the layered preset's rows).
> Choose one:
> **② attach** — full (`all`) or one-click (`preset`) — where every session,
> including one on a platform original preset, carries the family's model rows;
> or **① variant** — layered (`host` + the generated Evolution preset,
> `--mode variant`) — where the model rows exist only inside the family preset,
> so a session on an original preset gets no evolution behaviour at all
> (`sessionScoped`; `/evolution doctor` prints `deployment: variant|attach`).
>
> **Known difference (0.3.78, accepted not fixed):** under **① variant**, a session
> running a platform original preset still SEES the `/evolution …` commands. The
> platform registers commands in scope layers (global + calling-agent), and the
> family registers its command once on the host plane, so it lands in the global
> layer and every session's command list shows it. The surface is management-only
> and read-only (`/evolution doctor`, `curator status`, `pending`, …), and the
> AUTOMATIC paths (review cadence/injection, usage telemetry, curation) are
> already gated per session by `sessionAudited`, so an original-preset session
> gets no family behaviour behind the commands. Hiding the command face per
> session would mean registering inside each agent's scope with its own
> registration/teardown lifecycle, which this family deliberately does not do
> (see the optimization plan's "explicitly not doing" list).
>
> **Single source (0.3.78, G5):** this block is the family's ONE statement of what
> each install form does to a session and of the variant command-face difference.
> Every other document cites it — `scripts/family-facts.json` names it as the home
> of those facts, and a second copy fails architecture rule N19.

### What `/evolution doctor` reports

| `deployment:` | Form | What a session gets |
|---|---|---|
| `variant` | ① layered (`host` + the generated Evolution preset) | family behaviour only in sessions that selected the family preset |
| `attach` | ② full (`all`) or one-click (`preset`) | every session, platform original presets included |
| `host-only` | the host bundle, no model rows | background automation only; no `memory` / `skill_manage` tools |
| `preset-only` | the Evolution preset is delivered, no bundle is mounted | nothing runs until a bundle is added back |
| `none` | no family bundle and no generated preset | nothing mounted; install per §5 |

## Platform mode × self-evolution

Which agent preset a session runs decides how much of the family is usable in
it. Under `all` (and the infrastructure half of `host`) the family's rows sit at
profile root, so they mount in every session; what varies is the platform
surface they stand on.

| Session preset | Self-evolution | Why |
|---|---|---|
| `standard` | full | skills, subagents, plan/goal, fs and web tool rows all present |
| `ptc` | full | same row set plus `tool-presentation`; dispatch accounting covers both vocabularies since 0.3.75 |
| `cordis` | full | `standard` plus `tool-cordis`. The model can also inspect and mount plugins, so pair it with a deliberate review/approval policy |
| `minimal` | not usable | mounts `persona` and the shell/terminal rows only — no `skill-filesystem`, no `tool-skill`, no file tools, so the skill surface the family writes to has no home |

Preset variants (`--base`) exist for every base the agent package's
`bases.json` carries — the table, each base's installed id and its precondition
are single-sourced in `evolution-agent/README.md` §Preset variants. `cordis` is
registered there with `requires: dynamicCordisRunner` and is refused by name
where that service is absent; `minimal` is registered as unsupported because its
platform composition carries no skill row to attach to. The `sdk-minimal` application
bundle does not layer over `dsh-base` and ships neither the state, approval nor
skill rows, so the family has no foothold there either.

## Prerequisites

- **Validated platform line: DSH `0.2.0-rc.2`.** This family does not support
  two platform generations at once: `0.1.x` and earlier are outside the support
  window. The published `@deepseek-ai/dsh-*` ranges are `^0.2.0-rc.1`
  (`PLATFORM_FLOOR`), which under node-semver's prerelease rule admits this
  line including its earlier rc but no earlier line — an older platform fails
  at dependency resolution, not at runtime. `release.yml` carries BOTH values
  (`PLATFORM_FLOOR` = what the ranges declare, `PLATFORM_VERSION` = the line
  the gate validates and builds against); `scripts/verify-platform-ranges.mjs`
  asserts the floor against the staged manifests.
- A DeepSeek Harness checkout that resolves the evolution workspace packages,
  or a published `@deepseek-ai/dsh-evolution-host` bundle available to pnpm.
- For the local installer below: Node 22.19+ or 24+ (the repository's
  `engines` floor: `^22.19.0 || >=24.0.0`) and the source checkout.

## 1. Layered install (local development)

```bash
node packages/scripts/install-layered.mjs \
  --profile web \
  --mode layered \
  --home "$DSH_HOME"
```

Omit `--home` to use `$DSH_HOME` or `~/.dsh`.

Every flag the installer accepts (`node packages/scripts/install-layered.mjs --help`
prints this same table; `guard-scripts.spec.ts` fails when the two drift):

| Flag | Value | Meaning |
|---|---|---|
| `--mode` | `host` \| `agent` \| `layered` \| `oneclick` (aliases `variant` / `attach`) | Install target plane (default `layered`). |
| `--profile` | `<name>` | Profile directory under `$DSH_HOME/profiles` (default `web`). |
| `--base` | `<name>[,<name>...]` | Platform agent-preset base the family preset follows (repeatable). |
| `--home` | `<dir>` | Harness home to write into (default `$DSH_HOME`). |
| `--dry-run` | — | Report what would change and write nothing. |
| `--force` | — | Proceed past a conflicting install form. |
| `--check-presets` | — | Report on the presets already on disk (composes with any mode). |
| `--uninstall` | — | Remove the generated preset and its rows. |
| `--help` | — | Print the flag table and exit. |

This performs:

1. copies every evolution package (including a built `lib/` when present) into
   `<home>/profiles/<profile>/node_modules/@deepseek-ai/...`;
2. adds `@deepseek-ai/dsh-evolution-host` to
   `<home>/profiles/<profile>/package.json` `dsh.profile.bundles`;
3. writes the `Evolution` agent-preset ROW into
   `<home>/profiles/<profile>/cordis.patch.yml` as one `- insert:` block
   (`--base ptc` writes the ptc variant's row `preset-evolution-ptc` instead — the
   base names both the platform base patch the rows are read from and the row id,
   and the table behind both is `evolution-agent/bases.json`). 0.2.x removed the
   preset directory, so no `.agent-presets/` tree is produced.

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
dsh plugin --profile web add @lmzhen/dsh-evolution-all
dsh plugin --profile web add @lmzhen/dsh-evolution-host
dsh plugin --profile web add @lmzhen/dsh-evolution-preset
```

`@lmzhen/dsh-evolution-all` is the default target (§5 above: M1, the form the
status matrix records as verified) and depends on the host bundle, so it is the
one to add on a fresh profile; `host` and `preset` are the alternatives and are
mutually exclusive with it.

> Community-published `@lmzhen/*` packages are not official DeepSeek
> releases.

The agent preset is assembled by the installer (`install-layered.mjs`) or the
host-runner's preset generation — V6-03 (0.3.34): do NOT hand-write
`evolution-agent/agent.cordis.yml` into the profile patch. That file is a DELTA
(4 model-tool rows, see its own header) and the preset ROW is mounted as the
COMPLETE composition — a hand-written delta would mount an agent missing every
standard row. Use `dsh plugin add` + the installer, or `/evolution preset install`
(write only a standard+delta SYNTHESIZED row when a manual path is truly needed).
The npm-only path is `/evolution preset install [--base <name>[,<name>...]]`,
which reads the same `evolution-agent/bases.json` table and writes one variant
per named base in a single pass.

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

`memory-files.root` moves the memory files. The SKILL tree is read/written by a
whole set of family rows that all take the same `root` key and must all point
at the same path — the canonical list, and the story of the retired
`skillsRoot` key, live in the root `INSTALL.md` §Override memory/skill roots.
Setting `skill-usage.root` ALONE moves the `.usage.json` sidecar while the
skill tree stays where it was, which is the trap the root document spells out:

```yaml
- id: memory-files
  config:
    root: /srv/agent-data/memories

# Repeat the SAME value on every row the root INSTALL.md lists under this
# heading — one row (this one) is not enough.
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

It reports the install form (full / host / preset / layered / preset-only /
none — the `installForm` union in `evolution-commands/src/doctor.ts`), flags
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
