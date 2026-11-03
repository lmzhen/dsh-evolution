# 架构：36 个包如何叠起来

## 1. 一张图

```text
用户/模型
  │  /evolution …        memory / skill_manage / skill_search / merge_stage
  │  设置页/侧栏面板       HTTP 路由
  ▼
命令与 UI 层      evolution-commands · evolution-ui · evolution-merge-ui · evolution-client-kit
  ▼
领域服务层        review · curator · merge · approval · learning-graph · skill-health · skill-usage
  ▼
能力底座          core（SkillLibrary / MemoryStore / prompts / projections / events）
  │               memory · memory-files · tool-memory · tool-skill-manage
  │               skill-catalog · skill-discovery
  ▼
控制面            policy · threat · approval · state
  ▼
状态与 IO         state-storage · state-json / state-domain · io · io-node
  ▼
$DSH_HOME 文件（memories / skills / evolution / merge）
```

## 2. 七个包组

| 组 | 包 | 职责 |
|---|---|---|
| 基础 | contract/core/io/io-node/state-storage/state-json/state-domain/state/policy/threat/approval | 类型、IO、状态、事务、策略、威胁、技能/记忆底座与可暂存写审批 |
| 合并 | merge/merge-engine | 合并域 + 引擎 |
| 审查自动化 | review/maintenance/curator/learning-graph/activity/feedback/replay | 审查、维护、整理、图、账本、反馈、回放 |
| 技能生态 | skill-catalog/skill-discovery/skill-health/skill-usage/tool-skill-manage | 目录、检索/域卡、健康、用量、写入工具 |
| 命令与 UI | commands/ui/merge-ui/client-kit | 命令面、设置/历史、合并面板、客户端基础 |
| 安装形态 | host/all/preset/agent | 基础设施/全量/兼容/预设 delta |
| 记忆与工具 | memory/memory-files/tool-memory | 记忆注册表、文件 provider、模型工具 |

## 3. 三条最重要的写路径

### 3.1 技能写

```text
skill_manage / /evolution / /graph
  → core write-gates（argument → missing → policy → read-before-write → confirm）
  → 可选 approval.request(kind=skill)
  → SkillLibrary（校验、保护、版本历史、事件）
  → evolution/skill-mutated → catalog 缓存失效 / usage / merge supersede
```

### 3.2 记忆写

```text
memory 工具 / /graph memory edit
  → tool-memory 预校验
  → 可选 approval.request(kind=memory)
  → memory 注册表
  → memory-files provider（预算/串行）
  → core MemoryStore（去重、漂移、威胁、退避）
  → evolution/memory-applied → 快照刷新
```

### 3.3 合并

```text
/evolution merge scan → 引擎 screen（stub 或 deepseek judge）
/evolution merge pair  → 直接指定技能对，round1 使用子会话模型
  → PairLedger：pending 或 auto-approved
  → 两轮 authoring（merge_stage 只给绑定子代理）
  → staged tree 校验
  → UnitTransaction（prepare/commit/finalize）
  → 回执；失败 → undo / recovery / reconcile
```

## 4. 状态与一致性

- **单一状态介质**：state-storage 定义契约；state-json 是出厂默认，state-domain 可选。
- **单一写者**：state 门面只转发；merge 的 reconcile 是行状态唯一收敛写者。
- **CAS**：WriteKernel 在 expected 不匹配时拒绝写入；UnitTransaction 负责 prepare/commit/rollback。
- **不跨进程**：IO 只有 single-process node provider；不要把它当分布式锁。
- **恢复**：启动时 merge 会做 commit-unit recovery；state-json 有 quarantine/legacy 退休；curator 先快照。

## 5. 控制面边界

模型能写：

- `MEMORY.md` / `USER.md`（经 memory 工具）。
- `skills/`（经 skill_manage / graph / merge 的受控路径）。

模型不能写：

- 策略、提示词、路由、状态、审计历史。
- 审批决定（审批由人/宿主决定）。
- 绕过写门禁或审批 runner。

policy 的 `tools.guard` 只拦 6 个控制键；threat 只扫描 memory/skill 写工具。它们是“控制面护栏”，不是通用沙箱。

## 6. 主要持久文件

| 文件 | 作用 |
|---|---|
| `memories/MEMORY.md` / `USER.md` | 记忆/画像 |
| `skills/` + `.history/` + `.usage.json` | 技能树、版本、用量 |
| `evolution/events.json` | 自进化时间线 |
| `evolution/review-state.json` | 审查计数 |
| `evolution/activity.json` | 计划执行结果 |
| `evolution/runs.json` | 长任务登记 |
| `evolution/approval/pending.json` | 待批/执行中 |
| `evolution/reports/` | 维护/整理报告 |
| `evolution/merge/` | merge 运行状态、staging、提交回执与合并事务记录 |
| `units/skill/` | 当前技能单元的 journals/snapshots，用于单元撤销与恢复 |
| `merge/` | 旧版树改动快照的兼容回退；不属于 merge 的运行状态或当前单元主存储 |

## 7. 不变量（改代码前先读）

1. **merge-engine 筛选 pipeline ①–⑤ 冻结**：阶段/IO/模型/权重/阈值/过滤/评分/判定/候选集/排序不改；只允许包装/适配/错误边界/诊断/测试。
2. **single-process 诚实**：不伪造跨进程锁；state 介质声明 single-process。
3. **一个事实一个家**：文档/参数/路由/事件都有唯一来源；镜像由生成器产出。
4. **不自动晋升 shadow**：影子写入只能显式审批/提交。
5. **不按文件拆微包**：包按能力边界，不按文件。
6. **embedding/LLM judge 不进热路径**：合并 judge 是离线/子代理路径，不阻塞每次写。
7. **审批默认关闭，但写门禁始终在**：审批是附加闸门，不是唯一保护。
