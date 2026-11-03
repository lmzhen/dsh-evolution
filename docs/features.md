# 功能地图：它到底会做什么

这一页按“你会感知到的能力”组织，不按包名。每个能力都标明：什么时候发生、在哪里看到、默认是否开启。

## 1. 记忆回路

**做什么**：把项目事实、用户偏好写进 `$DSH_HOME/memories/MEMORY.md` 和 `USER.md`，新会话自动注入。

**谁参与**：

- `tool-memory`：模型面 `memory` 工具；`memory` 引导段和快照。
- `memory`：provider 注册表。
- `memory-files`：本地文件 provider、预算、写串行。
- `evolution-core`：真正的 `MemoryStore`（去重、预算、漂移、威胁扫描、失败退避）。

**你会看到**：

- 模型调用 `memory` 工具；写入成功后有事件刷新快照。
- 设置 → 自进化 → 参数卡里的「记忆」组（`memoryChars`、`userChars` 等）。
- 新会话开头自动带上记忆快照。

**默认**：开启。预算默认 2200 / 1375 字符；写超限会被拒，不会静默截断。

## 2. 技能回路

**做什么**：模型通过 `skill_manage` 创建/修改/删除/抽取/重组技能；目录 provider 把技能树发布给模型。

**入口**：`skill_manage` 工具（13 个 action）；`/evolution skill …` 命令；`/graph edit/delete` 也能编辑技能节点。

**写入保护**：

1. 结构/权限门（参数形状、缺失参数、策略保护、先读后写、人工确认）。
2. 可选审批暂存（`evolution-approval`，kind=skill）。
3. 执行时再查一次可复判的门。
4. 写成功后记录 usage、版本历史、变更事件。

**你会看到**：

- 技能文件在 `$DSH_HOME/skills/`；版本在 `.history/`；计数在 `.usage.json`。
- `/evolution skills health`、`/evolution skill history`、技能历史侧栏。
- 技能目录进入模型 `ctx.skills`；模型可以像用普通技能一样看到。

## 3. 后台审查

**做什么**：观察会话事件，在满足实质门槛时让模型回顾最近对话，产出可执行的改进计划。

**默认**：`reviewMode: inject`，在会话内注入，不另起子代理；默认按 cadence，不是每轮都跑。

**可选**：`reviewMode: branch` 起子会话；结果作为通知回投。它需要 agents 服务，且当前有已知限制（见 §8）。

**你会看到**：审查注入的提示、`/evolution params --group evolution-review`、`review-state.json` 计数。

## 4. 技能整理（curator）

**做什么**：确定性的生命周期管理：stale 判定、归档、合并近重复、usage 折叠；可选 LLM 提名。

**默认**：每小时 tick，间隔门默认较宽；`enabled: false` 只关自动调度，手动 `curator run` 仍可用。

**安全**：运行前先快照；失败回滚状态；归档不是硬删除，恢复走 `.archive`。

**你会看到**：`/evolution curator status|scope|report|run`、`/evolution restore`、`/evolution skill restore`、报告文件。

## 5. 技能合并

**做什么**：扫描技能库 → 引擎筛选候选 → 两轮 authoring → 暂存 → 审批/自动批准 → 提交 → 回执/撤销。

**入口**：`/evolution merge …`（16 个 verb），合并面板只读，`merge_stage` 只给合并子代理。

**默认**：`mergeApproval` 控制是否等待人工；扫描/pair 默认后台执行，返回 runId。

**你会看到**：侧栏「技能合并」、4 条只读路由、`$DSH_HOME/merge/` 下的运行/报告/回执。

## 6. 学习图 / 健康 / 用量

- `/graph`：技能与记忆节点的目录/detail/edit/delete；写走同一套写门禁。
- 技能健康：`/evolution skills health` 与侧栏健康面板；健康行默认 disabled，需要在 all 的 overlay 里显式开启。
- 用量：`skillUsage` 记录 view/patch/support-read；host-only 的会话范围门会让它不计数。

## 7. 控制面

- **策略**：不可变快照，模型不能改。
- **威胁扫描**：写 memory/skill 前扫描注入、角色劫持、外泄、持久化、密钥、隐形字符。
- **审批**：默认关闭；打开后每次写入进入待批窗口，批准后由对应 runner 回放。
- **审计**：审批决定带 decision audit；运行/报告/事件都落文件。

## 8. 已存在但默认关闭/有条件的能力

这些不是“没有”，而是默认不启用或需要条件：

| 能力 | 默认 | 条件 |
|---|---|---|
| 审批 | 关闭 | `approval.enabled: true` |
| 技能健康 | all 中 disabled | 手动启用该行 |
| 技能发现域卡 | `mode: off` | `mode: on`，且需要 llm/投影服务 |
| state-domain | disabled | 需要 `storageDomain`，并改 `provider` |
| branch 审查 | inject | `reviewMode: branch` + agents |
| `/merge` 别名 | 已移除 | 不再注册 |
| `/evolution consolidate` | 已退出用户面 | 没有命令入口 |
| merge `run/runs` 路由 | 未实现 | 只有常量，没有注册者 |
| host-only 模型工具 | 只有 maintenance_probe + merge_stage | 要记忆/技能工具请用 all/分层预设 |

## 9. 它不做什么

- 不训练模型，不做 embedding/LLM judge 热路径。
- 不提供跨进程文件锁或 WAL；状态介质只承诺 single-process。
- 不自动晋升 shadow/影子写入。
- 不把策略、提示词、路由、状态、审计历史交给模型。
- 不保证“所有能力在 host-only 都有”；host-only 是缩配，不是全量。

## 10. 功能面速查

| 面 | 数量 | 入口 |
|---|---:|---|
| 顶层命令 | 3 | `/evolution`、`/graph`、`/skill-domain`（mode:on） |
| `/evolution` 表项 | 30（展开 36 叶子） | 见命令手册 |
| 模型工具 | 6 | `memory`、`skill_manage`、`skill_search`、`session_search`、`maintenance_probe`、`merge_stage` |
| HTTP 路由 | 16 已实现 | diagnostics/approval/history/health/merge |
| 面板 | 4 | 设置区段、技能历史、技能合并、技能健康 |
| 常驻服务 | 12 | 见架构 |
| 未实现 | 2 | `merge/run`、`merge/runs` 路径常量 |
