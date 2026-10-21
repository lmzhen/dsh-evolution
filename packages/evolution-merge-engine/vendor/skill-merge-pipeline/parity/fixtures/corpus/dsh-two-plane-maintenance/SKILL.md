---
name: dsh-two-plane-maintenance
description: Maintain two split DSH planes with separate homes safely.
version: 0.1.0
author: Hermes
metadata:
  hermes:
    tags: [DSH, Desktop, Profiles, Isolation, Maintenance]
    related_skills: [dsh-mcp-wiring, dsh-evolution-maintenance, dsh-desktop-source-build]
---

# Two-plane DSH maintenance

One machine can run two DSH planes at once — the Electron desktop app and the npm-global `dsh web` — sharing one DSH home (`~/.dsh`) while owning separate profiles.

**现状（2026-10-11 19:07 起，已分家；本节优先于下文任何「共享」表述）**：两面各自独立 home——桌面 `~/.dsh`（默认，未改），web `D:\dsh-homes\web`（由 `~/.dsh\start-dsh-web.cmd` 的 `set "DSH_HOME=…"` 注入；回退＝删该行或恢复 `start-dsh-web.cmd.bak-before-home-split-20261011`）。sessions／skills／memories／evolution／storages／凭据／皮肤状态**各一份、不再互见**；两面 platform 同为 `0.2.0-rc.2`（这是「npm 端先装」成立的前提）。

**装机顺序（2026-10-11 起，用户口径）＝先在 npm 端装机实测，过了再装桌面端**。命令：npm 端 `dsh plugin --profile web add '<pkg>@<ver>'`（profile 目录 `D:\dsh-homes\web\profiles\web`）；桌面端只能用 app 自带 CLI `& '<app>\resources\runtime\cli\bin\dsh.cmd' plugin --profile desktop add '<pkg>@<ver>'`（全局 `dsh` 会硬拒 desktop）。两侧 profile 的 `pnpm-workspace.yaml` 都需一条 `minimumReleaseAgeExclude` 的 scope glob ``- '@lmzhen/*'``（逐版本 name@version 与裸名在新 pnpm 上不被 lockfile 策略检查认）。**给 web 面手工跑任何家族 CLI/脚本前先 `set DSH_HOME=D:\dsh-homes\web`**，否则落到桌面 home。装机核验：' + `node <tools>\verify-profile-integrity.mjs <ver> <profileDir>`（第 2 参数＝profile 目录）＋对已安装字节做运行期探针（import `node_modules/@lmzhen/dsh-evolution-core/lib/index.js` 断言注册表不变量；客户端半读 `lib/client.js` 数卡/字段）。

**装第三方插件（非家族包）的两面实操（2026-10-12 实证）**：桌面面必须用 **app 自带 CLI**：`& 'D:\Apps\DeepSeekHarness\resources\runtime\cli\bin\dsh.cmd' plugin --profile desktop add '<pkg>@<ver>'`（全局 `npm\dsh.cmd` 硬拒：*profile "desktop" is managed exclusively by the Electron application*，2026-10-12 实测；app CLI 同版本无此门）。**手工兜底（CLI 不可用或卡住时，与 CLI 等价）**：① 备份 profile 的 `package.json`＋`pnpm-lock.yaml`；② `package.json` 里加 `dependencies.<pkg>`，并把包名**追加到 `dsh.profile.bundles` 末尾**（管理器的规则是 append，顺序影响配置优先级）；③ 在 profile 目录用 `& "$env:APPDATA\npm\pnpm.cmd" install`；④ 核验＝`pnpm install --frozen-lockfile` 报 `Already up to date` ＋ `node_modules/<pkg>` 存在且版本正确。**踩坑**：web 面 `dsh plugin --profile web add` 写对 `dependencies` 后 `pnpm add` 会**静默挂死**（>15 分钟零文件写入，`package.json.lock`/`.plugin-manager/logs/<op>/pnpm.log` 为空）——杀掉后手工补 `bundles` 再 `pnpm install`（3.7 秒完成）；`dsh plugin add` **不会**替你写 `bundles`，只写依赖，所以两面都要检查 `bundles` 是否含新包，否则装了也不挂载。

