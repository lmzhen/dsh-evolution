# dsh-evolution 第五轮审计报告（最新版本 rc.69）

| 项 | 内容 |
|---|---|
| 审计对象 | `D:\dsh\dsh-evolution-mirror` @ git HEAD `54f7714`（**rc.69**，2026-08-30） |
| 对比基线 | 第四轮审计（`AUDIT_REPORT_v4.md`，rc.66 `9f0f729`） |
| 审计范围 | ① 逐条核验第四轮 K-1…K-6 修复；② 全量审计 rc.67→rc.69 新增/改动代码（约 +1072/−115 行、22 个文件：curator usage 写路径字段级事务化、事件日志单源化 `evolution-events.ts`、feedback 三平面重构（事件真值/启动缓存/内存聚合）、迁移竞态修复、`/learn` 注入、EPERM 锁竞态、锁预算放宽）；③ 上游 0.1.1-rc.2 增量接口复核（`CommandInvocation.agent`、`Agent.inject` 消息契约、`deriveMessages` 投影链路） |
| 约束 | 只读审计，未修改任何代码 |

**结论摘要**：v4 的 K-1…K-6 **六项全部确认修复**，且修复质量高——K-1/K-2 不只迁移到 `mutateUsage`，还把 curator 的权威字段集（`applyCuratorFields`/`foldCuratorFields`）显式化，使"工具侧计数 vs curator 状态"的字段所有权第一次成为类型化契约。rc.68 的 feedback 事件日志重构设计严谨（追加式真值 + 可重建缓存 + 幂等迁移 + rc.69 的语义序列合并），回归测试覆盖到位。**本轮新发现 7 项：2 项 P2 + 5 项 P3**，全部集中在 rc.67–69 的新代码；**无 P0/P1**。问题总量与严重度连续第五轮收敛（39 → 7 → 7 → 6 → 7，峰值 P0 → P1 → P1 → P2 → P2）。

---

## 1. 第四轮问题修复核验（K-1…K-6 全部确认 ✅）

| 编号 | 修复提交 | 核码证据 |
|---|---|---|
| K-1 控制面 usage 整文件写逃逸 | rc.67 | `consolidate()`/`restore()` 均已迁入 `mutateUsage`（`evolution-curator/src/index.ts:921`、`:942`）；`saveUsage` 生产调用方**清零**（全仓 grep），且新路径对损坏 sidecar 不再整写覆盖 |
| K-2 记录粒度折叠丢窗口计数 | rc.67 | core 新增 `applyCuratorFields`/`foldCuratorFields`（`usage.ts:132-160`）：权威字段集显式化为 `state/archived_at/quality_score/quality_warn/pinned`，`applyMutations` 折叠改字段级（`curator/index.ts:758-761`）——运行窗口内工具侧计数 bump 保留 |
| K-3 计划通道丢失 read-before-write 措辞 | rc.67 | bundle 升 `dsh-evolution@7`（`prompts.ts:25-26`）；SKILL_REVIEW/COMBINED 各补 "Read-before-write (enforced by this channel)…"（`:49`、`:99`）；plan 变体经模板串接原样继承（`:216-219`）并仍入 digest（`:257-258`） |
| K-4 `before dispose` 注释失实 | rc.67 | `evolution-review/src/index.ts:249-251` 注释改为"run 结束后、finally 仍持有 run 时读取"；`try/finally` dispose 结构（`:300-306`）完好 |
| K-5 curator report 行内挤压 | rc.67 | `evolution-commands/src/index.ts:93-94` 已换行规范化 |
| K-6 feedback `record` io 参数错配 | rc.68 | `record(target, rating, note?, kind?)` 收敛为四参（`evolution-feedback/src/index.ts:115`），path 与 eventsPath 均只从构造面推导（`:52-60`）；全仓无残留五参调用 |

