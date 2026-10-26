# 技能自动合并：插件整合设计（整合定稿）

> 状态：设计基线，2026-10-20 讨论定稿；2026-10-21 将 `open-questions.md` 与 `open-questions-answers.md` 合并回本文。
> 2026-10-23 四条落地裁决（staging 时序、undo/--retry、审计粒度、数据布局）见 `merge-design-decisions.md`，冲突处以裁决记录为准。
>
> 本文是 skill 自动筛选 + 融合流水线并入 `dsh-evolution` 的唯一整合阅读入口。原 `integration-discussion.md` 的逐轮实时记录保留在
> `integration-discussion.2026-10-20.archive.md`，作为过程证据，不再作为阅读入口。
>
> 对象：`@lmzhen/dsh-evolution-all` / 平台 `0.2.1-rc.2`。用户需求原话取自 2026-10-20 03:08、06:02 的对话记录；其余结论来自
> `integration-discussion.2026-10-20.archive.md` §12–§14、`open-questions.md`、`open-questions-answers.md` 与后续平台配套讨论。

## 0. 用户原始需求（逐字）

### 0.1 首轮功能设想（2026-10-20 03:08）

> 我目前能想到的主要功能有这几个：1、建立一个反斜杠命令，调用命令后就会走全量的技能融合pipline，还可以建立另一个反斜杠命令，指定一对skill走二阶段融合agent步骤（也可以通过参数跳过第一轮判定agent，直接开始融合）。2、检查目前dsh平台是否存在稳定的定时运行功能，用户可以把这个技能整合pipline设置为间隔多长时间自动运行一次（默认是7天） 3、建立一个无需融合的技能对清单（需要判断在哪个环节被认定为无需融合的可以进入这个清单），然后后续走skill融合pipline之前直接就把清单里的skill给剔除了，这个清单可以和「技能健康」放在一起展示，用户可以查看技能对的正文，还可以查看之前被判定为无需融合的原因（需要模型总结为一句话），并且可以对清单的展示面进行排序（包括拖动和右键置顶/置底），有按钮可以点击后将skill对移出清单（需弹窗确认），也有按钮点击后可以直接复制到融合这两个skill的命令到粘贴板。4、原始的两个被融合的技能都会被归档，「技能历史」中只展示被融合后的技能，并且修改历史清零，从新开始记入修改历史，同时技能历史中留出另一个「历史技能」界面，保留被归档的全量技能的最后一版（只保留最后一版，不在保留任何改动记录），并写明归档原因（被融合、被删除、被拆分（待后续开发）等）。5、融合后的skill如果超出了平台的skill字数上限，则会直接回退为原始的技能对，并将技能对纳入无需融合的技能对清单，原因就直接写“融合后超出字数上限”。你认为需要澄清和明确的功能维度有哪些，我目前给出的想法覆盖了哪些维度，没有覆盖哪些维度。

### 0.2 第二轮澄清（2026-10-20 06:02）

> 现在的两阶段 agent 判决的草稿代码是怎么写的？也需要在前台/会话里执行吗？我指的不用走任何模型没说准确，其实是不走任何有自由度的对话，流程、上下文和提示词定死。审批的时机是二阶段智能体的一阶段之后二阶段之前，如果用户点击拒绝，智能体对会和被模型拒绝的一样进无需合并清单，这样就会省第二轮的token了。之后的二阶段合并是暂时不考虑做人工审批的（skill太长，人眼看不过来），但确实有一个如果最终超字数上限回退的步骤，而据我所知，现有的合并计划是不动原本模型的skill（只读），然后在临时草稿文件上修改的，因此无需做diff，只要在删除旧文件和把临时草稿移动过来之前做判断和回退即可。D5 限制的话，其他限制是和质量相关的，可以引导和规范模型按照符合要求的方式进行，前移到“写库前”校验 是合理的，但字符数上限可能会导致模型为了字数可达强行删减skill，最终导致skill质量差，我还是准备把这部分作为后审查来实现，这样就可以看到skill合并时不受任何干扰的情况下的自然长度是否达标。

### 0.3 从原话推出的硬约束

