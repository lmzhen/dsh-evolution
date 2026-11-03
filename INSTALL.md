# 安装与升级

这份文档只管安装、升级、卸载和验证。每种安装形态对会话的精确影响，单源在 [packages/INSTALL.md](packages/INSTALL.md)。

## 先决条件

- DeepSeek Harness 平台线：**DSH `0.2.1-rc.3`**（发布包声明的最低版本为 `^0.2.1-rc.2`）。
- Node 22.19+ 或 24+。
- 能正常运行的 `dsh` profile。
- 模型/API key：可选；自动复盘、LLM 整理、技能发现域生成需要。配置方式见 [docs/api-keys.md](docs/api-keys.md)。

## 默认安装（推荐）

```bash
dsh plugin --profile web add @lmzhen/dsh-evolution-all
# 重启 dsh
/evolution doctor
```

`all` 是完整体验：每个会话都有记忆、技能工具，外加设置页、技能历史、技能合并面板。适合大多数用户。

## 只要自动化：host

```bash
dsh plugin --profile web remove @lmzhen/dsh-evolution-all
dsh plugin --profile web add @lmzhen/dsh-evolution-host
```

`host` 会跑整理和报告，但**不注册** `memory` / `skill_manage` 工具；由于缺少这些工具，自动复盘和用量统计在该形态下也不会生效。适合“我不想让模型自己写记忆/技能，但想要后台整理”的场景。

## 只在部分会话给工具：分层预设

先装 host 和预设包：

```bash
dsh plugin --profile web add @lmzhen/dsh-evolution-host
dsh plugin --profile web add @lmzhen/dsh-evolution-agent-preset
# 重启 dsh
```

再生成 Evolution 预设：

```text
/evolution preset install
```

然后再重启一次 dsh。之后新建会话时选择 **Evolution** 预设；只有这些会话有记忆/技能工具。其它会话不受影响。

默认基底是 `standard`；其它基底属于高级用法，普通用户不用管。

> 分层预设与 `all` / `preset` 互斥，不能同挂。

## 兼容一键：preset

```bash
dsh plugin --profile web add @lmzhen/dsh-evolution-preset
```

与 `all` 接近，但没有设置页和三个侧栏面板。适合从旧配置迁移；新装建议 `all`。

## 验证

```text
/evolution doctor
```

看三件事：

1. 安装形态是不是你选的那一种；
2. 家族版本与平台线；
3. 实际写一次记忆/改一次技能；doctor 不能证明工具存在，只能看形态/服务/scoped 探针。

再做一个最小读写：

> 记住：这个项目用 pnpm。

然后开新会话，看它是否自动带回来。

## 升级

**顺序：先平台，后家族。** 平台线和家族的依赖窗口绑定；反过来升级会遇到依赖解析失败。

1. 读目标版本的 `CHANGELOG.md`。
2. 备份 `$DSH_HOME`。
3. 升级 DeepSeek Harness，重启，确认宿主正常。
4. 升级家族 bundle。
5. 重启后 `/evolution doctor`。
6. 做一次记忆写入 + 一次技能改动，确认还能用。

升级命令：

```bash
dsh plugin --profile web add @lmzhen/dsh-evolution-all@0.32.5
# 或先 remove 再 add，避免旧行残留
```

## 卸载

```bash
dsh plugin --profile web remove @lmzhen/dsh-evolution-all
```

卸载只移除插件行。`$DSH_HOME` 下的记忆、技能、报告和审批历史保留；重新安装会接上。分层的用户注意：`/evolution preset install` 写进 profile patch 的预设行不会随卸载自动删除，残留可能导致下次启动失败；按安装器 `--uninstall` 清理，或手删 profile patch 里的预设块。

> 桌面 GUI 用户把 `--profile web` 换成 `--profile desktop`；装错 profile 的典型症状是“装完什么都没出现”。

## 从源码安装（高级）

```bash
node packages/scripts/install-layered.mjs --profile web --mode layered --home "$DSH_HOME"
```

源码安装器把家族包复制进 profile，并写入一条预设行。日常用户不需要走这条路径；生产安装用 `dsh plugin add`。

## 常见安装问题

- **命令不存在**：命令功能没装上，或装错 profile。先确认启动的是哪个 profile（`--profile web` 还是 `desktop`），检查 `dsh --profile <p> --dump-config` 和日志；命令都没了时 `/evolution doctor` 也跑不了，重装并重启。
- **没有 memory/skill_manage 工具**：你可能装的是 host；换 all 或分层预设。
- **UI 面板不出现**：缺少客户端/连接服务，或你装的是 host/preset；检查安装形态。
- **启动报重复注册**：同一 profile 挂了两种形态；先卸载再去重。
