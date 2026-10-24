# 参数表（生成物，勿手改）

> 由 `packages/scripts/gen-param-docs.mjs` 从 `evolution-core/src/params.ts` 的注册表生成，
> 门禁 `verify-param-registry` 逐字节比对两者（本文件受版本控制，是可引用的正文面）。
> 改参数请改注册表，然后重跑生成器（`node packages/scripts/gen-param-docs.mjs packages`）。
> 会话内读同一份数据不需要文件：`/evolution params` 打印同样的行。

## 档位含义（改哪个面）

| 档 | 谁能写 | 写面 | 生效 |
|---|---|---|---|
| E0 | 无人 | 代码常量 | 随版本 |
| E1 | 无人 | 只读可见（dump／`/evolution params`） | — |
| E2 | 部署方 | `cordis.yml` 行／补丁层 | 补丁层在长驻面热重载 |
| E3 | 本机用户 | `settings.yaml`／GUI 卡／`/evolution policy set` | 见 applies 列 |
| E4 | 安装者 | 安装器开关／`row-overrides.json` | 装完固化 |

## 设置面（第八列怎么读）

E3 行的第八列写 `卡：<row-id>`——**那张卡渲染的就是这一行的字段**（平台按 Loader 行 id 取卡，一张卡只渲染自己那行的 volatile 字段）。其余档写 `无（<why>）`，`why` 取值（**用列表不用表格**：门禁把 `| `id` |` 形状的行当作参数行，表格会把它读成 6 个不存在的参数）：

- `deployment` —— 挂载开关与库级范围策略（部署方的决定）
- `security` —— 安全面（工具授权、威胁豁免、审批闸；永不给用户）
- `identity` —— provider／模型／注册名
- `path` —— 每行各自的目录（技能根、事件目录、状态目录）
- `install` —— 安装期固化
- `internal` —— 超时／重试／冷却／权重／上限／窗口／阈值

## library（技能库）

| 参数 | 档 | 生效 | 权威面 | owner | 旧名（deprecated） | 设置面 | 说明 |
|---|---|---|---|---|---|---|---|
| `protectedSkillNames` | E2 | none | cordis | evolution-curator | — | 无（deployment） | Skills the lifecycle never archives or rewrites. |
| `manageUnmanaged` | E2 | none | cordis | evolution-curator | — | 无（deployment） | Let curation touch skills with no family metadata. |
| `pruneBuiltins` | E2 | none | cordis | evolution-curator | — | 无（deployment） | Let curation nominate bundled skills for pruning. |
| `referencedSkillNames` | E2 | none | cordis | evolution-curator | — | 无（deployment） | Names treated as referenced by external docs (never retired). |
| `includeSkillNames` | E2 | none | cordis | evolution-skill-catalog | — | 无（deployment） | Allow-list of skills the catalog exposes. |
| `skill-catalog.excludeSkillNames` | E2 | none | cordis | evolution-skill-catalog | — | 无（deployment） | Deny-list of skills the catalog hides (row-local name; see the collision note). |
| `modelInvocable` | E2 | none | cordis | evolution-skill-catalog | — | 无（deployment） | Default for whether the model may invoke a catalog skill. |
| `userInvocable` | E2 | none | cordis | evolution-skill-catalog | — | 无（deployment） | Default for whether the user may invoke a catalog skill. |
| `maxItems` | E2 | none | cordis | evolution-activity | — | 无（internal） | Entries kept in the activity sidecar window. |
| `sessionScoped` | E2 | none | cordis | evolution-review | — | 无（deployment） | Act only on sessions carrying the family model tools. |
| `skill-usage.sessionScoped` | E2 | none | cordis | skill-usage | — | 无（deployment） | Keep the usage sidecar scoped per session (row-local name). |

## write-caps（写入上限）

