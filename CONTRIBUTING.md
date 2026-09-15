# Contributing to the dsh-evolution family

This repository (the **flat mirror**) is the publication carrier: `packages/*`
are the packages that ship, and the root documents — `README.md`,
`README.zh.md`, `INSTALL.md`, `CHANGELOG.md`, this file — are the user-facing
surface. The CI validation tree is the platform checkout's
`packages/evolution/`, kept byte-identical to `packages/*` by the workspace's
`sync-dev-to-mirror` / `sync-mirror-to-dev` helpers. Edit here, sync, then run
the gate.

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
  10-step gate runs it on every batch; a second copy fails and names both files.
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
| 4 | `node packages/scripts/verify-dependency-closure.mjs packages --strict` | mirror |
| 5 | `node packages/scripts/verify-arch-guards.mjs packages --strict` | mirror |
| 6 | `node packages/scripts/verify-event-pairing.mjs packages --strict` | mirror |
| 7 | `node packages/scripts/verify-declared-config.mjs packages --strict` | mirror |
| 8 | `node packages/scripts/verify-layout-sync.mjs packages --strict` | mirror |
| 9 | `node packages/scripts/verify-profile-bundles.mjs packages --strict` | mirror |
| 10 | `node packages/scripts/verify-doc-facts.mjs packages --strict --require-repo-docs` | mirror |

(The former machine-specific `D:/dsh/audit-v37` helpers — `check-tsconfigs`,
`check-manifests`, `mirror-sync` — are retired from this table: tsconfig
registration is covered by gate 1, manifest version uniformity by the release
script, and the sync discipline by the workspace's own
`sync-dev-to-mirror` / `sync-mirror-to-dev` helpers.)

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
