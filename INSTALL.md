# 安装、升级与卸载

这份文档负责安装命令、升级、卸载和验证。各形态对会话的精确影响以 [packages/INSTALL.md](packages/INSTALL.md) 为准；数据路径、备份和恢复见 [docs/operations.md](docs/operations.md)。

## 先决条件

- DeepSeek Harness 官方 **0.2.2-rc.1** 或同一兼容线。
- Node.js `^22.19.0` 或 `>=24.0.0`。
- 可用的 `pnpm`：`dsh plugin` 会把 add/remove 转发给 pnpm。
- 一个能正常启动的 `dsh` profile。桌面 GUI 使用 `desktop`，Web/headless 通常使用 `web`。

## 安装：all（唯一产品安装）

```bash
dsh plugin --profile web add @lmzhen/dsh-evolution-all
# 重启 dsh
```

安装和升级都走 `dsh plugin add`：平台把 add/remove 转发给 pnpm（桌面端用应用内置的 pnpm）。**不要手工 `npm install`** —— npm 会在 profile 里留下 `package-lock.json` 和扁平 `node_modules`，之后插件页的「更新」按钮走 pnpm 时会和它打架（锁文件双份、依赖树两套）。已经用 npm 装过的修法：关掉 dsh，删 `profiles/<profile>/package-lock.json`，在 profile 目录里用 pnpm 重新 `add` 一次同一版本，再重启。

`all` 在每个会话挂载记忆和技能工具，并在 Web/桌面 GUI 提供进化工作台（技能历史/待批/合并/健康）。参数在 Web/桌面 GUI 的「设置 → 能力进化」里按功能分组编辑；安装和开关由平台的插件管理负责。

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

`all` 与 `host` 共享基础行，混挂会在启动时重复注册并失败。切换形态时先移除旧形态，再安装新形态。旧的 `preset` 和分层预设已退役，不再发布，也不作为安装选项。

## 升级

**先升级平台，再升级家族。** 家族依赖窗口与平台线绑定。

1. 阅读目标版本的 `CHANGELOG.md`。
2. 停止宿主并按 [运维文档](docs/operations.md#备份) 备份 `$DSH_HOME`。
3. 升级 DeepSeek Harness，重启并确认宿主正常。
4. 升级家族 bundle：

```bash
dsh plugin --profile web add @lmzhen/dsh-evolution-all@0.44.0
```

5. 重启后运行 `/evolution doctor`，再实际写一次记忆、改一次技能。

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

默认源码 scope 下 installer 使用 `@deepseek-ai/dsh-evolution-all`；设置页对产品 scope 与源码 scope 都适用。安装器完整参数以 `node packages/scripts/install-layered.mjs --help` 为准。

## 安装问题

- **`/evolution` 不存在**：确认 profile、安装命令和重启；此时先查 `dsh --profile <p> --dump-config` 与启动日志。
- **没有 `memory` / `skill_manage`**：当前可能是 host；改回 all。
- **UI 不出现**：确认使用 all + Web/桌面 GUI，并检查客户端与连接服务。
- **设置面板不可用**：平台没有设置分区时（旧平台线）参数改不了，只能用 `/evolution params` 只读查看；不再有 `/evolution policy` 命令。
- **启动报重复注册**：同一 profile 挂了多个家族形态；移除多余 bundle 后重启。
