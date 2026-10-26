# 技能自动合并：正式需求文档 v2

> 2026-10-26：本文的“当前状态”列是 0.30.15 时期快照，不能作为当前状态；当前代码基线是 **0.30.26（含本地优化分支）**，权威状态以 dsh-evolution 的 `packages/REQUIREMENTS.md` 为准。本文只保留需求文本与历史状态。
>
> 文档状态：实施校准版需求基线，2026-10-23。
> 本文件以 v1 的 126 条 FR + 8 条 NFR 为规范底稿，不重复未变更条目；未列出的 ID 继续按 v1 验收。v2.1（2026-10-23）按 Lead §10（ADR-3/4 终裁）另加 NFR-09/10 与 §10 增补，不重开 v2 已决条目。
> 2026-10-25：A1–A17 文档矛盾已裁决并回写，见 requirements-adjudication-2026-10-25.md。
> 需求来源：
> - U1–U7：2026-10-20 用户原话与后续裁定
> - D：integration-discussion.md 的 D1–D12、§3–§6、Q01–Q19
> - A：../reviews/61-landing-gap-audit.md（v2 合并审计）
> - M：../reviews/62-integration-coverage-matrix.md（全条款覆盖矩阵）
> - C：代码现状 D:\dsh\dsh-evolution-mirror @ feat/0.2.1-migration HEAD 5c3d5f86（0.30.15）
> - DEC：merge-design-decisions.md（4 条设计裁决）
> 判定口径：
> - v1 的 FR 文本仍是规范；v2 只新增/覆盖本文列出的条目。
> - 状态是“当前代码是否满足”，不是需求降级；标为 gap 的条目仍是必须满足的验收项。
> - 实现侧可自由选择契约/字段/存储/代码结构，但不得改变用户可见行为。

## 0. 范围、术语与非目标

### 0.1 范围

- skill 自动筛选 + 两轮融合流水线并入 dsh-evolution 插件。
- 覆盖：筛选 ①–⑤、两轮 agent、四队列、归档/历史/undo、校验、命令/面板/设置卡、run/report。
- 不覆盖：拆分、独立压缩、自动运行（v1 设计保留）、并行/abc 聚类。

### 0.2 术语

| 术语 | 含义 |
| --- | --- |
| 候选对 | 上游筛选产生的两个技能 |
| 第 1 轮 | agent1 只输出 KEEP/MERGE，产出 decision |
| 第 2 轮 | agent2 在 staging 写合并后的技能树 |
| pending | 待批准：名字、三句摘要、decision、target/sources、revision、状态；不存正文 |
| staging | agent2 的临时草稿目录，不是活技能树 |
| 待判断 | 上游候选/第 1 轮未完成（未开始、失败、取消） |
| 待合并 | 已批准、agent2 未成功或待重试 |
| 无需合并 | agent KEEP、人工拒绝、超限 system |
| run | 一次命令；不是一对 |
| merge unit | 一次 merge 的 target+sources+runId 事务锚 |

### 0.3 非目标

- v1 不实现自动运行；只保留 SchedulerPort/lastRunAt 设计。
- 不做并行 agent1/agent2、abc 聚类、LLM 内容质量 judge。
- 不新增第二套 history/audit/state；不新增 merge 级事件流。
- 不做 dry-run/预执行清单/diff；不提供 merge 模型工具入口。
- A 只读 JSON 形态仅参考；不做 headless 生产执行器。
- curator 自动 consolidate 保留；/evolution consolidate 退出用户面。

## 1. v2/v2.1 规范变更（DEC）

以下 v2/v2.1 DEC 覆盖 v1 中与本文冲突的表述；未列出的 v1 FR 不变。

