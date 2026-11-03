# 配置：把默认行为调到适合你

配置分三层：

1. **安装形态**（M1–M4）：决定模型有没有工具、哪些会话有。
2. **行配置**：bundle YAML 或 profile 配置里的键，控制每个插件的开关/预算/间隔。
3. **设置页卡片**：已注册为 E3 的参数，可以在 设置 → 自进化 里改；写入走平台 `settings.update`。

> 不是所有键都能在设置页改。E3 才有卡片；部署级/只读键要改 profile 配置并重启。

## 1. 四种模式（M1–M4）

| 模式 | 安装 | 模型工具 | 典型用途 |
|---|---|---|---|
| **M1 全自动（默认）** | `all` | 每个会话都有 | 日常使用，信任模型自动写 |
| **M2 人审** | `all` + `approval.enabled: true` | 每个会话都有 | 每次写入先审批 |
| **M3 只装底座** | `host` | 无 memory/skill_manage | 只要自动审查/整理，不给写工具 |
| **M4 分层** | `host` + `/evolution preset install` | 只有选中 Evolution 预设的会话 | 按会话给工具 |

`all`/`host`/`preset`/分层预设互斥，不能同挂。

## 2. 审批

默认关闭。打开后：

```yaml
approval:
  enabled: true
  # 可选：pending 的存活时间；0 = 永不过期
  pendingTtlMs: 0
  # create/裸 delete 的人工确认：auto | ask | timeout
  approvalConfirm: auto
```

- 审批只影响**可暂存**的写入；memory、skill 有 runner。
- 批准后由 runner 回放；拒绝不会执行。
- `release` 只用于回收“执行中但持有者已死”的记录；它不是批准。
- 约束：暂存依赖 `evolutionState` 服务；没有状态时不能暂存。

## 3. 记忆预算

在设置 → 自进化 → 参数卡「记忆」，或 memory-files 行：

| 键 | 默认 | 含义 |
|---|---:|---|
| `memoryChars` | 2200 | 项目记忆预算 |
| `userChars` | 1375 | 用户画像预算 |
| `addDatePrefix` | false | 新条目是否带日期前缀 |
| `maxConsolidationFailures` | 3 | 合并失败退避阈值 |
| `entryPreviewChars` | 200 | `tool-memory`：memory 工具回显条目截断 |
| `memoryEnabled` | true | `tool-memory`：关掉后不注册工具/提示（仍注册拒绝式 runner） |

预算有优先级：显式配置 > 已挂载 policy > 默认。显式值与 policy 不一致会 warn。数值会 clamp/floor，不会把小数写进 integer schema。

## 4. 审查

| 键 | 默认 | 说明 |
|---|---|---|
| `reviewEnabled` | true | 总开关 |
| `reviewMode` | inject | inject（会话内）/ branch（子会话） |
| `reviewMemoryInterval` | 由 cadence 决定 | 记忆触发间隔 |
| `reviewSkillInterval` | 由 cadence 决定 | 技能触发间隔 |
| `skillReviewTrigger` | cadence | cadence / completion |
| `skillReviewCompletionMinToolCalls` | 默认值 | completion 通道阈值 |
| `reviewToolAllow` | — | **当前是死配置**；代码不读取，不要依赖 |

`branch` 需要 agents 服务；结果通知在当前版本有一个已知边界：`REVIEW_RESULT_SUMMARY` 没有生产者，branch 结果可能被当成提示占用未结窗口。

## 5. 技能整理（curator）

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | true | false 只关自动调度，手动 run 仍可用 |
| `curatorIntervalHours` | 168 | 自动整理间隔（旧名 `intervalHours` 只读） |
| `autoStart` | true | 启动宽限后是否自动跑 |
| `bootGraceSeconds` | 默认 | 启动宽限 |
| `llmReview` | false | 是否用 LLM 提名；需要 llm 服务 |
| `curatorReviewTimeoutMs` | 默认 | LLM 提名超时 |

整理先快照；失败回滚状态；归档不是硬删除。

## 6. 技能发现（discovery）

**默认 `mode: off`**。off 时只保留 `skill_search` 工具；域图、agent/pre-step 投影、awareness、描述刷新、`/skill-domain` 都不注册。

要开启：

```yaml
skill-discovery:
  mode: on
  featureEpoch: v1
  mapReferenceCwd: /path/to/reference/view
  searchEnabled: true
```

- `mode: on` 需要 `llm` 服务；缺了会直接抛 `llm-unavailable`，不是降级。
- `generate` 只对空地图生效；必须配 `mapReferenceCwd`。
- 域策略只认 `mode`/`pinDomains`/`disableDomains`/`revision`；未知域 id 记 degraded。

## 7. 技能合并

| 键 | 说明 |
|---|---|
| `mergeApproval` | true=等待审批；false=自动批准 |
| `mergeModelsRoot` | 本地 potion 模型目录；不配会 fail loud |
| `mergeMaxPairs` / 其他 engine 参数 | 白名单四键；未知键直接抛 |

模型不会自动下载；缺模型时 `/evolution doctor` 会提示。

## 8. 状态介质

默认 JSON：

```yaml
evolutionState:
  provider: json
```

可选 domain（需要 `storageDomain`）：

```yaml
evolution-state-domain:
  # 行本身默认 disabled；启用前确认宿主有 storageDomain
evolutionState:
  provider: domain
```

多个 provider 同时注册且没有 pin 时，state 门面会直接抛错，避免静默选错介质。

## 9. 技能健康 / 会话范围

- 技能健康行在 all 中 `disabled: true`；要开就显式启用该行。
- `sessionScoped: true` 时，审查/用量只统计“会话能看到 skill_manage/memory”的会话；host-only 永远不命中，这是设计。

## 10. 配置改完怎么确认

```text
/evolution doctor
/evolution params --group <group>
```

`doctor` 看安装形态/行/服务；`params` 看参数当前值、来源（默认/用户/policy）、是否已注册。
