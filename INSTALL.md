# Installing dsh-evolution

Four install forms. `dsh-evolution-all` is the default; the other three are alternatives. **Never mount two forms in one profile**: they share infrastructure rows and the loader fails on duplicate ids.

| Form | Bundle / preset | Model tools | Notes |
|---|---|---|---|
| All (default) | `dsh-evolution-all` | profile-wide | complete surface; no preset step |
| Host + agent preset | `dsh-evolution-host` + Evolution preset | only sessions on the preset | per-session tools; exclusive with all/preset |
| One-click | `dsh-evolution-preset` | profile-wide | compatibility form; no settings/health rows |
| Agent only | Evolution preset | only sessions on the preset | requires the host bundle or agent packages |

The canonical per-form semantics live in [packages/INSTALL.md](packages/INSTALL.md#install-forms). This file owns the commands and operational details.

## Production install

Community packages publish under `@lmzhen`; they are not official DeepSeek releases.

```bash
dsh plugin --profile web add @lmzhen/dsh-evolution-all
# restart dsh, then:
/evolution doctor
```

To shrink to infrastructure only:

```bash
dsh plugin --profile web remove @lmzhen/dsh-evolution-all
dsh plugin --profile web add @lmzhen/dsh-evolution-host
```

Compatibility one-click form:

```bash
dsh plugin --profile web add @lmzhen/dsh-evolution-preset
```

Inside a source/overlay checkout the same packages use `@deepseek-ai`; those names do not resolve from npm.

## Install-form semantics

**② attach** — full (`all`) or one-click (`preset`) — where every session, including a session on a platform original preset, carries the family model rows. **① variant** — layered (`host` + the generated Evolution preset, `--mode variant`) — where the model rows exist only inside the family preset; a session on an original preset gets no family behaviour (see the single-source statement in packages/INSTALL.md). Under ① variant the `/evolution` command face still appears globally; automatic paths are gated by `sessionAudited`.

`host` alone is a third case: background automation only, no `memory` / `skill_manage` tools. The read-only `maintenance_probe` and the merge-child `merge_stage` remain.

## Prerequisites

- Validated platform line: **DSH `0.2.1-rc.3`**. Published `@deepseek-ai/dsh-*` ranges declare `^0.2.1-rc.2`.
- Node 22.19+ or 24+.
- A profile that can resolve the published bundle, or a source checkout for the local installer.

## Source-checkout layered install

```bash
node packages/scripts/install-layered.mjs --profile web --mode layered --home "$DSH_HOME"
```

This copies the family packages into the profile and writes one `- insert:` preset row into the profile patch. Omit `--home` to use `$DSH_HOME` or `~/.dsh`.

## Upgrade runbook (platform first)

1. Read `CHANGELOG.md` for the target version.
2. Back up `$DSH_HOME`.
3. Upgrade the platform and restart; verify the host boots.
4. Upgrade the family bundle (or uninstall + install to avoid stale rows).
5. Restart and run `/evolution doctor`.
6. Do one memory write and one skill write; verify approval/rollback if enabled.

Do not upgrade the family before the platform: the peers/engines window is tied to the platform line.

## Verify

```bash
dsh --profile web --dump-config | grep -c "id: evolution-"
/evolution doctor
```

Expect the rows for your chosen form and a doctor report naming the install form, platform line, family version, services, and runtime rows. A host-only install intentionally reports no memory/skill tools.

## Command fallbacks

When a route or service is missing, the UI and commands fall back to copyable commands. The canonical table is in `packages/INSTALL.md`; the fallback text is generated into `evolution-client-kit`. If a fallback names a command that no longer exists, treat it as a documentation defect, not a supported path.

## Uninstall

```bash
dsh plugin --profile web remove @lmzhen/dsh-evolution-all
```

Uninstall removes the rows; data under `$DSH_HOME` (memories, skills, state, reports, approval history) remains. Reinstall picks it up again.

## Troubleshooting quick reference

- Command missing: `commands` service or the commands row is absent.
- Tool missing: check the install form; host has no memory/skill tools.
- Route 404: `connection` service missing or the row disabled.
- Publish/install mismatch: check `/evolution doctor` family version and `npm view @lmzhen/dsh-evolution-all version`.