| ID | 覆盖 | v2 规范 | 当前状态 |
| --- | --- | --- | --- |
| V2-EXEC-01 | FR-EXEC-06/15、FR-LIFE-13、D §3.4 | staging 在 decide 之后：agent1 只读源，不建 staging；pending 不产生 staging；approve 后重新 resolve 活树，再复制两源到 staging | 代码仍按 decide 前建 staging；gap |
| V2-LIFE-01 | FR-LIFE-06、FR-SCOPE-10 | undo 的 --run 必填，省略不猜最新；--retry 是布尔 flag，不进取值参数表 | parser 已偏必填，help/文档与 --retry 形状待收口；部分 |
| V2-DATA-01 | FR-DATA-06、D §3.11/§5.2 | 一个 merge unit + 底层 per-skill mutations（1+N）；merge unit 记 target+sources+runId；不新增 merge 级事件流 | 代码 1+N，但 runId 未稳定写入 unit/history；部分 |
| V2-DATA-02 | FR-DATA-02/03/08、D §3.7 | pending/skipped 用单 evolution/merge-state.json，作为三文件设计的显式例外；runs 仍走 run registry；必须配损坏/备份/迁移保障 | 代码单文件；损坏/备份/迁移保障未验收；部分 |
| V2-WIRE-01 | FR-UI-01/03/05、FR-RUN-05、FR-APP-04 | 查询面拆 7 个版本化信封：Facts、QueuePage、RunView+RunDetail、RunsView、BodyView、HistoryView、DoctorView；wireVersion=1，全部携带；status/runs 用 RunView，doctor 独立、面板不请求 | 未实现：仅 MergeView 有 schemaVersion=2，QueuePage/RunDetail 无版本；0.30.15 |
| V2-WIRE-02 | FR-SCOPE-05/10、FR-APP-04、FR-UI-07 | ActionRef[]{id,command,confirm,enabled,disabledReason}；CommandSpec 只放 JSON-safe schema/actions/fallback，handler map 另层，CommandSurface 版本化；/merge 别名 0.31 弃用提示、0.32 删除 | 未实现：actions 为 string[]、无 confirm/enabled；parser/help/actions 三处；/merge 自注册 |
| V2-UI-01 | FR-UI-01、FR-LIFE-14/15 | 四队列 + counts.active/expired 分离；expired 只读可见、不计数；pending-expired 有 pair/discard 出口；skipped-ttl 标 expired 不删 | 部分：expired 计入 active；0.30.15 |
| V2-UI-02 | FR-APP-03、FR-UI-04/05 | summary 仅在 pending，三槽 a/b/rationale 可空；host 不出中文占位；缺失由 client locale 显示“无摘要” | 未实现：routes 对所有行给中文占位 |
| V2-QUERY-01 | FR-UI-03/06、FR-PLUG-05 | MergeFacts 纯读、Reconcile 唯一写、共用同一派生；GET 零写；读时收敛只派生不落盘 | 未实现：routes/read-commands 各自投影；收敛只在 approve |
| V2-UI-03 | FR-UI-06/08/09/10/12、FR-PLUG-05 | host 只给事实/code，client 管 locale/三态/actions；doctor/body/history 独立；body/history 读面保留 | 部分：裸 key/三态/approval 过滤等见 GAP-UI-01..07 |
| V2-TXN-01 | FR-LIFE-01/02/10、FR-SEC-04 | core 持唯一不透明 UnitTransaction；unitId 调用方提供；evidence 持久；rollback 由 evidence 授权；恢复四分支；已提交绝不回滚；run registry 只记账 | 部分：见 GAP-P0-03 与 §10.1 |

## 2. 需求总览（v1 126 FR + 8 NFR + v2.1 NFR-09/10）

| 组 | v1 条数 | v2 状态 | 主要缺口 |
| --- | ---: | --- | --- |
| 范围与入口 | 10 | 部分 | target managed/保护链；resume 语义；命令别名 |
| 运行与报告 | 11 | 部分 | approve/resume 未后台；status 行级；reportOnly 丢失 |
| 候选与判决 | 8 | 部分 | judge fallback；reportOnly；非 managed 对写 skipped |
| 两轮执行 | 17 | 部分 | staging 时序；源快照/commit live 不一致；pending staging 孤儿 |
| 校验与限制 | 8 | 部分 | Q08 同名覆盖；Q09 反向引用；超限未 skipped；双尺 |
| 提交与生命周期 | 15 | 部分 | journal/恢复；pinned 竞态；历史基线；undo/多代 |
| 数据与审计 | 9 | 部分 | 单文件例外保障；runId/1+N 聚合；skipped TTL/reason |
| 审批 | 10 | 部分 | approve 未后台；读时收敛；按钮/开关 |
| UI 与观测 | 13 | 部分 | 三态；locale；focus；E-325；tab 残留；summary 占位；wire/7 信封/ActionRef 未冻结（§10） |
| 调度/插件关系 | 12 | 部分 | 无 scheduler 是 non-goal；tree-lock；/merge 别名；唯一包 |
| 安全与保护 | 8 | 部分 | target managed；pinned 竞态；protected builtin；Q15/Q16 |
| 默认与参数 | 5 | 已实现 | mergeApproval 默认 false、TTL 0、timeout 0 已对齐 |

说明：状态是组级；具体条目以 §3–§4 的 gap 表为准。未列出的 FR 仍按 v1 验收。v2.1 新增的契约/命令/查询/UI 条目见 §10（目标版本见 §10.5/§10.7），本表不替代该节。

## 3. P0 阻断需求（必须清零）

