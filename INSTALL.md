# 安装、升级与卸载

这份文档负责安装命令、升级、卸载和验证。各形态对会话的精确影响以 [packages/INSTALL.md](packages/INSTALL.md) 为准；数据路径、备份和恢复见 [docs/operations.md](docs/operations.md)。

## 先决条件

- DeepSeek Harness 官方 **0.2.2-rc.3**（npm `next` 线；`latest` 尚未提升）。0.50.0 不再支持 rc.1/rc.2；旧平台请继续用 0.49.x。
- Node.js `^22.19.0` 或 `>=24.0.0`。
- 可用的 `pnpm`：`dsh plugin` 会把 add/remove 转发给 pnpm。
- 一个能正常启动的 `dsh` profile。桌面 GUI 使用 `desktop`，Web/headless 通常使用 `web`。

## 安装：all（唯一产品安装）

```bash
dsh plugin --profile web add @lmzhen/dsh-evolution-all
# 重启 dsh
```

安装和升级都走 `dsh plugin add`：平台把 add/remove 转发给 pnpm（桌面端用应用内置的 pnpm）。**不要手工 `npm install`** —— npm 会在 profile 里留下 `package-lock.json` 和扁平 `node_modules`，之后插件页的「更新」按钮走 pnpm 时会和它打架（锁文件双份、依赖树两套）。已经用 npm 装过的修法：关掉 dsh，删 `profiles/<profile>/package-lock.json`，在 profile 目录里用 pnpm 重新 `add` 一次同一版本，再重启。

`all` 在每个会话挂载记忆和技能工具，并在 Web/桌面 GUI 提供进化工作台（技能/数据总览/待我确认/合并建议）。参数在 Web/桌面 GUI 的「设置 → 能力进化」里按功能分组编辑；安装和开关由平台的插件管理负责。

安装后执行：

```text
/evolution doctor
```

`doctor` 检查安装形态、平台/家族版本和服务状态，不能证明模型工具实际可用。再让 Agent 写一条记忆、改一个技能，并开新会话确认记忆出现在预算内注入的快照中。

## 高级组合：host

只有在明确要自己组合行时才安装 host：

```bash
dsh plugin --profile web remove @lmzhen/dsh-evolution-all
dsh plugin --profile web add @lmzhen/dsh-evolution-host
# 重启 dsh
```

`host` 挂载整理、报告和维护能力，但不注册 `memory` / `skill_manage`。它不是产品默认形态。

## 互斥

`all` 与 `host` 共享基础行，混挂会在启动时重复注册并失败。切换形态时先移除旧形态，再安装新形态。0.48 只保留 all/host 两种安装形态；旧的 one-click preset 与分层预设安装已移除，`--uninstall --mode oneclick|agent|layered` 仅保留一个版本用于清理 0.47 及更早的 profile。

## 升级

**先升级平台，再升级家族。** 家族依赖窗口与平台线绑定。

1. 阅读目标版本的 `CHANGELOG.md`。
2. 停止宿主并按 [运维文档](docs/operations.md#备份) 备份 `$DSH_HOME`。
3. 升级 DeepSeek Harness，重启并确认宿主正常。
4. 升级家族 bundle：

```bash
dsh plugin --profile web add @lmzhen/dsh-evolution-all@0.55.1
```

5. 重启后运行 `/evolution doctor`，再实际写一次记忆、改一次技能。

升级只操作 `all`。profile 不应直接依赖 `@lmzhen/dsh-evolution-*` 子包：点击更新时平台只替换 `all`，子包由 `all` 的精确依赖一起更新。若版本卡显示新版本但界面仍是旧版，说明 profile 是旧的混合安装（直接依赖子包或复制过 `node_modules`）；退出宿主后按下节修复。

### 修复旧的混合安装

先退出宿主并备份 `$DSH_HOME`，再执行：

```bash
# 使用 DSH 桌面应用内置 pnpm 的路径（或 PATH 里的 pnpm）
node packages/scripts/install-layered.mjs --repair \
  --profile desktop --home "$DSH_HOME" \
  --pnpm "$DSH_DESKTOP_PNPM"
```

`--version` 可省略，默认使用已安装的 `all` 版本。桌面应用的内置 pnpm 在 `<安装目录>\resources\runtime\primary-runtime\dependencies\pnpm\bin\pnpm.cjs`；也可以把 `DSH_DESKTOP_PNPM` 设为该路径，或让 PATH 里有 pnpm；如果这些都没有设置，删掉 `--pnpm` 参数即可回退到 PATH。命令会保留 `all` 一行，删除其它家族直接依赖，备份旧 `node_modules`，重新用 pnpm 安装，并验证 20 个包同版本。失败会自动恢复。修复完成后重启宿主。

修复脚本位于源码 checkout；只通过 `dsh plugin add` 安装、没有源码树的用户，可用同版本的源码目录运行它，或按上面的 profile 依赖规则手工移除子包后重装 `all`。

`install-layered` 的普通安装会复制源码/离线包，只用于开发或离线场景；这种 profile 不支持 GUI 增量升级，需要重新执行安装器或先 `--repair` 转为 pnpm 管理。

## 卸载

```bash
dsh plugin --profile web remove @lmzhen/dsh-evolution-all
# 重启 dsh
```

卸载会移除 bundle 及其依赖，但不会删除 `$DSH_HOME` 下的记忆、技能、报告、审批历史或 profile patch。重新安装后可继续使用这些数据。

## 从源码安装（高级）

只用于开发/实验，不是产品安装路径：

```bash
node packages/scripts/build-lib.mjs
node packages/scripts/install-layered.mjs --profile web --mode all --home "$DSH_HOME"
```

默认源码 scope 下 installer 使用 `@deepseek-ai/dsh-evolution-all`；设置页对产品 scope 与源码 scope 都适用。安装器完整参数以 `node packages/scripts/install-layered.mjs --help` 为准。这条路径会把包复制进 profile，属于开发/离线安装；它不支持平台 GUI 的增量升级。需要点击升级时，用 `dsh plugin add` 安装，或先跑 `--repair` 把旧 profile 转成 pnpm 管理。

## 安装问题

- **`/evolution` 不存在**：确认 profile、安装命令和重启；此时先查 `dsh --profile <p> --dump-config` 与启动日志。
- **没有 `memory` / `skill_manage`**：当前可能是 host；改回 all。
- **UI 不出现**：确认使用 all + Web/桌面 GUI，并检查客户端与连接服务。
- **设置面板不可用**：平台没有设置分区时（旧平台线）参数改不了，只能用 `/evolution params` 只读查看；不再有 `/evolution policy` 命令。
- **启动报重复注册**：同一 profile 挂了多个家族形态；移除多余 bundle 后重启。
