> ⚠ 2026-10-15 清理：本文引用的 `D:\dsh` 下若干取证/暂存目录已移出（`D:\dsh-trash-20261015\` 可原样搬回；upstream checkout 只保留 `dsh-upstream-0.2.0-rc.2`，其余按 tag 重新 clone 即可）。文内路径已就地标注。
---
name: dsh-mcp-wiring
description: Wire MCP servers and skills into DSH profiles.
version: 0.2.0
author: Hermes
metadata:
  hermes:
    tags: [DSH, MCP, Configuration, Integration]
    related_skills: [dsh-plugin-discovery, dsh-skill-install, dsh-ptc-brace-prompt-failure]
---

# DSH MCP & Skill Wiring

Add an MCP server or an agent skill to a DeepSeek Harness profile and prove it
loaded. It does NOT install the upstream tool, judge whether that tool is worth
adopting, or touch another profile. Both wires are plain files under `$DSH_HOME`.

## When to Use

- "把这个 MCP 接到 dsh" / "给 dsh 用" after a tool has been chosen.
- A tool ships its own MCP server or SKILL.md and needs a DSH home.
- An existing MCP row stopped working and needs to be re-checked.

## Prerequisites

- The chooser step is done (see `dsh-plugin-discovery`): check `archived`,
  `pushed_at`, commits in the last 90 days, and licence BEFORE wiring.
- Know which transports the tool offers (stdio command, or an HTTP endpoint).
- **Pre-flight for PTC profiles**: dump the tool descriptions of the server you
  are about to wire and look for `{{`. A malformed `{{...}}` group in any visible
  tool description fails EVERY request at prompt-assembly time
  (`malformed prompt variable reference "{{...}}" in section "tools:sdk"`).
  Diagnosis and fix layers: skill `dsh-ptc-brace-prompt-failure`.
  Machine check: `scripts/mcp-description-brace-probe.js` spawns any stdio MCP server,
  runs `initialize` + `tools/list`, and prints per-tool `{{` counts (exit 1 if any) —
  count braces in the **tool descriptions/schemas**, never over the whole binary.

## How to Run

1. Read the profile patch file, then append ONE `- insert:` block.
2. Nothing else — the include file is watched, so the row hot-mounts.
3. Verify the row parsed, then verify the tools answer.
4. (Skills only) drop the SKILL.md into the skills home and reload.

## Quick Reference

| Wire | Home | Shape |
|---|---|---|
| MCP server | `~/.dsh/profiles/<profile>/cordis.patch.yml` | `- insert:` block holding rows with `name: '@deepseek-ai/dsh-mcp-client'` |
| Agent skill | `~/.dsh/skills/<name>/SKILL.md` | directory per skill, YAML frontmatter + body |

**The patch file is a PATCH LIST, not an entry list.** A bare `- id: x` means
"override entry x"; for a NEW id that reads as *entry not found* and is
**silently skipped**. New rows must be wrapped:

```yaml
- insert:
    - id: mcp-12306                 # stdio
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: train12306      # ← drives the tool prefix
        transport: stdio
        command: npx
        args: [ '-y', '12306-mcp' ]
    - id: mcp-amap                  # remote
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: amap
        transport: streamable-http
        url: 'https://mcp.amap.com/mcp?key=...'
```

**Tool naming**: `mcp__<serverName>__<tool>` — the prefix comes from the row's
`serverName` config field, NOT from the row id and NOT from the server's
self-reported `serverInfo.name` (row id `mcp-12306` + `serverName: train12306`
surfaces as `mcp__train12306__*`).

## Procedure

1. Read the patch file first and find the existing MCP block; append a new
   `- insert:` block — never rewrite other rows, they share the file.
2. Prefer `stdio` + an **absolute binary path** for local tools (PATH differs
   under the host process); use `streamable-http` only for a real endpoint.
3. **Do not invent the args.** If the vendor documents only per-client presets
   (e.g. `foo mcp claude|cursor`), run the preset once and copy the exact
   `command`/`args` it wrote, or read `foo mcp --help`.
4. **Pre-flight the descriptions** (Prerequisites) when the profile runs PTC.
5. Keep a rollback: the house pattern is
   `cordis.patch.yml.bak-before-<change>-<stamp>`.
6. Verify (no restart needed for this file — it is watched):
   ```bash
   cmd /c "dsh.cmd --profile <p> --dump-config" | Select-String 'mcp-<id>'
   ```
   A restart IS required for plugin-package rows (adding a package, not a
   config-only row).
7. For a skill: `~/.dsh/skills/<name>/SKILL.md`. Vendor SKILL.md files drop in
   unchanged; the skill catalog re-reads on the next session.

## Desktop profile (Electron plane)

The desktop app runs its own host on a different port (19387 vs the Web plane's
3080) and owns `~/.dsh/profiles/desktop`. Install packages with the
desktop-bundled CLI only — the npm-global `dsh` refuses that profile:

```bash
# <install-root>\resources\runtime\cli\bin\dsh.cmd
# The install root MOVES: this machine kept it at %LOCALAPPDATA%\Programs\... until 2026-10-10,
# then relocated to D:\Apps\DeepSeekHarness (NSIS /S /D=<path>). Resolve it from the running
# host's command line or the desktop shortcut instead of hardcoding it.
& "D:\Apps\DeepSeekHarness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add <spec>
```

- MCP rows go into `~/.dsh/profiles/desktop/cordis.patch.yml` as `- insert:`
  blocks, exactly as on the Web plane. A patch row keyed by an existing id
  (`- id: ui-git-graph` + `disabled: true`) is the supported way to switch a
  plugin-package row off without uninstalling it.
- **Which plane am I in?** Three checks: (1) walk the shell's `ParentProcessId` chain up to the host — `DeepSeek Harness.exe … dsh-desktop-host … <home>\profiles\desktop` vs `node …/dsh lib/bin.js web`; (2) the MCP tool names this session sees (the two planes carry different rows); (3) the port (19387 vs 3080). Window titles do not distinguish them.
- **The home layer is LIVE.** Composition order: bundle patches → `<home>/profiles/<p>/cordis.patch.yml` → `<home>/cordis.patch.yml` (**applies to every profile, higher priority**; `apps/cli/src/profile-boot.ts:68`) → `--patch` overlays. A row whose id exists in both profiles changes **both** planes; a row whose id is missing is **silently skipped** — a shared file can look inert today and bite tomorrow.
- Cross-plane mechanics, shared-directory hazards and the two-room maintenance rules: skill `dsh-two-plane-maintenance`.
- **A process started from a tool command dies with that command's process
  tree.** Observed 2026-10-09: a `Start-Process`-launched local MCP service
  opened its port and was gone seconds later, with nothing in its own log.
  Register a scheduled task instead (`Register-ScheduledTask` +
  `Start-ScheduledTask`); both the local Xiaohongshu service and the desktop
  app itself stay alive that way.
- Verify a row end to end inside a desktop session (ask the model to call the
  tool): that is the only check that covers stdio and streamable-http rows
  alike. Side evidence — the desktop host spawns its own stdio children
  (`officecli.exe mcp`, `cmd /c npx -y 12306-mcp`) whose parent PID differs
  from the Web host's.
- A blank first paint is not a wiring failure: press Ctrl+R once. A blank
  content area that survives the reload (sidebar renders, content stays white)
  is a client-plugin defect — bisect by disabling the suspect row in the
  profile patch.

Mirroring a whole row set from one plane to the other (plugin packages, MCP rows, bundles) is
covered by skill `dsh-two-plane-maintenance` — its "Mirroring one plane to the other" section owns the
order (global package last), the aggregate-removal closure audit, and the pre-restart resolvability gate.

## Pitfalls

- **换掉本地 MCP 二进制后，旧子进程会「坏一半」（2026-10-10 实测）。** stdio MCP 子进程长存：exe 在磁盘上被换成新构建后，老进程仍映射着旧镜像，.NET 单文件发布里**惰性加载**的程序集就再也读不到。症状极具误导性——`help`、`--version`、任何不碰 XML 的命令正常，一做文档操作就报
  `Unhandled exception: System.IO.FileNotFoundException: File name: 'System.Private.Xml, Version=10.0.0.0'`。
  **修法：杀掉那个子进程就行，客户端会自动重拉当前二进制**（桌面宿主与 Web 宿主两条都实测自动重拉：`ParentProcessId` 不变、`CreationDate` 变新），不必重启 dsh，也不必改任何配置。
  **但重拉前必须先验部署的二进制没丢 PTC 补丁** —— 2026-10-10 实测：fork 在 09:27 被重建成未打 braces 补丁的 v1.0.156，我杀掉子进程让它重拉，结果**两个平面（npm/web 与桌面）的 PTC 会话从 09:52:31 起全线报 `malformed prompt variable reference "{{...}}" in section "tools:sdk"`**（会话日志 turn/end 时间戳 = 重拉后 3 秒）。先跑这一步，`-1` 才敢杀：

  ```powershell
  $req = @('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}','{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}','{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}')
  (($req | & <exe> mcp | Where-Object { $_ -match '"id"\s*:\s*2' } | ConvertFrom-Json).result.tools[0].description).IndexOf('{{')
  ```
  详见 skill `dsh-ptc-brace-prompt-failure`。
  判定法：同一份文件、同一个操作，在新进程 CLI 与 MCP 通道各跑一次 —— 一成一败即坐实是子进程陈旧，不是二进制或通道坏。
- **A stdio MCP child writes stderr to the DSH host console — freeze that console and the child deadlocks (measured 2026-09-28).**
  The plugin passes no `stderr` to `StdioClientTransport`, whose default is `'inherit'` (MCP SDK 1.30.0
  `dist/esm/client/stdio.js:71`; plugin `lib/index.js:42`), so the child inherits the console `dsh web` was started from. A
  console in QuickEdit selection mode (window title prefixed `选择 `/`Select `) pauses its output, so the child's next WARNING+
  `write()` blocks **while Python holds the module-global logging handler lock** — every later log call in that child queues
  forever and its tools never return, until the client's `DEFAULT_TOOL_CALL_TIMEOUT_MS = 6e4` fires as
  `MCP error -32001: Request timed out`. Diagnosis: `uvx py-spy dump --pid <child pid>` shows threads parked in
  `logging\__init__.py` `emit`/`acquire`, while a tool that never logs (e.g. `DisplayInventory`) still answers in ms.
  Fix now: click once inside that console (or Esc). Fix durably: give the child a file instead of the console —
  `command: cmd`, `args: [ '/c', '<real command> ... 2>> %TEMP%\<name>.err' ]`. Full case with stacks:
  `〈已清理 2026-10-15：_winmcp-audit〉\归因-windows-mcp超时.md` (that particular row is retired as of 2026-10-13 —
  desktop control moved to the platform Cua line, skill `windows-computer-use` — but the trap is
  about the MCP transport, so it still applies to every stdio MCP child still mounted).
- **Vendor auto-install does not know DSH.** Tools that "install their skill
  into every agent they detect" only detect Claude Code / Cursor / Copilot /
  Codex / LM Studio — DSH needs the manual drop (or, if the vendor knows DSH,
  e.g. `officecli skills install <name> dsh`, just run it).
- **PTC + braces = dead profile.** See Prerequisites; the failure is
  per-request, and it takes down sessions that never call the tool.
- **Chinese output through the console mangles.** Write results to a UTF-8 file
  and read the file back; do not trust PowerShell stdout for CJK.
- **Quoting in probe scripts.** Avoid backticks in inline scripts and nested
  `jq` under `cmd /c` — both silently return empty and look like "no results".
- `dsh` resolves to `dsh.ps1` and is blocked by execution policy on this host:
  call `cmd /c "dsh.cmd ..."`.
- Namespace collisions: two rows must not share an `id`; the loader is
  fail-loud at startup.
- **Editing the profile patch file is YAML surgery on a LIVE config.** Long CJK
  comment lines can get split when written through a shell, and a stray bare line
  made the WHOLE patch list unparseable once (observed: `--dump-config` dropped to
  0 MCP rows). After every edit, re-run `--dump-config` and count the rows.

## Verification

- `--dump-config` shows the new row (and its configured `serverName`).
- A tool call from a fresh session returns real data, and `mcp__<serverName>__*`
  names match the vendor's documented commands.
- For a skill: it appears in the session skill catalog.
- Rollback proven: restore the `.bak` file and the row is gone.

## Local instance: OfficeCLI (installed 2026-09-22)

- Binary **实际在用的是 fork**：`D:\claw\_tools\officecli\fork\officecli.exe`（v1.0.156，2026-10-10 重建；同目录留
  `officecli.exe.old`、`officecli.exe.unpatched-20261008.bak` 作回滚）。官方原版
  `D:\claw\_tools\officecli\officecli.exe`（v1.0.152，win-x64，SHA256
  checked against the release's SHA256SUMS）与源码 sparse clone
  `D:\claw\_tools\officecli-src` 保留作对照。
- MCP: `transport: stdio`, `command: <that exe>`, `args: [ 'mcp' ]`,
  `serverName: officecli` → single tool `mcp__officecli__officecli` whose only
  parameter is `command` (a CLI command line; add `--json` for structured
  output). In-process execution ≈0.9 s/call vs 1.8–3.6 s for a cold CLI process.
- **Enabled via a local fork** (2026-09-22). Upstream's description carried a literal
  `{{...}}`, which failed every PTC request at prompt assembly; the local build
  (source `ffa8a0a` + commit `41c3d6a`, `McpSafeText()` breaks `{{` pairs) fixes it.
  Acceptance: PTC + official = error, PTC + fork = OK, live tool call returns the
  version. Rebuild/rollback: `D:\claw\_tools\officecli\FORK-说明.md`.
- Skill: `officecli skills install word dsh` → `~/.dsh/skills/officecli-docx`.
- Full analysis (four integration forms + measurements):
  `D:\claw\_tools\officecli\DSH-接入形式分析.md`.
