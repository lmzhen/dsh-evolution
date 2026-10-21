---
name: inkos-harness
description: Operate and maintain the local InkOS novel-writing harness.
---

# InkOS Novel-Writing Harness (local)

## What it is

- CLI: `inkos`, from global npm package `@actalk/inkos` (AGPL-3.0, source: https://github.com/Narcooo/inkos).
- Multi-agent novel production: Writer → Validator → Auditor → Reviser with human review gates. Supports long-form fiction, shorts, fanfic, continuations, covers, interactive worlds, translation, AUDIT/revise pipelines.
- Companion packages: `@actalk/inkos-core`, `@actalk/inkos-studio`; total install is large (~485 MB for @actalk/inkos alone).

## Key locations (Windows/Git Bash)

| Item | Path |
|---|---|
| Global npm package | `C:\Users\<user>\AppData\Roaming\npm\node_modules\@actalk\inkos` |
| CLI shim | `C:\Users\<user>\AppData\Roaming\npm\inkos.cmd` |
| Global LLM config | `~/.inkos/.env` — `INKOS_LLM_PROVIDER/BASE_URL/API_KEY/MODEL` |
| Codemoss skill link | `~/.codemoss/skills/global/inkos-multi-agent-novel-writing` → `~/.cc-switch/skills/inkos-multi-agent-novel-writing` |
| Skill source repo | https://github.com/Aradotso/trending-skills, path `skills/inkos-multi-agent-novel-writing/SKILL.md` |
| Project file | `./inkos.json` (created by `inkos init` or auto-initialized by Studio) |

## Quick verification

```bash
inkos --version
inkos doctor          # checks Node >= 20, global config, API connectivity (consumes a few LLM tokens)
```

## Common commands

- `inkos init [name]` — create a project in the current directory (`inkos.json`)
- `inkos studio [-p <port>]` — start the InkOS Studio web workbench (default port 4567)
- `inkos book / chapter / write / review / status / export / audit / revise / plan / compose`
- `inkos auto <book-id> <target-chapter>` — autonomous chapter writing
- `inkos tui` — terminal workspace; `inkos up` / `down` — daemon mode
- `inkos doctor --repair-node-runtime` — write pinned `.nvmrc` / `.node-version`

## Starting Studio reliably

- Run it **from the project directory**. If no `inkos.json` exists in cwd, Studio auto-initializes a minimal project **in the current directory** — in Git Bash, `/tmp` maps to Windows `%TEMP%`, so avoid launching from there unless intentional.
- Detached start:
  ```bash
  cd /path/to/project
  nohup /c/Users/<user>/AppData/Roaming/npm/inkos.cmd studio -p 4567 > /tmp/inkos-studio.log 2>&1 &
  ```
- Verify:
  ```bash
  netstat -ano | grep ":4567"
  curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4567/   # expect 200
  ```
- Log file: `/tmp/inkos-studio.log` (when launched from Git Bash).

## Restore a broken codemoss skill link

Symptom: `~/.cc-switch/skills` vanished, so `~/.codemoss/skills/global/*` symlinks are all BROKEN. Restore just InkOS skill:

```bash
mkdir -p ~/.cc-switch/skills/inkos-multi-agent-novel-writing
curl -fsSL -o ~/.cc-switch/skills/inkos-multi-agent-novel-writing/SKILL.md \
  https://raw.githubusercontent.com/Aradotso/trending-skills/main/skills/inkos-multi-agent-novel-writing/SKILL.md
```

Validate: `ls -la ~/.codemoss/skills/global/inkos-multi-agent-novel-writing/` lists `SKILL.md`.

## Notes

- `inkos doctor` may print `LLM API Key: Missing` while the global config still works (it wants a Studio service key); the `API Connectivity: OK` line is the practical validity test.
- Project-level `.env` / `.nvmrc` missing is expected before `inkos init` completes setup.
- LLM calls consume real tokens; confirm before bulk `auto` / daemon runs.

<!-- keep: references/machine-state.md — dated machine snapshot (2026-08-31: installed @actalk/inkos version,
     masked LLM config, cc-switch/codemoss link inventory, cc-switch SQLite layout). Historical fingerprint
     baseline only; versions and link state drift, so do not read it as current state. -->
