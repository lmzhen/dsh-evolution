# Hermes ← dsh-evolution 对齐复审（rc.39 校准，H-only，只读）

> 审计对象：
> - **H（原版）**：`D:\claw\hermes-agent`（`tools/memory_tool.py`、`tools/skill_manager_tool.py`、
>   `tools/skill_usage.py`、`tools/skill_provenance.py`、`agent/background_review.py`、
>   `agent/curator.py`、`agent/curator_backup.py`、`agent/learning_graph.py`、
>   `agent/learning_mutations.py`、`agent/learn_prompt.py`、`cron/jobs.py`、`hermes_cli/config.py`）
> - **D（当前实现）**：`D:\dsh\deepseek-harness\packages\evolution`（下文省略包前缀；
>   不看 `lib/`、不看 `.release-staging/`）
>
> 判定：✅ 完全对齐 / ≈ 语义一致形态不同 / ⚠ 部分（缺子集）/ ✗ 缺失 / ★ D 更强。
> 行号为本次读码快照。本文件只做审计，不改任何代码。
> 方法说明：本轮**未沿用** rc.25/rc.30 审计的既有结论框架，而是先逐段读 H 十二个源文件的
> 全部关键机制，再逐一在 D 源码中找对应实现——因此除复核 rc.30 遗留项外，还发现了一批
> 此前两轮审计都未列出的缺口（见 §4 标注「本轮新增」）。

---

## 0. 结论摘要

**rc.30 报告列出的全部 9 个待修项（A-I）本轮逐项核码确认已修复**：复习读标记改为
父会话∪子代理会话并覆盖全部六个写 action；delete 三条路径（工具/图谱/curator）全部回写
usage；后台 bare delete 在 plan-validator 与执行器双层 fail-closed；LLM 提名归档统一置
`archived`；usage 注册表加 `invalidate()`；review 输入纳入工具调用/结果证据；host 组合
approval-disabled 时直通执行；IO 层新增跨进程写锁（wx + 5s 陈旧 + 10 次重试）；
快照纳入 usage/suppression sidecar 与 `.archive/`。

**本轮从零新发现 2 中 + 6 低**（此前审计均未列出）：策展暂停门缺失（字段存在但无门控无入口）、
图谱技能-技能边为字母序占位而非 `related_skills` 语义边、review 直通 delete 不回写 usage
（rc.30-D 的兄弟残留）、inject 回退路径绕过读前写守卫、提示词与写保护的 pinned 矛盾
（D 原样复刻了 H 的同一矛盾）、错误面缺条目清单（H 可恢复错误）、报告目录无保留策略等。

高严重度缺陷：1 个（review 直通 delete 的 usage 状态分叉）。其余见 §4。

---

## 1. 三个指定检查点（逐项以代码为准）

| # | 检查点 | 核码结果 |
|---|---|---|
| 1 | 策展 LLM 合并：`llmReview` 门控默认 false，通道已接线 | ✅ 属实。`llmReview: z.boolean().default(false)`（`evolution-curator/src/index.ts:98`，构造 :140 同默认）。`runCore` :411 仅开启时调 `recommend()`；`recommend()` :217-260 调 LLM → `parseCuratorNominations`（`core/curator.ts:123-156`，consolidations+prunings 双通道）；`gateConsolidations()` :82-90 过滤 exclude/referenced/suppressed（双侧）；`applyMutations()` :553-646 执行 archive :570-596 与 consolidate :598-619；`.archive-reason` 由 `skill-store.ts:513-514` 落盘（absorbedInto 场景 reason=`Consolidated into X`，:513 先校验伞存在 :495-498）。**注意：H 的 LLM 合并默认同为 false**（`hermes_cli/config.py:2267-2274` "OFF by default"）——D 默认值实为精确对齐，此前文档把它当差异描述是口径错误。 |
| 2 | quality_score：`scoreTree()` → `computeQualityScores` | ✅ 属实。`runCore` :410 调 `scoreTree(usage, treeNames)`；`scoreTree()` :512-523 传 `supportDirs` + `referenceCounts`；`referenceCounts()` :531-546 从 frontmatter `related_skills` 算 in-degree（rc.30-G 已修）；`quality.ts:58-89` 六因子（权重 :38-45，warn<0.3 :48）。`skill_manage review` 消费分数（`tool-skill-manage/src/index.ts:129-133`）。 |
| 3 | 报告持久化：`run()` 写 `~/.dsh/reports/curator-<runId>.json` + `llmReviewEnabled` | ⚠ 字段属实，路径仍偏差（沿用 rc.25 起的口径）：`runCore` :455-457 写 `join(evolutionHome(), 'reports', curator-<runId>.json)`，:453 带 `llmReviewEnabled`；但 `evolutionHome()` = `$DSH_HOME/evolution`（`state-store.ts:12-14`），实际路径为 **`~/.dsh/evolution/reports/`**。`latestReport()` :662-670 同目录读。报告含 `schemaVersion/runId/staleCandidates/llmNominations/archiveCandidates/archived/failed/snapshotPath`（`core/curator.ts:59-102`）。H 对照：`_write_run_report`（curator.py:1079）写 `~/.hermes/logs/curator/<ts>/` 下 run.json + REPORT.md（`_reports_root` :561、`_render_report_markdown` :1271）。 |

---

## 2. 功能域对齐判定表