| ID | 需求（对应 v1） | 当前状态 | 验收 |
| --- | --- | --- | --- |
| GAP-P0-01 | approve/resume 必须后台，命令立即返回 run id（FR-RUN-02/FR-APP-07） | 未实现：两者未传 detached，round2 压在请求上 | approve/resume 1 秒内返回 accepted/runId；断客户端后 run 仍完成；status/report 可查 |
| GAP-P0-02 | 提交期保护/范围链：target 必须 family-managed；pinned 在 marker-after-snapshot 后仍拒（FR-SCOPE-01/02、FR-LIFE-04） | 部分：target managed 未校；pinned 仅 background_review 拒 | 构造 target 非 managed、决策后 pin 两类；approve 后整对 failed、零写入、源不归档 |
| GAP-P0-03 | 崩溃恢复不得回滚已提交 merge；journal 记录真实分段；恢复先读 receipt/unit（FR-LIFE-02、FR-VAL-08） | 部分：journal 在 commitMerge 前写 sources-archived；恢复无 receipt 即回滚 | 在 commit 成功→receipt 之间注入 crash；重启后树保持已提交、unit/history 一致；无 partial |
| GAP-P0-04 | engine 部署输入 allowlist：宿主不得写 offline/auto_provision/embed_backend/rank_mode 等非白名单 cfg（Lead §10.2） | 部分：C8 配置 allowlist 未冻结 | 非法 cfg 拒绝；白名单外字段不可达；engine 默认 report 不变 |
| GAP-P0-05 | engine 发布 parity：字节 parity/UPSTREAM/许可/精确版本；merge manifest 不留 workspace:^（Lead §10.2/ADR-2） | 部分：parity 未纳入发布 gate；版本约束未锁定 | npm pack 冒烟 + parity 校验；锁步版本 |

P0 hotfix 建议 0.30.16/17，schema 2 不变；发布验收：API web 真装 + 四 tab 截图 + 回滚演练（Lead §10.2/§10.7）。

## 4. P1 gap 需求（发布前）

### 4.1 命令/运行

| ID | 需求 | 状态/证据 | 验收 |
| --- | --- | --- | --- |
| GAP-CMD-01 | status 作用于 run，给 stage/第几对/stopReason；行清单归 candidates/pending/resume（FR-RUN-05） | 部分：read-commands 报行，status <runId> 报 row not found | 构造 run；status 返回进度；不支持时明确拒绝 |
| GAP-CMD-02 | candidates --retry <id> 重跑 verify 第 1 轮；resume --retry <id> 只重跑 agent2（FR-EXEC-10、FR-SCOPE-10） | 部分：parser 无 id；read-commands 把 approved 打印成 fuse | 两命令各一条；无审批重启；错误 id 两行 |
| GAP-CMD-03 | 行按钮按 state 给正确命令；approve 不被 mergeApproval 开关隐藏（FR-APP-04/06） | 部分：verify/fuse 一律 resume；approval=false 隐藏 approve | verify→candidates --retry；fuse→resume --retry；pending 按钮始终可用 |
| GAP-CMD-04 | 裸 resume 只列待合并，不自动起 run（FR-EXEC-10） | 部分：无 id 自动挑行；设计未写死，需按 v2 收口 | 无 id 不调用 registry.begin；有 id 才跑 |
| GAP-CMD-05 | cancel 无 id 只停 merge run；status/cancel 语义与设计一致 | 部分：cancelAll 取消全部 merge run（不误伤其它 kind，P2） | cancel 后 merge run cancelled；其它 kind 不受影响 |

### 4.2 候选/两轮/校验

| ID | 需求 | 状态/证据 | 验收 |
| --- | --- | --- | --- |
| GAP-CAND-01 | judge fallback 仍按 level 过滤；L0/L1 reportOnly（FR-CAND-05） | latent：engine report-map fallback 全送；当前 host 固定 deepseek 不可达 | fallback 夹具只产生 L2 候选；L0/L1 只进报告 |
| GAP-CAND-02 | 每对执行前重 resolve；staging 源与 commit live 源一致（FR-CAND-07/FR-EXEC-12） | 部分：run 起点快照；commit 用 live 源作 expected；源中途改内容可提交旧产物 | 源中途改/删；source-changed/source-gone；旧产物不提交 |
| GAP-CAND-03 | L0/L1 只进报告：reportOnly 计数+明细（FR-CAND-08） | 未实现：host 丢弃 reportOnly，MergeReport 无字段 | 报告可读 L0/L1 计数与明细 |
| GAP-CAND-04 | 非 managed/受保护对的 KEEP 不得写 skipped（FR-SCOPE-01/02、FR-EXEC-11） | 部分：onSelection 先写 skipped，过滤在后 | 构造非 managed 对；skipped 无该行 |
| GAP-VAL-01 | 超限→skipped+固定原因+自然长度；不无限 fuse（FR-VAL-05/07） | 部分：rules block→authoring failed→fuse；无长度 | 超 1 字节；skipped、源不归档、可 restore；长度可查 |
| GAP-VAL-02 | Q09 四条硬规则：每个 staged 文件必须被引用（FR-VAL-04） | 部分：只校验 body→file | 孤儿 support 文件整对失败 |
| GAP-VAL-03 | 校验和提交同一把 limits 尺（FR-VAL-01/05） | 部分：authoring 用默认 limits；commit 用部署 limits | 同一边界值门与 commit 一致 |
| GAP-VAL-04 | Q08 同名支撑文件不同内容拒绝（FR-LIFE-07） | 部分：commitMerge 只 CAS，不比较内容 | 同名不同内容整对失败；原文件不被静默覆盖 |