**顺带确认的工程亮点**：rc.67 的 Windows `EPERM` 锁竞态修复方向正确（`io.ts:130-134`，并发 create/delete 竞争按 EEXIST 同类重试）；rc.68 的 `/learn` 注入修复了一个真实行为缺陷（命令回显从不进入模型历史，旧实现等于没有投递）；rc.69 的迁移合并采用"语义序列包含判定 + 追加（seq 位移）"而非 first-writer-wins，`containsLegacySequence` 只比较语义字段（type/kind/target/rating/note，`feedback/index.ts:186-201`）且作者在注释里论证了巧合匹配的无害性——论证成立。

---

## 2. 本轮新发现（rc.67→rc.69 引入/暴露）

### F-1（P2 · 口径不一致）事件日志的"损坏拒绝"在 append 路径只覆盖 JSON 语法层，形状层损坏会被**静默覆盖**——与同模块读取路径的自述直接矛盾

- 位置：`packages/evolution-core/src/evolution-events.ts`。
- `readEvolutionEvents`（`:89-102`）把"JSON 合法但 `events` 非数组/缺失"的日志判为 `malformed: true`，其文档注释（`:83-84`）写明 *"loss case; never overwritten"*。
- 但 `appendEvolutionEvent`（`:63-79`）的拒绝门只有一层 `JSON.parse(current)`（`:68-70`）：`{"events": 42}`、`{"version": 1}` 这类**语法合法但形状错误**的日志能通过 JSON.parse → `parseEvolutionEvents` 读作 `[]` → 追加后**整文件重写**为仅含新事件的日志，原有未知内容被丢弃。
- 同族问题：日志内**个别条目**损坏（如缺 `seq`）时，`parseEvolutionEvents` 的 `isEventRecord` 过滤（`:37-39`、`:51`）在**下一次 append 时静默剥离**该条目再落盘——读取时无声丢弃 + 写入时无声清除，双重偏离 "malformed → refuse（字节不动）" 的 rc.65 门姿态。`evolution-events.spec.ts:23` 的回归测试只钉住了 JSON 语法层损坏（非 JSON 字节），形状层是未测盲区。
- 建议：append 门改用与 `readEvolutionEvents` 相同的判定（`parsed.events` 非数组或存在被过滤条目 → 返回 `current` 拒绝并抛错）；或显式把"条目级自愈"定为设计并同步 `malformed` 语义文档。两处口径必须二选一对齐。

### F-2（P2 · 接口契约违约）`/evolution learn` 注入绕过 `createUserMessage`，消息缺 `role`/`id`，下游按"侥幸路径"工作

- 位置：`packages/evolution-commands/src/index.ts:131-134`——`invocation.agent.inject({ content: […], source: {…} })` 传入**裸对象**。
- 上游契约（0.1.1-rc.2）：`Agent.inject(message: UserMessage)`（`packages/core/agent/src/runtime-types.ts:143`），`UserMessage` 要求 `readonly role: 'user'`（`packages/llm/llm/src/message.ts:141-143`），`createUserMessage` 负责补 `role` 并铸造 `id`（`:188-199`）。
- 下游后果链（逐级核实）：`inject → send → inbox.splice`（`packages/core/agent-loop/src/agent.ts:130-132,113-120`）无校验 → 消息被**原样**作为 `user/message` 事件数据落盘（`agent.ts:283`）→ `deriveEventMessage` 对 `user/message` **原样返回事件数据**作为 transcript 消息（`packages/core/session/src/surface.ts:96-98`）→ DeepSeek 适配器按 `message.role` 分派（`packages/llm/llm-deepseek/src/serialize.ts:246-277`）：`role === undefined` 落入末尾的 user/tool 分支——**默认路由碰巧工作**。
- 风险：①类型契约违约（当前 src 内唯一的裸 inject，同文件族的 review 注入路径用的是 `createUserMessage`）；②跨适配器脆弱——`serialize.ts:117` 的 `message.role !== 'user' && contentHasImage(...)` 对无 role 消息会抛 "cannot represent image content in a undefined message"，任何依赖 role 精确性的适配器/校验（如 `assertSupportedImageRoles`）行为未定义；③缺 `id` 使依赖消息身份的 UI 能力（消息操作、引用锚定）退化。
- 建议：与 review 路径对齐，`import { createUserMessage } from '@deepseek-ai/dsh-llm'` 包一层即可。