1. 流程、上下文、提示词固定；不存在“自由对话式”的合并 agent。
2. 第 1 轮判决、第 2 轮合成；审批只发生在两轮之间，第 2 轮不再人工审批。
3. 拒绝与模型 KEEP 走同一结果面：进入无需合并清单，省掉第 2 轮 token。
4. 源技能只读；在 staging 副本上写；提交前校验，不需要 diff，也不先写活树再回退。
5. 字数上限是**合成后、提交前**的后审；不把字数写进提示词，不用压缩指令逼模型删内容。
6. 其余质量/结构/安全限制前移到提示词引导 + 写库前校验。
7. 全量 scan 与指定 pair 都保留；自动运行只做设计保留，等平台上游能力。

## 1. 结论摘要

- 做一个家族模块，不新增第二个产品包；生产实现用 JS 放进插件目录，TS 草稿只作参考。
- 筛选 pipeline ①–⑤ 原样复用；⑤ judge 保留为候选闸门，L0/L1 KEEP 只进报告，L2 MERGE/UNDECIDED 进第 1 轮。
- 两阶段 child 选定；合成形态选 **B：child 在 staging 多步写/改，插件唯一提交**。A（只读 child + JSON）退出默认，保留参考。
- 默认审批关、默认串行、无步骤 plan、无自动运行；审批开时所有 merge 后台，第 1 轮结束写 pending，不弹窗。
- 结果面固定为四个队列：**待验证（UI 待判断）/ 待批准 / 待融合（UI 待合并）/ 无需合并**；不再使用 blocked 队列。
- run = 一次命令（scan / pair / approve 后的 agent2），不是一对；一对失败是 run 内记录。
- 目标命名、保护、写入、归档、历史、undo 全部走现有 SkillLibrary/curator 契约；不新增平行状态系统。
- UI 复用 `sidebar.panellist` + 同 id 的 `main` 面板、locale、生成式 host routes、平台 connection carrier 鉴权。

## 2. 12 个功能维度（最终表）

| 维度 | 定义 | 最终决定 |
| --- | --- | --- |
| D1 触发 | 手动/自动/事件；全量 vs 指定对 | 手动 `merge scan` 与 `merge pair <a> <b>`；自动运行设计保留、v1 不实现 |
| D2 候选与判决 | 哪些对进入/退出；在哪个环节判定 | 原 pipeline ①–⑤；L2 MERGE/UNDECIDED 进第 1 轮，L0/L1 KEEP 只进报告；agent KEEP 进无需合并 |
| D3 授权 | 谁批准、批准什么、默认开还是关 | `mergeApproval` 默认关，独立于平台写入审批；审批只卡两轮之间；所有运行后台、不弹窗 |
| D4 执行 | 目标命名、mode、支撑文件、原子性、并发 | B staging；插件唯一 `commitMerge`；默认串行；逐对重新 resolve；提交前校验；原子换入后归档 |
| D5 限制 | 平台限制集合与处置 | 规则门复用 SkillLibrary 写入校验 + merge 的 manifest/路径/引用成对；不做 LLM judge；字数后审 |
| D6 生命周期 | 归档、历史、恢复、撤销、多代合并 | 归档/恢复/历史复用既有能力；undo 委托 merge unit/receipt；多代按 run 反序 |
| D7 数据与失效 | 清单/历史的键、存储、失效与重审 | 对级键=两源名排序拼接，不做内容 hash；run 内 undo 才存 hash；删除/改名清记录 |
| D8 观测与操作 | 运行状态、进度、通知、清单 UI | 侧栏面板四个 tab（待判断 / 待批准 / 待合并 / 无需合并）+ 本次运行区；读 run registry；focus 刷新；只存展示排序 |
| D9 调度保障 | 执行宿主、错过补偿、并发、暂停 | v1 只手动/后台；持久 lastRunAt、启动补偿、SchedulerPort 仅保留设计 |
| D10 既有插件关系 | curator/技能健康/设置卡/包归属 | 模块进插件目录；curator 自动 consolidate 保留但 merge 是唯一人类合成入口；命令归 `/evolution` |
| D11 安全与保护 | pin/bundled/hub、跨 provider、注入 | 提交前 writeProtection；target 控制面校验；禁控制键；快照/原子/威胁扫描 |
| D12 默认与口径 | 默认值、scope、自动合并还是只产 plan | B 默认、审批关、无自动、无步骤 plan、默认串行、scope 只 family-managed |

## 3. 统一功能模型

### 3.1 入口与运行模型

两个入口：

```text
/evolution merge scan
/evolution merge pair <skill-a> <skill-b>
```

