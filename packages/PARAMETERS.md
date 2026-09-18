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
| E2 | 部署方 | `cordis.yml` 行／补丁层 | 本部署 patchReload=live |
| E3 | 本机用户 | `settings.yaml`／GUI 卡／`/evolution policy set` | 见 applies 列 |
| E4 | 安装者 | 安装器开关／`row-overrides.json` | 装完固化 |

## library

| 参数 | 档 | 生效 | 权威面 | owner | 旧名（deprecated） | 说明 |
|---|---|---|---|---|---|---|
| `protectedSkillNames` | E2 | none | cordis | evolution-curator | — | Skills the lifecycle never archives or rewrites. |
| `manageUnmanaged` | E2 | none | cordis | evolution-curator | — | Let curation touch skills with no family metadata. |
| `pruneBuiltins` | E2 | none | cordis | evolution-curator | — | Let curation nominate bundled skills for pruning. |
| `referencedSkillNames` | E2 | none | cordis | evolution-curator | — | Names treated as referenced by external docs (never retired). |
| `includeSkillNames` | E2 | none | cordis | evolution-skill-catalog | — | Allow-list of skills the catalog exposes. |
| `skill-catalog.excludeSkillNames` | E2 | none | cordis | evolution-skill-catalog | — | Deny-list of skills the catalog hides (row-local name; see the collision note). |
| `modelInvocable` | E2 | none | cordis | evolution-skill-catalog | — | Default for whether the model may invoke a catalog skill. |
| `userInvocable` | E2 | none | cordis | evolution-skill-catalog | — | Default for whether the user may invoke a catalog skill. |
| `maxItems` | E2 | none | cordis | evolution-activity | — | Entries kept in the activity sidecar window. |
| `sessionScoped` | E2 | none | cordis | evolution-review | — | Act only on sessions carrying the family model tools. |
| `skill-usage.sessionScoped` | E2 | none | cordis | skill-usage | — | Keep the usage sidecar scoped per session (row-local name). |

## write-caps

| 参数 | 档 | 生效 | 权威面 | owner | 旧名（deprecated） | 说明 |
|---|---|---|---|---|---|---|
| `skillContentChars` | E3 | live | cordis | tool-skill-manage | maxSkillContentChars | Character cap on a SKILL.md body (tighten-only). |
| `maxSkillFileBytes` | E3 | live | cordis | tool-skill-manage | — | Byte cap on one support file (tighten-only). |
| `maxSkillNameLength` | E3 | live | cordis | tool-skill-manage | — | Character cap on a skill name (tighten-only). |
| `maxDescriptionLength` | E3 | live | cordis | tool-skill-manage | — | Character cap on a skill description (tighten-only). |
| `descriptionStrict` | E3 | live | cordis | tool-skill-manage | — | Refuse a description over the authoring bar instead of advising. |
| `strictCrossSource` | E3 | live | cordis | tool-skill-manage | — | Refuse writes whose catalog entry resolves outside the family. |
| `citationPolicy` | E3 | live | cordis | tool-skill-manage | — | Refuse a move that would leave a dangling reference, or verify it. |
| `referenceRewrite` | E2 | none | cordis | tool-skill-manage | — | Re-home support files and rewrite references during a merge (plan or apply). |
| `archiveRetention` | E2 | none | cordis | tool-skill-manage | — | Report expired archives, or prune them. |
| `supportFileCharPolicy` | E3 | live | cordis | tool-skill-manage | — | Warn about an oversize support file, or refuse the write. |

## review

| 参数 | 档 | 生效 | 权威面 | owner | 旧名（deprecated） | 说明 |
|---|---|---|---|---|---|---|
| `reviewSkillInterval` | E3 | live | cordis | evolution-review | skillInterval | Activity units between skill-review injections. |
| `reviewMemoryInterval` | E3 | live | cordis | evolution-review | memoryInterval | Activity units between memory-review injections. |
| `skillReviewTrigger` | E3 | live | cordis | evolution-review | — | Which channel may inject a skill review (cadence, completion, both). |
| `skillReviewCompletionMinToolCalls` | E3 | live | cordis | evolution-review | — | Tool calls a task needs before the completion channel injects. |
| `reviewEnabled` | E3 | live | cordis | evolution-review | — | Master switch for the review plugin. |
| `reviewMode` | E3 | live | cordis | evolution-review | — | Run the review in the parent session (inject) or on a subagent. |
| `reviewWakeInject` | E3 | live | cordis | evolution-review | — | Deliver the deferred review as a waking follow-up message. |
| `reviewProvider` | E2 | none | cordis | evolution-review | — | LLM provider for review subagents (deployment identity). |
| `reviewTimeoutMs` | E2 | none | cordis | evolution-review | — | Bound on one review subagent run and its write leg. |
| `reviewContextMessages` | E2 | none | cordis | evolution-review | — | Messages of context handed to a review subagent. |
| `reviewMessageChars` | E2 | none | cordis | evolution-review | — | Per-message character budget of the review context. |
| `reviewMaxDepth` | E2 | none | cordis | evolution-review | — | Absolute delegation-depth cap of the review subagent. |
| `reviewToolAllow` | E2 | none | cordis | evolution-review | — | Tools the review subagent may use (safety surface). |

