# 03 curator / review / state / activity / memory 只读审计（HEAD 564431ac）

## 结论（一段）

这六包在三轮以上历史审计后已相当“封闭式”：错误分域、取消/超时、状态 CAS、深拷贝、跨进程 fence 都被逐条点名过，本轮在默认单进程配置下**没有找到可直接复现的 P0**。真正剩下的风险集中在两条线上：**(a) 跨进程/跨实例**——`evolution-state-domain` 把三张表常驻进程内存，claim/resolve 以本地缓存为判据，既不刷新也不互斥（P1-1，与 01-core-write P1-2 同根但更重：不是竞态窗口而是永久陈旧）；**(b) “先落账后执行”**——curator 的 restore 用整条 state 覆盖写吞掉并发 pause（P1-2），review 的 aux 段末先清零 durable 计数器再尝试调度、失败结果被丢弃（P1-3）。技术债主线是同一份会话级账本被拆成 9 张并行 Map（还用源码文本测试钉住）、review/curator 各手写一套“已调度/已执行”判据、以及 PTC 通道的 `dispose` 从未被调用。

## P0（无则写无）

无。最接近 P0 的是 P1-1 的“审批双执行”，但它需要两个宿主进程共用一个 DSH_HOME（文档已支持的双 plane 场景），且 family 已在 `medium-declaration.ts` 里书面声明 single-process，故列 P1。

## P1

### P1-1 storage-domain 提供者以进程内存为读判据，跨进程既不刷新也不互斥 → 审批可双执行、review 计数丢更新
- 证据：`packages/evolution-state/src/domain/index.ts:166-191`（domain 单例，open 一次后 `domain` 常驻）、`:338-406`（`listPending` 读 `table.entries()`）、`:440-447` 与 `:486-493`（claim/resolve 在 `table.update` 回调里读 `current` 判断状态）；上游 `D:\dsh\harness-rc3\packages\storage\storage-domain\src\domain.ts:320-328`（`get`/`entries` 直接返回 `this.records`）、`:375-388`（`update` 只排进本进程 `host.enqueue` 的写链）、`:391-408`（`domain/changed` 仅 `ctx.emit` 进程内事件）；`D:\dsh\harness-rc3\packages\storage\storage-json\src\atomic.ts:24`（后端只有 `writeAtomic`，无跨进程锁/变更回灌）；镜像 `packages/evolution-state/src/medium-declaration.ts:26-51` 自认 single-process，但只被 `processScopeViolations()` 这个检测 API 读取，挂载与读写路径都不调用。
- 机制：provider `open()` 时把 review/curator/pending 三表读进内存，此后所有 list/claim/resolve 都以这份快照为事实。B 进程看不到 A 已 approved/rejected 的 pending 行（永远 pending）；B 的 `claimPending` 会在 A 的机会已执行后再次 claim 成功（transition 表只校验 `pending`，见 `storage.ts:33-37`），随后 replay 非幂等 runner（memory/skill 写入）→ **双执行**。`saveReviewState` 的整行 put 则让两进程的计数器 last-writer-wins 互覆。
- 影响：审批队列双执行/幽灵行 + review 节奏计数丢失；与 `01-core-write.md` P1-2（home sidecar 的 `transact` 只单进程）同根，但这条是“持久陈旧”，不只是窗口竞争。
- 建议：pending 表的 claim/resolve 不允许以进程缓存为判据——要么回到 json/`transactIo` 介质，要么用 family 已有的 `LeaseStore`（`packages/evolution-core/src/lease-store.ts:81-104`，durable 单 host 文件租约）给每条记录加跨进程认领校验（写租约→读回→执行→resolve）；review_state 这类可重算数据迁回 json 侧最省事。至少在 domain 行挂载时调用 `processScopeViolations(io)` 并对“声明 single-process 却可能多宿主”打一次 warn、写进 doctor。
- 置信度：机制高（两侧源码可追）；可达性取决于部署是否双宿主共 home——文档与 04 号审计都已把该形态当现实场景。

