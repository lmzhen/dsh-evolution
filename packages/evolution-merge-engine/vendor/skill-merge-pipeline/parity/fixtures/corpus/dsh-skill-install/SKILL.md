> ⚠ 2026-10-15 清理：本文引用的 `D:\dsh` 下若干取证/暂存目录已移出（`D:\dsh-trash-20261015\` 可原样搬回；upstream checkout 只保留 `dsh-upstream-0.2.0-rc.2`，其余按 tag 重新 clone 即可）。文内路径已就地标注。
---
name: dsh-skill-install
description: Install third-party agent skills into DeepSeek Harness.
version: 0.1.0
author: Hermes
metadata:
  hermes:
    tags: [DeepSeek Harness, Skills, Installation]
    related_skills: [dsh-plugin-discovery]
---

# Installing Third-Party Skills into DSH

DSH has no skill-install command. Skills are discovered from fixed filesystem roots: any directory bundle (`<name>/SKILL.md`) or flat `<name>.md` with valid frontmatter becomes a skill. This covers the verified roots, the frontmatter rules, porting foreign formats (Claude Code `.claude-plugin`, OpenClaw), and a live verification. It does NOT cover npm plugin installation — that is `dsh plugin --profile <p> add <package>`.

## When to Use

- "Can DSH install <GitHub skill repo>?" / "Where does a SKILL.md go?"
- A third-party skill does not appear in the catalog.
- Porting a Claude Code or OpenClaw skill into DSH.

## Prerequisites

- DSH source for the claims below: `〈已清理 2026-10-15：dsh-upstream-0.1.5-rc.2〉` (not the npm package — its `lib/` is bundled).
- `$DSH_HOME` (default `~/.dsh`); on this machine `C:\Users\limengzhen\.dsh`.
- No install step and no restart: a chokidar watcher (stability 200 ms) refreshes the catalog.

## How to Run

1. Put the skill directory under a scanned root — simplest is `$DSH_HOME/skills/<name>/`.
2. Check frontmatter: `name` + `description` are mandatory.
3. Verify live with the `skill` tool (see Verification).
4. Install any runtime the body calls for; a SKILL.md never installs its own dependencies.

## Quick Reference

Scanned roots, from `packages/skill/skill-filesystem/src/index.ts:241-261` (lower rank wins):

| rank | root | source |
|---|---|---|
| 100 | `<project>/.dsh/skills` | project-dsh |
| 200 | `<project>/.agents/skills` | project-agents |
| 300 | `customSkillDirs` (plugin config) | custom |
| 400 | `$DSH_HOME/skills` | user-dsh |
| 500 | `~/.agents/skills` (`$DSH_AGENTS_HOME`) | user-agents |
| bundled | `$DSH_BUNDLED_SKILL_DIR` | platform/preset |

Frontmatter, from `parseSkillFile` (`skill-filesystem/src/index.ts:793-835`):

- Required: `name`, `description`. Optional: `whenToUse`, `invocation`, `metadata`.
- `name` must match `/^[a-z0-9]+(?:-[a-z0-9]+)*$/` (`packages/skill/skill/src/index.ts:21`).
- Unknown keys are ignored. A malformed `invocation` discards the whole skill.
- `skill_manage` (not the loader) enforces the write limits: name ≤64, description ≤1024 chars (`packages/evolution/evolution-core/src/constants.ts:76`).

## Procedure

1. Locate the skill inside the foreign repo. Claude Code plugins keep bodies at `skills/<name>/SKILL.md`; only that directory matters.
2. Copy it into the user root:

```powershell
Copy-Item -Recurse "<repo>\skills\<name>" "$env:USERPROFILE\.dsh\skills\<name>"
```

3. Do NOT expect DSH to read `.claude-plugin/marketplace.json` or `plugin.json`: `claude-plugin` and `marketplace.json` have zero matches in `packages/**/*.ts` and `docs/**/*.md`.
4. Convert frontmatter only when it fails the rules in Quick Reference; translation of Claude/OpenClaw keys (`display_name`, `homepage`, `metadata.agent`, `metadata.openclaw`) is unnecessary — they are ignored.
5. Keep supporting files beside the body (`references/`, `scripts/`, `templates/`, `assets/`) — `SUPPORT_DIRS` in `evolution-core/src/constants.ts:63`; the loader resolves `resourceBase` to the skill directory.
6. Install the runtime the body instructs (for example `npm i -g @fly-ai/flyai-cli` for `alibaba-flyai/flyai-skill`) with the `pwsh` tool; the body alone does nothing.

## Recovery: archive, history, backups

A skill removed through `skill_manage action=delete` is **archived, not erased**. Four restore layers sit under the skills home (`~/.dsh/skills`, shared by every DSH profile):

| Layer | Where | Restores |
|---|---|---|
| Archive | `.archive/<name>/` (full tree + `.archive-name` + `.archive-reason`, e.g. `…: Archived by self-evolution curator`) | the whole skill — copy the directory back to `skills/<name>/` and delete the two `.archive-*` markers |
| History | `.history/skills/<name>/index.json` + `.history/blobs/` | earlier **versions** of one skill (roll back a bad patch) |
| Backups | `.backups/skills-<ISO timestamp>/` | the whole skills tree at a point in time |
| Off-disk | the user's own backup directories | everything, including `.archive` |

- Only `skill_manage` deletions reach `.archive`; a manual `rm -rf` leaves nothing there — look in `.backups` or the off-disk copies instead.
- A `.pinned` marker (0 bytes, in the skill directory) allows **foreground** and delegated patches but refuses the background review/curator — so a pinned skill silently stops being maintained or archived (that is how a stale path can survive for months). `skill_manage action=unpin` removes it; `action=pin` restores it.

## Pitfalls

- `dsh --help` exposes only `web` and `plugin`; there is no `dsh skill add`. `dsh plugin` forwards to pnpm in the profile directory, so it installs npm packages, never GitHub skill repos.
- In the web profile the host `skill-filesystem` row is `disabled: true` (`packages/bundle/web-app/cordis.patch.yml:393-406`); presets own local discovery. Prefer the user root over re-enabling that row.
- Editing `customSkillDirs` means overriding a plugin row in `cordis.patch.yml` (a patch list — new rows need `- insert:`). Treat it as a config change, not a file copy.
- A skill that names a CLI does not bundle it; missing binaries surface as tool errors, not load errors.
- Malformed YAML frontmatter is dropped silently apart from a host log line "skill file … ignored".

## Verification

Write a throwaway skill, read it back through the `skill` tool, then delete it:

```
write  $DSH_HOME/skills/zz-probe/SKILL.md:
---
name: zz-probe
description: Temporary probe skill.
---
# Probe
skill  { name: "zz-probe" }      -> expect provider=filesystem and resourceBase = that directory
pwsh   Remove-Item -Recurse -Force $DSH_HOME/skills/zz-probe
```

Success = the `skill` call returns the body in the same session (hot reload, no restart).