- `scan` 处理上游固定候选集的全部对，没有 per-run 对数上限；`mergeRunTimeoutMinutes` 只是时间预算，到时停并记录剩余，不是 pair cap。
- `pair` 绕过扫描，直接对指定两技能执行；可参数跳过第 1 轮判决，用于复跑/指定合成。显式 pair 也只处理 family-managed，不因手动指定而绕过范围。
- 所有 merge 都是后台 Job，命令立即回 run id；结果写 `reports/merge-<runId>.{json,md}`，进 `runs.json` 与长跑表。
- run 是一次命令；`status/report/cancel/runs` 都作用于 run。一对失败只是 run 内一条记录，不新开 run。
- 前台不阻塞，不依赖 live parent 请求；审批开时第 1 轮结束即停，批准后另起 agent2 run。

### 3.2 候选与判决

沿用原 pipeline：

1. ①–④ 确定性筛选（prefilter / LSH / 词面 / 向量）
2. ⑤ judge L0→L1→L2
3. L0/L1 KEEP 只进报告，不进第 1 轮
4. L2 MERGE/UNDECIDED 进第 1 轮 child
5. 第 1 轮输出 KEEP → 无需合并；MERGE → 待批准（审批开）或直接进入第 2 轮（审批关）
6. 第 2 轮失败/取消 → 待融合，保留已批准 decision，重试只跑 agent2
7. ⑤ judge 的 fallback 分支同样只让 L2 MERGE/UNDECIDED 进第 1 轮；L0/L1 KEEP 只进报告，不能因为走 fallback 就全部送 round1

失败回退：

- agent1 前失败 → 待验证
- agent1 完成、等人批 → 待批准
- 审批通过/审批关后 agent2 失败 → 待融合
- agent KEEP + 人工拒绝 → 无需合并（origin:human）

不再有 blocked 队列；下轮筛选过滤上述结果队列。重叠 pair（ab、bc）不自动合成 abc；后一对在 agent2 前重新 resolve，源已归档则记 source-gone 并继续。

### 3.3 授权与审批

两套审批是独立域：

| 域 | 管什么 | 默认 | 位置 |
| --- | --- | --- | --- |
| 平台写入审批 | skill 使用中的生成/修改（`skill_manage` 等模型工具写） | 按平台设置 | 设置页“写入审批” |
| 合并审批 `mergeApproval` | merge 两轮工作流是否继续第 2 轮 | 关 | 设置卡“技能自动合并” |

审批开的路径：

1. 所有 merge 后台运行；agent1 完成写 pending，停下。审批摘要是固定三句：【skill1 摘要】【skill2 摘要】【融合原因】；pending 存技能名 + 三句话 + decision，不存正文。
2. 不弹窗、不产生 staging；pending 只有名字、decision、target/sources、摘要、状态。
3. 用户从面板/命令复制 `/evolution merge approve <id>`，或执行 reject。
4. approve 后另起 agent2 run，串行执行；agent2 失败回待融合。
5. reject 与模型 KEEP 同路径进无需合并，记录 `origin:human`。
6. pending 无 TTL；读时收敛 source-gone/target-taken；approve 前重新 resolve + 重新校验目标。
7. 平台写入审批开启不拦 `commitMerge`；两域互不替代。
8. pending/skipped 中的对在下一轮筛选前剔除；其中任一技能被融合/删除/改名，记录同步清掉。
9. 早期用户倾向“无自动运行时直接弹窗”，后因 305 s 墙与后台 run 定稿改为统一 pending、不弹窗；弹窗形态不再作为默认。

### 3.4 执行：B 形态与 staging

```text
resolve → decide（child 只读源，不建 staging）
→ approve?（可选，仅两轮之间）
→ stage（复制两源到 staging）
→ author（同一 child 在 merged/<target>/ 逐文件写/改）
→ validate（插件）
→ commit（插件唯一提交）
```

- B 为默认：author 阶段的 child 用工具多步写/改 staging，避免一次性大 JSON 输出；staging 可续。
- A 只读 child + JSON 退出默认，保留参考；压缩作为独立后处理立项，不写进 B 的合成提示词。
- 源只读；活树只在 commit 时由插件写；不先写活树再回退。
- 同一 child 尽量跑两轮；后批/审批后另起 run 时用存下的 decision 重建，接受 cache 损失。保留两轮而非两次单轮，依据是实测同 child 两轮成本略低、质量更好。
- 默认串行完整两轮；v1 不并行、不自动聚类 abc。曾讨论“先并行 agent1，再并行 agent2”和 ab+bc→abc 聚类，因审批串行更清晰、后一对必须看到前一对归档后的树，v1 不采用。
- 每对执行前重新 resolve，源被归档/改名则记 source-gone，继续下一对。
- **staging 时序（2026-10-23 裁决）**：decide 只读源，不建 staging；pending 不产生 staging；approve 后重新 resolve 活树，再从活树复制两源到 staging。这样 pending 不存正文，源在 pending 期间变化不会被旧草稿掩盖。
- staging 位置：`<evolutionHome>/merge/runs/<runId>/`；run 记录持 `stagingRef`；失败/取消保留 7 天，读时收敛，不自动续跑。