**web 宿主重启（2026-10-11 起由 agent 代做；用户在更新家族版本期间不使用 web 端）**：`Stop-ScheduledTask dsh-web; Start-ScheduledTask dsh-web`，随后复核三件——① 3080 重新监听（实测约 6 秒起）② pid 变成新的 ③ `D:\dsh\_logs\web-host-current.log` 里启动脚本自证的 `DSH_HOME=` 行指向 `D:\dsh-homes\web`。桌面宿主仍归用户，不要动。**「装完」≠「生效」**：装的是磁盘字节，跑的是内存里的旧代码 ⇒ 只有重启过宿主的那个面才算验过新版；判据＝宿主启动时间晚于 profile 里家族包的 mtime。

**给 web 面加/改环境变量（2026-10-11 G5 实证，四步）**：① 只改启动脚本 `~/.dsh\start-dsh-web.cmd`（纯 ASCII，紧邻 `DSH_HOME` 行，附一行 `rem Revert: …`）；② **同时给该变量加一行 `echo %NAME%`**——启动日志因此自证；③ `Stop-ScheduledTask dsh-web; Start-ScheduledTask dsh-web`；④ 三核＝端口 3080 重新监听、**pid 变化**（本轮 62360→18896）、日志里出现新变量行。桌面面同类改动走**用户级 env**（`[Environment]::SetEnvironmentVariable(...,'User')`），**下次 app 启动才生效**，重启归用户。

