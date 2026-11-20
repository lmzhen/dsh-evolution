# Aux 后台 review：完成语义与 PTC 适配决策

> 状态：用户决策已实施（2026-11-20）；native/PTC 真机通过，独立复核 P0=0/P1=0；待用户确认版本与发布。
> 范围：`evolution-review` 的 aux 后台 review；实现进入下一次发布，当前未发布。
> 背景：桌面端 aux 仍在运行，但现有成功/失败记录只能证明工具层结果，无法证明 review 在语义上完成了全部技能修改。

## 1. 已确认要做的三件事

### 1.1 达到轮数或时间上限时标记 `partial` / `truncated`

- 当前默认 `reviewMaxRounds = 12`、`reviewTimeoutMs = 120_000`。
- 当前达到轮数上限后循环正常返回，随后只要 `toolAllow` 非空就标 `completed`；从记录上无法区分“真正完成”和“被上限截断”。
- 目标：达到任一上限且最后一轮仍有工具调用时，必须记录为 `partial`（或 `truncated`），不得标 `completed`。
- review 记录至少持久化：`requests`、`toolCalls`、`hitRoundLimit`、`timeout`、`partialReason`。
- UI/活动记录要能看出“未完成/被截断”，而不是只显示成功。

### 1.2 模型最后调用 `review_done` 工具作为完成契约

- 当前完成条件只是“模型某一轮没有发工具调用”或“循环自然结束”，没有显式完成声明。
- 目标：新增一个仅供 aux review 使用的 `review_done` 工具；模型在确认本次 memory/skill 修改完成后显式调用它。
- 只有收到 `review_done` 且没有未完成的工具调用，才能标 `completed`。
- 未收到 `review_done` 就结束：按 `partial`/`failed` 处理，并在记录中说明原因。
- `review_done` 的返回应要求模型给出简短完成说明（例如 memory 是否有写入、技能是否修改、是否有无法完成的项），供活动记录和用户可见摘要使用。

### 1.3 PTC 适配

- 当前 PTC 会话父 header 只暴露 `run_code`；aux 的 `toolAllow` 为空，直接失败：
  `aux review has no allowed tools for this parent (PTC-only header); refusing to report completed`
- 目标：为 aux review 提供 PTC 传输适配，使 PTC 会话也能执行 memory/skill review，而不是空结果或失败。
- 适配实现方式待设计；需要保持父会话 no-append 约束，不能把 review 工具结果写进父会话日志。

## 2. AUX 拆分与并行（必须做）

用户决定（2026-11-20）：

- **AUX 不再禁止 memory 与 skill 两个 review 并行。** 当前“每个 session 只允许一个 aux review，第二个只设 rerun，且 skill 触发时使用 combined prompt”的形态不是长期目标。
- 后台的 memory 与 skill **提示词分开**；两者同时触发时各自独立运行，不再拼成一条 combined prompt。
- 前台 inject 模式保持现状：它发生在同一个父会话/同一条上下文里，顺序或 combined 是合理的；本次不改前台提示词。
- 原因：多会话同时进行时，family 自身的单飞/合并会让一个会话里的 memory/skill 互相等待，放大延迟和截断风险，也让两个提示词互相污染。

实现边界：

- 分析/LLM 调用可以并行；**写入提交仍由 mutation authority / per-file lock 串行**，不能假设并行写是安全的。
- pending/running 状态按 `(session, kind)` 区分，使用独立的 runId / lease；activity 记录也按 kind 分开，便于判断 memory 和 skill 各自的成功/失败。
- 当前 `auxRunning` 是 per-session 的，不是全局锁；但 combined prompt 和 `rerun` 仍是 family 层的串行策略，需要一起移除。
- 并行后仍需保持父会话 no-append，并保留各自的 timeout、cancel、`partial` 和 `review_done` 完成语义。

## 3. 暂缓：多位置修改的完整性校验

用户判断：

- 多位置技能修改先信任大模型的 agent 能力，不在本轮为它增加逐位置校验或结构化检查。
- 等未来获得更丰富的运行信息后，再决定是否增加语义完整性验证。
- 当前不因“可能漏改多个位置”而阻塞上述三项；上述三项先解决“截断被误报成功”和“PTC 不可用”的问题。

## 4. 现状证据（只用于说明问题，不是实现验收）

- 桌面端 `activity.json` 当前保留 200 条：completed 86、failed 113、timeout 1。
- 113 条失败中 112 条是历史 `review requires an idle parent`，发生在 2026-11-17/18；之后未复发。
- 现有成功记录没有 `requests` / `hitRoundLimit` / `partial` 字段；`skill_manage:ok` 的次数也不等于真实文件 mutation 次数，因此“成功”不能作为“所有修改完整完成”的证据。
- 当前代码默认值：`DEFAULT_REVIEW_MAX_ROUNDS = 12`（review 包）、`DEFAULT_REVIEW_TIMEOUT_MS = 120_000`（core）；桌面 profile 只覆盖了两个 cadence interval，未覆盖上限。

