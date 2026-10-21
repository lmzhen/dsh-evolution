---
name: dsh-ptc-brace-prompt-failure
description: Diagnose PTC prompt assembly crashes from tool braces.
version: 0.1.0
author: Hermes
metadata:
  hermes:
    tags: [DSH, PTC, Prompt, MCP, Diagnosis]
    related_skills: [dsh-plugin-compatibility, dsh-session-forensics, dsh-mcp-wiring]
---

# DSH PTC brace prompt failure

A PTC-mode session (`tools:sdk` prompt section) fails the whole turn when any
visible tool description contains a `{{...}}` group whose body is not a valid
prompt variable name. This skill reproduces it in one headless run, finds every
offending tool in the live catalog, and lists the fix layers. It does not modify
the shipped deployment unless you choose a fix.

## When to Use

- A run fails with `malformed prompt variable reference "{{...}}" in section "tools:sdk"`.
- Any `malformed prompt variable reference` / `unknown prompt variable` error that
  appears only in the `ptc` preset, or only after wiring a new MCP server.
- A newly added MCP server (e.g. officecli) "breaks" sessions while other
  presets stay green.

## Prerequisites

- DSH installed globally; `$env:APPDATA\npm\dsh.cmd` reachable.
- The MCP row you suspect, copied into a temp overlay patch file (never edit the
  profile you are diagnosing first).
- Windows PowerShell 5.1: keep one-off scripts ASCII-only.

## Quick Reference

| Item | Value |
| --- | --- |
| Throwing check | `packages/core/system-prompt/src/index.ts` `interpolate()` / `VARIABLE_NAME` |
| Section owner | `packages/core/tools/src/index.ts` `sdkSection()` (`tools:sdk`) |
| Text injector | `packages/core/tools/src/ts-types.ts` + `py-types.ts` `docLines()` (only `*/` is escaped) |
| PTC enable (one-off) | `$env:DSH_TOOLS_MODE='ptc'` |
| Upstream channel | GitHub Discussions on `deepseek-ai/deepseek-harness` (verified 2026-09-22: `has_issues=false`, `has_discussions=true`, `master` active) — plus the in-product feedback rows `command-feedback` / `message-feedback` / `ui-message-feedback`, which are live in the running `web` profile |
| Upstream status | 0.1.5-rc.2/rc.3、0.1.7-alpha.1、`master` 未修；**0.2.0-rc.2 一线已修**（`tools:sdk` 声明 `interpolate: false`，2026-10-10 实测见 Pitfalls） |
| Report target | **DSH only.** The defect is unescaped interpolation: third-party text is fed into DSH's own `{{...}}` template syntax and a malformed group *throws*. MCP allows any string in a tool `description`, so OfficeCLI's braces are legal — they are its product-domain syntax (`TemplateMerger.cs` `{{key}}` merge tokens, Mermaid `{{text}}` hexagon). OfficeCLI is the trigger, not the owner |
| Secondary (optional) | `iOfficeAI/OfficeCLI` has issues **open** (Discussions off) — only an interop FYI there; expect "that is a host-side problem" |

## Procedure

1. Reproduce with one variable at a time (headless profile, temp overlay):

```powershell
$env:DSH_TOOLS_MODE='ptc'
& "$env:APPDATA\npm\dsh.cmd" --profile headless --patch D:\dsh\probe-officecli-ptc.yml "reply with OK"
```

The overlay is a patch list, so wrap new rows in `- insert:`:

```yaml
- insert:
    - id: mcp-officecli
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: officecli
        transport: stdio
        command: 'D:\claw\_tools\officecli\fork\officecli.exe'
        args: [ 'mcp' ]
```

2. Control cells: same command without `--patch` (expect `OK`), and with
   `--patch` but no `DSH_TOOLS_MODE` (expect `OK`). PTC + the row alone must fail.

3. Confirm the literal string comes from the server, not from DSH:

```powershell
$req = @(
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}',
'{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}',
'{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
)
$out = $req | & 'D:\claw\_tools\officecli\fork\officecli.exe' mcp
($out | Where-Object { $_ -match '"id":2' } | ConvertFrom-Json).result.tools[0].description.IndexOf('{{')
```

4. Sweep every visible tool for brace groups (one call, output spills to a file,
   then attribute each hit to its tool):

```powershell
# cordis_inspect_query platform=host provider=Tool method=listTools
$f = '<the spilled cordis_inspect_query output path>'
$lines = Get-Content $f
for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -match '\{\{') {
    for ($j = $i; $j -ge 0; $j--) { if ($lines[$j] -match '"name":\s*"([^"]+)"') { $Matches[1]; break } }
  }
}
```