### 4.3 生命周期/数据/安全

| ID | 需求 | 状态/证据 | 验收 |
| --- | --- | --- | --- |
| GAP-LIFE-01 | staging 7 天清理覆盖嵌套 pairs；pending 不留孤儿（FR-LIFE-13） | 部分：cleanup 只扫 runs/<runId>；approval=on 不 drop staging | 过期 pair staging 被清；pending 无目录 |
| GAP-LIFE-02 | pending 读时收敛 source-gone/target-taken/source-changed；expired 只读不计数（FR-LIFE-14） | 部分：只在 approve 时校验；routes 幽灵行 | 列表不显示 source-gone；expired 筛选只读；计数不包含 |
| GAP-LIFE-03 | skipped TTL 到期标 expired，不删；一句话原因保留（FR-LIFE-15/DATA-04） | 部分：只过滤不标 expired；round1-keep/gate-keep 丢 reason | 到期可见 expired；reason 可读；restore 可用 |
| GAP-LIFE-04 | run 写入 stagingRef/pairs/target hash；undo 置 undone；unit/history 带 runId（FR-RUN-04/LIFE-10/12） | 部分：core 有字段但 begin 未写；unit/history 无 runId | run 可查 stagingRef；undo 后状态正确；历史可按 runId 聚合 |
| GAP-LIFE-05 | 历史基线 v1；归档/恢复/多代按 run 反序（FR-LIFE-08/09/12） | 部分：只写 audit merge；历史由 receipt 合成 | 新目标有 merge 基线；多代反序 |
| GAP-SEC-01 | 写库 origin=foreground；create 显式 .hermes-managed（FR-SCOPE-01/FR-LIFE-04） | 部分：origin=subagent；managed 依赖隐式行为 | audit origin 正确；新目标可被 family 列出 |
| GAP-SEC-01b | protected builtin 进入 curator.isBlocked（FR-SCOPE-02） | 部分：isBlocked 只查 exclude/referenced/suppressed；plan 依赖 .bundled marker 兜底 | plan 无 marker 时 scan/pair/commit 均拒 |
| GAP-SEC-02 | merge 与 curator 共用 tree-lock/instance claim（FR-PLUG-03） | 未实现：merge 无 acquireTreeWriteLock | 同 home 并发 merge/curator 串行 |
| GAP-SEC-03 | target 级串行覆盖 scan/pair/approve（FR-EXEC-17） | 部分：只有 approve 取 target claim | 同 target 两 scan/pair 单赢家 |
| GAP-SEC-04 | Q15 跨平面 foreign；Q16 三行错误+run id；Q17 E-code（NFR-04/07） | 部分：只查本进程；错误单句；只映射 E-323 | 跨平面拒绝；错误三行含 stage/run id；场景 key 可读 |
| GAP-SEC-05 | usage 折叠复用 curator 口径（FR-DATA-07） | 部分：commitMerge 只 archive | 合并后源 usage 显示 archived |

### 4.4 UI/观测

| ID | 需求 | 状态/证据 | 验收 |
| --- | --- | --- | --- |
| GAP-UI-01 | loading/空/失败三态互斥（FR-UI-02/03） | 部分：loading/failed 仍渲染空句 | 三态各截图；失败不显示空态 |
| GAP-UI-02 | locale 完整：failure*、stage.verify/screening/settle、origin.system；t 支持插值（FR-UI-04） | 部分：裸 key；t 丢 values | 英文界面无裸 key；无中文占位混入 |
| GAP-UI-03 | focus/visibilitychange 刷新（FR-UI-05） | 未实现：只有 mount/tab/refresh | 切回窗口刷新；无轮询 |
| GAP-UI-04 | 三句摘要只在 pending 行；非 pending 不显示中文占位（FR-APP-03） | 部分：routes 对所有行给 summary | verify/fuse/skipped 无三句占位 |
| GAP-UI-05 | E-325/404 分类可达；fallback 命令完整（FR-UI-06） | 部分：503 嵌套 error；body-missing 404 被误判；fallback 缺 candidates/resume/skipped | 服务缺席显示 E-325；兜底命令可整段复制 |
| GAP-UI-06 | 切 tab 清旧 rows；正文失败不拖垮整面板（FR-UI-03/05） | 部分：切 tab 不清；body 失败全局 failed | 新 tab 不显示旧数据；局部错误局部提示 |
| GAP-UI-07 | 运行区显示 endedAt/failure/resultRef；展示排序；doctor 段（FR-UI-07/08） | 部分：字段缺失；无排序；doctor 无 merge | 运行区字段/词表完整；排序持久；doctor 有 merge 行 |