### 3.5 限制与校验

规则门只做确定性校验：

1. 复用 `SkillLibrary.create/update/writeSupportFile` 的 frontmatter/limits/protection/threat 校验。
2. merge 只加四条：
   - manifest 文件路径必须在 `references/templates/scripts/assets` 下且为相对路径
   - manifest 每个文件必须真实存在
   - 每个 manifest 文件必须被正文或支撑文件引用
   - 正文每条支撑文件引用必须有对应文件
3. 不做 LLM 内容 judge，不另造一套 admission。
4. 60 字描述只是建议，不是硬门；TODO 不作硬门。
5. 字数上限在合成后、提交前审；不写进提示词；不达标整对失败/进清单，不做“先写再回退”。
6. 记录每次合成的自然长度分布，回退率过高再讨论软提示；不预设压缩。

### 3.6 生命周期、归档、历史、undo

- 归档：`archive({reason, absorbedInto})` → `.archive-reason`；源归档只在目标提交成功后。
- 历史：复用 content versions（保留 20 版）；不新建历史系统。
- 历史技能：只保留被归档技能的最后一版 + 归档原因；不保留改动链。
- 合并后目标“历史清零”：写一条合并基线 v1（注明来自 A+B），不删除旧数据；细节以 SkillLibrary/历史面板实现为准。
- undo：用户面 `/evolution merge undo <target> --run <id>`；`--run` 必填，省略不猜最新，避免多代误撤；一次 merge 写一个 merge unit（target + sources[] + runId）；底层委托 unit undo/receipt；目标被后续修改则拒绝；新建目标撤销时归档不硬删；整树 restore 后旧 run 标 superseded。
- 多代：按 run 反序；run 记录目标 before/after hash 作为 undo 锚点；对级判重键不做 hash。

### 3.7 数据、键与失效

| 数据 | 位置 | 键/失效 |
| --- | --- | --- |
| pending / skipped | `evolution/merge-state.json`（单文件，v1 显式例外） | rows 按 queue 投影；pending 无 TTL；skipped 收 agent KEEP（含 L2 KEEP），TTL 到期标 expired 不删；读时收敛；approve 前重校验 |
| runs | `evolution/merge/runs.json` / run 目录 | run=命令；stagingRef；cancelled/interrupted 读时收敛 |
| pair 键 | 两源技能名排序拼接 | 不做内容 hash；改名/删除清记录 |
| undo 锚 | run 记录 | 目标 body before/after hash；只用于 undo，不用于判重 |

> **数据布局裁决（2026-10-23）**：v1 保留单 `evolution/merge-state.json`，不拆 pending/skipped 两文件。这是对 §3.7 原三文件设计的显式例外：单文件换取一次原子写；代价是损坏半径覆盖全部队列，必须配损坏 note、备份/恢复与迁移策略。runs 仍走 run registry（`evolution/merge/runs.json` / run 目录）。

`mergeSkippedTtlDays` 默认 0 = 不过期；过期后恢复参与筛选；`merge pair` 无视 skipped。

### 3.8 观测与 UI

- 侧栏面板：四个 tab（待判断 / 待批准 / 待合并 / 无需合并）+ 本次运行区。四个队列全部可见：待判断放上游候选/第 1 轮未完成；待批准放等人批；待合并放已批准、agent2 尚未成功/待重试；无需合并放 agent KEEP + 人工拒绝。
- 面板 v1 只 all 形态；preset 命令可用但不承诺面板；host-only 命令可见但执行 E-323。
- 运行状态读 run registry；只做 focus 刷新，不轮询；排序只存展示序，不影响执行。
- 只读 host routes 依赖平台 connection carrier 鉴权，不自建 family fence。
- 设置卡“技能自动合并”，与“写入审批”分栏；字段 `mergeApproval`、`mergeSkippedTtlDays`、`mergeRunTimeoutMinutes`。
- 面板必须区分“读取中 / 空 / 读取失败”三态；服务缺失走 E-325 fallback，不把失败画成空列表。
- doctor 增加 merge 段：各队列计数、最近 run、staging 健康状况；不能只给笼统 runs 计数。