## memory

| 参数 | 档 | 生效 | 权威面 | owner | 旧名（deprecated） | 说明 |
|---|---|---|---|---|---|---|
| `memoryChars` | E3 | live | cordis | memory-files | memoryCharLimit | Character budget the memory store enforces for MEMORY.md. |
| `userChars` | E3 | live | cordis | memory-files | userCharLimit | Character budget the memory store enforces for USER.md. |
| `memoryEnabled` | E2 | none | cordis | tool-memory | — | Register the memory tool and its prompt section at all (deployment switch). |
| `entryPreviewChars` | E3 | live | cordis | tool-memory | — | Characters of one memory entry shown in a tool result preview. |
| `addDatePrefix` | E3 | live | cordis | memory-files | — | Prefix stored memory entries with their date heading. |
| `maxConsolidationFailures` | E3 | live | cordis | memory-files | — | Consolidation failures one turn tolerates before the tool gives up. |

## curator

| 参数 | 档 | 生效 | 权威面 | owner | 旧名（deprecated） | 说明 |
|---|---|---|---|---|---|---|
| `curatorIntervalHours` | E3 | live | cordis | evolution-curator | intervalHours | Minimum hours between deterministic curation passes. |
| `staleAfterDays` | E3 | live | cordis | evolution-curator | — | Inactive days before a skill counts as stale. |
| `archiveAfterDays` | E3 | live | cordis | evolution-curator | — | Inactive days before a stale skill is archived (must be >= staleAfterDays). |
| `qualityWarnStaleAfterDays` | E3 | live | cordis | evolution-curator | — | Age at which a low quality score starts warning. |
| `minIdleHours` | E3 | live | cordis | evolution-curator | — | Idle hours required before an automatic curation pass runs. |
| `minIdleFailOpen` | E3 | live | cordis | evolution-curator | — | Let the idle gate open when the activity probe is unavailable. |
| `llmReview` | E3 | live | cordis | evolution-curator | — | Enable the LLM nomination pass on top of the deterministic lifecycle. |
| `curatorReviewMaxTokens` | E3 | live | cordis | evolution-curator | — | Token budget of the curator LLM review. |
| `curatorReviewTimeoutMs` | E3 | live | cordis | evolution-curator | — | Wall-clock bound of the curator LLM review. |
| `healthSoftBodyChars` | E3 | live | cordis | evolution-curator | — | Body character line the health view judges against. |
| `healthStampDensityPerKb` | E3 | live | cordis | evolution-curator | — | Stamp density per KB that flags log-like content in a body. |
| `healthChurnMinPatches` | E3 | live | cordis | evolution-curator | — | Patches without a read that flag a write-ghost skill. |
| `evolution-curator.enabled` | E2 | none | cordis | evolution-curator | — | Mount the curator plugin at all. |
| `autoStart` | E2 | none | cordis | evolution-curator | — | Arm the hourly due-ness tick with the plugin. |
| `bootGraceSeconds` | E2 | none | cordis | evolution-curator | — | Grace period before the first automatic pass after a restart. |
| `curatorProvider` | E2 | none | cordis | evolution-curator | — | LLM provider for curator reviews (deployment identity). |
| `curatorModel` | E2 | none | cordis | evolution-curator | — | Model for curator reviews (deployment identity). |

## deployment