### P1-2 `restoreSnapshot` 用整条 curator-state 覆盖写，吞掉并发 `setPaused`
- 证据：`packages/evolution-curator/src/index.ts:945-963`（`restoreSnapshotCore`：`:947` load 当前态作 extras，`:951` restore 树，`:956` `stateService.saveCuratorState(JSON.parse(stateExtra.content))` 整条写入）；对照 `:705-730` `setPaused` 走 `transactCuratorState`（`:723`）且**不取** `acquireMutex`；同文件 `:720-722`、`:1513-1519` 的 E-16/S5.5 注释明确“整条 saveCuratorState 会把并发 setPaused 压平回 paused:false”，本路径没有按该结论修。
- 机制：快照携带的 state 是上一次存档时的（`paused` 可能为 false）。restore 在 mutex 内，`setPaused` 在 mutex 外 → pause 落在 load 之后、写之前时被旧整条记录覆盖；同一覆盖还会把 `lastRunAt`/`runCount` 回退一个快照代际。pause 是操作者的软停止安全开关，被吞后自动 pass 会继续改技能树。
- 影响：暂停丢失（静默）；时间窗窄（restore 与 pause 并发）但一旦命中，操作者以为已停。
- 建议：restore 的 state 写也走 `transactCuratorState`，只回写快照里的簿记字段（`lastRunAt`/`runCount`/`lastSummary`），保留 `current.paused`；或让 setPaused 也进同一 mutex。
- 置信度：机制高（两条路径均在代码中）；触发需并发，未构造复现。

### P1-3 review aux 段末：先清零 durable 计数/删闩锁，再尝试调度；失败结果被丢弃
- 证据：`packages/evolution-review/src/index.ts:770-781`（completed flush：`:774` `pendingCadenceReviews.delete`，`:779` `await consumeReviewDebt` 清零并落盘，`:780` 才 `scheduleAuxDebt`）；`:1056-1061` `scheduleAuxDebt` 把多个 `tryAuxReview` 放进数组后 `await Promise.all(tasks)` 并丢弃每个 boolean；`:1064-1073` `consumeReviewDebt` 的 load→清零→save；`tryAuxReview` 的失败返回点：`:1102`（无 requestHeader）、`:1109`（llm/tools 未挂载）、`:1115`/`:1116`（lease acquire 抛错/被占）、`:1154`（PTC child/通道 setup 失败）。对比 inject/completion 两条路径在拒绝投递时都显式回滚闩锁：`:788-790`、`:861-863`。
- 机制：aux 模式在“任务结束”这一刻先把两个 domain 的 `turnsSince*` 清零并持久化、并删掉内存 debt，然后才调用可能失败的子代理调度；任一失败只返回 false 给一个被丢弃的数组，没有回滚也没有重试闩锁。于是本段的复查没跑、计数也没了，下一次要再等满一个 `reviewInterval*`。
- 影响：transient 的 lease/io/child 失败即可静默丢掉一次段末复查；与 inject 路径“被拒必回滚”的既定契约不对称（0.3.73 正是为这条契约修的）。
- 建议：`scheduleAuxDebt` 返回 `{scheduled, failed}`，只对 scheduled 的 domain 调 `consumeReviewDebt`；failed 的 debt 写回 `pendingCadenceReviews` 或清空的动作后移到调度成功之后（与 inject 回滚共用同一函数）。
- 置信度：机制高；生产触发频率取决于 lease 争用/child 创建失败率。

## P2 / 技术债 / 屎山