### 3.9 调度（设计保留，不实现）

v1 不做自动运行。保留：

- 持久化 `lastRunAt` + 启动宽限 catch-up
- `SchedulerPort`
- 失败清理/并发/暂停/重试
- 未来形态：agent1 停下写 pending，用户批准后跑 agent2

恢复条件：平台提供无会话定时回调，或可编程会话唤醒 + 冷恢复。当前平台 schedule 只投会话消息，不满足。

### 3.10 与既有插件的关系

- 功能模块移入插件目录，作为插件一部分（JS）；不再维护独立生产包。
- 命令统一挂 `/evolution`，只保留一个注册者；命令/registry/UI/bundle 随插件。
- `/evolution consolidate` 退出用户面；curator 自动 consolidate 保留（归档收尾，不是单纯 fusion）。
- curator 仍管 stale/archive/usage；merge 是唯一人类合成入口，不被 curator 自动调用。curator 已有 168 h 定时整理与空闲门，不与 `mergeSkippedTtlDays` 共用参数；两者只是默认值恰好都是 7 天的量级。
- merge 运行与 curator 写操作串行（instance claim/同一写锁口径）。
- 进 all/preset；host-only 明确 E-code；不静默降级。

### 3.11 安全与保护

- 提交前 `writeProtection`：pinned/bundled/hub/protected built-in（如 plan）拒绝；referenced/excluded/suppressed 也遵守 curator 同一把保护尺，不提供“手动绕过保护”开关。
- target 由控制面校验，不接受模型自由控制；模型只能提内容/候选目标。
- 禁 `FORBIDDEN_CONTROL_KEYS`；源正文按不可信输入做威胁扫描。
- 快照 + 原子换入；v1 采用「一个 merge unit + 底层 per-skill mutations（1+N）」，不新增 merge 级事件流。merge unit 记录 target + sources[] + runId，供审计/历史/undo 聚合；不逐文件写活树。
- 保护尺是权限/策略门禁，不是写锁；curator instance claim 才是写锁。

### 3.12 默认与参数

| 参数 | 档位 | 默认 | 说明 |
| --- | --- | --- | --- |
| `mergeApproval` | E3 | false | 独立于平台写入审批 |
| `mergeSkippedTtlDays` | E3 | 0 | 0=不过期；到期标 expired |
| `mergeRunTimeoutMinutes` | E3 | 0 | 0=无上限；时间预算非 pair cap |
| 候选阈值 | E2/internal | 原 pipeline 值 | 不改筛选 pipeline 语义 |

无自动运行；无步骤 plan（候选清单/摘要/报告允许）；默认串行；scope 只 family-managed；用户旋钮 E3。

## 4. 命令、状态与转移

### 4.1 命令

```text
/evolution merge scan
/evolution merge pair <a> <b>
/evolution merge status [<id>]
/evolution merge report [<id>]
/evolution merge cancel [<id>]
/evolution merge runs
/evolution merge pending
/evolution merge approve <id>
/evolution merge reject <id>
/evolution merge skipped
/evolution merge skipped --restore <id>
/evolution merge candidates
/evolution merge candidates --retry <id>
/evolution merge resume
/evolution merge resume --retry <id>
/evolution merge undo <target> --run <id>
```

- 两段命令 + flags，不用 `merge blocked run/clear` 三段。
- 四个运行命令的语义：`status` 看当前/最近 run 的 stage、第几对、停止原因；`report` 读完整 per-pair 结果；`cancel` 停正在跑的 run、标 cancelled、保留现场；`runs` 列最近 run 找 id。
- 跑完不主动推送；用户通过 status/report 查询。裸 `merge` 给一族帮助。
- `--run`、`--restore` 进 parser 取值参数表；`--retry` 是布尔开关，不进取值参数表；帮助/README 自动生成。
- 清单名：`candidates` = 待验证（UI 待判断）；`resume` = 已批准、待第 2 轮/待重试（UI 待合并）；`pending` = 待批准。
- 重试不重新审批：`resume --retry` 只重跑 agent2；`candidates --retry` 重跑第 1 轮；`merge pair` 仍可强制重跑整对。

### 4.2 四队列状态机