| 参数 | 档 | 生效 | 权威面 | owner | 旧名（deprecated） | 说明 |
|---|---|---|---|---|---|---|
| `evolution-review.root` | E1 | none | cordis | evolution-review | — | Skill-tree root for review-created skills (empty = shared default). |
| `evolution-review.skillsRoot` | E1 | none | cordis | evolution-review | — | Retired alias of root; a value here fails the load (V27 G2.4). |
| `evolution-curator.root` | E1 | none | cordis | evolution-curator | — | Skill-tree root for curator scope, snapshot and archive. |
| `evolution-commands.root` | E1 | none | cordis | evolution-commands | — | Skill-tree root the command surface writes through. |
| `evolution-commands.skillsRoot` | E1 | none | cordis | evolution-commands | — | Retired alias of the commands root; a value here fails the load. |
| `evolution-maintenance.root` | E1 | none | cordis | evolution-maintenance | — | Skill-tree root the maintenance probe scans. |
| `evolution-maintenance.skillsRoot` | E1 | none | cordis | evolution-maintenance | — | Accepted skill-root spelling for the maintenance row. |
| `evolution-skill-catalog.root` | E1 | none | cordis | evolution-skill-catalog | — | Skill-tree root the catalog lists. |
| `evolution-learning-graph.root` | E1 | none | cordis | evolution-learning-graph | — | Skill-tree root the learning graph reads. |
| `skill-usage.root` | E1 | none | cordis | skill-usage | — | Skill-tree root the usage store observes. |
| `skill-usage.eventsHome` | E1 | none | cordis | skill-usage | — | Directory holding the family event log the usage store reads. |
| `evolution-state-json.root` | E1 | none | cordis | evolution-state-json | — | Directory holding the JSON state store. |
| `memory-files.root` | E1 | none | cordis | memory-files | — | Directory holding MEMORY.md and USER.md (empty = $DSH_HOME/memories). |
| `evolution-feedback.path` | E1 | none | cordis | evolution-feedback | — | Event log the feedback scorer reads (empty = family events file). |
| `evolution-state.provider` | E2 | none | cordis | evolution-state | — | Registered state-store provider name. |
| `memory.provider` | E2 | none | cordis | memory | — | Registered memory provider name. |
| `memory-files.providerName` | E2 | none | cordis | memory-files | — | Name this package registers as the memory provider. |
| `memoryReviewModel` | E2 | none | cordis | evolution-review | — | Model for the memory review channel (deployment identity). |
| `skillReviewModel` | E2 | none | cordis | evolution-review | — | Model for the skill review channel (deployment identity). |
| `maxOpsPerPlan` | E2 | none | cordis | evolution-plan-validator | — | Operation cap one staged plan may carry. |
| `substantiveMinToolCalls` | E2 | none | cordis | evolution-review | — | Tool calls that make a turn count as substantive. |
| `substantiveMinUserChars` | E2 | none | cordis | evolution-review | — | User characters that make a turn count as substantive. |
| `substantiveMinAgentChars` | E2 | none | cordis | evolution-review | — | Assistant characters that make a turn count as substantive. |
| `threatExemptLabels` | E1 | none | cordis | evolution-threat | — | Threat labels the deployment declares benign (safety surface, never user-writable). |
| `evolution-threat.enabled` | E2 | none | cordis | evolution-threat | — | Mount the write-time threat guard at all. |
| `evolution-threat.maxScanChars` | E2 | none | cordis | evolution-threat | — | Scan window size of the threat guard. |
| `evolution-approval.enabled` | E2 | none | cordis | evolution-approval | — | Require approval before a staged write executes. |
| `evolution-approval.stageForeground` | E2 | none | cordis | evolution-approval | — | Stage foreground agent writes for approval too. |
| `qualityWarnThreshold` | E2 | none | cordis | evolution-feedback | — | Feedback score below which a skill carries a warning. |
| `replay.maxPlans` | E2 | none | cordis | evolution-replay | — | Plans compared in one replay report. |
| `replay.weights` | E2 | none | cordis | evolution-replay | — | Scoring weights of the replay comparison. |
| `evolution-commands.maintainCooldownMs` | E2 | none | cordis | evolution-commands | — | Cooldown between maintenance runs from the command surface. |
| `evolution-commands.maintainTimeoutMs` | E2 | none | cordis | evolution-commands | — | Timeout of one maintenance run started from the command surface. |
| `skill-usage.supportReadToolNames` | E2 | none | cordis | skill-usage | — | Tool names whose file reads are attributed to support files. |
| `install.mode` | E4 | restart | install | scripts | — | Install target plane (layered preset vs profile-root bundle). |
| `install.basePreset` | E4 | restart | install | scripts | — | Agent-preset base the layered install composes from (--base). |
| `install.home` | E4 | restart | install | scripts | — | Harness home the installer writes into (--home). |
| `install.presetRowOverrides` | E4 | restart | install | scripts | — | Preset row overrides the installer injects (row-overrides.json). |