1. **curator 的固定 1h tick 与 interval gate 相位不齐**：`packages/evolution-curator/src/index.ts:677-683`（`setInterval(…, 3600_000)`）、`:1138`（due = `now - lastRunAt >= interval*3600_000`）、`:1542`（成功后 `lastRunAt = Date.now()` 写在 run 结束）；schema 允许 1h（`:304`，policy 同 `packages/evolution-core/src/policy.ts:123`）。tick 网格钉在 boot 时刻，而 lastRunAt 落在某次 run 结束后，下一 due 必然落在某个 tick 之后几分钟 → 再等一个整 tick。**interval=1h 时实际 2h**；默认 168h 每轮多漂 1h。建议改自调度 `setTimeout(max(0, lastRunAt+interval-now))`（unref/dispose 保留）。置信度高。
2. **PTC review 通道 `dispose()` 从不调用**：`packages/evolution-review/src/review-ptc-channel.ts:195-198` 定义了 `dispose()`（`active`/`controls` 删除），但调用点只有 `index.ts:1139-1145`（拿 channel）与 `:1276`（只 dispose `reviewChild`）；每次 PTC 复查在 host 内留一条 control 和一个永远 `active` 的 reviewId，直到插件卸载（`:1302` 才整体 `ptcToolHost.dispose()`）。
3. **PTC 身份判据两套**：`when` 只用 ALS `currentReviewContext()`（`review-ptc-channel.ts:159-164`），而 handler 有 child-session 前缀兜底（`:79-88`，注释自认“PTC program dispatch 可能跨过 ALS 边界”）。平台 `when` 在 step 准备/`resolve()` 期求值（`D:\dsh\harness-rc3\packages\core\tools\src\contracts.ts:105-125`）：一旦嵌套 dispatch 越过 ALS，工具在目录里就不可见，兜底成为死代码。likely/unverified（需真机 PTC 复查验证）。
4. **“平台没有 session 结束钩子”是过时前提**：`review/index.ts:549-552`、`:1385-1388` 以“the platform has no in-process session-end hook”为由做 128 条阈值清扫；平台实际有 `session/disposed`（`D:\dsh\harness-rc3\packages\core\session\src\index.ts:65`）和 `agent/disposed`（`packages/core/agent/src/runtime-types.ts:300`）。应订阅后精确回收 9 张会话 Map + `reviewStateLocks`，删掉阈值清扫与相关注释。
5. **`waitForReview` 不响应 abort**：`packages/evolution-review/src/review-executor.ts:139-143` 先 `setTimeout(timeoutMs)` 再 `throwIfAborted()`；超时/卸载最迟要等满 60s（上限见 `:132`）。同语义的锁等待在 `review-write-locks.ts:62-87` 是能提前退出的——一个语义两条实现。
6. **错误文案复制粘贴**：`packages/evolution-state/src/storage.ts:189` “mount @deepseek-ai/dsh-evolution-state-domain or @deepseek-ai/dsh-evolution-state-domain”（第二个应为 json provider），排障会把 operator 引回同一个包。
7. **domain provider 无 disposed 标志**：`evolution-state/src/domain/index.ts:166-191` 的 `ensure()` 在 dispose（`:555-567` 等 opening、关 domain）之后被 stale 引用再次调用会重新 open 一个 domain 并泄漏句柄；curator 有同款防护（`evolution-curator/src/index.ts:367-377` isDisposed），此处缺。
8. **memory 工具挂载期 await 无超时**：`packages/memory/src/tools/index.ts:165-171` 在 `apply` 里 `await ctx.memory.renderContext()`，只 catch reject 不管挂起；provider 永不 resolve 时 tool-memory 整行永不完成挂载。家族对同类外部调用用 `AbortSignal.timeout`（`evolution-curator/src/index.ts:854`）。
9. **curator 每轮 3+ 次全树遍历**：`seedBaseline`（`evolution-curator/src/index.ts:1573` `skills.list()`）、主扫描 `:1241` `skills.list({withContent:true})`、`scoreTree` 逐 skill `await countSupportDirs(name)`（`:1607-1610`，串行 N 次目录扫描）；`healthView` 又扫一遍（`:2147`）。是延迟/dogfood 债，不是正确性问题。
10. **测试以源码文本做断言**：`packages/evolution-review/tests/session-state-ownership.spec.ts:13-30`（`readFileSync` + 正则 + 硬编码集合数 9 + cleanup body 不含 `.clear()`），任何重命名/格式化直接红；`tests/review-executor-skill-write.spec.ts:16` 直接 `import '../../tool-skill-manage/src/index.ts'`，把测试绑到邻包 src 形状（跨包源码耦合）。
11. **超长函数/单文件**：`evolution-curator/src/index.ts` 2643 行，`runCore` `:1116-1558`（≈443 行）、`applyMutations` `:1647-1940`（≈293 行）；`evolution-review/src/index.ts` 1423 行，`apply` `:347-1305`（≈959 行）、`runOnTurnEnd` `:670-880`、`tryAuxReview` `:1075-1284`。同一“active-session 跳过即返回 skippedReport”的 3 段（`:1145-1151`、`:1334-1338`、`:1361-1365`）几乎逐字重复。
12. **兼容层常驻**：`skillsRoot` 已退休仍留在 schema 只为 load 时抛错（`review/src/index.ts:150-152`/`:196`、`maintenance/src/tools.ts:33-34`）；`reviewMode:'inject'` 调试模式每次加载 warn（`:509-511`）并与 aux 两套语义长期并存；`PENDING_KINDS` 的 `'capability'` 无生产者只为读旧（`evolution-state/src/record-contract.ts:25-39`）——都是有意为之，但构成持续的判据分叉成本。
13. **同 home 两个 sidecar 两套锁法**：feedback boot cache 是 lockless `readText→writeText`（`packages/evolution-activity/src/feedback/index.ts:521-573`），activity.json 走 `transactIo`+homeFence（`packages/evolution-activity/src/index.ts:408-436`）。cache 可丢弃所以只列 P2，但“哪些写落锁、哪些不落”没有一处声明。
14. **review executor 的模型侧 allowlist 实由 channel 兜**：`review-executor.ts:349` 的 `allowedNames` 取 `channel.visibleTools`（native = 父会话**全量**工具，`review-tool-channel.ts:51-55`），真正按 review 白名单过滤在 channel `execute`；于是 `review-executor.ts:398-411` 的“not allowed”分支只对目录外的幻觉名字生效，而被 channel 拦下的真实工具名在 actions 里记成普通 `error`，`evolution/plan-applied` 的 `rejectedOps` 分不清“策略拦截/工具失败”。