| 参数 | 档 | 生效 | 权威面 | owner | 旧名（deprecated） | 设置面 | 说明 |
|---|---|---|---|---|---|---|---|
| `skillContentChars` | E3 | live | cordis | tool-skill-manage | maxSkillContentChars | 卡：tool-skill-manage | Character cap on a SKILL.md body (tighten-only). |
| `maxSkillFileBytes` | E3 | live | cordis | tool-skill-manage | — | 卡：tool-skill-manage | Byte cap on one support file (tighten-only). |
| `maxSkillNameLength` | E3 | live | cordis | tool-skill-manage | — | 卡：tool-skill-manage | Character cap on a skill name (tighten-only). |
| `maxDescriptionLength` | E3 | live | cordis | tool-skill-manage | — | 卡：tool-skill-manage | Character cap on a skill description (tighten-only). |
| `descriptionStrict` | E3 | live | cordis | tool-skill-manage | — | 卡：tool-skill-manage | Refuse a description over the authoring bar instead of advising. |
| `strictCrossSource` | E3 | live | cordis | tool-skill-manage | — | 卡：tool-skill-manage | Refuse writes whose catalog entry resolves outside the family. |
| `citationPolicy` | E3 | live | cordis | tool-skill-manage | — | 卡：tool-skill-manage | Refuse a move that would leave a dangling reference, or verify it. |
| `referenceRewrite` | E2 | none | cordis | tool-skill-manage | — | 无（internal） | Re-home support files and rewrite references during a merge (plan or apply). |
| `archiveRetention` | E2 | none | cordis | tool-skill-manage | — | 无（internal） | Report expired archives, or prune them. |
| `skillVersionKeep` | E2 | none | cordis | tool-skill-manage | — | 无（internal） | Content versions retained per skill; older ones leave the index. Their stored blobs stay on disk — no automatic sweep exists yet, so a long-lived library grows by the distinct bodies it has written. |
| `supportFileCharPolicy` | E3 | live | cordis | tool-skill-manage | — | 卡：tool-skill-manage | Warn about an oversize support file, or refuse the write. |
| `skillWriteConfirm` | E3 | live | cordis | tool-skill-manage | — | 卡：tool-skill-manage | What the one confirmation before a create or a bare delete does: write straight through, wait for an answer, or cancel the write when nobody answers within the timeout. |
| `skillWriteConfirmTimeoutSeconds` | E3 | live | cordis | tool-skill-manage | — | 卡：tool-skill-manage | Seconds the confirmation waits for an answer in timeout mode before the write is cancelled. |
| `approvalConfirm` | E3 | live | cordis | evolution-approval | — | 卡：evolution-approval | What the confirmation before an APPROVE does: write straight through, ask first, or treat an unanswered prompt as a cancel. The same three words skillWriteConfirm uses for a skill write. |

## review（会话回顾）

| 参数 | 档 | 生效 | 权威面 | owner | 旧名（deprecated） | 设置面 | 说明 |
|---|---|---|---|---|---|---|---|
| `reviewSkillInterval` | E3 | live | cordis | evolution-review | skillInterval | 卡：evolution-review | Tool calls between skill-review injections: a turn advances by its tool-call count (a turn with none counts as one), or by 1 when the turn itself used a skill. |
| `reviewMemoryInterval` | E3 | live | cordis | evolution-review | memoryInterval | 卡：evolution-review | Tool calls between memory-review injections: a turn advances by its tool-call count (a turn with none counts as one), or by 1 when the turn itself touched memory. |
| `skillReviewTrigger` | E3 | live | cordis | evolution-review | — | 卡：evolution-review | Which channel may inject a skill review (cadence, completion, both). |
| `skillReviewCompletionMinToolCalls` | E3 | live | cordis | evolution-review | — | 卡：evolution-review | Tool calls a task needs before the completion channel injects. |
| `reviewEnabled` | E3 | live | cordis | evolution-review | — | 卡：evolution-review | Master switch for the review plugin. |
| `reviewMode` | E3 | live | cordis | evolution-review | — | 卡：evolution-review | Run the review in the parent session (inject) or on a subagent. |
| `reviewWakeInject` | E3 | live | cordis | evolution-review | — | 卡：evolution-review | Deliver the deferred review as a waking follow-up message. |
| `reviewProvider` | E2 | none | cordis | evolution-review | — | 无（identity） | LLM provider for review subagents (deployment identity). |
| `reviewTimeoutMs` | E2 | none | cordis | evolution-review | — | 无（internal） | Bound on one review subagent run and its write leg. |
| `reviewContextMessages` | E2 | none | cordis | evolution-review | — | 无（internal） | Messages of context handed to a review subagent. |
| `reviewMessageChars` | E2 | none | cordis | evolution-review | — | 无（internal） | Per-message character budget of the review context. |
| `reviewMaxDepth` | E2 | none | cordis | evolution-review | — | 无（internal） | Absolute delegation-depth cap of the review subagent. |
| `reviewToolAllow` | E2 | none | cordis | evolution-review | — | 无（security） | Tools the review subagent may use (safety surface). |