**验收前先确认宿主在跑（2026-10-11 实证）**：计划任务状态 **`Ready` ＝ 没在跑**（不是`正常待命`），此时 3080 无人侦听、`install-family` 第 7 步的重启是否落地就没有可比基线（pid 前后都可能为空 ⇒ 三核退化成只看日志）。做装机实测前的顺序：`Get-ScheduledTask dsh-web` 查状态 → 若未运行 `Start-ScheduledTask dsh-web` → **记下 3080 的基线 pid**（`Get-NetTCPConnection -LocalPort 3080 -State Listen`）→ 看一眼启动日志里 `DSH_HOME=/`DSH_AGENTS_HOME=` 两行（这既是自证也是这次起的是哪个面的证据）→ 再跑装机。
- **部署面清单只留一份**：需要面内/面外清单时，**扩写既有的 `situation-*-two-plane-split.md` §4.3**（并把该文档 §6 的待办行标成已完成），不要新建目录或第二份清单；每条面外项都要写**到期条件**（例：上游把 `agentsHome` 纳入 `DSH_HOME` 派生 ⇒ 删除该行）。 This skill covers identifying which plane you are in, changing one plane without disturbing the other, relocating the desktop app, and reasoning about what is shared. It does not cover building DSH from source, authoring plugins, or publishing releases.

## When to Use

- 桌面版 vs npm 端 / 两个客户端 / 另一个对话正在改另一面。
- 「帮我装进桌面版」「npm 端也要一样」——镜像、对齐插件集。
- 改 profile、动 `~/.dsh` 共享目录、迁移桌面 app 位置之前。
- 跨面症状：一面改了另一面也变、别处写的会话看不见、升级后另一面读不了。

## Prerequisites

- Know both ports (desktop 19387, `dsh web` 3080) and that each plane owns its profile directory.
- Desktop-profile operations must use the **desktop-bundled** CLI; the npm-global `dsh` refuses `--profile desktop`.
- `DSH_HOME` selects the home for a process (default `~/.dsh`). The desktop app's own UI state is Electron userData (`%APPDATA%\@deepseek-ai\dsh-desktop`), not the home.

## How to Run

1. Identify the plane (three checks below).
2. Decide scope: which profile is yours, what is shared.
3. Snapshot before any profile or shared-directory write.
4. Apply one change at a time, restart the owning host, verify.
5. Record baseline changes so a later mirror does not drift.

## 证明「某插件是否自动按面隔离」（2026-10-11 实测流程，六个判据）

1. **根解析**：找它自己的 home 解析函数——是否读 `DSH_HOME`、是否**每次调用现读**（模块级缓存会让「分家」只在启动那一刻成立）。家族＝`evolution-core/src/state-store.ts` 的 `evolutionRoot()/evolutionHome()`（无缓存）。
2. **门禁兜底**：有没有规则禁止别处再读一次 env——家族＝arch-guard **N1**（`process.env.DSH_HOME` 只许出现在 `evolution-core/src`）。有这类门禁，才谈得上「不可能各写各的」。
3. **写入点穷尽**：优先用它自己的机器可读清单（家族＝`evolution-core/persisted-write-inventory.json`，15 条，N20 门禁逐条对账）；没有清单就 grep 写路径与 `.lock`。
4. **锁与单实例**：锁必须**就地**（`<file>.lock`）而不是共享 temp；单实例 claim 必须**按 home 键**，否则两面互相挡——家族 `instance-scope.ts` 注释原话：two instances resolving different homes (…a second DSH_HOME) do not contend。
5. **绝对路径/端口/env 覆盖**：grep `D:\`、端口字面量、以及 `DSH_*` 覆盖项是否在两面的配置里被设成同一个共享值。
6. **实测（决定性）**：① 两面同名文件 mtime 对照（新家动、旧家冻结）；② 在 `DSH_HOME=<目标家>` 下驱动一次**真写入**并断言落在目标家（例：驱动家族 commands 的 `skill pin`，看 `.pinned` 落在哪个 home）；③ 跨面**字节一致性用 hash + integrity**（`verify-profile-integrity.mjs <ver> <profileDir>`），**别用 pwsh `.Contains` 比中文**——UTF-8→GBK 会给假阴性（0.21.0 实测：据此差点误判「web 端缺符号」，哈希一算两面逐字节相同）。

**分家后必须清掉不属于本面的 `<home>/profiles/<name>`（不是省空间，是功能正确性）**：家族读 `<home>/profiles` 有两处——① **写路径拒绝**：`evolution-commands/src/index.ts:1247` 的 `/evolution preset install` 用 `collectEvolutionBundles(evolutionRoot())` 做三方互斥，只要**本 home 任一 profile** 挂了 `dsh-evolution-all`／`dsh-evolution-preset` 就拒装（旧面残留 ⇒ 本面这条命令直接不可用）；② doctor 的全量汇总（`doctor.ts:311/502/639`）让读数多一份。**穷尽读者要按函数名/调用图 grep（`collectEvolutionBundles`／`profileDirectories`／`profileBundles`／`profilePatchText`），别按字符串 `'profiles'`**——后者只命中 `doctor.ts`，会漏掉写路径那次（2026-10-11 实测：据此误判为「只读、无运行期影响」）。

> 本流程的一次完整执行记录（0.21.0 分家审计的判据结果、两 home 现场读数与字节一致性、旧 home 残留清单与「`.dsh-doctor` 归属」判定、三项待裁、可复跑命令）见 `references/per-plane-isolation-audit-20261011.md`。

## 验收面：npm 包还是 link（2026-10-15）

- **口径**：验收面装 **npm 包**；`link:<repo>` 只用于开发内环（改码即生效，但验不到产物）。切换：`DSH_HOME=<home> dsh plugin --profile <prof> add '<pkg>@<ver>'`；回退＝恢复同目录 `package.json.bak-before-npm-*` ＋ `pnpm install` ＋重启宿主。
- **判「装的是产物还是 link」**：`Get-Item <profile>/node_modules/<pkg> -Force` 看 `LinkType` —— 空＝真实目录（产物）；`SymbolicLink`＝link 到仓库树。
- **判「产物与仓库同字节」**：逐文件 SHA256；**老文件会因换行符假报差异**（CI 在 Linux 打包＝LF，Windows 工作区＝CRLF）⇒ 先把 `\r\n` 归一成 `\n` 再比哈希；新文件通常本就 LF ⇒ 直接相同。
- **别把 pnpm 的 `Packages: +1 -10` 当插件被删**：那只是依赖图重算；判据是「备份 package.json 的依赖键集 vs 现在的丢失/新增清单」。
- 本次读数与翻车点：`references/live-acceptance-cli.md`。

## 活体验收：一条 CLI 回合顶开浏览器（2026-10-15）

不必去拿 web 宿主的 launch token 驱动浏览器 —— 用同一 home 的 `headless` profile 跑**一次真模型回合**：

1. 装插件：`DSH_HOME=<home> dsh plugin --profile headless add '<pkg>@<ver>'`
2. 造**可断言**夹具：`node scripts/make-test-png.mjs <out.png>`（纯 `node:zlib` 手写 PNG，8x4 左红右蓝；不依赖 sharp 等图像库，宿主/仓库里图像库不可用时也能造）
3. 跑：`DSH_HOME=<home> dsh headless '<明确任务：先 ingest 该路径，再用 <工具> 的 views 一次取两处，最后只输出一行 JSON>'`
4. 断言：返回值必须等于夹具的已知颜色（例 `[["#ff0000"],["#0000ff"]]`）。**模型拿不到输入时会如实回 `path_not_found` 而不是编造** —— 这本身也是一条有效验收信号（工具面与错误路径都在）。

两个操作坑：`dsh headless` 单回合可能 >300s ⇒ 直接 `run_in_background: true`，再用 `job_output(wait:true)` 收；pwsh 结果若非 `foreground`（被提升为后台 job）而你的程序只在 `foreground` 分支打印，就会**静默无输出** ⇒ 三个 kind 都要处理。

## Quick Reference

| Thing | Desktop plane | npm/web plane |
|---|---|---|
| Host process | `DeepSeek Harness.exe … dsh-desktop-host … <home>\profiles\desktop` / 19387 | `node …/dsh lib/bin.js web` / 3080 |
| Profile | `<home>\profiles\desktop` | `<home>\profiles\web` |
| Install CLI | `<install-root>\resources\runtime\cli\bin\dsh.cmd` | `dsh` (npm global shim) |
| UI state | `%APPDATA%\@deepseek-ai\dsh-desktop` | browser storage |

### A third, disposable plane for experiments (safest bed)

When a question needs a host you can restart, patch, or break — a symptom that only shows on one plane, a long-request experiment, an A/B on a plugin version — do NOT experiment on either of your planes. Build a throwaway profile with the plane's OWN CLI and drive it over HTTP (verified 2026-10-10):

1. Create it from a shipped template: `<cli> labweb --from-default-profile web` (a `lab` profile made by `plugin --profile lab add` gets only base+plugin bundles and therefore boots **no web host**).
2. Install what you need: `<cli> plugin --profile labweb add <pkg>@<ver>` (desktop CLI for desktop-runtime profiles).
3. Boot on a free port and capture the authenticated URL: `<cli> labweb --port 0 --no-open` prints `http://127.0.0.1:<port>/?token=…` (`web` alone is a PROFILE selector, so `web --profile labweb` is rejected as a double profile).
4. Drive it with the URL's token — full protocol in `references/host-api-driving.md`.
5. Delete the profile directory when done: nothing of either real plane was touched, so the whole experiment is its own rollback.

