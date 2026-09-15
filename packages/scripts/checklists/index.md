# New-surface checklists (G6, 0.3.78)

Adding a package, a base, a command, an event, a consumer or an architecture
rule is the same shape every time — and every one of them has a gate that fails
when a step is skipped. Copy the skeleton, walk the checklist, then run the gate
column. The rule for these files: **a step without a guard is not a step** — if
you cannot name what fails, the step belongs in prose elsewhere.

| Surface | Checklist | Skeleton | Guards that fail on a skipped step |
|---|---|---|---|
| New package | [new-package.md](./new-package.md) | `templates/package/package.json.tmpl`, `templates/package/src-index.ts.tmpl`, `templates/package/README.tmpl.md` | `verify-dependency-closure.mjs`, `verify-arch-guards.mjs` (N1/N3/N5/N7/N8), `verify-layout-sync.mjs`, `tsc -b`, `oxlint` |
| New preset base | [new-base.md](./new-base.md) | `templates/base/bases-row.json.tmpl` | `installer-preset-base.spec.ts`, `verify-doc-facts.mjs` (N19 `preset-bases`), `installer.spec.ts` |
| New `/evolution` subcommand | [new-command.md](./new-command.md) | `templates/command/registry-row.ts.tmpl` | `registry.spec.ts` (T-WD2 pins the rendered table), `oxlint`, `tsc -b` |
| New family event | [new-event.md](./new-event.md) | `templates/event/producer-consumer.ts.tmpl` | `verify-event-pairing.mjs`, `verify-arch-guards.mjs` (N12/N17) |
| New session consumer | [new-consumer.md](./new-consumer.md) | `templates/event/producer-consumer.ts.tmpl` | `verify-arch-guards.mjs` (N14/N16/N18), `verify-event-pairing.mjs` |
| New architecture rule | [new-arch-rule.md](./new-arch-rule.md) | `templates/rule/rule-snippet.mjs.tmpl` | `verify-arch-guards.mjs` startup self-test + `--list-rules` inventory, `guard-scripts.spec.ts` |

Two more places where an addition lands, whatever the surface:

- **The mirror is the source.** Edit `packages/...` here, then run the
  workspace's dev-tree sync (the `sync-dev-to-mirror` / `sync-mirror-to-dev`
  helpers) and confirm a zero-diff check before publishing.
- **A new fact means a new registry entry**, not a second explanation:
  `packages/scripts/family-facts.json` (see [CONTRIBUTING.md](../../../CONTRIBUTING.md)
  §Where a fact is allowed to live).