## memory（记忆）

| 参数 | 档 | 生效 | 权威面 | owner | 旧名（deprecated） | 设置面 | 说明 |
|---|---|---|---|---|---|---|---|
| `memoryChars` | E3 | live | cordis | memory-files | memoryCharLimit | 卡：memory-files | Character budget the memory store enforces for MEMORY.md. |
| `userChars` | E3 | live | cordis | memory-files | userCharLimit | 卡：memory-files | Character budget the memory store enforces for USER.md. |
| `memoryEnabled` | E2 | none | cordis | tool-memory | — | 无（deployment） | Register the memory tool and its prompt section at all (deployment switch). |
| `entryPreviewChars` | E3 | live | cordis | tool-memory | — | 卡：tool-memory | Characters of one memory entry shown in a tool result preview. |
| `addDatePrefix` | E3 | live | cordis | memory-files | — | 卡：memory-files | Prefix stored memory entries with their date heading. |
| `maxConsolidationFailures` | E3 | live | cordis | memory-files | — | 卡：memory-files | Consolidation failures one turn tolerates before the tool gives up. |

## curator（技能整理）

| 参数 | 档 | 生效 | 权威面 | owner | 旧名（deprecated） | 设置面 | 说明 |
|---|---|---|---|---|---|---|---|
| `curatorIntervalHours` | E3 | live | cordis | evolution-curator | intervalHours | 卡：evolution-curator | Minimum hours between deterministic curation passes. |
| `staleAfterDays` | E3 | live | cordis | evolution-curator | — | 卡：evolution-curator | Inactive days before a skill counts as stale. |
| `archiveAfterDays` | E3 | live | cordis | evolution-curator | — | 卡：evolution-curator | Inactive days before a stale skill is archived (must be >= staleAfterDays). |
| `qualityWarnStaleAfterDays` | E2 | none | cordis | evolution-curator | — | 无（internal） | Age at which a low quality score starts warning (the pair of evolution-feedback.qualityWarnThreshold; both live on the deployment face so one bar is not half user-set). |
| `minIdleHours` | E3 | live | cordis | evolution-curator | — | 卡：evolution-curator | Idle hours required before an automatic curation pass runs. |
| `minIdleFailOpen` | E3 | live | cordis | evolution-curator | — | 卡：evolution-curator | Let the idle gate open when the activity probe is unavailable. |
| `llmReview` | E3 | live | cordis | evolution-curator | — | 卡：evolution-curator | Enable the LLM nomination pass on top of the deterministic lifecycle. |
| `curatorReviewMaxTokens` | E3 | live | cordis | evolution-curator | — | 卡：evolution-curator | Token budget of the curator LLM review. |
| `curatorReviewTimeoutMs` | E3 | live | cordis | evolution-curator | — | 卡：evolution-curator | Wall-clock bound of the curator LLM review. |
| `healthSoftBodyChars` | E3 | live | cordis | evolution-curator | — | 卡：evolution-curator | Body character line the health view judges against. |
| `healthStampDensityPerKb` | E3 | live | cordis | evolution-curator | — | 卡：evolution-curator | Stamp density per KB that flags log-like content in a body. |
| `healthChurnMinPatches` | E3 | live | cordis | evolution-curator | — | 卡：evolution-curator | Patches without a read that flag a write-ghost skill. |
| `evolution-curator.enabled` | E2 | none | cordis | evolution-curator | — | 无（deployment） | Mount the curator plugin at all. |
| `autoStart` | E2 | none | cordis | evolution-curator | — | 无（deployment） | Arm the hourly due-ness tick with the plugin — the STARTUP default only; at runtime /evolution curator pause or resume overrides it (the override is persisted in curation state and wins until cleared). Off keeps curation manual. |
| `bootGraceSeconds` | E2 | none | cordis | evolution-curator | — | 无（internal） | Grace period before the first automatic pass after a restart. |
| `curatorProvider` | E2 | none | cordis | evolution-curator | — | 无（identity） | LLM provider for curator reviews (deployment identity). |
| `curatorModel` | E2 | none | cordis | evolution-curator | — | 无（identity） | Model for curator reviews (deployment identity). |