**Rule before any experiment on their machine: state the revert path first** — which files get a timestamped backup, the one command that restores them, and what gets deleted. Prefer a disposable profile over editing an installed one; if you must patch an installed package, back up each file you touch (`*.bak-<timestamp>`) and keep the version pin unchanged so the revert is a file copy, not a reinstall. The user asks for this explicitly (「如果修不好这一问题，就要回退」).
Patch layering: bundle patches → profile `cordis.patch.yml` → **home `$DSH_HOME/cordis.patch.yml` (applies to every profile, higher priority)** → `--patch` overlays (`apps/cli/src/profile-boot.ts:68`). A row whose id exists in both profiles changes **both** planes; a row whose id is missing is **silently skipped** — a shared file can look inert today and bite tomorrow.

Shared by both planes: `skills/`, `memories/`, `sessions/`, `evolution/`, `storages/`, `attachments/`, `mcp/`, `.credentials.yaml`, settings files, usage/task-board/presets.
Per plane: `profiles/<name>/` and the client's own storage.

### Mirroring one plane to the other (plugins + MCP + bundles)

Order is not negotiable: **snapshot → remove → add/patch rows → global package LAST → human restart → verify**.
The global-package upgrade replaces the target host's runtime files, so its in-flight `run_code`/`pwsh` die at that moment — that is why it goes last, and why only a restart makes the new row set live.

