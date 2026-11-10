# 设置

常用设置是审批、记忆预算、复盘频率和整理频率。完整参数及 E0–E4 写入面见 [../packages/PARAMETERS.md](../packages/PARAMETERS.md)。

## 审批与写入确认

审批默认关闭。开启后，可暂存的 memory/skill 写入进入待批窗口；整理器的生命周期动作和技能合并有各自控制，不要与这套写入审批混为一谈。

| 设置 | 默认值 | 说明 |
|---|---|---|
| `evolution-approval.enabled` | `false` | 是否启用暂存审批 |
| `approvalConfirm` | `auto` | 批准时直接执行；`ask` 会再确认一次 |
| `evolution-approval.pendingTtlMs` | `0` | 待批保留毫秒数；0 表示永不过期，过期会关闭为拒绝且不执行 |

技能创建和裸删另有一次确认，与暂存审批独立：

| 设置 | 默认值 | 说明 |
|---|---|---|
| `skillWriteConfirm` | `auto` | `auto` 直接写；`ask` 一直等待；`timeout` 超时未答则取消 |
| `skillWriteConfirmTimeoutSeconds` | `120` | 仅 `timeout` 模式使用的等待秒数 |

## 记忆预算

| 设置 | 默认值 | 说明 |
|---|---:|---|
| `memoryChars` | 2200 | `MEMORY.md` 的字符预算 |
| `userChars` | 1375 | `USER.md` 的字符预算 |

用量达到约 80% 后会出现存储提示。预算写满时新增会被拒绝；替换只有在未触发超限保护且替换后仍满足预算时才能执行。

调低预算不会立即删改现有内容。若已有单条记忆超过新上限，**删除是恢复通道**；此时 replace 不会绕开保护，先删除或缩短超限条目，再继续写入。

## 自动复盘

| 设置 | 默认值 | 说明 |
|---|---|---|
| `reviewEnabled` | `true` | 自动复盘总开关 |
| `reviewMode` | `inject` | 在当前会话内复盘；`branch` 使用后台子会话 |
| `reviewMemoryInterval` | `10` | 记忆复盘的活动量间隔 |
| `reviewSkillInterval` | `10` | 技能复盘的活动量间隔 |
| `skillReviewTrigger` | `cadence` | 技能复盘按节奏、按完成或两者；完成通道阈值默认 20 次工具调用 |

间隔不是用户消息数。`inject` 会在父会话追加复盘；`branch` 需要子会话支持，并有独立的通知边界。cadence 的实质信号与加权规则、completion 的原生工具调用计数差异见 [功能指南](features.md#复盘)。

host 形态没有 `memory` / `skill_manage` 等家族模型行，自动复盘和用量统计的会话门控不会命中。

## 技能整理

| 设置 | 默认值 | 说明 |
|---|---:|---|
| `curatorIntervalHours` | 168 | 自动整理的最小间隔（小时） |
| `staleAfterDays` | 30 | 多少天未使用后视为陈旧 |
| `archiveAfterDays` | 90 | 多少天未使用后进入归档，必须不小于 staleAfterDays |
| `minIdleHours` | 2 | 自动整理要求的空闲小时数 |

启动后先经过默认 10 秒宽限期，再每小时检查是否到期。`curator pause/resume` 的运行时选择优先于启动默认值。默认 `llmReview=false` 时，整理器只做确定性生命周期维护；开启后可以产生 LLM consolidation 提名。独立 merge 才走 `merge scan/pair` 的候选、运行与提交流程。

## 技能发现域

`skill_search` 的本地基础检索独立可用。默认关闭的是 discovery 的发现域生成和目录裁剪：`mode=off`。高级启用需同时核对 `featureEpoch`；`mode=on` 需要可用 LLM，`/skill-domain generate` 还需要 `mapReferenceCwd`，否则会拒绝从调用者视图生成全局图。完整高级配置见 [evolution-skill-discovery README](../packages/evolution-skill-discovery/README.md)。

## 技能合并

scan 需要 `mergeModelsRoot` 指向本地 potion 模型目录。未配置时 `/evolution merge doctor` 会提示，`merge scan` 会失败；不会自动下载。普通 pair 不经过本地候选筛选，但其 round1/authoring 需要子会话模型，不能使用 scan 的 stub 降级。

`mergeApproval` 默认 `false`，表示第一轮后不进入人工待批；设为 `true` 才会进入 pending。审批、宿主写入能力和模型条件是不同前提，不能用其中一个替代其它条件。

## 设置写在哪里

- **E3 用户设置**：通过平台插件管理的 bundle row 配置页写入；`/evolution params` 只读查看。
- **E1/E2 部署配置**：写在 Cordis 配置或 `profiles/<profile>/cordis.patch.yml`。分层预设行也在该 patch 中。
- **查看实际值**：使用 `/evolution params [--group <name>]`，它会区分用户覆盖、部署值和未注册来源。

不要同时在 GUI 和文本编辑器里写同一个设置文件。备份时必须同时覆盖 `settings.yaml` 与 profile patch，步骤见 [operations.md](operations.md#备份)。