## 5. 未来实现的验收口径

1. 构造“最后一轮仍在改技能”的测试：记录必须为 `partial`，不能是 `completed`。
2. 构造“模型没有调用 `review_done` 就结束”的测试：记录必须为 `partial`/`failed`。
3. 构造“调用 `review_done` 且工具调用全部成功”的测试：记录为 `completed`，并包含完成摘要。
4. PTC 会话下：能完成至少一次 memory/skill review；父会话事件序列不增加 review 工具消息。
5. 活动记录和 UI 能区分 `completed` / `partial` / `failed` / `timeout`，并显示 partial/timeout 原因。

## 6. 非目标

- 本轮不实现“多位置修改”的逐项校验或模型自检协议。
- 本轮不改变前台 inject 模式的提示词内容；只处理 aux 的完成语义与 PTC 通道。
- 不把 PTC 的 `run_code` 结果写进父会话日志。


## 7. 综合优化方案（目标形态）

> 详细接口、状态机、PTC child、锁等待与文件级改造面见 [aux-review-redesign.md](aux-review-redesign.md)。

### 7.1 结论

把问题拆成四个正交层，而不是在 `tryAuxReview` 里继续加分支：

1. **触发与调度**：谁到期、memory/skill 是否分别排队、并发上限。
2. **执行与工具通道**：native 直接工具 / PTC `run_code`，两者都通过同一个 review runner。
3. **完成语义**：`completed` / `partial` / `failed` / `timeout` / `aborted`，由 runner 统一判定。
4. **写入与记录**：修改提交串行化，activity/review 记录可审计。

前台 inject 只使用第 1 层的“合并提示词”和第 4 层的记录，不引入后台调度器。

### 7.2 插件侧目标架构

#### A. Review 触发数据

把 `advanceReview` 的返回值从 `memory | skill | combined` 改成“到期集合”：

```ts
interface ReviewDebt {
  memory: boolean
  skill: boolean
  trigger: 'cadence' | 'completion'
}
```

- `inject` 通道保留现状：两者都到期时组合成 combined prompt，一次注入父会话。
- `aux` 通道：memory 和 skill 各自生成独立 task；**不再使用 combined prompt**。
- 计数复位在“成功入队”时执行，而不是在 `advanceReview` 内隐式绑定通道；这样前台/后台的语义不再互相污染。

#### B. ReviewTask 状态机

```ts
type ReviewKind = 'memory' | 'skill'
type ReviewStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'timeout' | 'aborted'

interface ReviewTask {
  id: string
  sessionId: string
  kind: ReviewKind
  trigger: ReviewDebt['trigger']
  toolMode: 'native' | 'ptc'
  status: ReviewStatus
  startedAt: number
  deadlineAt: number
  limits: { maxRounds: number; maxToolCalls: number }
  requests: number
  toolCalls: number
  hitRoundLimit: boolean
  partialReason?: string
  actions: ReviewAction[]
  done: boolean
  result?: ReviewReport
}
```

- 每个 task 使用独立 `runId`（例如 `review:<session>:<kind>:<task>`）。
- 旧 `auxRunning: Map<session, {rerun}>` 删除，改为 `Map<session, Map<kind, ReviewTask>>` 加有界队列。
- 同一 session 的 memory/skill 可以并行；不同 session 也并行，受全局并发上限约束。
- 同一 kind 的重复触发只合并为一次 queued/running，不覆盖另一个 kind。

#### C. 执行器统一

`runReview` 保留为一个执行内核，但接收：

- `ReviewToolTransport`：native 或 PTC；
- `ReviewCompletion`：显式完成协议；
- `ReviewWriteGate`：写入串行化；
- 预算（轮数/时间/工具调用数）。

执行循环：

1. 生成 prompt（memory 或 skill 独立）。
2. 调 LLM；收集 tool calls。
3. 只读工具可并行；**写工具进入 write gate** 串行执行。
4. 每轮结束检查：完成工具是否调用、轮数/时间/调用数是否超限。
5. 收到 `review_done` 且无未完成调用 → `completed`；否则 `partial` / `failed` / `timeout`。

#### D. 完成协议 `review_done`

`review_done` 是 review 专用工具，native 和 PTC 都必须可见：

```ts
review_done({
  summary: string,
  memoryChanged: boolean,
  skillsChanged: string[],
  unresolved: string[],
})
```

规则：