- Removing an **aggregate** bundle removes its whole installed closure: enumerate it first (`node_modules/<scope>/*`) and rescue non-UI roles before restart. Here `@linxin666/dsh-web-all` also carried `dsh-doctor`, the supervisor keeping the web host alive — it had to be re-added standalone at its own latest version. **An aggregate can also be a compat layer**: a rescued plugin may `inject` a service the aggregate used to provide, so on the new platform line it mounts *pending* forever — the **host log stays clean while the GUI reports `N entry did not activate`** (here `@linxin666/dsh-doctor`: client half waiting on `settingsScope`, removed in 0.2.x, no fixed release). Verify each rescued plugin actually **activates** (both host and client halves); if no fixed release exists, prefer parity with the baseline plane and drop it (re-declare nothing by hand: edit `dependencies` + `bundles`, restart, and confirm the boot report is clean).
- `plugin add/remove` rewrites `dsh.profile.bundles` by package name, but **order** and **non-dependency bundles** (platform `@deepseek-ai/dsh-experimental-*`) are hand-edited in `package.json`; bundle order is semantic (patch layers apply in that order).
- **Pre-restart gate**: assert every bundle name resolves from the target plane's roots — the profile's `node_modules` *or* the platform install's `node_modules`. An unresolvable bundle fails the boot; never hand the user a restart you have not gated.
- **Snapshot race**: a long copy of a *live* profile can capture a mixed state. Additionally copy `package.json` + `cordis.patch.yml` by hand before the first mutation, then confirm the snapshot's vintage by diffing its dependency keys.

### Per-plane record stores (splitting the shared session/storage roots)

One home does not have to mean one record book: the roots are **row config**, so a single profile can
move its own and leave the other plane untouched. Shipped defaults: `packages/bundle/base/cordis.patch.yml`
`:130-133` `- id: session-persistence-jsonl / config.root: !!js dshHomePath('sessions')` and `:168-171`
`- id: storage-json / config.root: !!js dshHomePath('storages')`; the platform names the override layer
itself (`:141-148`: deployments override these rows "in a later patch layer (profile `cordis.patch.yml`
or a `--patch` overlay)"). Three knobs, narrowest first:

1. **Row override in ONE profile's `cordis.patch.yml`** — restate the keys, because a patch replaces the
   whole `config` block (`root` is `required`: `session-persistence-jsonl/src/index.ts:246-247`):
   `- id: session-persistence-jsonl` + `config: { root: 'D:\\planes\\web\\sessions' }` and the same for
   `storage-json`. Split **both**: `storages/workspace.json` is the sidebar/workspace index and membership
   is checked with `sessions.get(id)` (`workspace/workspace/src/index.ts:473`), so a half-split leaves ghost
   entries. Add `session-query-sqlite.path` if content search is ever enabled.
2. **`--patch <overlay.yml>`** — a launcher flag, repeatable, applied *after* the profile layer
   (`apps/cli/src/args.ts:170`); one line in the plane's launcher script, profile file untouched ⇒ deleting
   the line is the whole revert. `dsh web --help` exposes no path flags, so this is the only non-profile route.
3. **`DSH_HOME`** — whole-home split; precedence explicit config > `$DSH_HOME` > `~/.dsh`
   (`util/home-paths/src/index.ts:18,79-88`, blank means unset). Costs a re-seed of profile/skills/memories/credentials.