5. Pick a fix layer (all verified to be technically open; L2/L3 keep the
   deployment upgrade-safe):

| Layer | Change | Level | Cost |
| --- | --- | --- | --- |
| L0 | append `- id: <mcp row>` + `disabled: true` to the profile patch file (hot-applies, no restart; verified live) | deployment | the tool is gone in every session of that profile |
| L1 | profile plugin row on the `system-prompt/assemble` expert waterfall, neutralizing only the `{{...}}` groups `interpolate()` would reject | runtime, every assembly | one small package + profile restart |
| L2 | stdio shim in front of the MCP server that breaks `{{` pairs in `tools/list` output | deployment (patch row) | extra process to maintain |
| L3 | upstream-shaped source fix: make schema-derived SDK text template-safe in `docLines`/section body, or sanitize untrusted server text at the MCP boundary | build artifact | install file, lost on upgrade |

**Choosing L1?** Before writing that plugin, answer two questions from the pre-collected facts in
`references/l1-side-effects-and-limits.md`: does a `complete` section bypass your rewrite (it is
snapshotted before the waterfall and restored after, so that section still throws), and can all four existing
`system-prompt/assemble` mounters survive it? That file also carries the side-effect, invariant and
acceptance tables read off the shipped `lib/index.js` (v0.1.5-rc.2), so the plugin can be written and
verified without re-deriving them.

### 退役条件（什么时候可以不再打补丁）

上游从 **0.2.0-rc.2** 起给 `tools:sdk` 声明了 `interpolate: false`（纯净上游树 `packages/core/tools/src/index.ts:900`，
**0.2.1-alpha.1 保持**），`renderPrompt` 同时加了 `interpolate === false ? text : interpolate(...)` 旁路
（`system-prompt/src/index.ts:281`）⇒ 平台侧触发路径消失，L2/L3 类补丁可退役、MCP 服务可回官方二进制。

- **前提**：那个平面**真的升到 ≥0.2.0-rc.2**。同一台机器上两条线可以差一个大版本（2026-10：桌面 app 内置
  0.2.0-rc.2，npm 全局 web 面仍 0.1.5-rc.2）—— 只升一边时，未升的那边**一天都不能退补丁**。
- **残留**：段级 opt-out 只修了这一条路径；**context 仍无条件插值**（0.2.1 `system-prompt/src/index.ts:320`），
  别的插件/MCP 把 `{{...}}` 送进 context 照样炸 ⇒ 那个"部署门禁"脚本（本机 `fork\verify-braces.ps1`）
  留着当哨兵，别随补丁一起删。
- **换二进制时**：同一份 exe 常被多个 profile 共用（本机 desktop + web 的 `mcp-officecli` 都指向它），
  要**一起改**；回官方版要重新对官方 `SHA256SUMS`（fork 上原校验链不适用）；dotnet SDK、源码树、
  patch/diff 留档等**验收过后**再删。
- **实测判据**（同一份未打补丁的二进制 + `DSH_TOOLS_MODE=ptc` + 同一 overlay）：0.2.0-rc.2 的 CLI → `OK`；
  0.1.5-rc.2 的 CLI → 原句报错。

## Pitfalls

- **中招要同时满足两个条件，少一个就是绿的**（2026-10-10 实测：同一份坏二进制、同一 PTC 模式，两个平台结论相反）：
  ① **平台版本对 `tools:sdk` 做插值**。0.1.5-rc.2 的 `renderPrompt` 是**无条件** `interpolate(section, …)`
  （`packages/core/system-prompt/src/index.ts:275`）；0.2.0-rc.2 是
  `section.interpolate === false ? section.text : interpolate(…)`（同文件 `:281`），且其 `sdkSection()`
  明确写了 `interpolate: false`（`packages/core/tools/src/index.ts:900`）⇒ 该段整体不插值，`{{…}}` 原样输出。
  ② **该会话展示模式是 `ptc`/`both`**。`sdkSection()` 在 `mode === 'native'` 时返回空串，空段被丢弃
  （两版都有，`tools/src/index.ts:896-914` / 0.1.5 `:867-874`）⇒ native 会话的描述根本不进这个段。
  实测对照（officecli 未打补丁的构建 + `DSH_TOOLS_MODE=ptc` + 同一 overlay）：桌面 app 内置 CLI
  **0.2.0-rc.2** → `OK`；npm 全局 CLI **0.1.5-rc.2** → 原句报错。
  ⇒ **别拿新平台/ native preset 的绿去推断老平台/ PTC 会话没事**，反之亦然；报"某个 MCP 行把聊天搞挂了"
  之前先把 (平台版本, preset) 两项报清楚。同理：这个 bug 类在 0.2.x 升上去后会自动消失，但 0.1.5-rc.2 线上仍需要 fork 补丁。