### 4.5 契约/查询/UI（v2.1，0.31 冻结 / 0.32 落地）

| ID | 需求 | 状态/证据 | 验收 |
| --- | --- | --- | --- |
| GAP-WIRE-01 | 7 信封 wireVersion=1：Facts/QueuePage/RunView+RunDetail/RunsView/BodyView/HistoryView/DoctorView（ADR-3） | 未实现：仅 MergeView schemaVersion=2；QueuePage/RunDetail 无版本（routes.ts:74-103） | 每个信封版本断言；版本不符可读失败 |
| GAP-WIRE-02 | ActionRef[]{id,command,confirm,enabled,disabledReason}；label 由 client 映射（ADR-3） | 未实现：actions 为 string[]、无 confirm/enabled（routes.ts:33,66-70） | pending 恒有 approve/reject；confirm：reject/discard/restore/pair=true，approve/retry=false；disabledReason 闭集 expired/invalid/not-retryable/source-gone/owned/unavailable |
| GAP-WIRE-03 | CommandSpec JSON-safe + handler map 另层 + CommandSurface 版本化；/merge 0.30.18 保留、0.31 弃用提示、0.32 删除（ADR-3/§10） | 未实现：parser/help/actions 三处；/merge 自注册（commands.ts:14,66；merge-command.ts:70-79） | surface JSON 往返；handler 覆盖；help 19 形式+默认值；0.30.18 存在 /merge，0.32 才无 |
| GAP-WIRE-04 | status/runs 用 RunView；doctor/body/history 独立；面板不请求 doctor（ADR-3） | 部分：status 行级（read-commands.ts:18-25）；doctor 无全局行（doctor-view.ts:90-99）；body/history 已有 | status 报 run stage/progress/stopReason；全局 doctor merge 行；body/history 回归 |
| GAP-QUERY-01 | MergeFacts 纯读、Reconcile 唯一写、共用同一派生；4 条 panel GET 零写；读时收敛只派生（ADR-3） | 未实现：routes/read-commands 各自投影；收敛只在 approve | 写即抛 io + 4 panel GET 零写；RunView/RunDetail/RunsView 不作 HTTP 要求；reconcile report；GET 前后计数/mtime 不变 |
| GAP-UI-08 | 四队列 counts.active/expired 分离；expired 只读不计数；pending-expired 只给 pair/discard；skipped-ttl 标 expired（ADR-3） | 部分：expired 计入 active（status.ts:16-19） | 计数分离；expired 筛选只读；出口正确 |
| GAP-UI-09 | 三句 summary 仅 pending、三槽可空；host 无中文占位（ADR-3） | 部分：routes 对所有行中文占位（routes.ts:61-65） | 非 pending 无占位；三槽缺失时 client 显示“无摘要” |

GAP-UI-01..07 仍有效；本表只补 v2.1 的新增/细化条目。

## 5. NFR 状态

| ID | v2 状态 | 证据/缺口 |
| --- | --- | --- |
| NFR-01 长跑不绑请求 | 部分 | scan/pair 已后台；approve/resume 仍前台（GAP-P0-01） |
| NFR-02 8k/摘要 | 已实现 | status/report 有预算与路径 |
| NFR-03 maxTokens 容错 | 已实现 | 截断/1MB fail closed；channel 可重试 |
| NFR-04 同 pair/target | 部分 | pair 原子；target claim 只 approve；跨平面 foreign 未用 |
| NFR-05 崩溃收敛 | 部分 | journal 恢复有；pending 读时收敛缺失；journal 相位问题 |
| NFR-06 损坏不静默 | 部分 | state note 已进命令；单文件损坏/备份/迁移未验收 |
| NFR-07 错误三行+脱敏 | 部分 | stage/run id 支持；runtime 调用点仍单句；E-code 未全映射 |
| NFR-08 cacheRead | 已实现 | ChannelTurnLike→MergeDecision；测试 1234 透传 |
| NFR-09 GET 零写 / Facts 纯读 / Reconcile 显式写（v2.1） | P1 | write-spy io × 4 panel GET × 状态注入零写；ReconcileReport 可查 |
| NFR-10 wire/命令面版本化（v2.1） | P1 | wireVersion=1 全信封；CommandSurface 版本；版本不符可读失败 |