Switching a root leaves that plane **empty from then on** (old logs stay in the old root and remain visible to
the other plane); move the project buckets with that plane's host **stopped**, then restart only the changed
plane. Everything else under the home (skills, memories, evolution, attachments, mcp, credentials) stays shared.

### The session store is shared by design; copy is the wrong tool

- Layout: `<home>/sessions/<project-slug>/<session-id>/session.v{N}.jsonl.zstd`; subagent children are
  **sibling** session directories (some bare-uuid, some `session-`-prefixed), and the sidebar index is
  `storages/workspace.json`.
- Both planes read that store, so a conversation written by one plane shows up in the other after a **client
  reload**, with title/sidebar settled after a **host restart**. "Copy this conversation to the other client"
  is therefore usually a no-op — answer with the evidence (files present, id in `workspace.json`) instead of
  duplicating bytes.
- The platform offers export (`导出会话` → zip of `session.v4.jsonl` + `subagents/<id>/…`) but has **no import
  command**; a real second copy means rewriting ids in the JSONL, so only do it with the writer quiesced.

### Going all the way: a second home per plane (clone-then-diverge)

When the planes should be two *separate harnesses* — own skills, own memories, own session history — give one
plane its own `DSH_HOME` (precedence: explicit config > `$DSH_HOME` > `~/.dsh`, `util/home-paths/src/index.ts:18,79-88`).

1. **Clone** the home for the moving plane: dirs `sessions skills memories storages evolution mcp attachments
   .agent-presets dsh-usage task-board llm-deepseek speech-to-text browser-* dsh-session-archive cache
   dsh-runtimes _staging pw-automation` + files `.credentials.yaml pet.json skin-center-active.json
   cordis.patch.yml <ca>.pem`, plus `profiles` **excluding the staying plane's profile directory**
   (`robocopy /XD <absolute path>`). Leave the old home untouched — the clone *is* the backup, and the revert
   is one line.
2. **Point only that plane's launcher** at the new home (`set "DSH_HOME=…"`): the web host's `.cmd`, or the
   desktop app's own launcher/scheduled task. A *user-level* environment variable would move both planes.
3. **Restart only that plane**; leave the other host running.

- **Launcher files must be pure ASCII.** A Unicode comment in a `.cmd` is decoded in the ANSI code page by
  `cmd.exe`; the mangled line swallowed the following `set`, leaving `DSH_HOME` empty so the plane silently
  stayed on the old home. Put `echo DSH_HOME=%DSH_HOME%` in the launcher — the boot log then proves which home
  is live.
- **Verify by mtime freeze, not by port.** Take files the home's plugins rewrite at boot
  (`dsh-usage/provider-snapshots.json`, `pet.json`, `storages/workspace.json`): after the restart the NEW
  home's copies must be fresh while the OLD home's stay at their pre-switch timestamps. `listen=true` and a
  clean boot log say nothing about which store is in use.
- End state: two independent histories from that moment on (the clone starts identical). The old home's copy of
  the moved plane's profile is dead weight — prune it only after the moved plane has run clean for a while.

## Procedure

1. **Identify the plane.** Walk the shell's process ancestry (`ParentProcessId` up) until you hit the host; cross-check the MCP tool names this session sees and the listening port. Do not infer the plane from the GUI window title — both look the same.
2. **Snapshot** the target profile (including `node_modules`) plus every shared dir you are about to touch, onto another drive.
3. **Apply in your own profile only.** New MCP rows go in an `- insert:` block; disable a plugin-package row with `- id: <row>` + `disabled: true`.
4. **Restart the owning host** (host half = restart, client half = reload). Never restart the other plane's host.
5. **Verify**: host port up; the host's command line names the expected profile; the plane's MCP children are parented by that host; one end-to-end tool call; boot log clean of `did not activate` / `already registered`.
6. **Record** in the mirror plan when the mirrored-to baseline changes (date + what changed).

## Pitfalls

