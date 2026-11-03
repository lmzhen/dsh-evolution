# Install forms (single source)

This file is the canonical statement of what each install form does to a session. The root [INSTALL.md](../INSTALL.md) owns commands and operational details.

## Forms

| Form | Bundle / preset | Model tools |
|---|---|---|
| All (default) | `dsh-evolution-all` | profile-wide |
| Host | `dsh-evolution-host` | only `maintenance_probe` + `merge_stage` |
| One-click | `dsh-evolution-preset` | profile-wide (compatibility) |
| Layered | `host` + Evolution preset | only sessions on the preset |

`all`, `host`, `preset`, and the layered preset are mutually exclusive. The three bundles share infrastructure rows; duplicate ids abort the loader at startup.

## What each form does to a session

**② attach** — full (`all`) or one-click (`preset`) — where every session, including one on a platform original preset, carries the family model rows.

**① variant** — layered (`host` + the generated Evolution preset, `--mode variant`) — where the model rows exist only inside the family preset, so a session on an original preset gets no evolution behaviour at all. `sessionAudited` gates the automatic paths. A session on an original preset still SEES the `/evolution …` commands; this is an accepted, management-only difference.

Host-only is neither attach nor variant: it mounts the infrastructure but no memory/skill model rows. `/evolution doctor` reports `deployment: variant|attach|host-only|preset-only|none`.

## Status against the validated platform line

Validated line: **DSH `0.2.1-rc.3`**. This matrix describes evidence, not expectation:

| Form | Status | Basis |
|---|---|---|
| All | verified on the current release line | packed tarball install + web host + desktop smoke in the release gate |
| Host | verified | source installer/lab and packed smoke |
| One-click preset | source-level judged | row set equals all minus UI/health; not separately installed on this line |
| Layered preset | verified in lab | isolated `DSH_HOME`, profile patch preset row, clean boot |

## Why not mount two

The three bundles insert the same infrastructure rows. Mounting two double-registers the services and the loader fails loud (`already registered`). Shrinking means uninstall then install; the layered preset is also exclusive with all/preset because the model rows would double-mount.

## Known differences

- Under variant, `/evolution` commands remain visible globally; automatic behavior is session-gated.
- `skill-health` is disabled in the `all` bundle by default.
- `merge/run` and `merge/runs` paths are declared but not implemented.
- `reviewProvider`, `reviewContextMessages`, `reviewMessageChars`, `reviewMaxDepth`, and `reviewToolAllow` appear in the generated parameter table/bundle metadata but are not read by the review plugin. Do not rely on them for provider selection, context limits, delegation depth, or tool restrictions. `reviewTimeoutMs` is implemented.
- The local `evolution-io-node` backend guarantees same-path serialization only within one process. Cross-process read-modify-write over a shared home requires the platform `ctx.fs` provider; the Node backend alone is not a cross-process lock.

## Upgrade runbook (platform first)

1. Upgrade the platform first.
2. Upgrade the family bundle.
3. Publish/verify the release artifacts; never publish before the gates.

## Command fallbacks

Fallbacks cover `approval`, `skill-history`, and `diagnostics`; current examples include `/evolution pending`, `/evolution restore`, `/evolution skills`, and `/evolution merge`. The generated table lives in evolution-client-kit; if a fallback names a retired command, treat it as a documentation defect.

Preset bases and preconditions are single-sourced in [evolution-agent/README.md](evolution-agent/README.md).

## Installer flags

`install-layered.mjs` accepts: `--mode`, `--profile`, `--base`, `--home`, `--dry-run`, `--force`, `--check-presets`, `--uninstall`, `--help`.

`--mode` chooses host/agent/layered/oneclick; `--base` is repeatable; `--dry-run` reports changes without writing.

## Merge control axes

The merge control model has three axes: merge-specific approval, host write capability, and the model path required by scan. The documentation and UI use `mergeApproval`, `platformWrite` for the first two, but they are not one switch. In the merge package, `platformWrite` is accepted as a fallback parameter and is overridden by the host approval capability when available. It is projected into run reports and snapshots rather than used as an admission check; host capability preparation is the actual write precondition. `mergeModelsRoot` applies to scan. Ordinary pair does not use that local screening dependency, but still requires the child-session model channel.