### F-3（P3 · 诊断误导）rc.69 锁预算提到 40 后，io.ts 留下两处陈旧的 "10 attempts"

- `io.ts:133`（EPERM 注释 *"The retry budget still fails loud at 10 attempts"*）与 `:151`（fail-loud 错误消息 *"could not acquire write lock … after 10 attempts"*）——循环上界已是 `40`（`:120`）。故障现场按消息排查会得出错误的等待预算。纯文案债，建议随手清。

### F-4（P3 · 边缘残留）空聚合迁移会在日志缺失时**创建空的 events.json**

- `migrateFeedbackEvents` 的 skip 路径返回 `current ?? ''`（`evolution-feedback/src/index.ts:216`）：当聚合为空（`parseAggregate` 对 `{"skills":{},"sessions":{}}` 返回真值，例如全 learn 事件的 v2 缓存）且日志不存在时，transact 以 `''` 为 next → `writeText` 创建一个空文件。幂等、无数据后果（空文件被 rc.69 语义视为 missing），但留下永久垃圾残留且与"skip = 不动文件"的意图相悖。建议 skip 且 `current === null` 时返回 `null`（transact 契约中 null = 不建/删）。

### F-5（P3 · 文档-实现偏差）feedback.json 缓存写未按 006 设计声明走 transact

- `docs/design-review/006-feedback-events-single-source.md` 数据平面表声明 feedback.json *"Uses transact; failure = warn only"*；实现中 `restore()`（`:107`）与 `persistCache()`（`:172`）都是裸 `io.writeText` 整写。后果可自愈（缓存本就"可重建、丢失只付出 O(events) 重折叠"），两个进程竞写最坏得到一个 lastSeq 略旧的合法缓存，`foldWithDelta` 会补齐——**行为安全，但与设计声明不符**。要么补 transact，要么把设计表改为"原子整写（rename），无需 transact（真值派生、非 RMW）"。

### F-6（P3 · 可观测性）/learn 事件 append 失败被完全静默

- `evolution-commands/src/index.ts:142`：`.catch((error) => { void error })`。commands 处理器持有 `ctx.logger`，此处连 warn 都没有——事件日志正是本轮引入的"循环基底"，其写入失败不可见会让"反馈—学习时间线"出现无声空洞（对照：feedback 侧同样静默，但 core 类无 logger 属可接受；commands 侧没有借口）。

### F-7（P3 · 门工程质量）sidecar 清单门的 regex 笔误与已知粒度局限

- `packages/evolution-host/tests/sidecar-inventory.spec.ts:27`：`async function? ${marker}` 中 `?` 量化的是字母 `n`（匹配 "functio"），第一个备选失义；第二/三备选兜底，门仍有效。另外门仍按"文件含 transactIo"判合规——v4 的 K-1（同文件个别调用点逃逸）暴露过该粒度局限，本轮 feedback 的缓存写（F-5）恰好又从这门下溜过：门不检查"RMW 写点数 ≥ transact 调用数"。建议加一条人工核对注释或升级为逐写点断言。

---

## 3. 已记录的取舍（提示，不计缺陷）

- **事件日志无界增长**：`events.json` 每 append 全量重写（O(n) 写放大，累计 O(n²) IO）且每次启动全量解析。`006` 设计文档 §Notes 已明确 *"no consumer needs compaction yet; pagination/size cap deferred"*——是**有记录的决策**而非遗漏。提醒：一旦部署进入高频反馈场景（每次 `record()` + 每次 `/learn` 都触发整文件重写），该文件将同时成为最大 sidecar 与最热写点，建议把"体积阈值 + 归档轮转（cache lastSeq 作锚点）"列入下一个设计评审，而不是等到出现性能事故。