```text
上游候选
  ├─ L0/L1 KEEP ──────────────→ 报告
  ├─ L2 MERGE/UNDECIDED
  │     ├─ agent1 失败 ───────→ 待验证
  │     ├─ agent1 KEEP ───────→ 无需合并
  │     ├─ 待批准（审批开）───→ approve → agent2
  │     ├─ agent2 失败 ───────→ 待融合
  │     └─ commit 成功 ───────→ 完成
  └─ agent KEEP/人工拒绝 ─────→ 无需合并
```

- 待验证/待融合是“上一阶段失败”的暂存面，不是新清单系统。UI 名：待验证=“待判断”，待融合=“待合并”。
- 无需合并是决策事实源；筛选 ledger 只是候选缓存，不互相替代。
- pending 无 TTL；staging 只在 agent2 后产生，保留 7 天。

## 5. Q01–Q19 决策台账

| ID | 主题 | 最终结论 |
| --- | --- | --- |
| Q01 | scan 对数/顺序/停止 | 处理固定候选集全部对，无 per-run 对数上限；默认串行、按候选分数降序；时间预算可选；hard failure 记录并继续/按预算停，不静默丢 |
| Q02 | ⑤ judge 是否作闸门 | 保留；L0/L1 KEEP 只进报告，L2 MERGE/UNDECIDED 进第 1 轮；“不做 LLM judge”只指合成后内容质量门 |
| Q03 | 扫描中源被归档/usage | 每对执行前重新 resolve；源消失记 source-gone 并继续；usage 折叠复用 curator 口径 |
| Q04 | 前后台/结果落点 | 后台 Job + run id；报告 `reports/merge-<runId>.{json,md}`；长跑表补 merge 行 |
| Q05 | 取消/断线/重启/staging | staging 放 `merge/runs/<runId>/`；7 天保留；run 读时收敛；不自动续跑 |
| Q06 | 审批等待/超时/写 pending | 最新口径：scan 与 pair 都后台，agent1 完成直接写 pending，不弹窗；旧“pair 前台即时问 120s”被覆盖，仅保留兼容参数 |
| Q07 | target 命名冲突 | 最新口径：target 已存在→`<target>-v2`，再冲突 `-v3` 递增；旧 target 不动；超 64 字符/后缀耗尽整对失败 |
| Q08 | 目标已存在写入语义 | 正文整体覆盖；支撑文件按路径写；同名不同内容拒绝并列名；目标原有未列入 manifest 的文件保留 |
| Q09 | manifest/路径/引用校验 | 四条硬规则：白名单相对路径、文件存在、每个文件被引用、每条正文引用有目标；任一失败整对失败 |
| Q10 | 提交顺序/部分失败 | 先建/更新目标，再归档源；失败回滚目标与已归档源；不留 partial success |
| Q11 | 写库身份/保护 | 审计 origin=foreground；commitMerge 显式写 `.hermes-managed`、显式拒 pinned/bundled/hub，不靠 origin 推断 |
| Q12 | undo 判定/粒度/多代 | run 存目标 before/after hash + 源列表 + 快照；live hash==after 才 undo；多代按 run 反序；新目标撤销归档不硬删 |
| Q13 | skipped 收录/TTL | 收 agent KEEP（含 L2 KEEP）+ 人工拒绝（origin:human）；执行失败只进报告；pair 无视清单；TTL 到期标 expired 不删 |
| Q14 | pending 失效/批准重校验 | pending 无 TTL；读时收敛 source-gone/target-taken；approve 前重新 resolve + 重新校验目标 |
| Q15 | 并发/幂等 | pair 键=两源名排序拼接；target 级串行 + 提交 CAS；跨平面用 run-registry foreign 行 |
| Q16 | 成功验收/失败呈现 | 四判据：decision shouldMerge 且 mode≠keep、staging 校验无 issue、commit 与 manifest/源列表一致、目标可列且源归档带 absorbed_into；失败三行 stage/code/next + run id；无 partial success |
| Q17 | 范围/保护/E-code | 复用 E-323/E-324/E-305/E-306；errors.ts 增加 target-out-of-scope/protected/invalid 场景 key，不新造数字码 |
| Q18 | 面板/运行可见性 | 新面板 id，四 tab（待判断/待批准/待合并/无需合并）+ 本次运行区；读 run registry；focus 刷新；平台 connection carrier 鉴权，不自建 fence |
| Q19 | blocked 队列 | 已取消；四队列取代；下轮筛选过滤待验证/待融合/待批准/无需合并 |