- 模型必须在完成本轮所有修改后显式调用。
- `review_done` 是**终止调用**：必须单独出现在一个 assistant 批次里；runner 执行它后停止本轮，不再请求模型。若同一批还夹带其他工具调用，按 `partial` 记录，不执行后续轮次。
- 未调用就结束：`partial`，`partialReason='missing review_done'`。
- 达到 `maxRounds` 或 deadline 时仍收到工具调用：`partial`，记录 `hitRoundLimit` / `timeout`。
- `unresolved` 非空仍可标 `completed`，但活动记录和 UI 必须显示未解决项；这是给“信任模型 agent 能力”保留的语义出口。
- 不要求按位置逐项校验；多位置修改的完整性仍由模型负责，`review_done` 只要求模型显式声明完成状态。

#### E. 读写分离与并行安全

并行的是**分析/LLM 推理**，不是无约束写入：

- 只读：`read`、`glob`、`grep`、`skill`、`skill_search` 可并行。
- 写入：`skill_manage`、`memory` 通过 `ReviewWriteGate` 进入串行队列。
- `evolutionMutationAuthority` 从“整个 review 一个 lease”改为**写事务 lease**：每次写操作获取资源域（memory / skills / skill:<name>）的租约；review 整体不再长时间占着 lease。
- 现有 per-file skill-store 锁、memory store serial queue 保留作为最后防线；写 gate 负责跨 memory/skill 的顺序和冲突可观测性。
- 任何 task 都不得 append 父 Session；父前缀冻结与 seq 校验保持。

#### F. PTC 工具通道

PTC 不能复用父 agent 执行工具，因为平台 `run_code` 的嵌套 dispatch 会 append 到 `exec.agent.session`（`packages/core/tool-executor-ptc/src/ptc.ts:560,587`），而 review 要求父 Session no-append。

目标 `PtcReviewToolTransport`：

- 为 review 创建一个**独立 review-scoped agent/session**（review 专用 child），父前缀只提供 prompt 快照；
- 把 `run_code` 工具挂在 review child 上执行；PTC 的 `tool/ptc-dispatch*` 只进 child 日志；
- prompt 只暴露 PTC 的真实能力：`run_code` + review SDK；模型用 `await tools.skill_manage(...)` / `await tools.memory(...)` 完成修改，最后 `await tools.review_done(...)`；
- runner 从 `RunCodeOutput.result` 读取结构化 `ReviewReport`，不解析自由文本；
- 父 Session 的 seq 不变，review action 仍写入 activity。
- `review_done` 在 PTC 中既是 SDK 调用，也是 runner 的完成信号；不同 transport 用同一个完成校验。

**若平台暂时没有创建 review-scoped agent 的公开入口**，PTC 适配需要先补一个平台能力（例如受控 `review session` 或子代理工具通道）；不要在插件里用假 parent/session 绕过日志边界。

#### G. 触发器与通道解耦

- `inject`：继续使用父会话注入；memory/skill/combined prompt 保持现状。
- `aux`：使用独立 scheduler；没有 combined prompt；没有 `rerun` 覆盖；memory/skill 各自有 timeout、cancel、activity。
- 业务代码不按平台版本/工具模式分支；工具模式由 adapter 的 `ReviewToolTransport` 决定。

### 7.3 平台侧代码依据

- 无 `aux` 服务：aux 是 family 自己的 review 调度，不是平台模式。
- `LlmRuntime.stream()` 每次调用独立，没有全局队列；并行 LLM 调用在平台原语层可行。
- `executeToolBatch` 支持 `maxParallelToolCalls`，读写并行由 tool 的 `isConcurrencySafe` 决定；但 review 的写安全必须由 `ReviewWriteGate` 和 mutation authority 保证，不能把平台并行当写入安全。
- `Agent.status` 只是 turn 状态；aux 使用冻结父前缀，不依赖状态机做全局互斥。
- PTC `run_code` 的 nested dispatch 会 append 到 `exec.agent.session`；这是 PTC review 必须使用独立 review session 的直接原因。
- `SessionStore.create()` / subagent 类能力可以作为 review-scoped session 的实现路径；具体 API 以平台当前版本为准，但边界是“review 工具日志进 child，不进 parent”。

### 7.4 迁移顺序

1. **先做完成语义**：task 状态机、`review_done`、partial/timeout/round 字段、activity schema v3、native transport。
2. **拆 AUX 调度**：`ReviewDebt` + memory/skill 两个 task + 写 gate；先允许并行分析、写串行，验证同一 session 和跨 session。
3. **PTC transport**：review-scoped child session + run_code SDK + structured report；补父 seq 不变测试。
4. **删除兼容层**：旧 `auxRunning`/`rerun`、AUX combined prompt、旧 activity 读取兜底；保留必要的历史数据只读迁移。

