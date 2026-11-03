# 安装、升级与卸载

这份文档负责安装形态、安装命令、升级、卸载和验证。各形态对会话的精确影响以 [packages/INSTALL.md](packages/INSTALL.md) 为准；数据路径、备份和恢复见 [docs/operations.md](docs/operations.md)。

## 先决条件

- DeepSeek Harness：当前验证线为 **DSH `0.2.1-rc.3`**，发布包接受的最低平台版本为 `^0.2.1-rc.2`。
- Node.js `^22.19.0` 或 `>=24.0.0`。
- 可用的 `pnpm`：`dsh plugin` 会把 add/remove 转发给 pnpm。
- 一个能正常启动的 `dsh` profile。桌面 GUI 使用 `desktop`，Web/headless 通常使用 `web`。
- 模型和 API key 可选。自动复盘、整理器的 LLM 提名、技能发现域生成和维护扫描的模型部分需要它们；配置见 [docs/api-keys.md](docs/api-keys.md)。

## 默认安装：all

```bash
dsh plugin --profile web add @lmzhen/dsh-evolution-all
# 重启 dsh
```

`all` 在每个会话挂载记忆和技能工具，并提供设置页、技能历史与技能合并面板。设置页和侧栏面板只在 Web/桌面 GUI 显示。

安装后执行：

```text
/evolution doctor
```

`doctor` 检查安装形态、平台/家族版本和服务状态，不能证明模型工具实际可用。再让 Agent 写一条记忆、改一个技能，并开新会话确认记忆出现在预算内注入的快照中。

## 只要后台自动化：host

先移除其它家族形态，再安装：

```bash
dsh plugin --profile web remove @lmzhen/dsh-evolution-all
dsh plugin --profile web add @lmzhen/dsh-evolution-host
# 重启 dsh
```

`host` 挂载整理、报告和维护能力，但不注册 `memory` / `skill_manage`。由于会话没有这些家族模型行，自动复盘和技能用量统计的门控不会命中。它仍包含 `maintenance_probe` 和 `merge_stage`，所以“没有 memory/skill_manage”不等于没有任何模型工具；其中 `merge_stage` 只绑定合并子代理，不是普通用户直接调用的工具。

## 只在部分会话提供工具：分层预设

安装 host 与预设包：

```bash
dsh plugin --profile web add @lmzhen/dsh-evolution-host
dsh plugin --profile web add @lmzhen/dsh-evolution-agent-preset
# 重启 dsh
```

生成 Evolution 预设：

```text
/evolution preset install
```

再次重启 dsh。新会话选择 **Evolution** 预设后才有记忆/技能工具和自动行为；平台原预设的会话仍可看到管理命令，但没有这些工具或自动行为。默认基底是 `standard`，多基底用法见 [docs/commands.md](docs/commands.md#安装设置与迁移)。

## 兼容一键：preset

```bash
dsh plugin --profile web remove @lmzhen/dsh-evolution-all
dsh plugin --profile web add @lmzhen/dsh-evolution-preset
# 重启 dsh
```

`preset` 与 `all` 接近，但没有设置页和侧栏面板，供旧配置迁移使用；新装通常选 `all`。

## 形态互斥

`all`、`host`、`preset` 和分层预设在一个 profile 内互斥。它们共享基础行，混挂会在启动时重复注册并失败。切换形态时先移除旧形态，再安装新形态；分层预设行也要一并清理。

## 升级

**先升级平台，再升级家族。** 家族依赖窗口与平台线绑定。

1. 阅读目标版本的 `CHANGELOG.md`。
2. 停止宿主并按 [运维文档](docs/operations.md#备份) 备份 `$DSH_HOME`。
3. 升级 DeepSeek Harness，重启并确认宿主正常。
4. 升级家族 bundle：

```bash
dsh plugin --profile web add @lmzhen/dsh-evolution-all@0.32.5
```

5. 重启后运行 `/evolution doctor`，再实际写一次记忆、改一次技能。

其它形态使用对应包名和相同版本。不要为升级同时保留两个家族形态。

## 卸载

```bash
dsh plugin --profile web remove @lmzhen/dsh-evolution-all
# 重启 dsh
```

卸载会移除 bundle 及其依赖，但不会删除 `$DSH_HOME` 下的记忆、技能、报告、审批历史、`settings.yaml` 或 profile patch。重新安装后可继续使用这些数据。

分层安装还需删除 `/evolution preset install` 写入 `profiles/<profile>/cordis.patch.yml` 的 Evolution 预设行；卸载 host 不会自动删除它。源码安装可用下面的反向命令：

```bash
node packages/scripts/install-layered.mjs --profile web --mode layered --home "$DSH_HOME" --uninstall
```

没有源码树时，按 [运维文档](docs/operations.md#恢复与回退) 备份后手动删除该预设块。

> 桌面 GUI 用户把命令中的 `--profile web` 换成 `--profile desktop`。装错 profile 时，当前客户端不会出现命令或面板。

## 从源码安装（高级）

先构建，再运行安装器：

```bash
node packages/scripts/build-lib.mjs
node packages/scripts/install-layered.mjs --profile web --mode layered --home "$DSH_HOME"
```

安装器把家族包复制进 profile，并写入分层预设行；缺少构建产物会直接失败。生产安装优先使用 `dsh plugin add`。安装器完整参数以 `node packages/scripts/install-layered.mjs --help` 为准。

## 安装问题

- **`/evolution` 不存在**：先确认当前 profile、安装命令是否成功以及是否重启；此时无法先跑 doctor。检查可用的 `dsh --profile <p> --dump-config` 和启动日志，必要时重装。
- **没有 `memory` / `skill_manage`**：当前可能是 host；改用 all 或分层预设。
- **UI 不出现**：确认使用 all + Web/桌面 GUI，并检查客户端与连接服务。host/preset/分层不带这些面板。
- **启动报重复注册**：同一 profile 挂了多个家族形态；移除多余 bundle 和分层预设行后重启。