## 6. 功能侧与实现侧边界

### 6.1 功能侧（必须对齐）

- 四队列/四 tab、命令动作语义、后台 run、L0/L1/L2 路由、审批三句话、pending 收敛、target 优先/不 partial/undo/归档/历史、保护尺/唯一写者/审计最小面、三态/focus、doctor/安装形态。
- v2 既有四条 DEC 是功能侧：staging 时序、undo 形状、审计 1+N、单文件例外。
- v2.1 契约冻结（ADR-3/Lead §10.3）属功能侧：wireVersion=1 的 7 信封、ActionRef[]、CommandSpec/CommandSurface、summary 三槽、四队列 active/expired、GET 零写/Reconcile 显式、host 只给事实/code；字段细节以 merge-wire-contract.md 为唯一源。

### 6.2 实现侧（自由）

- 路由路径与字段名细节以 merge-wire-contract.md 为准；组件结构、样式、tab 实现自由。信封集合与语义按 ADR-3 冻结，不得改回三队列/单 MergeView。
- 状态文件 schema/布局：v2 允许单 merge-state.json 例外；不得新增 state-storage 三表；必须满足损坏/迁移/备份验收。
- 提交内部快照/事务/回滚实现；但目标优先、无 partial、恢复不清已提交 merge 是功能不变量。
- 锁机制可自由；必须满足同 home 同 target 串行与 curator 写锁。
- engine 打包布局/registry 路径；只守默认安装可运行。
- 字段名 aSummary/a_summary；只守三句话上屏。

## 7. 验收矩阵

| 组 | 最小验收 | 对应 gap |
| --- | --- | --- |
| 运行/命令 | approve/resume 立即 run id；status 有 stage；candidates/resume retry | GAP-P0-01、CMD-01..04 |
| 候选 | L0/L1 不进 round1；fallback 同规则；reportOnly 可读 | CAND-01..03 |
| 两轮 | pending 无 staging；approve 重 resolve；源中途改不提交旧产物 | V2-EXEC-01、CAND-02 |
| 校验 | Q09 双向引用；Q08 同名拒绝；超限 skipped；同尺 | VAL-01..04 |
| 生命周期 | journal 不回滚已提交；pending 收敛；staging 清理；undo/历史 | P0-03、LIFE-01..05 |
| 安全 | target managed；pinned 竞态；protected builtin；tree-lock | P0-02、SEC-01..05 |
| 契约/查询 | 7 信封 wireVersion；ActionRef；GET 零写；Facts/Reconcile 拆分；四队列 active/expired 分离 | WIRE-01..04、QUERY-01、UI-08/09 |
| UI | 三态；locale；focus；E-325；tab 残留；三句只 pending；ActionRef label 映射 | UI-01..07、WIRE-02 |
| NFR | 断线/长跑、8k、maxTokens、claim、损坏、三行错误、cacheRead | §5 |

每条 P0/P1 修复必须配“构造态→命令→断言 store/report/mutations”三段式测试；P0 竞态/崩溃项要有反例测试。

## 8. 追踪与变更记录

- 61 审计：../reviews/61-landing-gap-audit.md（v2 修正/补全）。
- 62 覆盖矩阵：../reviews/62-integration-coverage-matrix.md。
- 4 条裁决：merge-design-decisions.md。
- 代码基线：D:\dsh\dsh-evolution-mirror @ 5c3d5f86（0.30.15）。
- v1 详细 FR 文本：merge-functional-spec.md。

| 日期 | 变更 | 依据 |
| --- | --- | --- |
| 2026-10-23 | v2 建立；新增 P0 3 条、P1 4 组、状态表 | 61/62 二次复核 |
| 2026-10-23 | v2.1 增补 engine C8/parity 两条 P0，合计 P0 5 条 | ADR-2/Lead §10.2 |
| 2026-10-23 | staging 改 decide 后；undo --run 必填；审计 1+N；单 merge-state 例外 | DEC + 用户裁决 |
| 2026-10-23 | v2.1：补 7 信封/wireVersion、ActionRef/CommandSurface、四队列 active/expired、summary 三槽、GET 零写/Reconcile、doctor/body/history 独立、P0 hotfix 与 0.30.16/17→0.31→0.32 阶段 | ADR-3/4 终裁、Lead §10 |
| 2026-10-26 | UI 合并面板保持只读：无写按钮；批准/移出等通过复制命令，不引入前端写模型 | FR-UI-07；A18 |

## 9. 未决/后置