D 侧路径省略 `packages/evolution/`；H 侧省略 `D:\claw\hermes-agent\`。

### 2.1 记忆

| 语义 | H 行号 | D 行号 | 判定 | 差异说明 |
|---|---|---|---|---|
| 条目解析/读写 | `tools/memory_tool.py:683,760` | `evolution-core/src/memory-store.ts:46-52,105-115` | ✅ | 同为 `§` 分隔、trim+去空、原子写（temp+rename） |
| 单操作 add/replace/remove | `tools/memory_tool.py:336,388,457` | `memory-store.ts:184,218-263` | ✅ | 子串唯一匹配、去重（`stripDatePrefix` 归一）、威胁扫描；add 也先查 drift（:189-195） |
| 批量原子写 | `tools/memory_tool.py:497-545` | `memory-store.ts:266-319` | ✅ | 均为锁内 all-or-nothing、最终预算校验、先扫毒后落盘；H 锁=`_file_lock`(:245)，D=io 层写锁（`io.ts:60-86`）+ 进程内 writeChain（`memory-files:43-48`） |
| 字符限额/失败退避 | `tools/memory_tool.py:331,145` | `memory-store.ts:87-89,121-132` | ✅ | 2200/1375；连续失败上限 3、成功重置；limit≤0 视为无界 |
| 注入渲染 | `tools/memory_tool.py:615,664` | `memory-store.ts:321-344`；`tool-memory/src/index.ts:116-127,140` | ≈ | 头部使用率标注 `[N% — X/Y chars]`（钳位 100）、无独立 cap、threat 过滤标注一致；**已知差异：D 为 live 快照**（写后 :140 重渲染），H 为 load 时冻结（:168） |
| 条目预览 | `tools/memory_tool.py:631`（width 80） | `tool-memory/src/index.ts:111,144`（entryPreviewChars 200） | ≈ | 仅宽度不同 |
| 日期前缀 | H 无 | `memory-store.ts:82,207,287`；`memory-files:30` | ✅ | 默认 false |
| 漂移检测 | `tools/memory_tool.py:704-760` | `memory-store.ts:354-371` | ✅/★ | 双信号一致：结构漂移（canonical 重渲染比对）+ 单条目超限（:367，注释即标 H parity signal #2）；D 另有 10×limit 读守卫（:20,:97-103）与 raw-copy 备份（:153-163，随机后缀防同秒覆盖） |
| 漂移/超限拒绝消息 | `tools/memory_tool.py:83`（`.bak` 路径） | `memory-store.ts:172-182,192` | ✅ | 均附备份文件名与人工修复指引 |
| 水位提示 | H 无（错误带 usage） | `memory-store.ts:139-144` | ★ | ≥80% 追加 `⚠️ Storage at N%`，钳位 100 |
| 可恢复错误 | `tools/memory_tool.py:927-958,604`（附 `current_entries`） | `memory-store.ts:228,245-252,283,292-299` | ⚠ | **本轮新增**：H 在 replace/remove 未命中或缺 old_text 时回传当前条目清单让模型免再读自恢复；D 只给错误文本（条目清单仅在 schema `entries` 字段，render 不展示）——见 §4-低 |
| 多 profile / 路径重定向 | `tools/memory_tool.py:55`（profile 目录）；`skill_manager_tool.py:589` | 无 | ≈ | DSH 无 profile 概念（平台差异，非缺陷） |
| 写审批门 | `tools/memory_tool.py:823,880,1036`（默认 false） | `evolution-approval/src/index.ts:70,109-133`；`tool-memory:210-221` | ✅ | 双方默认关；开启后前台+后台均 staged，replay 走注册 runner |
| 威胁扫描 | `tools/memory_tool.py:78` | `threats.ts:118-124`；`memory-store.ts:196,234,284,307,333` | ✅ | strict scope、ANY 命中阻断 |

### 2.2 技能

| 语义 | H 行号 | D 行号 | 判定 | 差异说明 |
|---|---|---|---|---|
| 工具入口/action | `tools/skill_manager_tool.py:1303,1337-1370`（6 mutating：create/edit/patch/delete/write_file/remove_file） | `tool-skill-manage/src/index.ts:160`（12 action） | ★ | D 多 review/list/update/skip/pin/unpin；H 的 pin/unpin 仅 CLI（curator.py 外部），D 为模型可达控制面（后台被 :387-389 拒） |
| 名字校验 | `tools/skill_manager_tool.py:469-481`（允许 `.`/`_`） | `constants.ts:26`；`skill-store.ts:284-290` | ≈ | D 正则更窄（仅 lowercase+digit+hyphen）；D 额外要求 frontmatter name 与目录名一致（:125） |
| category 嵌套 | `tools/skill_manager_tool.py:483,562` | 无（平铺树） | ≈ | DSH 技能树平铺；archive 扁平化语义与 H 一致（`skill_usage.py:723-727` vs `skill-store.ts:499-504`） |
| 创建/编辑/补丁 | `tools/skill_manager_tool.py:776,844,897` | `skill-store.ts:410,431,448` | ≈ | 语义一致；D fuzzyPatch 两级（边界 trim→空白+转义容忍，:221-243）小于 H 六策略链；所有路径先过 badName 守卫 |
| 写前校验 | `tools/skill_manager_tool.py:508,547` | `skill-store.ts:119-131` | ✅ | frontmatter name/description/内容尺寸；D 行式解析（非 YAML 库）但校验面等价 |
| 删除=归档 + absorbedInto | `tools/skill_manager_tool.py:1010-1073`（前台硬删，curator 路径归档） | `skill-store.ts:487-517`（前台也归档，永不硬删） | ≈/★ | D 可恢复性更强；`absorbedInto` 非空必须指向存在技能（:495-498）；`.archive-reason` 落盘（:513-514）；冲突加时间戳（:501-504）与 H `archive_skill`（skill_usage.py:723-727）一致 |
| 后台删除 fail-closed | `tools/skill_manager_tool.py:405-453` | `evolution-plan-validator/src/index.ts:136`；`evolution-review/src/index.ts:353-358`；`tool-skill-manage:95` | ✅ | rc.30-C 已修：validator 要求 delete 必带 absorbed_into，执行器再验伞存在；前台 bare delete 不受限（同 H） |
| 支持文件 | `tools/skill_manager_tool.py:692,1115,1177` | `skill-store.ts:143-152,605-639` | ✅ | 白名单目录（references/templates/scripts/assets）、路径穿越拒绝、字节限制、威胁扫描 |
| 原子写 | `tools/skill_manager_tool.py:740` | `io.ts:97-104` | ✅ | temp+rename；D 另有跨进程锁 |
| 删除目标防线 | `tools/skill_manager_tool.py:193-253`（拒 symlink/根/树外路径） | `skill-store.ts:284-290`（名字正则）+固定 join+rename-only | ≈ | D 无 rmtree、路径由名字白名单构造，误删根不可能；但**无显式 symlink 拒绝**（symlink 目录会被整体 rename 进 .archive）——见 §4-低 |
| 写保护双语义 | `tools/skill_manager_tool.py:254-278`（前台挡删）、`:281-364`（后台连 patch 拒 :312） | `skill-store.ts:292-303`（后台 pinned 连写拒 :301）、`:305-314`（deleteProtection 含 pinned） | ✅ | bundled/hub 对一切来源拒写；pinned 前台只挡删、后台连 patch 拒 |
| 后台读前写 | `tools/skill_manager_tool.py:56,81,89,366-394`（edit/patch/write_file/remove_file 前查读标记） | `evolution-review/src/index.ts:379-395,405-417`（READ_REQUIRED 六 action）+ `:222,241`（父会话∪子代理会话） | ✅ | rc.30-A 已修：读标记取自 review 子代理自己的会话（:222）并与父会话并集；create 豁免与 H preflight（:396-402）一致 |
| origin provenance | `tools/skill_provenance.py:37-78`（ContextVar） | `tool-skill-manage:185-191`；`skill-store.ts:422-426` | ≈ | D：`origin==='subagent'` 即 review 通道（H 仅 review fork 是）；库层面 D 区分 `subagent`/`background_review` 双值（:191），审批面统一 background_review——语义近似 |
| agent-created 标记 | `tools/skill_manager_tool.py:102,1387-1390`；`skill_usage.py:646` | `tool-skill-manage:111`；`skill-usage/src/index.ts:70-75`；review 直通 `evolution-review:345-348` | ✅ | 仅 create 且非前台标记；H 有 `_guard_agent_created_enabled` 开关（:102），D 恒开（差异无场景） |
| delete 的 usage 回写 | `tools/skill_manager_tool.py:1392-1395`（归档保 STATE_ARCHIVED/硬删 forget） | `tool-skill-manage:112`（markArchived）；`evolution-learning-graph:180-181`；review 直通 ✗ | ⚠ | 工具与图谱路径已回写；**review 直通路径漏**——见 §4-高 A |
| 安全扫描 | `tools/skill_manager_tool.py:121`（写后扫描） | `threats.ts:127`；`skill-store.ts:417,441,480,548,615` | ✅/★ | D 写前扫描阻断（无需回滚） |

### 2.3 复习

| 语义 | H 行号 | D 行号 | 判定 | 差异说明 |
|---|---|---|---|---|
| cadence 触发 | `agent/background_review.py:872`（每轮后 fork） | `evolution-review/src/index.ts:112-159`；`signals.ts:74-106` | ≈ | D = interval + substantive 门 + 正则信号 + 密度加权（`turnsSinceSkill += max(1, toolCalls)` :88）；H 无 interval 概念 |
| substantive 判定 | —（H 无） | `signals.ts:82-84`；`constants.ts:57-59` | ✅ | ≥3 tool calls / ≥200 user chars / ≥500 agent chars |
| completion 双通道 | H 无 | `evolution-review:160-177,374-376`；`constants.ts:54-56`（trigger 默认 both、阈值 20） | ★ | completed + 累计 toolCalls≥20 每会话一次；累计计数含触发过 cadence 的轮（:142-143） |
| spawn + origin 短路 | `agent/background_review.py:572,677-683`（fork+持久隔离） | `evolution-review:120,180-224`（subagent 独立会话） | ✅ | subagent 失败回退 inject（:152-157）；回退路径缺读前写守卫见 §4-低 |
| 三提示词 | `agent/background_review.py:160,171,276` | `prompts.ts:21,31,59` | ✅/≈ | 核心规则逐条对应（ACTIVE、class-level、四步优先序、protected 规则、do-not-capture 四条、fix-not-negative）；D 为精简版：support-file 三目录语义、user-preference embedding 段、overlap→curator 提示被压缩；D 另加 completion 提示（:112-117） |
| 执行白名单 | `agent/background_review.py:766-780`（memory+skill 工具） | `evolution-review:51`（reviewToolAllow `['skill']`）+ 结构化 plan（memory 走 plan 非 live 工具） | ✅ | 危险命令自动 deny（H :592-600）在 D 由 toolFilter 结构性排除 |
| review 输入 | `agent/background_review.py:782`（同模型全量 replay；aux 模型走 digest :112 tail 24） | `evolution-review:427-470`（user/assistant 尾 60 条×2000 字符 + 尾 12 条 tool call/result 证据） | ≈ | rc.30-F 部分修复：已有工具证据但非全量 replay；另有 `redactReviewSecrets`（`redact.ts:25-31`）脱敏 ★ |
| 计划执行旁路 | `tools/skill_manager_tool.py:1376-1400`（fork 内工具直调+遥测） | `evolution-review:272-364`（approval 三态：staged/disabled 直通/replay） | ≈ | rc.30-G 已修（isEnabled 分流 :307）；残留见 §4-高 A |
| plan 校验 | H 无（fork 直接用工具） | `evolution-plan-validator:75-141`（evidence seq、forbidden keys、预算、absorbed_into） | ★ | D 独有确定性校验层 |
| 读标记作用域 | `tools/skill_manager_tool.py:89`（每次 review 重置，仅本次 fork 内读过的算） | `evolution-review:241`（父会话全历史 ∪ 子会话） | ≈ | D 偏宽（父会话早先加载的也算"读过"）；单会话场景等价 |

### 2.4 策展

| 语义 | H 行号 | D 行号 | 判定 | 差异说明 |
|---|---|---|---|---|
| 生命周期状态机 | `agent/curator.py:291-370` | `core/curator.ts:233-279` | ✅ | active→stale→archived、复活；pinned/exclude/suppressed/referenced/bundled 门（`lifecycleCandidate` :163-178）对应 H :317-327 |
| protected builtins | `tools/skill_usage.py:66-69`（`{"plan"}`） | `constants.ts:35`（`{"plan"}`） | ✅ | 集合逐一相同 |
| never-used 宽限 | `agent/curator.py:349-355` | `core/curator.ts:244` | ✅ | use_count==0 且未到 stale 窗口不动 |
| seed 基线 | `agent/curator.py:331-334`；`tools/skill_usage.py:557` | `evolution-curator:493-507`（seedBaseline） | ✅/★ | 时钟从 now 起算；D 同时把 `.pinned` marker 双向镜像进 usage（:503-504） |
| curator 资格 | `tools/skill_usage.py:447-475`（agent-created 恒可、bundled 看开关、hub/external 永不） | `core/curator.ts:173-175`（`created_by==='agent'` 或 manageUnmanaged；bundled 看 pruneBuiltins） | ✅ | 语义同构 |
| 运行门控 | `agent/curator.py:219-262`（enabled/paused/interval/first-run seed defer） | `evolution-curator:361-391` | ⚠ | interval 门（:361）、active-session 门（:368）、first-run-deferred（:378-391，H :247-262 对位）齐全；**paused 门缺失**——字段三处声明但无门控无入口（本轮新增，见 §4-中 B） |
| minIdle | `agent/curator.py:154`（默认 2h，config.py:2260） | `constants.ts:62`；`evolution-curator:143,368,648-660` | ✅ | 默认 2h；调用点比较 agents 事件（H 在 gateway 调用点） |
| pruneBuiltins + suppression | `hermes_cli/config.py:2284`（默认 True）；`tools/skill_usage.py:263-327` | `evolution-curator:104`（默认 **false**）；`usage.ts:121-148` | ≈ | 机制齐全（bundled marker + allowBundled + 版本化 suppression + 归档即抑制 :591-595）；默认保守（差异需显式声明，见 §4-低） |
| 快照回滚 | `agent/curator_backup.py:211-287,539`（tar.gz、keep 5、cron jobs 一并备份、usage/state 同备） | `skill-store.ts:648-693,763-807`；`evolution-curator:280-314` | ✅/≈ | D 快照含活跃树 + usage/suppression sidecar（:659-666）+ `.archive/`（:671-676）+ extras（curator-state :280-287）；restore 回读 sidecar/archive/extras（:763-807）+ pre-rollback 安全快照；差异仅形态（目录 copy vs tar.gz）与 cron 备份（D 无 cron 可备，curator state 走 extras） |
| dry-run | `agent/curator.py:1480,1506-1512`（不 bump state） | `evolution-curator:338,355,395-396,436,472-474`（clone usage、不 snapshot、不推 lastRunAt、仍写报告） | ✅ | D 另有 `CURATOR_DRY_RUN_BANNER`（prompts.ts:100-110）注入 LLM pass |
| LLM 合并 | `agent/curator.py:1480,1569-1744,1809`；`config.py:2267-2274`（**默认 False**） | `evolution-curator:98,217-260,411`（默认 **false**） | ✅ | 默认值精确对齐（此前口径有误）；均为「LLM 只提名、确定性执行」；H 有单次 `--consolidate` 覆盖（CLI），D 无（§4-低） |
| 提名纠偏 | `agent/curator.py:723-989`（claimed-into 不存在→降级为 pruned、rename map） | `evolution-curator:253,417-422,600-602`（树外即 error；gate 过滤保护名） | ≈ | D 拒绝而非降级（保守方向）；rename map 未采纳（extraction-2 §3 已裁定，报告以 `archived[].reason='Consolidated into X'` 承载） |
| 合并提示词 | `agent/curator.py:403-470`（100+ 行） | `prompts.ts:68-98`（31 行） | ≈ | 硬规则 6 条、集群法、YAML 协议、use=0 非证据、"distinct trigger 非拒绝理由" 均保留；篇幅压缩 |
| LLM pruning 状态回写 | `tools/skill_usage.py:696-754`（archive_skill 尾 `set_state(ARCHIVED)`） | `evolution-curator:585-589`（每次成功归档统一置 archived+archived_at） | ✅ | rc.30-D 已修；consolidation 路径同（:609-613） |
| 归档失败回滚 | `agent/curator.py`（失败即不迁移） | `evolution-curator:576-578`（failedFrom 回滚 state，防 stale↔archived 振荡） | ★ | D 独有 |
| 抑制持久化 | `tools/skill_usage.py:288-327` | `evolution-curator:620-628`；`usage.ts:142-148` | ✅ | 版本化 JSON |
| usage 缓存一致性 | `tools/skill_usage.py:500-543`（每操作读盘） | `skill-usage/src/index.ts:41-44`（缓存）+ `evolution-curator:639-644`（invalidate） | ✅ | rc.30-E 已修 |
| cron 引用保护/重写 | `cron/jobs.py:1748-1775,1777-1824`；`agent/curator.py:276` | `evolution-curator:47,105,408,417-422`（声明式 `referencedSkillNames`，双侧 gate） | ≈ | 不自动扫描调度记录、合并后不重写引用（task-board 渠道阻塞，补齐路径见 §4-低） |
| 报告 | `agent/curator.py:1079-1120,1271`（run.json+REPORT.md，`~/.hermes/logs/curator/<ts>/`） | `evolution-curator:455-462,662-670`（仅 JSON，`~/.dsh/evolution/reports/`） | ⚠ | 路径偏差 + 无 REPORT.md 人读层 + 无保留裁剪（§4-低） |
| 运行摘要/计数 | `agent/curator.py:75-102`（last_run_at/run_count/last_run_summary/paused） | `evolution-curator:470-477`（同构+schemaVersion）；摘要含 llmHint（:466-469） | ≈ | llmReview 关闭且有 stale 候选时明示（决策可见性）★ |
| 调度入口 | `agent/curator.py:1958`（gateway tick） | `evolution-curator:158,173-209`（autoStart + boot grace 追赶 + 1h tick） | ≈ | 进程内调度；重启追赶（bootCheck :180-184）为 D 增强 |
| 质量评分/去重 | H 无 | `quality.ts:58-89,115-176`；`evolution-curator:410,512-546`；`tool-skill-manage:135-145` | ★ | 六因子（references 已接）+ 两阶段去重（SHA+Jaccard 0.95+token 比 5×+union-find）进 review 文本 |

### 2.5 图谱

| 语义 | H 行号 | D 行号 | 判定 | 差异说明 |
|---|---|---|---|---|
| 技能节点 | `agent/learning_graph.py:125-154`（usage+frontmatter 元数据） | `evolution-learning-graph/src/index.ts:41-45` | ≈ | D 节点仅 name/label；无 category/state/use_count 元数据 |
| 技能-技能边 | `agent/learning_graph.py:156-172`（frontmatter `related_skills`，双向去重、两端存在） | `evolution-learning-graph:47-52` | ⚠ | **本轮新增**：D 的 `related` 边是排序后相邻节点连线（占位实现，非语义）；D 的 quality references 因子已解析 `related_skills`（`evolution-curator:531-546`）但图谱未复用——见 §4-中 C |
| memory 节点/边 | `agent/learning_graph.py:193-227`（MEMORY+USER 全量卡片、token 匹配） | `evolution-learning-graph:53-64` | ✅ | `memory:<source>:<index>` 两源渲染 + token 包含匹配（rc.30-C 构建器/解析器一致性已修：:73-78） |
| memory 索引规则 | `agent/learning_graph.py:193-211`（**全局**索引：MEMORY 先 USER 后）+ `learning_mutations.py:48-60`（全局→局内换算） | per-file 索引（各文件独立从 0） | ≈ | 已知近似（跨生态 id 互换会错位；DSH 内部自洽） |
| 编辑入口 | `agent/learning_mutations.py:124,157`（delete/edit，三 surface） | `evolution-learning-graph:126-131,160-190`（`graph detail/edit/delete`） | ≈ | 命令名 `graph`（挂在 /evolution 下）；memory 编辑走 applyBatch、skill 走 update/archive；graph delete 已回写 usage（:180-181，rc.30-B 关联修复） |
| 密度统计 | `agent/learning_graph.py:174-191`（edges_per_node/isolated_pct/categories） | 无 | ⚠ | 观测面子集缺失（低） |

### 2.6 遥测 / provenance

| 语义 | H 行号 | D 行号 | 判定 | 差异说明 |
|---|---|---|---|---|
| Usage 记录 | `tools/skill_usage.py:484-498` | `usage.ts:11-25` | ✅ | 字段逐一对应（含 state/pinned/archived_at/quality_*） |
| 三计数器 | `tools/skill_usage.py:611,623,635` | `usage.ts:84-100`；`skill-usage:57-64` | ✅ | use/view/patch + 时间戳 |
| seed / markAgentCreated | `tools/skill_usage.py:557,646` | `usage.ts:33-47,102`；`skill-usage:70-75` | ✅ | |
| markArchived（状态迁移不 bump patch） | `tools/skill_usage.py:657-663,754`（set_state） | `skill-usage:82-91` | ✅ | delete 路径已接线（tool :112、graph :180-181）；review 直通缺（§4-高 A） |
| forget（硬删记录） | `tools/skill_usage.py:678-694` | 无 | ≈ | D 永不硬删，forget 无对应场景 |
| 并发控制 | `tools/skill_usage.py:90-123`（fcntl/msvcrt 锁内 RMW） | `io.ts:60-86`（io 层写锁）+ `skill-usage:51-55`（进程内 chain） | ✅ | rc.30-H 已修（wx+5s 陈旧+10×50ms） |
| 抑制清单 | `tools/skill_usage.py:263-327` | `usage.ts:121-148` | ✅ | 版本化 JSON + legacy 数组兼容 |
| provenance | `tools/skill_provenance.py:37-78`（ContextVar） | `tool-skill-manage:185-191`（origin 参数） | ✅ | 平台翻译（Cordis 无线程上下文需求）；§3.11 翻译清单兑现 |
| 审批 | `tools/memory_tool.py:823,880`；`skill_manager_tool.py:1242`；`config.py:2076,2242`（默认 False） | `evolution-approval:70`（默认 false）、`:109-133`（never 策略跳过 :115）、claim/dedupe 防竞态 :143-158,168-198 | ✅/★ | staged 队列 + claim 表 + batch/archive 摘要（:204-214）+ sessionPolicy='never'（无人值守显式化） |

### 2.7 威胁

| 语义 | H 行号 | D 行号 | 判定 | 差异说明 |
|---|---|---|---|---|
| 模式目录 | `tools/memory_tool.py:78`→`tools/threat_patterns.py`（strict） | `threats.ts:24-64`（31 模式/3 scope） | ✅ | D 为无依赖子集；scope 累积（strict⊃context⊃all :69,100）、ANY 命中阻断（:112-115） |
| 防规避 | —（不在本轮 H 清单） | `threats.ts:66-67,91-97`（零宽/Bidi/NFKC/65536 截断） | ★ | |
| 工具调用面守卫 | H 无独立层（扫描内嵌工具） | `evolution-threat/src/index.ts`（pre-execution 扫 memory/skill_manage 参数）+ `evolution-policy:148-161`（protected paths + forbidden keys 拒绝） | ★ | D 独有双层 |

### 2.8 写作规范

| 语义 | H 行号 | D 行号 | 判定 | 差异说明 |
|---|---|---|---|---|
| 写作标准 | `agent/learn_prompt.py:30-96` | `prompts.ts:171-201`（DSH_AUTHORING_STANDARDS） | ✅ | 逐条翻译（frontmatter 各字段、章节序、verbatim 规则、router 禁令）；D 增 `metadata.hermes.related_skills` 指引（:180，喂 quality references） |
| /learn 入口 | `agent/learn_prompt.py:99-112` | `learn-prompt.ts:21-41`；`evolution-commands:97-100` | ✅ | 三步指引 + 「所有需求都是负载」+ 标准全文；空参回退同款 |
| 60 字符规则机制前提 | H 系统索引按 60 截断 | D 目录索引上限 500（F12 支线，不在本仓库） | ≈ | 已知差异（文本/校验关系一致，保留） |

### 2.9 调度 / 配置治理

| 语义 | H 行号 | D 行号 | 判定 | 差异说明 |
|---|---|---|---|---|
| 调度 | `agent/curator.py:1958`（gateway poll）；`cron/jobs.py`（任务调度域） | `evolution-curator:106,158,173-187`（autoStart，默认 true） | ≈ | 进程内 timer+boot 追赶；task-board cron 可作外部通道（渠道差异） |
| 默认值单源 | `hermes_cli/config.py:2245-2295`（curator 块） | `constants.ts:51-67` + 各包 `Config.z.default` | ✅ | interval 168h/minIdle 2h/stale 30d/archive 90d/consolidate off/prune_builtins（D false vs H true）/keep 5 逐项对齐 |
| 版本迁移 | `hermes_cli/config.py:5605,5711`（v 迁移 seed） | `state-store.ts:35-50`（mergeDeep） | ≈ | 无版本化迁移 seed；mergeDeep 前向兼容 |
| 解析兜底 | `hermes_cli/config.py` load 容错 | `JsonState.mergeDeep`（:16-90）；schema 默认 | ✅ | |

---

## 3. D 独有增强（★，H 无对应）

| 机制 | D 行号 | 说明 |
|---|---|---|
| 计划确定性校验 | `evolution-plan-validator:75-141` | evidence 事件序号、forbidden keys（policy/threshold/prompt_hash/model_route/evolution_config）、预算上限 |
| 策略控制面 | `evolution-policy:105-161` | 工具 guard 拒改 policy 路径 / 拒改治理键；protectedSkillNames 强制含 plan（:130） |
| 审计轨迹 | `mutations.ts` + `skill-store.ts:355-374` | 每次技能变更落 before/after sha256，cap 500，版本化 |
| prompt bundle fail-closed | `prompts.ts:125-169`；`evolution-review:103-105` | sha256 钉住常量，部署漂移拒绝调度 review |
| review 输入脱敏 | `evolution-review/src/redact.ts:9-31` | 凭据形态掩码后才会话快照出域 |
| 快照完整性 | `skill-store.ts:648-693` | sidecar+archive+extras 全状态快照、manifest 白名单回读（:745-755）、pre-rollback 可逆 |
| 归档失败回滚 | `evolution-curator:576-578` | 防 stale↔archived 振荡 |
| 活动投影 / A-B 回放 | `evolution-activity`、`evolution-replay` | plan-applied 事件投影与策略对比 |
| 技能目录直通 | `evolution-skill-catalog` | 写入即失效的 skill registry provider（去 fs-watcher 窗口） |
| 能力治理 | `evolution-capability` | 动态包只走 staged 审批，不执行模型代码 |
| 记忆读守卫/水位 | `memory-store.ts:97-103,139-144` | 10× 尺寸守卫 + 80% 水位提示 |
| completion 复习通道 | `evolution-review:160-177` | 单发长任务会话的复习入口（H 无） |

---

## 4. 仍需优化项（按严重度）

### 高

**A. review 直通路径 delete 归档后 usage 不置 archived（本轮新增，rc.30-D 的兄弟残留）**
- H 机制：`tools/skill_manager_tool.py:1392-1395`——归档路径保留 `STATE_ARCHIVED`（`skill_usage.archive_skill` :754 尾部 `set_state`），硬删才 `forget`。
- D 现状：三条 delete 路径中两条已修（`tool-skill-manage:112` markArchived、`evolution-learning-graph:180-181` markArchived、curator `applyMutations:585-589`）；但 `evolution-review/src/index.ts:353-358` 的 `executeSkillDirect` delete 分支只调 `library.archive`，**不调 `markArchived`**。默认部署（host 挂 evolution-approval 但 `enabled=false`）恰好走该直通分支（:307 `isEnabled===false → runnerDirect`）。
- 实际场景差异：复习子代理 delete（带 absorbed_into）成功后，`.usage.json` 记录仍是 active/stale；下次 curator run 把该名字当 archive 候选，`skills.archive` 报 "not found"，`failedFrom` 回滚 state——每次 run 产生一条持久错误噪音，记录永不收敛。
- 严重度：高（遥测状态与文件树分叉，复习通道主场景）。
- 补齐路径：能做的——`executeSkillDirect` delete 成功分支与 create 的 `markAgentCreated`（:345-348）对称，调 `ctx.skillUsage.markArchived(name)`。无渠道阻塞。

### 中

**B. 策展暂停门缺失（本轮新增）**
- H 机制：`agent/curator.py:110-116`（`set_paused`/`is_paused`）+ `should_run_now` :231-233 paused 门 + CLI `hermes curator pause`。
- D 现状：`paused` 字段三处声明（`evolution-state-domain:32`、`evolution-state-storage:25`、`evolution-curator:73`），但 `runCore` 三个门（interval :361 / active-session :368 / first-run :378）都不检查它，且每次保存硬编码 `paused: false`（:384,:476）；`evolution-commands` 无 pause/resume 子命令。
- 实际场景差异：无法暂停自动策展——只能 `enabled:false` 重启整个服务（丢定时器与 boot 追赶），或临时改 interval。
- 严重度：中（运维面缺失，自动化行为不可控时无软闸）。
- 补齐路径：能做的——`runCore` 开头加 `persisted?.paused === true → skipped:'paused'`；`/evolution curator pause|resume` 写 state。无渠道阻塞。

**C. 图谱技能-技能边为占位实现，未用 `related_skills`（本轮新增）**
- H 机制：`agent/learning_graph.py:156-172` `build_edges` 基于 frontmatter `related_skills`，双向去重、两端存在校验——语义边；节点亦携带 category/state/related 元数据（:125-154）。
- D 现状：`evolution-learning-graph/src/index.ts:47-52` 的 `related` 边 = 排序后**字母相邻节点两两连线**。而 quality 的 references 因子已经在解析同一 frontmatter 字段（`evolution-curator:531-546`），两处不同源。
- 实际场景差异：`/evolution graph` 的技能连线是噪音（无关技能因排序相邻而连线），图谱既不反映引用结构也不反映 H 语义。
- 严重度：中（命令面用户可感知的失真）。
- 补齐路径：能做的——`buildLearningGraph` 增加 related 输入（从 `parseFrontmatter(...).frontmatter['related_skills']` 收集，复用 `referenceCounts` 的正则），替换字母相邻逻辑；顺手补 density 统计（H :174-191）。无渠道阻塞。

### 低

**D. inject 回退路径绕过读前写守卫（本轮新增）**
- H 机制：无 inject 模式——复习总是 fork，读前写守卫（skill_manager_tool.py:366-394）必然生效。
- D 现状：`evolution-review:151-157` subagent 启动失败回退主会话 inject；主会话随后用 `skill_manage` 直接改，不经 `filterUnreadSkillOps`/plan-validator（写保护与威胁扫描仍在）。
- 实际场景差异：仅回退场景发生；主会话可 patch 本会话未加载过的技能（"盲改"面与 H 不一致）。
- 严重度：低（回退频率低；写保护/威胁扫描仍兜底）。
- 补齐路径：能做的——inject 文本内嵌"只更新本会话已加载的技能"约束；或回退也走结构化 plan 通道。无渠道阻塞。

**E. 提示词与写保护的 pinned 矛盾（D 原样复刻了 H 的同一矛盾；本轮新增）**
- H 机制：skill prompt 明言 "Pinned skills … CAN be improved — pin only blocks deletion"（background_review.py:171-275 内），但 `_background_review_write_guard` :312 对 pinned 后台 patch 直接拒绝（#25839 语义）——文本与实现互相矛盾。
- D 现状：`prompts.ts:47` "Pinned skills may be patched but not archived" + `skill-store.ts:301` background_review+pinned 拒写——同一矛盾。
- 实际场景差异：review 子代理被提示鼓励 patch pinned 技能，随后被实现拒绝（浪费一次 plan op，产生 rejected 噪音）。
- 严重度：低（行为安全侧；仅提示词误导）。
- 补齐路径：能做的——D 先行修掉：`prompts.ts:47` 改为 "pinned skills are read-only to the background review"。无渠道阻塞。

**F. replace/remove 错误面缺条目清单（本轮新增）**
- H 机制：`tools/memory_tool.py:927-958`（缺 old_text → 附 `current_entries` + 重试指引）、`:604` `_batch_error`、`:497` 未命中附 entries——可恢复错误让模型免再读。
- D 现状：`memory-store.ts:228,245-252,283,292-299` 只回错误文本；条目清单在 schema `entries` 字段但 tool render 不展示（`tool-memory:186`）。
- 实际场景差异：多义匹配/未命中后模型通常靠注入快照仍可见条目，影响小；注入被 threat 过滤或 skip 时自恢复变慢。
- 严重度：低。
- 补齐路径：能做的——`mutate/applyBatch` 失败消息附前 N 条预览（复用 `entryPreviewChars`）。无渠道阻塞。

**G. 报告目录无保留策略 + 无 REPORT.md（沿用，加重一条）**
- H 机制：`agent/curator.py:561`（`~/.hermes/logs/curator/<ts>/`）+ `:1079,1271`（run.json + REPORT.md）。
- D 现状：`evolution-curator:455-457` 平铺 `~/.dsh/evolution/reports/curator-<runId>.json`，无 prune（每 run 一文件，无限增长）、无人读层。
- 严重度：低（可观测性；不影响决策落地）。
- 补齐路径：能做的——`latestReport` 时顺手裁剪保留 N 份；可选按 H `_render_report_markdown` 生成 md。无渠道阻塞。

**H. 技能目录无 symlink 显式拒绝（本轮新增）**
- H 机制：`tools/skill_manager_tool.py:193-253` `_validate_delete_target` 拒 symlink/junction、拒删根、拒树外路径。
- D 现状：`skill-store.ts:284-290` 名字正则 + 固定 join + rename-only 归档——误删根在结构上不可能，但 symlink 目录会被**整体 rename** 进 `.archive`（链接本身移动，不跟进目标）。
- 实际场景差异：外部用 junction 把技能目录指到别处时，归档会搬走链接而非内容；restore 同理搬回。无数据丢失，但行为与 H 的"拒绝并要求手动处理"不同。
- 严重度：低。
- 补齐路径：能做的——`archive/restoreFromArchive` 前 `io.lstat` 检查符号链接并拒绝。无渠道阻塞。

**I. 保留为 ≈ 的已知差异（非缺陷，建议在文档显式声明其中两项默认值）**
- `pruneBuiltins` 默认 false vs H true（`config.py:2284`）——保守默认可取，但应声明（rc.25 起未声明）。
- 记忆注入 live vs H frozen（`memory_tool.py:168`）——已裁定保留（前缀缓存优化不落地）。
- skill name 正则更窄（无 `.`/`_`，`skill_manager_tool.py:469-481`）；无 category 嵌套；无多 profile。
- 报告路径 `~/.dsh/evolution/reports/`（口径统一即可）。
- memory id per-file 索引 vs H 全局（`learning_graph.py:193-211`）——已知近似。
- review 输入压缩（尾 60 条+12 条工具证据）vs H 同模型全量 replay（background_review.py:782）。
- cron 引用仅声明式、无自动扫描/重写（`cron/jobs.py:1748,1777`）——渠道阻塞：需 task-board 暴露"列举引用+重写"接口；接口具备后接 `computeLifecycleTransitions` 入参与 `applyMutations` 后重写。
- `/evolution curator run` 无单次 `--consolidate` 覆盖（H CLI 有）；llmReview 为构造期配置。
- LLM 提名 consolidate 的 `into` 不存在时 D 报错 vs H 降级为 pruned（`curator.py:858-989`）——保守方向，可保持。

---

## 5. 过期文档行清单（文档 ↔ 代码不一致）

### 5.1 rc.25 校准表（任务输入）逐行核对

| rc.25 文本 | 代码现状 | 结论 |
|---|---|---|
| 记忆行（全项 ✅） | 全部核实成立（含 raw-copy 备份、使用率标注、无 cap、日期前缀 off） | 仍有效 |
| 技能「8 action（差 review/skip）」 | 12 action：review/list/create/edit/update/patch/delete/write_file/remove_file/skip/pin/unpin（`tool-skill-manage:160`） | **过期** |
| 技能「写保护双语义」「读标记」「origin provenance」 | ✅ 核实成立（读标记本轮已修至父∪子会话、六 action 全覆盖） | 仍有效 |
| 复习「cadence+completion 双通道、spawn+origin 短路、三提示词 ✅」 | 成立；completion 阈值=累计 toolCalls≥20 | 仍有效 |
| 策展「状态机/门控/宽限/复活/seed/minIdle 2h/快照回滚/dry-run/suppression/LLM 合并（默认 false）/cron 引用保护=声明式 ✅/≈」 | 成立；快照回滚现已含 sidecar+archive+extras（比 rc.25 口径更强）；**LLM 默认 false 与 H（config.py:2267-2274 默认 False）实为精确对齐**，表述为差异需更正 | 仍有效（两处口径更正） |
| 图谱「2 边型、per-file 索引（已知近似）、/evolution graph 编辑 ≈」 | 2 边型属实；per-file 构建器/解析器已一致（rc.30 修）；**related 边为字母序占位**（本轮新发现，判定应降为 ⚠） | 部分过期 |
| 已知差异「注入 live」 | 属实 | 仍有效 |
| 已知差异「60 规则机制前提（索引 500）」 | 属实 | 仍有效 |
| 已知差异「skill_manage 9 vs 8」 | 现为 **12 vs 6 mutating** | **过期** |
| 已知差异「调度=进程内 autoStart」 | 属实（autoStart 默认 true + boot 追赶） | 仍有效 |

### 5.2 `docs/hermes-alignment-map.md`（rc.12 快照）

rc.25 审计 §2.1 所列 27 行过期判定**继续有效**（8 action、LLM 未接线、quality/dedup ✗、
completion ✗、读标记 ✗、start 未接线、drift 无 .bak、suppression ✗、minIdle 0、dry-run ✗、
CURATOR_PROMPT 17 行、cron 保护 ✗、内置仅 plan、图谱编辑 ✗ 等，逐项已被后续版本推翻）。
本轮补充：

| 行 | 旧文本 | 代码现状 |
|---|---|---|
| :20 | 写保护 "pin 不挡 patch"（claw 语义） | D 为 H 语义：后台 pinned 连 patch 拒（`skill-store.ts:301`） |
| :35/:143-144 | D 图谱 2 边型 ⚠ | 边数属实，但 `related` 为字母序占位而非 `related_skills` 语义边（见 §4-C） |
| :57 | 注入「≈ → ✅」 | live 快照差异仍在（属已声明决策，非回归） |

### 5.3 `docs/hermes-borrow-extraction-2.md`

| 行 | 旧文本 | 代码现状 |
|---|---|---|
| :63 | "DSH F15 实现为 per-file index…与构建器不一致"（rc.25 报告的质疑） | **该行现在反而准确**：rc.30 修复后构建器与解析器均为 `memory:<source>:<index>` per-file（`evolution-learning-graph:55,73-78`），文档无需改 |
| :34 | "frozenSnapshot 默认 live，配置项未实现" | 仍准确（未实现，属已裁定） |

### 5.4 `docs/hermes-borrow-implementation-plan.md`

| 行 | 旧文本 | 代码现状 |
|---|---|---|
| :66 | E（journey 全局索引）保持已知近似 | 仍准确（rc.25 报告对该行的质疑已随 rc.30 修复失效） |
| :15 | G3 "探路完成，实现待确认" | 已实现（rc.24，`sessionPolicy` 通路在 `evolution-approval:115`、两工具透传 :192/:208）——行状态可更新为 ✅ |

### 5.5 前两轮审计报告中被本轮推翻的行

**`docs/hermes-alignment-audit-rc25.md`**（已被 rc.30 取代，其中）：
- :55「读标记未覆盖 write_file/remove_file」→ 已修（READ_REQUIRED 六 action，`evolution-review:406`）。
- :88-89「图谱构建器 `memory:<index>` 与解析器不一致」→ 已修。
- :148「首次 defer 缺失」→ 已修（first-run-deferred，`evolution-curator:378-391`）。

**`docs/hermes-alignment-audit-rc30.md`**（§0「仍存在 4 个高优先级缺陷」整段过期）：
- §3-A（读标记父会话）→ 已修（`evolution-review:222,241`）。
- §3-B（delete 不回写 usage）→ 工具/图谱/curator 三路径已修；**review 直通路径残留**（本轮 §4-高 A）。
- §3-C（后台 bare delete）→ 已修（plan-validator :136 + 执行器 :353-358）。
- §3-D（LLM pruning 不置 archived）→ 已修（`applyMutations:585-589`）。
- §3-E（usage 缓存双写）→ 已修（`invalidate`，`evolution-curator:639-644`）。
- §3-F（review 无工具证据）→ 部分修（尾 12 条工具证据，:445-460；非全量 replay，保留 ≈）。
- §3-G（host approval runner）→ 已修（isEnabled 分流，:307）。
- §3-H（跨进程锁）→ 已修（`io.ts:60-86`）。
- §3-I（快照不含 usage/archive）→ 已修（`snapshotAll:659-676`）。
- §2.1 写并发 ⚠、§2.6 跨进程锁 ✗ → 同 §3-H，过期。
- §2.5 图谱 ✅ 判定 → 本轮发现 related 边占位，应降 ⚠（见 §4-C）。

---

## 6. 关键证据索引

- H 记忆：`tools/memory_tool.py:78,83,145,245,331,336,497,604,615,631,664,683,704,791,823,880,927,959,1036`
- H 技能：`tools/skill_manager_tool.py:56,81,102,121,193,254,281,312,366,396,405,469,508,547,692,740,776,844,897,1010,1115,1177,1242,1303,1376-1400`
- H 遥测/provenance：`tools/skill_usage.py:66,71,90,263-327,447,473,484,500,557,611,623,635,646,657,678,696-755,757-830,870`；`tools/skill_provenance.py:37-78`
- H 复习：`agent/background_review.py:46,112,160,171,276,363,545,572,592,677-683,766-780,782,872`
- H 策展：`agent/curator.py:71-116,140-190,219-262,276,291-370,403-470,561,601,723,804,858,989,1079,1271,1458,1480,1569,1744,1809,1958`；`agent/curator_backup.py:70,86,164,186,211,288,539`
- H 图谱/写作/调度/配置：`agent/learning_graph.py:125,156,174,193,227,254`；`agent/learning_mutations.py:36,48,124,157`；`agent/learn_prompt.py:30-96,99`；`cron/jobs.py:1748,1777`；`hermes_cli/config.py:2076,2242,2245-2295`
- D 记忆：`evolution-core/src/memory-store.ts:20,46,82,87,97,105,121,139,153,172,184,226,266,321,354`；`memory-files/src/index.ts:30,43-48,57-71`；`tool-memory/src/index.ts:22,44,111,116-127,144,186,192-221`
- D 技能：`evolution-core/src/skill-store.ts:26,48,119,143,165,221,268,284,292,305,356,382,410,431,448,487,495,513,524,580,605,624,648,696,763`；`tool-skill-manage/src/index.ts:82-123,125-150,160,184-207,210-217`
- D 复习：`evolution-review/src/index.ts:51,102,112-159,160-177,180-270,222,241,272-364,307,333-363,345-348,353-358,374-395,405-417,427-470`；`signals.ts:36-47,74-106`；`evolution-plan-validator/src/index.ts:60,61,75-141,136`；`redact.ts:9-31`
- D 策展：`core/curator.ts:35,59-102,123-156,163-178,199-226,233-279`；`evolution-curator/src/index.ts:47,73,82-90,92-159,173-209,217-260,280-314,338-485,361,368,378,410,411,417-422,455-462,470-477,493-507,512-546,553-646,585-589,620-644,662-692,708-747`
- D 遥测/审批/威胁/图谱/命令/IO：`usage.ts:11-25,84-102,121-148`；`skill-usage/src/index.ts:41-55,57-64,82-91,98-112`；`evolution-approval/src/index.ts:70,90,109-133,143-158,168-198,204-214`；`threats.ts:24-64,89-127`；`evolution-learning-graph/src/index.ts:36-78,126-190`；`evolution-commands/src/index.ts:14-105`；`io.ts:13-46,48-133`；`state-store.ts:12-14,16-90`；`mutations.ts`；`learn-prompt.ts:21-41`；`prompts.ts:18,21,31,59,68-98,100-110,112-117,125-169,171-201`；`constants.ts:26,35,51-67`；`evolution-policy/src/index.ts:105-161`；`memory-files/src/index.ts:43-48`