## 平台接口对照

| 接缝 | 镜像用法 | 平台事实 | 结论 |
|---|---|---|---|
| `session/event` | `review/index.ts:528` `(session, event)`；`turn/end` data 读 `{turn, reason.kind}` | `core/session/src/index.ts:79`；`types.ts:294-303`，`completed` 属 `TurnEndReasonMap` `:206-207` | 一致 |
| `agent/inbox/*` | `review/index.ts:645-647` 三个事件；settle 用 `event.data.turn`（`:715`） | payload `{agent,message,(turn)}`：`core/agent/src/runtime-types.ts:318-337`，`claimed.turn` 是“owning turn” | 一致 |
| `agent.followup/inject/inbox` | `review/index.ts:959-1008` followup 优先、降级 inject；对 inbox 做 optional 软探 | `runtime-types.ts:245-271`，`inbox` 平台侧必填 | 一致；软探是为 partial host 有意降级 |
| `tools.register(def,{when})` / `tools.guard` | `review-ptc-channel.ts:159`、`activity/src/threat/index.ts:132` | `core/tools/src/index.ts:128`、`contracts.ts:116-125`、`:410`；`when` 在 step 准备期求值、抛错会让 step 准备失败 | shape 正确；PTC 的 `when` 依赖 ALS 有边界风险（P2-3） |
| session 读面 | `requestHeader/deriveMessages/toolHistory/seq/header`（`snapshotReviewParent` `review/index.ts:1031-1053`） | `core/session/src/index.ts:1007/1079/1048`、`types.ts:557`、`:574` | 一致 |
| `sessionProjections.snapshot` | `review/index.ts:1088-1092` 取 `['agentPreset']`，缺则回落 header | `session/session-projection/src/index.ts:514`：只算 wire-visible 单元，返回 `{asOfSeq, values}` | 一致；host-only 单元读不到时回落可接受 |
| `settings.configure({auto},fiber)` | `review/index.ts:359`、curator `:407`、memory `:121` | adapter `packages/evolution/evolution-adapter/src/settings.ts:10` | 一致 |
| storage-domain | `open`/`domainTable`/`table.get|put|delete|update/entries` | `storage-domain/src/domain.ts:320-408`；`missing-key` 语义与镜像的两次 retry+seed（`evolution-state/src/domain/index.ts:306-336`）匹配 | API 一致；读面进程缓存是 P1-1 |
| scheduler/cron | 未使用；curator 自建 timer、review 由 session 事件驱动 | `packages/schedule/schedule/README.md` 是“向会话投递定时消息”，没有 host 型 interval/cron 服务可注册 | 不迁移是对的；缺陷只在 tick 相位（P2-1） |
| 事件生命周期 | `ctx.effect(() => ctx.on(...))`、`ctx.effect(() => () => chain)` | cordis `vendor/cordis/src/fiber.ts:408-424`、`:437-447`（disposer 可返回 Promise 并被等待） | 一致；activity 的卸载 flush 依赖该契约成立 |
| approval | 家族自建 `evolutionApproval`（非平台 `user-approval`） | — | 本次未审（出界） |