- **Before executing an existing mirror plan, audit it first.** Re-derive each axis by measurement (not from the plan text), diff ids package-by-package, and write down what the plan *loses*: removing an aggregate drops whole feature sets that no platform package replaces. Number the keep/drop decisions in one table, and correct plan statements that are technically wrong (bundle order *does* matter; a "config-only" row can still change the other plane). The user asks for this explicitly (「对比并查缺补漏一下」) and expects the corrections written back into the same plan file.
- **An irreversible step is the human's, exactly like a restart.** When the instruction's object does not match the plan's target — e.g. 「按照计划升级桌面端」 while the plan is "npm side aligns TO the desktop" — resolve it on **state evidence** (which components are actually behind), finish every reversible step first (snapshot, profile deps/rows/bundles, pre-restart gate), and stop before the one-way door (here: `npm i -g @deepseek-ai/dsh@<new>`, which also breaks the target host's `run_code`/`pwsh`). That reservation is a **default, not a veto**: a one-word 「你来」 hands the step back to you — then execute it (kill by exact command-line match, relaunch, verify) and do not re-ask. Then answer with three things in the first lines: the reading you executed, the rollback window that is still open (and the exact revert), and the single remaining human touchpoint. "Everything is fine" claims without that framing get rejected on the spot.
- **Two planes, two platform versions.** Sharing `sessions/` across versions risks a format the older plane cannot read; platform migrations are forward-only, so upgrading the global package is a one-way door.
- **Per-client vs shared state.** Option values (theme/skin sliders, time windows) live in each client's localStorage while the on/off switch may live in a shared patch layer — "same state on both planes" is false in general.
- **Duplicate MCP children are normal** (each host spawns its own), but a *single-instance* local service behind both planes queues concurrent calls and can trip rate limits.
- **A process started from a tool call dies with that command's process tree.** Use a scheduled task for anything that must outlive the call (local MCP services, the desktop app).
- **Relocating the desktop install** is a folder copy in principle (the app does not hardcode its install path), but you must repoint shortcuts, the uninstall registry record, and any scheduled task you created; the uninstaller also deletes the app's userData, so snapshot it first.
- **The other plane's CLI stamps its OWN version.** Listing `--profile web` with the desktop CLI reports the web profile's older packages as "incompatible with dsh <desktop version>" (pure noise) and validates peers against the wrong runtime; use the target plane's own CLI to list/verify, and the newer CLI only to install packages whose peers require the newer platform.
- **pnpm's `minimumReleaseAge` gate can fail a single `add` mid-migration** ("lockfile contains entries that the active policies reject"): retry the same add after the sibling installs settle — it succeeded on retry here; the durable fix is an entry in the profile's `pnpm-workspace.yaml` `minimumReleaseAgeExclude`.
- **A "successful-looking" `add` can half-apply.** After a policy/interrupted install the package can sit in `node_modules` while being absent from `dependencies` **and** `dsh.profile.bundles` — the plugin then simply never mounts. Re-read the declared dep list + bundles after every add (and diff their count against the plan), instead of trusting the command's summary.
- **★ Dev-linking a plugin by junction/symlink ⇒ it loads from the plugin's OWN `node_modules`, so its peers can be a DIFFERENT copy than the host's ⇒ "installs but never activates", silently** (2026-10-12, verified). Node resolves a symlink to its **realpath** before walking up, so a package junctioned into `profiles/<name>/node_modules` resolves its imports from `<real plugin dir>/node_modules` first — and if those are the *dev/test* links this repo built (here they pointed at the **global/other-plane** DSH), plugin and host end up with two instances of the same `@deepseek-ai/*` ⇒ cordis service identity mismatch ⇒ pending-forever, boot log clean. ⇒ **Classify peers by whether they carry identity**: *identity-bearing* (`@deepseek-ai/dsh-tools`/`-attachment`/`-storage-domain`/`-output-retention`/`cordis`, `zod`) **must resolve to the target plane's store**; *native* (`.node` bindings, e.g. `sharp`) only need to **load**, so they may come from elsewhere. Prove it by resolving *from the plugin's installed location* (`createRequire('<profile>/node_modules/<pkg>/lib/x.js').resolve(p)`), not from the repo.
  - **On this machine the flat store is `$DSH_HOME/profiles/node_modules`** — NOT `$DSH_HOME/node_modules` (that path holds neither `sharp` nor `@deepseek-ai/*`). A candidate-root list that only probes `$DSH_HOME/node_modules` falls through to the global install and quietly produces the split above.
  - **The native exception is real, not a workaround**: the web plane's `sharp` is a pnpm-layout install and importing it via an external path fails with `Could not load the "sharp" module using the win32-x64 runtime`, while the global copy loads fine. Pin natives to whatever copy *loads*; pin services to the plane.
