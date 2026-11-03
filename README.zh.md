# dsh-evolution：给 DeepSeek Harness 的自进化记忆与技能

[English](./README.md) · 中文

**一次安装：Agent 会记住项目，持续改进自己的技能，并把每次改动留下可审计的痕迹。**

这是 **36 个可组合 Cordis 插件**，不是模型、不是托管服务，也没有独立 GUI。模型只能写记忆和技能；策略、提示词、路由、状态和审计历史属于控制面，它改不了。

当前家族版本：**0.32.4**。平台线与依赖窗口见下文「兼容与版本」。

## 先跑起来

```bash
dsh plugin --profile web add @lmzhen/dsh-evolution-all
# 重启 dsh，让 profile 重新组合
/evolution doctor
```

默认 `all` 是完整形态。只要自动化、不要记忆/技能工具，用 `host`；只想在部分会话给工具，用 `host` + Evolution 预设。**一个 profile 只能挂一种**，挂两种会在启动时报重复注册。

## 装完你会得到什么

| 能力 | 它做什么 | 在哪里看 |
|---|---|---|
| 记忆 | 项目事实/偏好写进 `MEMORY.md` / `USER.md`，新会话自动带快照 | 设置页参数卡、`memory` 工具 |
| 技能 | 模型创建/修补/搬段/归档技能；每次写入有门禁、可审批、有版本 | `skill_manage`、技能历史侧栏 |
| 审查 | 会话边界做后台回顾；默认 inject，不另起子代理 | `/evolution params`、review-state 文件 |
| 整理 | 确定性的 stale/归档/合并；可选 LLM 提名 | `/evolution curator …`、报告 |
| 合并 | 筛选 → 两轮 authoring → 暂存 → 审批 → 提交 → 撤销 | `/evolution merge …`、合并面板 |
| 控制面 | 威胁扫描、不可变策略、可选审批 | 审批卡、`/evolution pending` |
| 可观测 | 活动账本、回放排行、健康、用量、学习图 | `/evolution replay`、`/graph`、健康面板 |

## 选安装形态（四选一）

| 形态 | 安装 | 模型工具 | 说明 |
|---|---|---|---|
| **all（默认）** | `dsh-evolution-all` | 每个会话 | 完整功能；无 preset 步骤 |
| host | `dsh-evolution-host` | 只有 `maintenance_probe`、`merge_stage` | 只要后台自动化 |
| preset（兼容） | `dsh-evolution-preset` | 每个会话 | 兼容旧配置；无设置/健康两行 |
| 分层 | `host` + `/evolution preset install` | 只有选中 Evolution 预设的会话 | 与 all/preset 互斥 |

`all`、`host`、`preset`、分层预设不能同挂。要缩配：先卸载，再装另一种。

## 命令与工具

主命令面：`/evolution`（30 条表项，展开 36 个叶子）、`/graph`；`/skill-domain` 只在 discovery `mode: on` 时注册。`/merge` 兼容别名在 0.32 已移除。

| 面 | 入口 |
|---|---|
| 预设安装 | 见 [命令手册](docs/commands.md) 的 preset install 行 |
| 审批 | `/evolution pending`、`approve <id>`、`reject <id>` |
| 诊断 | `/evolution doctor [--json]` |
| 整理 | `/evolution curator status|scope|report|run` |
| 合并 | `/evolution merge scan|pair|status|approve|resume|undo|doctor` |
| 模型工具 | `memory`、`skill_manage`、`skill_search`、`session_search`、`maintenance_probe`、`merge_stage` |

## 兼容与版本

| | 取值 |
|---|---|
| 验证平台线 | **`0.2.1-rc.3`** |
| 声明依赖窗口 | `^0.2.1-rc.2` |
| 家族版本 | `0.32.4` |
| Node | 22.19+ 或 24+ |

平台线只支持这一条；更早的预发布线在依赖解析阶段就失败，这是支持窗口，不是 bug。

安装形态对会话的影响、variant 的命令面差异，单源在 [packages/INSTALL.md](packages/INSTALL.md)。

## 安全边界

- **状态是 single-process**：本地 `node:fs` provider，不伪造跨进程锁/WAL。
- **不自动晋升 shadow**：影子写入必须显式提交。
- **不硬删除技能**：删除=归档；恢复/单元撤销是显式操作。
- **审批可选，门禁始终在**：审批关了，写门禁和威胁扫描仍然执行。
- **无遥测**：数据只在你自己的 `$DSH_HOME`。

## 已知限制

- `host` 本来就没有 memory/skill 工具。
- `skill-health` 在 all 中默认 disabled。
- `skill-discovery` 默认 `mode: off`，只留 `skill_search`。
- `merge/run`、`merge/runs` 只有路径常量，没有实现。
- `reviewToolAllow` 是死配置，代码不读。
- feedback 族内没有生产者/消费者；activity/replay 只在 branch 审查模式收到事件。
- `/merge` 别名已移除；`/evolution consolidate` 已退出用户面。

## 文档

- [docs/](docs/README.md)：入门、功能地图、命令手册、配置、运维、排障、架构、开发。
- [INSTALL.md](INSTALL.md)：安装/升级/卸载/验证。
- [packages/README.md](packages/README.md)：包地图与维护者参考。
- [CHANGELOG.md](CHANGELOG.md)：发布历史。
- [CONTRIBUTING.md](CONTRIBUTING.md)：贡献者门禁与规则。
