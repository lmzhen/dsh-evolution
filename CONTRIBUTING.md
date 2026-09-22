# Contributing to the dsh-evolution family

This repository (the **flat mirror**) is the publication carrier: `packages/*`
are the packages that ship, and the root documents — `README.md`,
`README.zh.md`, `INSTALL.md`, `CHANGELOG.md`, this file — are the user-facing
surface. The CI validation tree is the platform checkout's
`packages/evolution/`, kept byte-identical to `packages/*` before a release.
Edit HERE (the mirror is the authoring tree since 0.3.83) and copy the result
into that validation tree, then run the gate: the `sync-dev-to-mirror` /
`sync-mirror-to-dev` helpers belong to the retired dual-line workflow and the
stale side must never be copied back over this one.

## Start here

1. **Edit in this mirror** (`packages/<pkg>/…`) — since 0.3.83 it is both the
   authoring and the publication tree, so nothing is copied over it.
2. **Copy the change into the validation checkout**. Type-checking and the
   suites run where the same sources live at `packages/evolution/<pkg>/…` (the
   CI overlay built from the platform tag). The machine-local
   `D:/dsh/deepseek-harness` checkout is the stale former dev tree and is never
   a source to copy from.
3. **Run the gate**. `node D:/dsh/audit-v42/run-baseline.mjs <prefix>` executes
   all eighteen steps and writes one log per step plus a summary (§The gate has
   the table and says which step runs in which tree).
4. **Decide where your words live**. §Where a fact is allowed to live is the
   rule that fails a conclusion stated in two documents (N19).

## Where a fact is allowed to live (G5, 0.3.78)

The same conclusion used to be written in the root README, the package README,
the install documents and the CHANGELOG, so it drifted where no build could see
it — 0.3.77 left the root README still promising other presets the shared
automation after the variant form made that false, and the agent README kept
denying that a cordis base exists after `bases.json` grew one. (This file has to
describe those claims without quoting them: the strings themselves are the
forbidden copies.) Three layers, one owner each:

| Layer | What it holds | Where it lives |
|---|---|---|
| **Conclusion** | what a user must know | ONE document — a README, or `INSTALL.md` for install-form facts |
| **Reason** | why it changed | `CHANGELOG.md` version sections (released sections are history, never rewritten) |
| **Mechanism** | how it works | the code docblock next to the code |