### 5.1 已裁决矛盾（以时间靠后为准）

| 议题 | 早期口径 | 最终口径 | 收口依据 |
| --- | --- | --- | --- |
| scan 对数 | Q01 旧答：默认最多 3 对 | 处理候选集全部对，无 per-run 对数上限；时间预算可选 | integration §14 |
| pair 审批形态 | Q06 旧答：pair 前台可问，120 s 超时 | 所有 merge 后台；agent1 完成写 pending，不弹窗 | integration §14 / PQ-03 |
| create-umbrella 冲突 | Q07 旧答：managed 已存在转 merge-into-existing | 自动后缀 `-v2`/`-v3`，旧 target 不动 | 用户 13:38 / §14 |
| 结果队列 | 用户 13:38 曾要保留 blocked 三段命令 | 四队列（待验证/待批准/待融合/无需合并），不再有 blocked；两段命令 + flags | integration §14 |
| 自动运行 | 首轮提案要默认 7 天定时 | v1 不实现，只留 SchedulerPort/lastRunAt 设计 | 用户 06:08 / §0.3 |
| curator 自动 consolidate | 曾在平台审查初稿被判“停用” | 保留（归档收尾），只是用户面 `/evolution consolidate` 退出 | 用户 13:38 / platform 晚补充 |
| 审批超时参数 | Q06 旧答：`mergeApprovalTimeoutSeconds=120` | 不需要；无前台审批，统一 pending | platform PQ-08 |
| plan 边界 | 用户 08:59：“合并就完了，没必要出 plan” | 不出带操作步骤的 plan；候选清单/摘要/报告/pending 行允许 | 用户 13:38 |

- **A/B 选型**：A 在 2 对样本略优，但 B 操作面更好，最终 B 默认；样本只有 2 对可评分，结论有统计限制。
- **Q07 后缀命名**来自用户 2026-10-20 13:38 的原话：“希望自动改名，加后缀做成-v2（类似数字），然后等待以后处理”；与 §14 一致。
- **blocked**：用户 13:38 曾要求保留 `merge blocked run` 三段读法；§14 后续取消 blocked、改为四队列与两段命令，本文以 §14 为准。

### 5.2 平台配套审查补遗（2026-10-20 晚）

来源：`platform-fitness-review.md`（14 条缺口）、`platform-open-questions.md`（PQ-01–PQ-14）、`platform-open-questions-answers.md`（含文末覆盖）。

- **写面/恢复面可复用**：SkillLibrary 的 create/update/archive/snapshot/applyTreeChange、内容版本、unit undo 是底座；merge 需要的是多技能事务单元，不是另造状态机。
- **运行面必须补齐**：status/report/cancel/runs 四命令、RunKind 多 kind、run 记录 stage/stagingRef/progress、报告进 sweepReports 桶、长跑表补 merge 行；否则小时级后台任务不可观察、不可停止。
- **审批面**：平台写入审批与 mergeApproval 两个独立开关（PQ-02 C）；不新增“合并审批超时”参数；UI 分栏写明“写入审批=使用中生成/修改；合并审批=两轮工作流”。
- **恢复面**：merge undo 保留，但一次 merge 写一个 merge unit（target+sources+runId），委托 unit undo；历史面板标“合并”来源；整树 restore 后旧 run superseded。
- **审计最小面**：v1 只写 run 记录、merge 报告、既有 per-skill mutations；不新增 events/activity/replay 类型，不假装有事件流。
- **三条合并路径收口**：`/evolution consolidate` 退出用户面；curator 自动 consolidate 保留为“归档收尾”；merge 是唯一人类合成入口。help/README/doctor/空态必须写清“机械追加 vs 两轮合成”，避免用户点错。
- **保护尺**：pinned/bundled/hub/protected built-in + referenced/excluded/suppressed；与 curator 同一把尺、同一 instance claim；保护是权限门禁，不是写锁。
- **安装/发现性**：命令进 all/preset；面板 v1 只 all，preset 用命令 fallback；host-only 明确 E-323 并指 doctor；不出现“能点但静默失败”。
- **UI 三态**：读取中/空/失败必须分开；服务缺失走 E-325 fallback；空态不能覆盖失败。
- **已收口**：四个队列全部展示为四个 tab（待判断/待批准/待合并/无需合并）；命令 `candidates`（待判断）与 `resume`（待合并）。

### 5.3 执行架构与平台实测补遗

