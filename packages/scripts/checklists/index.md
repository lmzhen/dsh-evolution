# New-surface checklists (G6, 0.3.78)

**When to use:** you are adding a new surface to the family — a package, a preset
base, a `/evolution` subcommand, a family event, a session consumer or an
architecture rule. Find your row below and walk that ONE checklist.

Adding any of them is the same shape every time — and each one has a gate that
fails when a step is skipped. Copy the skeleton, walk the checklist, then run the
gate column. The rule for these files: **a step without a guard is not a step** —
if you cannot name what fails, the step belongs in prose elsewhere. The italic
tail of a step names the guard that fails when you skip it.

| I want to add… | Checklist | Skeleton | What fails if I skip a step |
|---|---|---|---|
| a package | [new-package.md](./new-package.md) | `templates/package/package.json.tmpl`, `templates/package/src-index.ts.tmpl`, `templates/package/README.tmpl.md` | `verify-dependency-closure.mjs`, `verify-arch-guards.mjs` (N1/N3/N5/N7/N8), `verify-package-discovery.mjs` (a package the release would publish but the source installer would not accept), `tsc -b`, `oxlint` |
| a preset base (`--base`) | [new-base.md](./new-base.md) | `templates/base/bases-row.json.tmpl` | `installer-preset-base.spec.ts`, `verify-doc-facts.mjs` (N19 `preset-bases`), `installer.spec.ts` |
| a `/evolution` subcommand | [new-command.md](./new-command.md) | `templates/command/registry-row.ts.tmpl` | `registry.spec.ts` (T-WD2 pins the rendered table), `oxlint`, `tsc -b` |
| a family event | [new-event.md](./new-event.md) | `templates/event/producer-consumer.ts.tmpl` | `verify-event-pairing.mjs`, `verify-arch-guards.mjs` (N12/N17) |
| a session consumer | [new-consumer.md](./new-consumer.md) | `templates/event/producer-consumer.ts.tmpl` | `verify-arch-guards.mjs` (N14/N16/N18), `verify-event-pairing.mjs` |
| an architecture rule | [new-arch-rule.md](./new-arch-rule.md) | `templates/rule/rule-snippet.mjs.tmpl` | `verify-arch-guards.mjs` startup self-test + `--list-rules` inventory, `guard-scripts.spec.ts` |

Two more places where an addition lands, whatever the surface:

- **The mirror is the authoring tree** (since 0.3.83): edit `packages/...`
  here, then copy the result into the CI validation tree and run the gate —
  `CONTRIBUTING.md` is the home of that workflow. The `sync-dev-to-mirror` /
  `sync-mirror-to-dev` helpers belong to the retired dual-line workflow; the
  stale side must never be copied back over this one.
- **A new fact means a new registry entry**, not a second explanation:
  `packages/scripts/family-facts.json` (see `CONTRIBUTING.md` §Where a fact is
  allowed to live).