A fact that wants a second home gets a **citation** instead. The registry is
`packages/scripts/family-facts.json`; each entry names the fact's ONE home, the
sentences that must be there (`must`, with `unique: true` meaning "the home
only"), the claims forbidden everywhere else (`forbid`), the documents that must
cite the home (`cites`), and the machine owner that re-derives the value
(`machine`). Checked values today: the `--base` table
(`evolution-agent/bases.json`), the catalog-cap reach
(`evolution-core/row-overrides.json`), the doctor's reported deployment forms
(`evolution-commands/src/doctor.ts`) and the rendered command table.

- Run it: `node packages/scripts/verify-doc-facts.mjs packages --strict`
- It is also architecture rule **N19** inside `verify-arch-guards.mjs`, so the
  21-step gate runs it on every batch; a second copy fails and names both files.
- `packages/docs/**` is gitignored: it is a source of material, never a home.
  Move the conclusion into a tracked document before citing it.

### Adding a fact to the registry

1. Pick the home document that a reader would already open for that subject.
2. Add the entry: `id`, `title`, `home` (tree-relative), `must` (the exact
   sentence, copied from the home), `forbid` (the drifted claim, with its reason),
   `cites` (the documents that must now point at the home), and `machine` when a
   file owns the value.
3. Make the home say it, make the other documents cite it — do not copy.
4. `node packages/scripts/verify-doc-facts.mjs packages --strict` must be 0, and
   the gate's step 5 must stay green.

## Adding a new surface (G6)

Package, preset base, subcommand, event, session consumer, architecture rule:
each has a copyable skeleton and a checklist whose steps name the guard that
fails when the step is skipped — see
[`packages/scripts/checklists/index.md`](./packages/scripts/checklists/index.md).
A step without a guard is not a step: if nothing fails, say it in prose instead
of pretending it is checked.

## The gate

Run from the two trees (never reorder or rename these steps):

| # | Command | Working tree |
|---|---|---|
| 1 | `node node_modules/typescript/lib/tsc.js -b tsconfig.host.json` | overlay |
| 2 | `node node_modules/oxlint/bin/oxlint packages/evolution` | overlay |
| 3 | `node node_modules/vitest/vitest.mjs run packages/evolution --maxWorkers=2 --testTimeout=30000` | overlay |
| 4 | `node packages/evolution/scripts/build-lib.mjs` | overlay |
| 5 | `node packages/evolution/scripts/smoke-built-entries.mjs packages/evolution` | overlay |
| 6 | `node packages/scripts/verify-dependency-closure.mjs packages --strict` | mirror |
| 7 | `node packages/scripts/verify-arch-guards.mjs packages --strict` | mirror |
| 8 | `node packages/scripts/verify-event-pairing.mjs packages --strict` | mirror |
| 9 | `node packages/scripts/verify-declared-config.mjs packages --strict` | mirror |
| 10 | `node packages/scripts/verify-param-registry.mjs packages --strict` | mirror |
| 11 | `node packages/scripts/verify-bundle-rows.mjs packages --strict` | mirror |
| 12 | `node packages/scripts/verify-param-channel-parity.mjs packages --strict` | mirror |
| 13 | `node D:/dsh/audit-v37/check-tsconfigs.cjs` | machine-local (outside this repo) |
| 14 | `node D:/dsh/audit-v37/check-manifests.cjs` | machine-local (outside this repo) |
| 15 | `node D:/dsh/audit-v37/mirror-sync.mjs check` | `D:/dsh` (machine-local) |
| 16 | `node packages/scripts/verify-profile-bundles.mjs` | mirror |
| 17 | `node packages/scripts/verify-doc-facts.mjs packages --strict --require-repo-docs` | mirror |
| 18 | `node packages/scripts/verify-platform-contract.mjs packages --upstream D:/dsh/dsh-upstream-0.1.5-rc.2` | mirror |
| 19 | `node packages/scripts/verify-package-discovery.mjs packages --strict` | mirror |
| 20 | `node packages/scripts/verify-family-tool-names.mjs packages --strict` | mirror |
| 21 | `node packages/scripts/verify-skill-roots.mjs packages --strict` | mirror |

The canonical runner is `node D:/dsh/audit-v42/run-baseline.mjs <prefix>` (it
writes one log per step plus a summary, and prints the step names it ran, so a
drift between this table and the executed set is visible in every gate log).

Steps 13-15 live **outside this repository** and are machine-local: tsconfig
registration, manifest version uniformity and mirror↔overlay parity. Each row
names its absolute path precisely because these three are NOT shipped guards
(citing a bare script name here would claim a guard the repository does not
have). They are part of the executed gate because no in-repo script covers those
three checks today; a portable replacement belongs in `packages/scripts` if the
workspace is ever used from another machine.

`verify-layout-sync.mjs` is **retired from this table** but NOT from the
release path: the publish chain still executes it as its step 2 version guard,
comparing `packages/scripts/**` against the stale checkout's copy — a drifted
script pair ABORTS the release before any commit or tag (0.3.83 hit exactly
that: 58 drifted files, fixed by copying the mirror's scripts over the stale
side). Its other half, the dev→mirror robocopy, is gone with the dual-line
workflow (running it would overwrite this tree).

The stale tree is `D:/dsh/deepseek-harness` (a platform checkout at `548aa30`
whose `packages/evolution/*` predates this mirror). It carries an
`AUTHORING-MOVED.md` marker at its root pointing here, and the drift between the
two trees is measurable at any time with a **machine-local, warn-only** probe:
`node D:/dsh/audit-v44/two-tree-drift.mjs` (per-package file hashes; it never
exits non-zero). It is deliberately NOT a shipped guard — an in-repo script
cannot assume a second tree exists — which is the same reason rows 8-10 above
name absolute paths.

`verify-doc-facts.mjs` runs standalone for the same check rule N19 makes, and
`verify-platform-contract.mjs --upstream <tree>` audits the platform anchors
(its failures are recorded platform drift, not family drift).

### House rules

- Rule ids are **append-only**: docs and registers cite them, so a landed id is
  never reused or renumbered.
- Scripts under `packages/scripts/` are outside oxlint: their correctness is
  proven by fixtures in `packages/evolution-host/tests/guard-scripts.spec.ts`.
- A new gate lands in warn mode for one release before `--strict` is wired.
- No corpse, no rule: every guard names the incident it exists for.