- `merge-execution-conclusion.md`：2026-10-18 的 A/B 是“两个独立会话 vs 同一会话两轮”，不是写形态 A/B；定版结论是默认单会话两轮（成本略低、质量略高）。
- `dsh-integration-debug.md`：实测 `ctx.llm` 直调、⑤ judgeCascade 接 DSH、同会话两轮 child；真实 pair 前台 240 s 未返回，桌面壳约 305 s 结束请求 ⇒ 生产执行必须后台 Job，不能把两轮+人工等待绑在请求上。
- `two-round-skill-merge-module-design.md`：模块边界、对外契约、两轮时序、提交/门禁、错误/并发/恢复、安全与不做清单；本文的模块级细节以它为依据，未重复全文。
- B 形态实测用 3 对真实 skill（p1/p2/p3）：p2 正确 KEEP，p1/p3 可评分；A/B 写形态只有 2 个可评分 pair、一组裁判，统计力弱，结论只作方向。
- `implementation-team/` 五份（架构/后端/产品/前端/算法）：把 12 维落成角色设计；属于实现层展开，不是用户需求原话。

## 6. 仍未决/后续

1. 自动运行：等平台无会话回调或可编程会话唤醒；v1 不实现。
2. 拆分：只占归档原因位，待后续开发。
3. 独立压缩：另立项，不写进 B 合成提示词。
4. A/B：仅 2 对可评分、一组裁判；扩到 4–6 对再评估是否调整形态。
5. 与 curator 的串行实现细节：instance claim 的接缝和失败清理需在实现层确认。
6. 多代合并/整树 restore 后的 superseded 展示口径。

## 7. 证据与来源

### 7.1 文档

- `integration-discussion.2026-10-20.archive.md`：原始逐轮记录（§1 提案、§2 12 维、§3 轮次、§4 pending、§5 A/B、§7 限制、§8 评测、§12–§14 定稿）。
- `open-questions.md`：18 题 + 16 条已定口径 + 逐题证据。
- `open-questions-answers.md`：Q01–Q19 结论与关键说明。
- `00-platform-pin.md`：平台/版本 pin 与实测探针结果。
- `two-round-skill-merge-module-design.md`：模块契约、时序、复用、提交/恢复/安全。
- `plugin-feature-map.md`：整合前命令/工具/UI/后台回路盘点。
- `dsh-integration-debug.md`：ctx.llm / judgeCascade / 同 child 两轮实测与平台约束（240 s、305 s、后台 Job）。
- `merge-execution-conclusion.md`：单会话两轮 vs 独立会话的执行架构结论。
- `platform-fitness-review.md`：平台配套完整度/自洽度审查，14 条缺口（P0 4 / P1 7 / P2 3）。
- `platform-open-questions.md` + `platform-open-questions-answers.md`：PQ-01–PQ-14 及文末覆盖（审批双开关、run 边界、四队列、安装/保护/审计）。
- `implementation-team/01-architecture.md` 等五份：按角色展开的实现层设计，不是本文的裁决来源。
- `eval/quality-rubric.md`、`eval/README.md`、`eval/*-scores.json`：A/B 与合并质量证据；rubric 是 D1–D6 + H1–H3，不是本文的设计条目。
- 后续实现计划（`detailed-design.md`、`implementation-plan.md`、`grouped-implementation-plan.md`、`merge-engine-reintegration-plan.md`、`merge-engine-grouped-implementation-plan.md`）属于实现/重接阶段材料，不作为本设计基线，也不并入本文。

### 7.2 用户原话

- 2026-10-20 03:08：首轮 5 条功能设想（本文 §0.1）。
- 2026-10-20 06:02：固定流程、审批时机、超限后审、只读+staging（本文 §0.2）。
- 2026-10-20 13:38：Q07 自动后缀命名、blocked 三段读法、curator 自动 consolidate 保留等逐条裁定（本文 §5.1）。

### 7.3 实现证据（设计不是实现证明）

本文只定义设计口径，不证明当前代码已实现。实现状态另见代码与门禁；涉及具体函数/路由/测试时以当前工作区代码为准。

## 8. 变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-10-20 | 首轮提案 → 12 维盘点；七轮讨论；B 形态定案；§13 待定项定稿；§14 最新口径覆盖前文 |
| 2026-10-21 | 将 `open-questions.md` / `open-questions-answers.md` 合并回本文；形成统一设计基线；原 discussion 存档 |
