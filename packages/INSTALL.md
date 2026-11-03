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
- `reviewToolAllow` appears in bundle YAML but is not read by the review plugin.

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

The merge settings are three axes, not one switch: approval, platform-write capability, and the local model root. The two booleans are `mergeApproval`, `platformWrite`; the model root is `mergeModelsRoot`.
