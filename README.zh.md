# dsh-evolution

给 DeepSeek Harness 的自进化记忆与技能。

装一次，之后 Agent 可以：

- **记住你的项目**：决策、命令、偏好，下次会话自动带回来；
- **改进自己的技能**：创建、修补、拆分、合并技能，带历史和撤销；
- **主动复盘**：在自然节点把“刚才发生了什么”变成改进计划，不用你每次提醒；
- **始终在你控制下**：每次写入都可以等你审批；删除是归档，不是硬删。

它不是模型，也不是托管服务；数据都在你的 `$DSH_HOME` 下。

## 安装

```bash
dsh plugin --profile web add @lmzhen/dsh-evolution-all
# 重启 dsh，然后在任意会话：
/evolution doctor
```

重启后，让 Agent 记一件事：

> 记住：这个仓库用 pnpm，测试命令是 `pnpm test`。

然后开一个新会话，这条事实已经在了。最小的闭环就是：**记住 → 复用 → 改进**。

## 四种用法

| 你想怎样 | 装什么 | 你会得到 |
|---|---|---|
| 完整体验（推荐） | `@lmzhen/dsh-evolution-all` | 每个会话都有记忆/技能工具，外加设置页和面板 |
| 只要自动化，不要模型写权限 | `@lmzhen/dsh-evolution-host` | 整理、报告照跑；Agent 不能写记忆/技能，review/用量也不生效 |
| 只在部分会话给工具 | `host` + `agent-preset` + `/evolution preset install` | 只有选中 Evolution 预设的会话有工具，其它会话不受影响 |
| 旧的一键配置 | `@lmzhen/dsh-evolution-preset` | 兼容形态；没有设置页和三个侧栏面板 |

**一个 profile 只能挂一种**；换形态先卸载再装。每种形态对会话的精确影响单源在 [packages/INSTALL.md](packages/INSTALL.md)，这里不重复。

## 你实际会用的功能

### 记忆

让 Agent 记住一条事实，或者它自己注意到。它会写 `$DSH_HOME/memories/MEMORY.md` / `USER.md`，新会话自动带一段快照。预算可以在设置里改。

### 技能

让 Agent 把重复流程写成技能。它可以创建、修补、拆分、合并、归档。改错了用 `/evolution skill history <name>` 看版本，`/evolution skill undo <name>` 退回。

### 后台复盘

在自然节点，Agent 回顾刚才发生了什么，给出改进建议。默认在会话内做，不是每句话都打断你。频率可调，也可以关掉。

### 自动整理

整理器定期把过时技能标 stale、把不再用的归档、把近重复的合并。它先快照，删除是归档；用 `/evolution curator status` 和 `/evolution curator report` 看它做了什么。

### 技能合并

两个技能重叠时，Agent 可以提议合并。**默认会自动合并并写入**；打开审批才会等你批准/拒绝。合并结果可以撤销；面板只读，展示队列并复制命令。

### 审批

默认关闭。打开后，每次记忆/技能写入都等你批。日常就三条：`/evolution pending`、`/evolution approve <id>`、`/evolution reject <id>`。

## 日常命令

| 命令 | 什么时候用 |
|---|---|
| `/evolution doctor` | 安装/升级后，或怀疑功能没挂上 |
| `/evolution pending` | 看等待审批的写入 |
| `/evolution skill history <name>` | 看/撤销技能改动 |
| `/evolution curator status` | 看自动整理是否到期 |
| `/evolution merge pending` | 看合并提议 |
| `/graph` | 浏览/编辑技能与记忆图 |

还有高级命令（维护扫描、回放、预设安装、章节抽取），在 [docs/commands.md](docs/commands.md) 里；日常不用。

## 值得改的设置

- **审批**：开/关；批准时是否再问一次（只有 all + Web 有设置页）。
- **记忆预算**：项目记忆和用户画像各留多少。
- **复盘频率**：多久回顾一次，或关掉。
- **整理间隔**：多久清理/合并一次。

其它都有合理默认；完整用户向参数见 [docs/configuration.md](docs/configuration.md)。

## 隐私与安全

- 无遥测、无托管服务；数据在 `$DSH_HOME`。
- 模型只能写记忆和技能；内部策略、提示词和审计记录模型改不了。
- 删除技能是归档；恢复和撤销是显式操作。合并有回执。
- 写入前有威胁扫描；审批关着也照扫。

## 兼容性

| | 取值 |
|---|---|
| 验证平台线 | **`0.2.1-rc.3`** |
| 发布依赖窗口 | `^0.2.1-rc.2` |
| 家族版本 | `0.32.5` |
| Node | 22.19+ 或 24+ |

平台线只支持这一代；更早的预发布线会在依赖解析阶段失败。安装细节见 [INSTALL.md](INSTALL.md)。

## 文档

- [入门](docs/getting-started.md)：10 分钟从安装到第一次记住。
- [功能说明](docs/features.md)：从用户视角看五条回路。
- [命令](docs/commands.md)：日常与高级命令。
- [设置](docs/configuration.md)：审批、预算、频率。
- [模型/API key](docs/api-keys.md)：哪些功能要模型、怎么配。
- [运维](docs/operations.md)：备份、升级、卸载、doctor。
- [排障](docs/troubleshooting.md)：症状 → 动作。
- [安装细节](INSTALL.md)：四种形态与升级顺序。

## 已知边界

- **host** 形态没有记忆/技能工具；这是它的用途。要写记忆/技能，用 all 或分层预设。
- 审批默认关闭；要人工闸门就打开。
- 技能健康面板在完整包里默认关闭；它是可选项。
- 需要模型或本地合并模型的功能，失败会明确报错，不会假装成功。