> 注：`D:\dsh\harness-rc3\packages\evolution\*` 与镜像逐字节相同（rc3 工作区未跟踪目录），不能当“上游版本”用；真正的平台权威是 `packages/core/*`、`storage/*`、`session/*`、`vendor/cordis`。

## 更优实现

1. **pending 表的跨进程语义二选一**：回 json/`transactIo` 介质，或改用 family 已有的 `LeaseStore` 做 durable 单 host 认领（写租约→读回→执行→resolve），并把 `processScopeViolations` 接进 mount/doctor；`review_state`/`curator_state` 迁回 json 侧即可消除 P1-1 的丢更新。
2. **curator 调度改自调度**：`run()` 结束后按 `lastRunAt + interval` 重算下一次 `setTimeout`（boot grace/错过窗口/boot catch-up 合到一个 `scheduleNext()`），同时删掉固定 1h tick，P2-1 与“boot 后首个 tick 对齐”一起消失。
3. **review 段末改成“调度成功才结账”**：`scheduleAuxDebt` 返回每个 kind 的 `scheduled|busy|failed`；`consumeReviewDebt` 只对 scheduled 调，failed 写回 debt 并在下个边界重试——和 inject 路径的回滚共用一个函数，顺带消掉 P1-3。
4. **会话级账本合并**：9 张 `Map<SessionId, …>` 合成一个 `Map<SessionId, SessionState>`，一个注册点、一个回收点；订阅 `session/disposed` 精确删，删掉 `COUNTER_SWEEP_THRESHOLD` 阈值清扫与源码文本测试（P2-4/P2-10）。
5. **PTC 通道收尾**：`tryAuxReview` 的 finally 里 `channel.dispose()`；`when` 与 `controlFor` 共用 `reviewIdFor(exec)`（ALS 优先、child id 兜底），两来源各配一个用例。
6. **curator restore 的 state 写走 transact + 字段级回写**：只恢复运行簿记，保留 `current.paused`（P1-2）；`applyMutations` 的 archive/consolidate 两段 + usage/suppression 收尾可拆成 3 个返回 typed result 的 stage，`runCore` 里的 aborted/回滚记账自然收敛到一处（P2-11）。

## 覆盖清单

- **全读**：`packages/evolution-state/src/**`（storage/index/domain/index/record-contract/medium-declaration/constants/domain/compatibility）；`packages/memory/src/**`（index/files/tools）；`packages/evolution-review/src/**` 全部（index/review-executor/review-limiter/review-notice/review-ptc-channel/review-tool-channel/review-write-locks/session-state）；`packages/evolution-curator/src/**`（index 分 4 段通读、unit-undo-plan）；`packages/evolution-maintenance/src`（index/orchestrate/tools/footprint/enrichment/validate-plan 前 120 行）；`packages/evolution-activity/src`（index、replay 全读；feedback 60-573/599-773/862-991；learning-graph 300-796；threat 全）。
- **抽读/未逐行**：`evolution-activity/src/feedback` 1-59/780-861、`learning-graph` 1-299、`maintenance/validate-plan` 121-393、`drift-scan`/`probe`/`render-facts`（行为面由 orchestrate 调用覆盖）、`evolution-state/src/conformance.ts`（发布用的 provider 契约套件，299 行未逐行）。
- **测试**：仅按“夹具依赖/源码文本断言”抽读（P2-10）；未执行测试（只读审计），未跑 tsc。
- **平台对照**：`harness-rc3/packages/core/{session,agent,tools,system-prompt}`、`storage/storage-domain`、`storage/storage-json`、`session/session-projection`、`schedule`、`vendor/cordis/{fiber,registry,events}`；`harness-rc3/packages/evolution/*` 仅用于确认其与镜像同源，不作上游。
- **明确出界未审**：`evolution-state-json`（位于 `.release-staging/`，仅作为 provider 契约对照读注释）、`evolution-approval`/`evolution-core`/`evolution-commands`/`evolution-ui`（仅读被调用面）、`tool-skill-manage`。
