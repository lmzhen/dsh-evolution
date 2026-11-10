# Install (single product)

This file is the canonical statement of the product install surface. The root [INSTALL.md](../INSTALL.md) owns commands and operational details.

## Upgrade runbook (platform first)

1. Upgrade the platform first.
2. Upgrade the family bundle.
3. Publish/verify the release artifacts; never publish before the gates. The publish step is last.

## Product forms

| Form | Package | What it does |
|---|---|---|
| All (default) | `dsh-evolution-all` | Every session gets the family model tools and UI. Use this unless you have a specific advanced reason not to. |
| Host (advanced) | `dsh-evolution-host` | Infrastructure only; no memory/skill model rows. For custom compositions, not the default. |

`all` is the only product installation. Partial capability is a row switch in the Plugins page, not a second install form.

## Internal composition (not product choices)

`dsh-evolution-preset` is a migration-only compatibility bundle and is no longer published. The layered form (`host` + generated Evolution preset) remains an internal/dev installer path for sessions that must opt in through an agent preset; it is not a product install choice and must not appear in user docs.

The three historical bundles share infrastructure rows; mounting two double-registers services and the loader fails loud. Shrinking a product install means disabling rows or uninstalling `all`; the layered path is exclusive with `all` because its model rows would double-mount.

## Validation status

Validated line: **DSH 0.2.2-rc.1**.

| Surface | Status | Basis |
|---|---|---|
| all | verified | packed install + web host + desktop smoke in the release gate |
| host | verified | source installer/lab and packed smoke |
| preset/layered | internal only | migration/dev path; not a product claim |

## Known differences

- Under variant, `/evolution` commands remain visible globally; automatic behavior is session-gated.
- `skill-health` is disabled in the `all` bundle by default.
- `merge/run` and `merge/runs` paths are declared but not implemented.
- `reviewProvider`, `reviewContextMessages`, `reviewMessageChars`, `reviewMaxDepth`, and `reviewToolAllow` appear in the generated parameter table/bundle metadata but are not read by the review plugin. Do not rely on them for provider selection, context limits, delegation depth, or tool restrictions. `reviewTimeoutMs` is implemented.
- The local `evolution-io-node` backend guarantees same-path serialization only within one process. Cross-process read-modify-write over a shared home requires the platform `ctx.fs` provider; the Node backend alone is not a cross-process lock.

## Command fallbacks

Fallbacks cover `approval`, `skill-history`, `skill-health`, `merge`, `diagnostics`, and `settings`; examples include `/evolution pending`, `/evolution restore`, `/evolution skills`, `/evolution merge`, `/evolution doctor`, and `/evolution policy` (`/evolution policy set <id> <value>`). The generated table lives in evolution-client-kit; if a fallback names a retired command, treat it as a documentation defect.

Preset bases and preconditions are single-sourced in [evolution-agent/README.md](evolution-agent/README.md).

## Installer flags

`install-layered.mjs` accepts: `--mode`, `--profile`, `--base`, `--home`, `--dry-run`, `--force`, `--check-presets`, `--uninstall`, `--help`.

`--mode all` is the product install; `--mode host` is the advanced infrastructure plane. `--base` is repeatable; `--dry-run` reports changes without writing. Legacy agent/layered/oneclick values remain migration-only and are not product choices.

## Merge control axes

The merge control model has three axes: merge-specific approval, host write capability, and the model path required by scan. The documentation and UI use `mergeApproval`, `platformWrite` for the first two, but they are not one switch. In the merge package, `platformWrite` is accepted as a fallback parameter and is overridden by the host approval capability when available. It is projected into run reports and snapshots rather than used as an admission check; host capability preparation is the actual write precondition. `mergeModelsRoot` applies to scan. Ordinary pair does not use that local screening dependency, but still requires the child-session model channel.