---

## 4. 回归面抽查（历史修复未回退）

| 检查项 | 结果 |
|---|---|
| `session.append('evolution/*')`（第一轮 P0-1） | 生产代码零命中 ✅（rc.45 起保持） |
| `'evolution replay'` 空格命令名（第一轮 P0-2） | 零命中，replay 已并入 `/evolution replay` 子命令 ✅ |
| `saveUsage` 生产调用方（K-1 收敛面） | **零** ✅；剩余 `loadUsage` 三处均为合法读（runCore 快照/scopeView/report） |
| skill-usage `root=''`（第一轮 P0-3） | 已修复（更早批次），本轮抽查未回退 ✅ |
| prompt bundle v7 fail-closed 校验（pinned 常量比对） | `prompts.ts:268` 机制未变 ✅ |
| review 子代理 try/finally dispose（v3 M 项） | `review/index.ts:300-306` 完好 ✅ |
| 发布链：`PLATFORM_VERSION` 单源 + platform-ranges 守卫（rc.56） | 自 rc.66 未触碰 ✅ |
| 上游 `DomainError('missing-key')` 精确捕获（rc.64） | 仅注释标签更名（"v3-round self-check"），逻辑未动 ✅ |
| 本地 vitest 通道 | 本镜像无 node_modules/vitest（测试在 dev 树执行，layout-sync 守卫同步两侧）；本轮新测试以静态审读代替执行：新增 spec 命名与断言目标与修复点一一对应，未见"永远绿"的断言 |

---

## 5. 上游接口增量（0.1.1-rc.2）

- `CommandInvocation.agent`：上游 `packages/interaction/commands/src/index.ts:37-38` 确有 `readonly agent: Agent` ——rc.67 `/learn` 注入依赖的调用面**真实存在**（本地 `CommandInvocation` 接口的 `agent` 字段类型化正确）。
- `Agent.inject` 消息契约：`UserMessage.role` 必填（message.ts:141-143）——**F-2 即对这条契约的违反**。
- `deriveMessages` 投影：`user/message` 数据原样进 transcript（surface.ts:96-98）——F-2 的传导链证据。
- 事件日志/迁移不新增任何上游依赖面（纯 core + IO seam），无新接口风险。

---

## 6. 总体评价与建议

五轮趋势：**39 项（6 P0）→ 7（2 P1）→ 7（1 P1）→ 6（0 P1）→ 7（0 P1，2 P2 + 5 P3）**。rc.67–69 的工作把上一轮指出的"usage 写路径收敛做了一半"彻底收口，并完成了 feedback 持久化的架构级重构（追加事件真值替代聚合快照），设计文档（006）与回归测试纪律保持了一贯水准。本轮全部新发现都来自**新引入的事件日志面自身的口径细节**（损坏容忍、消息契约、诊断文案），不涉及既有架构。

**建议处理顺序**：
1. F-1：append 门与 read 门的"损坏"判定对齐（改动集中在 `appendEvolutionEvent` 一个函数，补形状层回归用例）；
2. F-2：`/learn` 注入包 `createUserMessage`（一行改动 + 断言更新）；
3. F-3/F-4/F-6：文案、空文件残留、失败告警——随手批；
4. F-5/F-7：缓存写 transact 声明对齐与清单门笔误，可与下一批次合并；
5. §3：把事件日志轮转列入下一轮设计评审议程（不急于实现）。

**统计**：本轮新发现 7 项（P2×2、P3×5）+ 1 项已记录取舍提示；v4 遗留 0 项；历史遗留仅 D-8（invariant 模板去重，持续搁置）。五轮累计 66 项发现，全部闭环或显式搁置。