- 自动运行、拆分、独立压缩：后置。
- A/B 扩样 4–6 对：未决。
- 多代/整树 restore 后 superseded 展示：未决。
- 历史基线 v1 的细节：未决；数据单文件的备份/恢复/迁移按 Lead §10.4/本文件 §10.5 约束（last-known-good + 原子替换 + 损坏 note + 迁移 dry-run，否则不接受单文件）。
- P2 清单见 61 §9.2，不阻塞本 v2 的 P0/P1 收口。
- wire 字段细节（7 信封字段/ActionRef/CommandSurface 具体形状）由 merge-wire-contract.md 冻结；本文件只冻结语义与验收。冲突时行为以本文件为准，字段名以 wire 契约为准。
- engine 内部化另开 ADR（本轮按 Lead §10.2 保持 pinned 私有库 + parity）。
- 0.31 旧 UI 兼容面与 0.32 切换点：0.32 同版本切 UI 并删旧面，禁止长期双面并行（Lead §10.2/本文件 §10.5）。

## 10. v2.1 契约与阶段增补（依据 Lead 2026-10-23 §10）

### 10.1 查询/命令/UI 契约（ADR-3，0.31 冻结 / 0.32 落地）

- **MergeFacts 纯读 + Reconcile 显式写**：Facts 只接受不可变输入快照，不得持有 io/写端口；Reconcile 是唯一写入口，由 run 起点/approve/commit 前/挂载触发并产出 ReconcileReport；Facts 与 Reconcile 必须共用同一派生函数（active/expired/invalid 判定只写一次）。
- **GET 零写**：4 条 panel GET（view/rows/body/history）不得写盘、不得顺手重建 state；RunView/RunDetail/RunsView 是 CLI/只读投影，不要求 HTTP；DoctorView 走全局 doctor，若暴露为 HTTP 另计。write-spy 验收对象是 4 条 panel GET（加可选的 doctor GET），不是“7 条路由”。expired/source-gone/target-taken 只做派生展示；收敛持久化只经 Reconcile。
- **视图分开**：Facts、QueuePage（含同次读 counts）、RunView+RunDetail、RunsView、BodyView、HistoryView、DoctorView 各自版本化；status/runs 用 RunView，不得塞进 QueuePage；doctor 独立，面板不请求 doctor 路由。
- **版本**：wireVersion=1（整型），7 个信封全部携带；state schemaVersion 另计；客户端对每个信封浅校验，不符进本地化 failed 态（非空/非白屏）。
- **ActionRef[]**：{id, command（完整串含 /evolution）, confirm, enabled, disabledReason?}；label 由 client 按 id+行上下文映射；confirm：reject/discard/restore/pair=true，approve/retry=false；disabledReason 闭集：expired/invalid/not-retryable/source-gone/owned/unavailable。
- **CommandSpec/CommandSurface**：字段名以 wire §10 为准——CommandSurface{wireVersion:1,prefix:'/evolution merge',commands,fallback}；CommandSpec 含 id/words/flags/positional/summary/readOnly/needsRun/defaults/rowActions/fallback，不放 inputSchema/actions；handler 以 CommandId→Handler 独立 map 注入；surface 可 JSON 往返；/merge 在 0.30.18 保留，0.31 弃用提示，0.32 删除。

> 去重与覆盖语义（2026-10-25）：V2-* 行是规范变更记录，GAP-* 行是验收权威；同一主题以 GAP 行为唯一计分，V2-* 不重复计分。“覆盖”分两种：真改写按 v2 判；仅适用/细化按 v1 + 补充判据判。
- **host/client 分界**：host 只给事实与 code，不出 label/cells/中文占位/本地化句子；client 管 locale、三态、focus、tab/cursor/filter、复制/确认、ActionRef label 映射；client 不拼命令、不按 approval 开关过滤动作。
- **body/history 保留**：BodyView（活动/归档、截断标记）与 HistoryView 必须保留（v1 FR-UI-04），不得因合并 routes 而删除。

### 10.2 四队列与 expired（V2-UI-01）

- 数据四态 verify/pending/fuse/skipped；approved 归 fuse 队列，`counts.active.fuse` 含 approved，`queue=fuse` 同时返回 approved+fuse；counts 拆 active（四队列）与 expired（pending/skipped）。
- expired 只读可见、不计入 active；pending-expired（target-taken/source-changed）只给 pair/discard 出口；skipped-ttl 到期标 expired、不删、可 restore；skipped tab 普通页仍返回这些 expired skipped 行，expiredOnly 仍只对 pending 为 true。
- source-gone 由 Reconcile 收敛出活动队列；GET 只派生不写。
- 面板/命令面均需 expired 入口（pending --expired；面板 pending tab 的“已过期”筛选）。

### 10.3 三句 summary（V2-UI-02）