## deployment（安装配置）

| 参数 | 档 | 生效 | 权威面 | owner | 旧名（deprecated） | 设置面 | 说明 |
|---|---|---|---|---|---|---|---|
| `evolution-review.root` | E1 | none | cordis | evolution-review | — | 无（path） | Skill-tree root for review-created skills (empty = shared default). |
| `evolution-review.skillsRoot` | E1 | none | cordis | evolution-review | — | 无（path） | Retired alias of root; a value here fails the load (V27 G2.4). |
| `evolution-curator.root` | E1 | none | cordis | evolution-curator | — | 无（path） | Skill-tree root for curator scope, snapshot and archive. |
| `evolution-commands.root` | E1 | none | cordis | evolution-commands | — | 无（path） | Skill-tree root the command surface writes through. |
| `evolution-commands.skillsRoot` | E1 | none | cordis | evolution-commands | — | 无（path） | Retired alias of the commands root; a value here fails the load. |
| `evolution-maintenance.root` | E1 | none | cordis | evolution-maintenance | — | 无（path） | Skill-tree root the maintenance probe scans. |
| `evolution-maintenance.skillsRoot` | E1 | none | cordis | evolution-maintenance | — | 无（path） | Accepted skill-root spelling for the maintenance row. |
| `evolution-skill-catalog.root` | E1 | none | cordis | evolution-skill-catalog | — | 无（path） | Skill-tree root the catalog lists. |
| `evolution-learning-graph.root` | E1 | none | cordis | evolution-learning-graph | — | 无（path） | Skill-tree root the learning graph reads. |
| `skill-usage.root` | E1 | none | cordis | skill-usage | — | 无（path） | Skill-tree root the usage store observes. |
| `skill-usage.eventsHome` | E1 | none | cordis | skill-usage | — | 无（path） | Directory holding the family event log the usage store reads. |
| `evolution-state-json.root` | E1 | none | cordis | evolution-state-json | — | 无（path） | Directory holding the JSON state store. |
| `memory-files.root` | E1 | none | cordis | memory-files | — | 无（path） | Directory holding MEMORY.md and USER.md (empty = $DSH_HOME/memories). |
| `evolution-feedback.path` | E1 | none | cordis | evolution-feedback | — | 无（path） | Event log the feedback scorer reads (empty = family events file). |
| `evolution-state.provider` | E2 | none | cordis | evolution-state | — | 无（identity） | Registered state-store provider name. |
| `memory.provider` | E2 | none | cordis | memory | — | 无（identity） | Registered memory provider name. |
| `memory-files.providerName` | E2 | none | cordis | memory-files | — | 无（identity） | Name this package registers as the memory provider. |
| `memoryReviewModel` | E2 | none | cordis | evolution-review | — | 无（identity） | Model for the memory review channel (deployment identity). |
| `skillReviewModel` | E2 | none | cordis | evolution-review | — | 无（identity） | Model for the skill review channel (deployment identity). |
| `maxOpsPerPlan` | E2 | none | cordis | evolution-plan-validator | — | 无（internal） | Operation cap one staged plan may carry. |
| `substantiveMinToolCalls` | E2 | none | cordis | evolution-review | — | 无（internal） | Tool calls that make a turn count as substantive. |
| `substantiveMinUserChars` | E2 | none | cordis | evolution-review | — | 无（internal） | User characters that make a turn count as substantive. |
| `substantiveMinAgentChars` | E2 | none | cordis | evolution-review | — | 无（internal） | Assistant characters that make a turn count as substantive. |
| `threatExemptLabels` | E1 | none | cordis | evolution-threat | — | 无（security） | Threat labels the deployment declares benign (safety surface, never user-writable). |
| `evolution-threat.enabled` | E2 | none | cordis | evolution-threat | — | 无（security） | Mount the write-time threat guard at all. |
| `evolution-threat.maxScanChars` | E2 | none | cordis | evolution-threat | — | 无（security） | Scan window size of the threat guard. |
| `evolution-approval.enabled` | E2 | none | cordis | evolution-approval | — | 无（security） | Require approval before a staged write executes. |
| `evolution-approval.stageForeground` | E2 | none | cordis | evolution-approval | — | 无（security） | Stage foreground agent writes for approval too. |
| `evolution-approval.pendingTtlMs` | E3 | live | cordis | evolution-approval | — | 卡：evolution-approval | How long a staged write may wait before it expires: expired writes are closed as rejected and are NEVER executed; 0 (the default) means the window never expires. |
| `qualityWarnThreshold` | E2 | none | cordis | evolution-feedback | — | 无（internal） | Feedback score below which a skill carries a warning. |
| `replay.maxPlans` | E2 | none | cordis | evolution-replay | — | 无（internal） | Plans compared in one replay report. |
| `replay.weights` | E2 | none | cordis | evolution-replay | — | 无（internal） | Scoring weights of the replay comparison. |
| `evolution-commands.maintainCooldownMs` | E2 | none | cordis | evolution-commands | — | 无（internal） | Cooldown between maintenance runs from the command surface. |
| `evolution-commands.maintainHandoffOnSettle` | E3 | live | cordis | evolution-commands | — | 卡：evolution-commands | Hand the maintenance report to the model automatically once a scan settles successfully (the same injection as maintain handoff); off by default — enabling it costs one extra model call per successful run. |
| `evolution-commands.maintainTimeoutMs` | E2 | none | cordis | evolution-commands | — | 无（internal） | Timeout of one maintenance run started from the command surface. |
| `evolution-maintenance.probeTimeoutMs` | E2 | none | cordis | evolution-maintenance | — | 无（internal） | Model-facing budget of one maintenance_probe call — a hang guard, not a latency budget. |
| `skill-usage.supportReadToolNames` | E2 | none | cordis | skill-usage | — | 无（internal） | Tool names whose file reads are attributed to support files. |
| `install.mode` | E4 | restart | install | scripts | — | 无（install） | Install target plane (values host / agent / layered / oneclick; the `layered` form uses the generated preset, the others mount the bundle at profile root). |
| `install.basePreset` | E4 | restart | install | scripts | — | 无（install） | Agent-preset base the layered install composes from (--base). |
| `install.home` | E4 | restart | install | scripts | — | 无（install） | Harness home the installer writes into (--home). |
| `install.presetRowOverrides` | E4 | restart | install | scripts | — | 无（install） | Preset row overrides the installer injects (row-overrides.json). |
| `timeout.gateDefault` | E2 | none | install | scripts | — | 无（internal） | Gate budget: the vitest --testTimeout the gate table and the CI step carry (the number lives in testing-policy.timeouts). |
| `timeout.specDefault` | E2 | none | install | scripts | — | 无（internal） | Local spec budget: the vitest testTimeout the family config generates per leaf tier (the number lives in testing-policy.timeouts). |

## merge（技能合并）

| 参数 | 档 | 生效 | 权威面 | owner | 旧名（deprecated） | 设置面 | 说明 |
|---|---|---|---|---|---|---|---|
| `mergeApproval` | E3 | live | cordis | evolution-merge | — | 卡：evolution-merge | Pause after round 1 and put the pair in the pending queue instead of authoring round 2 automatically. |
| `mergeSkippedTtlDays` | E3 | live | cordis | evolution-merge | — | 卡：evolution-merge | Days a skipped pair stays out of screening; 0 means it never expires. |
| `mergeRunTimeoutMinutes` | E3 | live | cordis | evolution-merge | — | 卡：evolution-merge | Wall-clock budget of one merge run; 0 means no limit. |
| `mergePairTimeoutMinutes` | E2 | none | cordis | evolution-merge | — | 无（internal） | Wall-clock budget of one pair round (a stuck child guard). |
| `mergeModelsRoot` | E2 | none | cordis | evolution-merge | — | 无（path） | Local model root containing the int8 and pca64 model directories; no env fallback. No auto provisioning. |