- **A junction install is a legitimate lightweight route for a locally-developed plugin** — `node_modules/<pkg>` → the repo, plus an `- insert:` row in the target profile's `cordis.patch.yml` — and it sidesteps the `pnpm add` hang documented above. Two things it does not give you: the package is absent from `dependencies`/`bundles` (fine, the row is what mounts it) and a later `pnpm install` in that profile may prune the link. **Back up `cordis.patch.yml` with a `*.bak-before-<pkg>-<timestamp>` name first** (this repo's convention), and remember the row must be inside an `- insert:` block — a bare `- id:` is read as an *override* of an existing row and is **silently skipped**.
- **Shared *binaries*, not just services.** Both planes' MCP rows can point at the same executable (here the patched `officecli` fork). Verify it before and after any upgrade — SHA256 prefix plus a `{{` count of 0 in its description text; a silently swapped copy breaks both planes at prompt-assembly time.
- **A restarted `dsh web` prints a NEW token URL.** Give the human a launcher that (a) stops the old host by command-line match, (b) starts the new one through a *scheduled task* so it outlives the caller, (c) redirects output to a log, (d) waits for the port and prints the fresh `?token=…` — the old browser tab is left unauthenticated.
- **A Task Scheduler action cannot carry `cmd /c "x.cmd" > log 2>&1`.** With a quoted first token plus redirection the task runs and dies instantly (exit 1, **empty log**) — the redirect never happens. Put the redirect inside a wrapper `.cmd` and make the task execute that wrapper file; and **run the launcher once yourself** before handing it over (proving the bundles resolve is not proving the launcher works).
- **Do not copy safety config between planes** (permission presets, approval switches, model defaults) when "making them the same" — those are per-plane choices.

## Verification

- One end-to-end tool call per plane (not just a port check).
- Diff the two profiles' dependency lists and patch-row ids; the difference should be exactly the intended exception(s).
- Reverse check: after editing one plane, re-list the other plane's profile and confirm it is unchanged.

## References

- **As-built (2026-10-11, verified):** the web host runs as scheduled task `dsh-web` → `D:\dsh\_logs\web-host-launch.cmd` → log `D:\dsh\_logs\web-host-current.log`; boot log clean (0/0/0/`not found`=0/`incompatible`=0); `xhs-mcp-service` needed a restart (18060 is single-instance, shared); the officecli check is the MCP `tools/list` probe, not a whole-binary grep.
- `references/home-split-2026-10-11.md` — the 2026-10-11 home split: clone sizes, the launcher-encoding failure, the mtime-freeze proof, revert path and leftovers (log tier).
- `references/web-mirror-2026-10-11.md` — worked example of a full plane-to-plane mirror: package/version matrix, the six keep/drop decisions, exact command forms, snapshot + rollback assets, acceptance checklist (log tier).
- `references/desktop-plane-state-2026-10.md` — this machine's concrete baseline, relocation record, scheduled tasks and open items (log tier).
- `references/host-api-driving.md` — drive any DSH host over `/api` without the GUI: launch-token → cookie auth, the `{type:'client-request', payload:{args}}` envelope, descriptor-exact arg names, `--port 0` lab-profile recipe, and the maintain-wall worked example (log tier).