- summary 仅 pending 行；结构 {a?:string|null, b?:string|null, rationale?:string|null}；非 pending 不出现 summary。
- host 不得输出“未提供技能1摘要”等中文占位；缺失槽由 client locale 显示“无摘要”；三句原文不翻译。

### 10.4 P0 hotfix（0.30.16/17，schema 2）

| 项 | 来源 | 验收 |
| --- | --- | --- |
| approve/resume detached，命令立即回 run id | GAP-P0-01 | 1 秒内 accepted；断客户端 run 仍完成；status/report 可查 |
| target managed + pinned/protected 提交期校验 | GAP-P0-02 | 非 managed/决策后 pin 整对 failed、零写、源不归档 |
| journal/恢复：已提交不回滚；receipt/unit 权威 | GAP-P0-03 | crash 注入；重启后树保持已提交；无 partial |
| engine C8 配置 allowlist | GAP-P0-04 | 非法 cfg 拒；白名单外字段不可达 |
| engine 发布 parity/UPSTREAM/许可/精确版本 | GAP-P0-05 | npm pack 冒烟 + parity 校验 |

发布验收：API web 真装 + 四 tab 截图 + 回滚演练；schema 2 不变。

### 10.5 版本阶段与门槛（Lead §10.2/§10.7）

| 版本 | 内容 | schema | 门槛 |
| --- | --- | --- | --- |
| 0.30.16/17 | P0 hotfix 五项（含 engine C8/parity）；旧 UI/旧只读面继续可用 | 2 | API web 真装、四 tab 截图、回滚演练 |
| 0.31 | RG1 端口/CommandSurface/MergeFacts+Reconcile/eligibility/lock；wire 契约冻结；旧 UI 与旧只读面并行保留；/merge 弃用提示 | 2 | RG0 ownership matrix + RG1 fixtures/备份/对账/no-downgrade；新面只读、GET 零写 |
| 0.32 | schema v3 Row 联合/迁移、commit 事务收口、UI 薄化（7 信封/ActionRef）；同版本切 UI 并删旧面；删 /merge | 3 | RG2/RG3；v2 P0/P1 全绿；7 信封版本矩阵；旧文件只读备份 + 迁移 dry-run |

> 2026-10-25 裁决回写：0.30.18 实际已包含 wire v1、v3 schema、UI 落地与 /merge 保留，故上表 0.31/0.32 仅为历史计划标签，不再是本版本的应然范围；0.30.18 审计按本文件 §10.1/§10.2 已落地语义判。

约束：

- schema v3 必须覆盖 state/runs/receipts/journals/staging/unit-history，不只 Row；必须先有 0.30.15 fixtures、last-known-good 备份/原子替换/损坏 note/迁移 dry-run、对账、no-downgrade（Lead §10.4/§10.5）。
- RG0 + RG1 是 Phase 2/3 全局前置；未过不得开工 0.32。
- 0.31 新面与旧 UI 并行是过渡态；0.32 必须同批切换并删除旧面，禁止长期双面。
- 阶段顺序：文档冻结 + RG0 → 0.30.16/17 P0 hotfix → RG1 + 0.31 契约/端口 → RG2/RG3 + 0.32 schema 3/UI。

### 10.6 文档归属与边界

- merge-wire-contract.md（frontend）：冻结 7 信封字段、ActionRef、CommandSurface 具体形状；与本节冲突时行为以本节为准、字段名以 wire 契约为准。
- merge-design-decisions.md（platform-backend）：ADR-1/2/4 事务/锁/包/迁移细节。
- merge-architecture-gates.md（platform-fitness-reviewer）：RG0–RG8/K1–K12/迁移/运维/scale。
- 本文件：只冻结用户可见行为与验收；不写实现/字段细节。
- merge-architecture-optimization.md：方案层，评审后由 chief-architect 按 Lead §6 改写，不作为验收基线。

### 10.7 状态映射（gap → 目标版本）

| gap 组 | 目标版本 |
| --- | --- |
| GAP-P0-01..05 | 0.30.16/17 |
| GAP-CMD-01..05（命令语义/动作形状） | 0.31（catalog/query）；其中按钮/开关的 UI 面 0.32 |
| V2-WIRE-01..04、GAP-QUERY-01 | 契约 0.31；UI 落地 0.32 |
| GAP-UI-01..09 | 0.32（UI 薄化）；locale/三态等小项可提前 hotfix，但不得依赖新 schema |
| GAP-CAND/VAL/LIFE/SEC | 0.31/0.32，按 RG2/RG3 gate；schema v3 相关项 0.32 |
| 单 merge-state 损坏/备份/迁移保障 | 0.31（RG1 证据）；schema v3 迁移 0.32 |