### 7.5 验收重点

- 达到轮数/时间上限且仍有 tool call：`partial`，不能 `completed`。
- 没有 `review_done` 就结束：`partial`。
- `review_done` + 所有工具成功：`completed`，带 round/tool 计数。
- 同一 session 同时触发 memory+skill：两个 task 独立，分析并行、写入串行。
- 两个 session 同时跑 review：互不阻塞。
- PTC：能完成 memory/skill review；父 session seq 不变；嵌套 dispatch 只在 child。
- activity/UI：`completed/partial/failed/timeout` 和 kind 可分；历史 activity 可读。
- 前台 inject：提示词和投递行为不变。

### 7.6 非目标

- 不实现逐位置技能修改校验；由模型 agent 负责，未来有更丰富信息再评估。
- 不改变前台 inject 的 combined 语义。
- 不把 PTC 的 nested dispatch 写进父 Session。
- 不为并行而放弃写安全；分析并行不等于写入并行。

## 8. 多会话同时触发 skill 总结的可靠性补强

§7 的调度骨架加上“模型自己等待锁、重读、重写”的协议，在多会话同进程场景下已经够用；不需要为单轮工具失败做自动 rebase 引擎，也不把 desktop/web 共用 home 当作当前目标。

### 8.1 现有风险

- 不同会话的 review 可以并行分析，但可能选中同一个 skill；一个 task 写入后，另一个 task 的旧读基线会失效。
- 现有 SkillLibrary 有 per-directory 锁、stage-time anchor 和 CAS；冲突会被拒绝而不是静默覆盖。这是最终正确性防线，不需要重写。
- 现有 per-runId lease 只表示“这个 review 正在跑”，不表示“这个 skill 正在被写”；资源互斥应交给已有的 skill-store 锁 + CAS，而不是再加一层重量级协调器。
- desktop 与 web 共用 DSH_HOME 属于当前明确不处理的极端场景；同进程多 session 是当前目标。
- 单轮工具失败本身不是问题；问题是失败信息必须让模型知道“资源被锁、可以等待、解锁后要重读”，而不是一个不可恢复的普通错误。

### 8.2 最小协议

1. **写工具暴露可恢复的锁状态**：
   - 写工具返回结构化 `resource-busy`（带 resource 和 retryAfterMs），或使用现有 HomeFence/skill-store 的阻塞获取；
   - 不把锁冲突压成一个普通 `error`；
   - 最终写入仍走 SkillLibrary 的 anchor+CAS，冲突时返回“内容已变化，请重读后重试”。
2. **`review_wait` 工具**：
   - 模型在收到 `resource-busy` 后调用一次 `review_wait({ resource, timeoutMs })`；
   - wait 在工具侧阻塞到锁释放或自身 deadline，不做模型侧轮询；
   - 返回后模型重新读取目标文件，再生成新的 patch；
   - wait 有上限，不能无限占用 review 的 120 秒总预算。
3. **预算与状态**：
   - wait 是一次工具调用，计入 `toolCalls`；不额外消耗模型轮次（模型在等 tool result，不是在连续请求）；
   - review 仍有轮数/时间上限；等待后仍无法完成则 `partial`，记录 `partialReason='lock-wait-exhausted'`；
   - `review_done` 语义不变：没有显式完成就不算完成。
4. **提示词纪律**：
   - 写前读；收到 resource-busy 后 wait；wait 返回后必须重读，不能拿旧内容再写；
   - 冲突重试只由模型按工具结果决定，不在插件里做隐式自动 rebase；
   - 模型可以选择放弃该写入并调用 `review_done`，在 `unresolved` 中记录。
5. **观测**：
   - activity 记录 wait 次数、等待时长、resource、冲突/重试结果；
   - UI 区分 `completed/partial`，并显示“因锁等待未完成”的原因。

### 8.3 结论

- **够用**：同进程多会话共享 skill 时，只要写工具给出可恢复的 busy 状态、提供有界 `review_wait`、模型等待后重读再写，加上现有 SkillLibrary 的锁 + CAS，就能做到不静默写坏、也不会因为单轮失败直接丢掉总结。
- **不需要**：自动 rebase 引擎、跨进程资源协调器、复杂公平队列，或者为 desktop/web 共用 home 增加大量补丁。调度层一个全局并发上限 + 每会话按 kind 的队列即可。
- **仍需保留**：`partial/truncated`、`review_done`、PTC transport、activity 可观测。这些不是并发补丁，而是完成语义和工具通道的基础。
- 验收增加：两个会话同时改同一 skill（一个成功、一个 wait 后重读重试）、wait 超时→`partial`、多会话不同 skill 并行、锁释放后没有静默覆盖。