- **重建 fork 二进制 = 必须重跑第 3 步。** 2026-10-10 实测事故：`fork\officecli.exe` 在 09:27 被重建成
  未打补丁的 v1.0.156（描述 4021 字符、`{{` 在 1281），但**当时两个宿主的 MCP 子进程仍跑着旧镜像**，
  所以现场是绿的；直到子进程被重拉（杀进程/重启宿主都算），两个平面（npm/web 与桌面）的 PTC 会话
  才从重拉后 3 秒起全线 `tools:sdk` 报错。**同一份 exe 被 desktop 与 web 两个 profile 共用**
  （`profiles/{desktop,web}/cordis.patch.yml` 都指向 `D:\claw\_tools\officecli\fork\officecli.exe`），
  换一次两个平面一起坏。回滚：把补丁版（当时是 `officecli.exe.old`，descLen 4023）盖回该路径，
  再杀掉两个 `officecli.exe mcp` 子进程让客户端自动重拉；坏构建留 `.unpatched-<stamp>.bak` 别删。
  修完必须同时过：第 3 步 `IndexOf('{{')` = -1 **且** PTC 复现格打印 `OK`。
- `interpolate()` has no escape syntax: `{{` must be broken (`{ {`) or reached
  through a variable, because substituted values are not rescanned.
- A leaked `{{` anywhere in a section body is enough; the tools registry scans
  the WHOLE rendered SDK block, not just the offending tool's doc line.
- Only PTC/`both` render `tools:sdk`; native sessions cannot hit this path.
- `validate`-style shape checks and `list()` broken flags say nothing about this;
  only a real assembly does.
- **部署路径可以被 DSH 之外的动作换掉，所以"谁改的"常常查不到** —— 2026-10-11 09:45:27 第三次复发：
  `fork\officecli.exe` 被写成与 `officecli.exe.unpatched-20261010.bak` **逐字节相同**的 v1.0.156
  （`{{`@1281 / descLen 4021），而当日 03:00–14:00 所有 workspace 分组下**没有任何会话落盘**、
  机器上也**没有 PSReadLine 历史文件** ⇒ 不是 agent 会话干的（写入口令：CreationTime 保持
  2026-09-22 17:20:12 而 mtime = 当日 ⇒ Copy-Item -Force 类就地覆盖；若 mtime 等于 .bak 自己的
  mtime 才是普通 Copy-Item）。宿主只在 MCP 子进程重拉时才吃到新镜像（本次 web 子进程 14:21:46、
  桌面 14:28:05 起来后立刻全线报错）⇒ **别把力气花在追责上：每次换完二进制就立刻跑门禁**。
- 已知哈希速判（2026-10-11 实测）：**坏** = 70B4E266…（officecli 1.0.156 未打补丁，descLen 4021，
  `{{`@1281，与 `.unpatched-20261010.bak` 同字节）｜**好** = **7EBB2298…（当前部署，1.0.156 + 补丁，
  descLen 4023，`{{` 计数 0，源码 699cafb + 5f2c262）**、9C8DB979…（`officecli.exe.old`，1.0.152 + 补丁，回滚源）。
- **换 exe 必须先「改名腾位」**（2026-10-11 实测）：在役 `officecli.exe mcp` 子进程锁着部署路径，直接
  `Copy-Item -Force` 报 IOException；而子进程被 kill 后**秒级自动重拉**，杀不干净 ⇒
  `Move-Item officecli.exe officecli.exe.swap-tmp` → 放入新件 → `Get-Process officecli | Stop-Process -Force`
  → 删 swap 副本。重建走「publish 到暂存目录 → 先对暂存件跑门禁 → 再改名腾位部署 → 部署后复跑门禁」。

## Verification

For containment (L0): the profile patch file hot-applies to the running process,
so confirm through the step 4 sweep — the offending server's tool names AND every
`{{` must be gone, with the remaining `mcp__*` count unchanged. No restart needed.

Re-run step 1 after a real fix: the same command must print `OK`, and the SDK block
must still declare the offending tool (grep the prompt for its binding name).
Before the fix it must fail with the exact `tools:sdk` error, and the control
cells from step 2 must be green either way.
