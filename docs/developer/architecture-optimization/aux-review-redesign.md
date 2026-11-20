# Aux Review 目标重构设计

> 状态：已实施（2026-11-20）；native/PTC 真机验收通过，独立复核 P0=0/P1=0；待用户确认版本与发布。
> 范围：`evolution-review` 的 aux 后台 review；前台 inject 保持不变。
> 依据：`docs/developer/architecture-optimization/aux-review-completion.md` 的决策与平台/插件代码现状。
> 目标：一次解决完成语义、memory/skill 拆分并行、PTC 通道、锁等待、多会话并发；不为单轮工具失败做自动 rebase，不为 desktop/web 共用 home 增加跨进程补丁。

## 1. 设计原则

1. **触发、执行、工具通道、记录四层分开**。不再把调度、prompt 选择、LLM 循环、工具 allowlist、lease、activity 都塞在 `tryAuxReview` 里。
2. **一个 review 只做一件事**。AUX 的 memory 与 skill 是两个独立 task，各自有提示词、预算、状态和 activity。
3. **完成是协议**。`review_done` 是唯一完成信号；轮数/时间/等待耗尽必须 `partial`。
4. **分析并行，写入有锁**。LLM 可以并行；写工具遇到 resource-busy 时由模型 `review_wait` 后重读重写。
5. **复用现有正确性防线**。`SkillLibrary` 的 per-directory lock + stage-time anchor + CAS，`MemoryStore` 的 serial/transact，`HomeFence` 都不重写。
6. **工具通道由 adapter 决定**。业务层不按 native/PTC/版本分支；只依赖 `ReviewToolChannel`。
7. **平台没有 aux**。aux 是 family 调度；平台只提供 LLM/tools/session/agent 原语。

## 2. 目标分层

```text
ReviewDebt (core signals)
        │
        ├── inject channel ──► 现有父会话注入（组合提示词，行为不变）
        │
        └── aux scheduler ──► ReviewTask(memory|skill)
                                  │
                                  ▼
                            ReviewRunner
                    ┌────────────┼────────────┐
                    ▼            ▼            ▼
             ReviewModelPort  ReviewToolChannel  ReviewCompletion
                                  │
                         native | ptc
                                  │
                         ReviewWriteGate (lock/wait)
                                  │
                         SkillLibrary CAS / MemoryStore / HomeFence
```

## 3. 触发层

### 3.1 `ReviewDebt`

`packages/evolution-core/src/signals.ts` 的 `advanceReview` 现在直接返回 `memory | skill | combined`，把“前台组合”策略泄漏到所有通道。改为：

```ts
export interface ReviewDebt {
  readonly memory: boolean
  readonly skill: boolean
  readonly trigger: 'cadence' | 'completion'
}
```

`advanceReview` 只计算两个计数器是否到期；`combined` 由通道自己决定：

- `inject`：`memory && skill` → 现有 combined prompt；否则 memory/skill prompt。行为完全不变。
- `aux`：`memory` 和 `skill` 各入一个独立队列；没有 combined。

计数器复位放在调用方成功消费 debt 时，而不是写死在 `advanceReview`；避免“前台注入成功、后台队列未消费”或反之导致计数语义不一致。

### 3.2 触发入口

- `turn/end` 计算 debt → `inject` 或 `scheduler.enqueue`。
- 完成轮（completion channel）只产生 skill debt；不额外产生 memory。
- 显式 `/evolution review [memory|skill|combined]` 仍走前台注入；不进入 AUX 队列。

## 4. 调度层

### 4.1 `ReviewScheduler`

```ts
interface ReviewScheduler {
  enqueue(sessionId: SessionId, kind: ReviewKind, trigger: ReviewDebt['trigger']): void
  cancelSession(sessionId: SessionId): Promise<void>
  dispose(): Promise<void>
}
```

最小规则：

- 每个 `(session, kind)` 最多一个 queued/running task；重复触发合并。
- 同一 session 的 memory/skill 可以并行；不同 session 可以并行。
- 全局并发上限 `maxConcurrentReviews`（默认 2，可配置）；超出时按 FIFO 排队。
- 每 task 的 deadline 从“开始执行”起算，不把排队时间算进 review 的 120s；排队超时单独记录 `queue-timeout`。
- 不做复杂公平调度；只保证单一 session 不会无限插队（队列按 session 轮转）。实现可以是一个 `Map<SessionId, {memory?, skill?}>` + 全局 FIFO；这是最简形态。

### 4.2 `ReviewTask`

```ts
type ReviewTaskStatus =
  | 'queued' | 'running' | 'completed' | 'partial'
  | 'failed' | 'timeout' | 'aborted' | 'queue-timeout'

interface ReviewTask {
  readonly id: string
  readonly sessionId: SessionId
  readonly kind: ReviewKind
  readonly trigger: ReviewDebt['trigger']
  readonly toolMode: 'native' | 'ptc'
  status: ReviewTaskStatus
  queuedAt: number
  startedAt?: number
  deadlineAt?: number
  requests: number
  toolCalls: number
  waitCount: number
  hitRoundLimit: boolean
  partialReason?: string
  actions: ReviewAction[]
  report?: ReviewReport
  error?: string
}
```

- `runId = review:<session>:<kind>:<taskId>`。
- 状态只在 runner 的完成点写入；activity 读取同一 task，不推断。
- 进程重启后 queued/running 不恢复；activity 记录 `interrupted`（与现有 review 状态口径一致）。

## 5. 执行层

### 5.1 `ReviewRunner`

`runReview` 保留为单 task 执行器，但不再持有调度状态、不再决定通道。接口：

```ts
interface ReviewRunner {
  run(task: ReviewTask, context: ReviewRunContext): Promise<ReviewOutcome>
}
```

`ReviewRunContext` 提供：

- `model: ReviewModelPort`（现有 LLM stream 的薄适配；不依赖具体平台类型）
- `toolChannel: ReviewToolChannel`
- `completion: ReviewCompletionPort`
- `limits: { maxRounds; maxToolCalls; deadlineAt }`

循环：

```text
for round in 1..maxRounds:
  if deadline exceeded -> timeout
  messages += prompt/instructions
  stream model -> assistant
  calls = assistant.toolCalls
  if calls empty:
      if no review_done -> partial(missing done)
      break
  partition calls:
      read-only -> execute in parallel
      mutating -> channel.execute with write gate
  if review_done was called:
      if batch had other calls -> partial(mixed done batch)
      finalize report -> completed
  if round == maxRounds and calls non-empty -> partial(round limit)
```

- 只读工具并行；写入走 `ReviewWriteGate`。
- 每次工具结果都进入 messages；模型根据结果决定下一步。
- 完成判定由 runner 写 `ReviewOutcome`，不再由 `tryAuxReview` 事后看 `toolAllow.size`。

### 5.2 `ReviewOutcome`

```ts
interface ReviewOutcome {
  status: 'completed' | 'partial' | 'failed' | 'timeout' | 'aborted'
  report?: ReviewReport
  actions: ReviewAction[]
  requests: number
  toolCalls: number
  waitCount: number
  partialReason?: string
  error?: string
}
```

规则：

- `completed`：唯一条件是有且仅有一个 `review_done` 完成调用，且之前的工具调用没有未处理失败。
- `partial`：无 `review_done`、轮数/时间/toolCalls 用尽、`review_done` 夹带其他调用、锁等待耗尽、模型主动放弃但未调用 done。
- `failed`：模型/工具通道不可恢复错误（不是单次工具失败）。
- `timeout` / `aborted`：deadline / cancellation。
- 单次工具失败记为 action `error`，review 继续；只有完成协议失败才改变 task 状态。

## 6. 完成协议

### 6.1 `review_done` 工具

```ts
review_done({
  summary: string
  memoryChanged: boolean
  skillsChanged: string[]
  unresolved: string[]
})
```

- 只在一个 assistant 批次中单独调用；runner 执行后立即终止 review。
- 结果写入 `ReviewReport`，并映射为 activity 的 `report`。
- native：由 review runner 直接处理，不需要平台全局工具注册；工具 schema 只在本 task 的 model request 中可见。
- PTC：作为 review child 的 review SDK 工具可见；由 child 工具集提供，外部会话不可见。
- `unresolved` 非空仍可 `completed`，但 activity/UI 显示未解决项；不要求逐位置校验。

### 6.2 Prompt

- memory prompt 只要求 durable facts；skill prompt 只要求技能库更新；各自以 `review_done` 结束。
- 不再出现 combined prompt in AUX。
- 前台 inject 的 combined prompt 原样保留；只把生成逻辑从 `reviewPrompt` 的 surface 分支里抽出为 `injectPromptFor(debt)`，避免 AUX 复用。

## 7. 工具通道

### 7.1 契约

```ts
interface ReviewToolChannel {
  readonly mode: 'native' | 'ptc'
  readonly visibleTools: readonly ReviewToolSchema[]
  execute(calls: readonly ReviewToolCall[], context: ReviewToolContext): Promise<readonly ReviewToolOutcome[]>
}
```

- `ReviewToolSchema` / `ReviewToolCall` / `ReviewToolOutcome` 是 contract 自有类型；adapter 做平台类型映射。
- `ReviewToolContext` 包含 parent snapshot、task id、signal、toolMode。
- `ReviewToolChannel` 实现由 `evolution-adapter` 提供；review 业务不 import `@deepseek-ai/dsh-*`。

### 7.2 Native 通道

- 直接从 frozen parent header 取**完整工具 schema**，保持与父请求相同的前缀；runner 再追加 `review_done`/`review_wait`。模型侧不再裁剪 allowlist，避免工具目录提前差异。
- 执行仍走现有 `tools.execute`，agent 使用 review parent proxy；但 channel 在执行前按 allowlist（`skill_manage`、`memory`、`skill`、`skill_search`、`read`、`glob`、`grep`）拦截：未在 allowlist 的调用返回 `isError` tool result，**不会执行**。提示词只作引导，不能当安全边界。
- 写工具返回 `resource-busy` 时，runner 把错误作为 tool result 交给模型，不判 task failed。

### 7.3 PTC 通道

PTC 会话父 header 只有 `run_code`，且 `run_code` 的 nested dispatch 会 append 到 `exec.agent.session`（平台 `ptc.ts:560,587`）。因此：

1. review 创建一个**独立 review child agent/session**；
2. 父前缀只用于构建 prompt 快照；review child 拥有自己的 session/工具事件；
3. model 只看到 `run_code`；
4. prompt 要求用 review SDK：
   ```ts
   const read = await tools.skill({ name })
   const result = await tools.skill_manage({ ... })
   await tools.review_wait({ resource: 'skill:' + name, timeoutMs: 45_000 })
   await tools.review_done({ ... })
   ```
5. `run_code` 的 `RunCodeOutput.result` 必须是结构化 `ReviewReport`（或可解析的 JSON）；runner 从 result 读取 done/report，不解析自由文本；
6. child 的 PTC dispatch 只写 child session，父 session seq 不变。

平台需要提供 **detached review child** 能力；现有 `SubagentActivation` 的 `delivery:'caller'` 仍会让 local child 进入 parent catalog 并可能产生 parent 事件，不能直接复用。需要的边界是：

- child 有独立 Session/Agent；
- 不进父 catalog、不向父 session append；
- 可挂 review 专用 tool set；
- 可取消/超时/销毁。

如果平台短期没有公开入口，PTC 适配应作为独立 platform capability 先补，不在插件里伪造 session。

### 7.4 前缀缓存复用

DeepSeek 的上下文缓存是前缀缓存。结构上 system/message 来自父 `deriveMessages()`，review instruction 追加在末尾；两种通道的 tools 目录不同：

- **PTC**：顶层 tools 只含父 header 的 `run_code`，不插入合成完成工具；并按 PTC 路由回放父 `toolHistory()`。system/父 messages 与父请求一致，只有 review instruction 是追加后缀。
- **native**：`nativeReviewToolChannel` 现在向模型发送父 header 的**完整工具目录**，执行层按 review allowlist 拦截（非 allowlist 返回 `isError`，不执行）；runner 只在末尾追加 `review_done`/`review_wait`。父工具目录保持一致，但合成工具仍是后缀差异；不能用提示词替代执行层限制。
- 2026-11-20 实测（隔离 home，同一 prompt/三文件，`cacheRead/(input+cacheRead+cacheWrite)`，每模式 2 条 review；**这是 native 仍裁剪工具目录时的读数**）：

  | 实际模式 | toolMode | 首条 | 第二条 |
  |---|---|---:|---:|
  | 标准 | native | 0.98 | 0.92 |
  | PTC | ptc | 0.98 | 0.98 |
  | 创造 | native | 0.13 | 0.97 |
  | 极简 | native | 0.00 | 0.98 |

  这说明 PTC 两条都复用良好；native 首条可能是冷缓存（创造/极简），第二条因 review-to-review 前缀而高；标准首条高，不能简单归因为“工具目录一定全部失效”。样本只有每模式 2 条，不能当作稳定结论。**该读数发生在 native 改为全量父工具目录之前；当前实现需要用同样方法重测。**
- 旧 `0.58.0` 的 aux 是 native 且使用父完整 tools + `toolHistory`；desktop activity v2 中 cordis 会话 134 条 review 的平均缓存命中约 **99.65%**，是旧实现基线。
- activity v3 review 已记录可选 `toolMode`（native/ptc）和 `preset`（当前生效的 `agentPreset` 投影，不是创建 header）；尚无按模式聚合的 UI/接口，开发者可按这两个字段聚合缓存。
- 若后续更多样本证明 native 首条持续显著低，正确修法是保留父完整工具目录，把 `review_done` 作为 in-history tool addition 追加在父前缀之后；不要简单恢复未过滤工具而失去审查工具约束。

## 8. 锁与等待

### 8.1 现有基础

- `SkillLibrary`：per-directory 写锁 + stage-time anchor + CAS（`skill-store.ts`）。
- `MemoryStore`：serial queue + transact（`memory-store.ts`）。
- `HomeFence`：home 级 fence；同进程/跨进程最终防线。

不重写这些，只在其上暴露一致的工具结果。

### 8.2 协议

- 写工具被锁住时返回：
  ```ts
  { code: 'resource-busy', resource: 'skill:<name>' | 'memory', retryAfterMs: number }
  ```
- 模型调用 `review_wait({ resource, timeoutMs })`；wait 在工具侧阻塞到释放或超时，不做模型轮询。
- wait 返回后模型必须重新读取目标文件，再生成新 patch；旧的 stage-time anchor 不允许直接重放。
- CAS drift → 工具返回 `content-changed`；模型可重读重试；等待/重试耗尽 → `partial`。
- `review_wait` 计入 `toolCalls`；模型拿到 wait 结果后仍需要一次请求，因此会占用一轮模型调用；用 `maxRounds`/deadline 兜底，wait 自身另有上限，不能无限占用 120s 总预算。
- 不实现自动 rebase；不做跨进程资源协调器；desktop/web 共用 home 不作为当前目标。

### 8.3 多会话

- 不同 session 的 task 可并行。
- 同一 session 的 memory/skill 可并行；各自独立队列/预算。
- 同一 skill 的并发写由 `SkillLibrary` 锁 + CAS 兜底；单轮失败是模型可恢复信息。
- 全局只加一个并发上限（默认 2）和一个简单 FIFO；不做复杂公平调度。

### 8.4 PTC 与 native 共用锁（2026-11-20）

PTC 不是另一套写实现：PTC child 的 `skill_manage`/`memory` 调用走同一 `toolsPort` 和同一 `SkillLibrary`/`MemoryStore` 锁。因此：

- 不需要 PTC 专用写锁或 PTC 专用 CAS；
- 锁的键按资源（skill 目录/ memory），不按 native/PTC 会话；
- PTC program 内多个写仍由同一把锁裁决，冲突返回 `resource-busy`，模型 `review_wait` 后重读重试；
- PTC 专属风险只有两个：`resource-busy` 必须原样穿过 `run_code` 嵌套 dispatch；approval/sandbox 不能持锁等待或把拒绝伪装成成功。这两项是 PTC 执行壳语义，不是并发机制缺口。
- 因此“PTC 双会话同 skill 写冲突”是验收覆盖项，不是架构前置；当前作为 DEFERRED，不阻塞 0.59.0。

## 9. Activity 与 UI

`activity.json` 升到 schema v3，新增 review task 字段：

```ts
interface EvolutionReviewActivityRecordV3 {
  reviewId: string
  taskId: string
  sessionId: string
  kind: 'memory' | 'skill'
  status: 'completed' | 'partial' | 'failed' | 'timeout' | 'aborted' | 'queue-timeout'
  trigger: ...
  requests: number
  toolCalls: number
  waitCount: number
  partialReason?: string
  report?: ReviewReport
  actions: ReviewAction[]
  usage?: ...
  startedAt: number
  finishedAt: number
}
```

- 写入继续走 `evolution-activity` 的 HomeFence/transact；旧记录只读兼容。
- UI 的“技能自动进化”页按 kind 分开展示 memory/skill；`partial` 显示原因和未解决项。
- 不把 `review_done` 的摘要当成功证据；`status` 与 `report` 分列。
- 自动复查区块增加轻量汇总：完成/部分/超时/失败计数、平均轮数、平均工具调用、轮数截断数；最近 8 条每行补 `requests/toolCalls/waitCount/hitRoundLimit`。汇总覆盖 activity 保留的全部 review，不只看最近 8 条。
- 轮数/时间/工具调用上限：`reviewMaxRounds`、`reviewTimeoutMs`、`reviewMaxToolCalls`（默认 12 / 120000 / 50）是部署配置；不新增独立 `truncated` 状态，UI 用 `partial + hitRoundLimit` 标示轮数截断。

## 10. 平台侧改动清单

1. `LlmRuntime.stream()`：已支持独立并发，无需改。
2. `executeToolBatch`：已支持 `maxParallelToolCalls`，无需改。
3. PTC：需要 detached review child/session 能力；`run_code` nested dispatch 写 child session，父 session 不写。
4. `review_done` / `review_wait`：由 review 工具集提供；PTC child 工具集可见，普通会话不可见。
5. `SubagentActivation`：**不**直接用于 review，因为 local child 进父 catalog，违反 no-append；如果以后把它改造成 detached review 通道，再统一。
6. `SessionStore.create`/`Agent`：作为 review child 的实现基础；具体 API 以平台当前版本为准，但必须提供 detached 语义。

## 11. 文件级改造面

- `packages/evolution-core/src/signals.ts`：`ReviewDebt`，`advanceReview` 只返回 debt。
- `packages/evolution-core/src/prompts.ts`：`injectPromptFor(debt)`；memory/skill 独立 prompt；删除 AUX 对 combined 的依赖。
- `packages/evolution-platform-contract/src/review.ts`：`ReviewTask`/`ReviewToolChannel`/`ReviewReport` 类型（如 contract 需要）。
- `packages/evolution-review/src/index.ts`：调度器、task 状态、activity 事件、删除 `auxRunning/rerun`。
- `packages/evolution-review/src/review-executor.ts`：runner 循环、`review_done`、partial/limit、只读/写分区。
- `packages/evolution-review/src/review-tool-channel.ts`：native/PTC 选择与执行编排。
- `packages/evolution-adapter/src/review.ts`：native/PTC 通道实现；PTC child session 创建。
- `packages/evolution-activity/src/index.ts`：schema v3、兼容读取。
- `packages/evolution-ui/src/panels/...`：按 kind/status 展示。
- 测试：`evolution-review/tests`、`evolution-activity/tests`、`evolution-adapter/tests`。

## 12. 迁移顺序

1. 完成语义（partial/timeout/round 字段、`review_done`、activity v3、native runner）。
2. 触发/scheduler 拆分（`ReviewDebt`、memory/skill 独立 task、前台保持组合）。
3. 锁等待（`resource-busy` + `review_wait`；复用 SkillLibrary CAS）。
4. PTC 通道（detached review child + `run_code` + report）。
5. 删除旧 `auxRunning`/`rerun`、AUX combined prompt、旧 activity 字段兜底。

## 13. 验收矩阵

- 轮数耗尽 → `partial`；时间耗尽 → `timeout`/`partial`。
- 无 `review_done` → `partial`。
- `review_done` 单独调用 → `completed`；夹带其他调用 → `partial`。
- 同一 session memory+skill 同时触发 → 两个 task，各自 activity。
- 两个 session 同时改同一 skill → 一个成功，一个 wait/重读/CAS 后成功或明确 partial；无静默覆盖。
- 不同 skill 并发 → 同时完成。
- `review_wait` 超时 → partial + 原因。
- PTC：memory/skill review 可完成；父 session seq 不变；child 有 PTC dispatch。
- 前台 inject：现有 combined 行为不变。
- activity v2 记录可读，v3 记录可分 kind/status。

### 13.1 验收状态（2026-11-20）

| 项 | 状态 | 证据 |
|---|---|---|
| 轮数/时间/无 done/夹带 → partial | 已验收 | `review-executor` 单测 |
| review_done 单独调用 → completed | 已验收 | 单测 + native/PTC 真机 |
| 同 session memory+skill 并行 | 已验收 | PTC 真机启动相差 33 ms，两 task completed |
| 不同 session 并发 | 代码/单测 | limiter + 独立 task；未单独真机计时 |
| 同 skill 两 session 冲突 wait/重读/CAS | 单测 | `ReviewWriteLocks` + executor busy 分支；**未做真实双会话写冲突** |
| 不同 skill 并发 | 单测 | limiter 独立槽；未单独真机计时 |
| review_wait 超时 → partial | 已验收 | 单测 |
| PTC memory/skill completed | 已验收 | 真机 activity v3 + UI 截图 |
| PTC 父 seq 不变 / child dispatch | 已验收（PTC 帧不进父日志；child 已执行 run_code/review_done） | 持久日志无 `ptc-dispatch`；activity actions |
| PTC child cwd/sandbox/approval | 部分 | 真机 read 路径成功说明 cwd 继承；写/审批未单独覆盖 |
| 前台 inject combined | 已验收 | 单测 + 现有行为回归 |
| activity v2 可读 / v3 分 kind/status | 已验收 | activity 24 项 + UI |

## 14. 非目标

- 不做逐位置技能修改校验；信任模型 agent 能力。
- 不做自动 rebase/重放引擎；单轮工具失败由模型 wait/重读处理。
- 不做 desktop/web 共用 home 的跨进程协调。
- 不改变前台 inject 提示词和投递方式。


## 模式能力策略（跨插件，2026-11-20）

这层解决“极简无 skill”与“family 模型面泄漏”的共同根因；它不是 Aux Review 专属逻辑，但 Aux Review 是其中一个消费者。

### 设计原则

1. **preset 是 session 模式**：UI 已经随 session 切换，不需要卸载 UI 面板。
2. **模型工具、命令、后台自动化是三个独立表面**，不能用同一个“插件是否加载”开关粗暴处理。
3. **单一策略源**：由 core runtime 根据当前 `agentPreset` 投影计算 `PresetCapabilities`；工具、命令、后台任务只消费结果，不各自复制 preset 判断。
4. **未知 preset 默认保持 legacy 全量**，只对明确声明的模式收窄；不猜版本、不猜名称。

### 策略表

| preset | 模型工具 | 后台自动任务 | 命令 | UI |
|---|---|---|---|---|
| `minimal` | family tools 全部 deny；仅保留平台工具 | AUX review/curator 自动触发关闭 | family 命令应不可见 | 正常渲染 session UI；family 空态/动作由策略隐藏，不卸载面板 |
| standard / cordis(创造) | native 全量父目录 + 执行 allowlist | 正常 | 正常 | 正常 |
| ptc | PTC child + `run_code` | 正常 | 正常 | 正常 |
| 未知/自定义 | legacy 全量，不主动收窄 | 正常 | 正常 | 正常 |

### 已实现（A1）

- core runtime 监听 `agent/created` / `agent-preset/selected`，读取 `agentPreset` 投影；minimal 时 `tools.restrict({deny})` 隐藏 family tools，切出时 dispose。
- review 在 minimal 直接跳过，且先释放 kind 状态，不产生 activity。
- 极简真机请求头已从 8 个工具降为 `pwsh/read_image/working_directory`。

### 命令面缺口与正确方案

平台命令注册是 `ScopedLayers`：profile-root 命令对所有 agent 可见；当前 `CommandRuntime.list(agent)` 只有视图，没有类似 `tools.restrict()` 的 allow/deny API。  
因此 family 命令（`/evolution` 等）在 minimal 目前仍会被列出。正确方案不是每个 handler 里判断 preset（仍可见、仍可执行一半），而是：

1. **平台增加 `commands.restrict({allow?, deny?})`**，作用域与 `tools.restrict` 同构：
   - 存在 scoped command layer；
   - `list(agent)` 与 dispatch 用同一个过滤视图；
   - 返回 exact disposer；
   - 未知名称 fail-closed。
2. family runtime 的 minimal policy 调用 `commands.restrict({deny: FAMILY_COMMANDS})`，与 tools 的 guard 共用同一 preset 状态。
3. 若平台短期不加，退化为“命令 handler 返回 policy 错误”仍不满足“不可见”，只能作为过渡，不应作为最终架构。

### 后台任务面

- AUX review 已消费 policy；curator/其他 turn-end 自动任务也必须走同一 `PresetCapabilities`，不能各自判断。
- policy 只在 `agentPreset` 投影变化时变更；任务启动时再检查一次，避免 preset 切换后旧任务继续写入。
- 任务取消/排队中策略变化：新任务拒绝入队；已运行任务按其启动时 policy + abort 处理，不静默继续。

### 生命周期与鲁棒性

- guard 必须覆盖：创建时即 minimal、空白 session 切换、切回 full、agent disposed、插件热载时已有 agent 扫描。
- `tools.restrict`/`commands.restrict` 失败不得否决 agent 创建；记录 warn 并重试下一次 sync。
- policy 结果应可观测（doctor/日志），但缓存命中率等成本指标不进用户 UI。

### 验收

- minimal：请求头无 family tools；family 命令不可见/不可调用；无 AUX activity；平台工具保留。
- standard/创造/PTC：工具、命令、AUX 与当前实现一致；不因 minimal guard 误伤。
- 切换：minimal↔standard 双向切换后工具/命令恢复正确，无 restriction 泄漏。
- 未知 preset：legacy 行为不变。

## 15. 实施状态

### Round 1（2026-11-20）

- A/B：`ReviewExecutionResult` 增加 `done`/`hitRoundLimit`/`report`/`partialReason`；`runReview` 注入 `review_done` 合成 schema，未调用、夹带其他调用、轮数耗尽都返回 partial/原因；`tryAuxReview` 不再只看 `toolAllow.size` 标 completed，并把 `requests`/`toolCalls`/`partialReason` 写入 `evolution/review-completed` 与 activity record。
- C：`advanceReview` 返回 `ReviewDebt`（memory/skill 布尔）；前台用 `injectKind` 保持 combined 行为；AUX 用 `scheduleAuxDebt` 生成独立 memory/skill task；`reviewPrompt(kind,'aux')` 不再返回 combined；`auxRunning` 改为嵌套 map，lease runId 带 kind，两个 kind 可并行；`pendingCadenceReviews` 存 debt。
- 测试：`review-executor.spec.ts` 新增 4 例（review_done 完成、缺 done partial、轮数上限 partial、done 夹带调用 partial）；`signals.spec.ts` 覆盖双 debt；`prompts.spec.ts` 更新 aux 映射。当前 `evolution-review` 47 项、core signals/prompts 相关测试本地通过。
- 未完成：PTC `ReviewToolChannel`、detached review child、`review_wait`/resource-busy、activity 字段的 UI 展示、真实宿主并行与 PTC 验收；`review_done` 在 PTC 中的 SDK 暴露仍需平台能力。

### 下一轮

1. 抽出 `ReviewToolChannel` 与 native 实现，保持现有行为；补 native 通道测试。
2. 设计并实现 `review_wait`/resource-busy（先 native；复用 SkillLibrary/HomeFence）。
3. activity v3 + UI 状态分离；旧 v2 只读。
4. PTC detached review child（平台能力确认后）。


### Round 2（2026-11-20）

- activity 升到 v3：review record 增加 `taskId`、`requests`、`toolCalls`、`waitCount`、`partialReason`；`evolution-review` 的 aux event 写 `taskId`。旧 v2 bytes 仍按既有 foreign/legacy 规则可读，写入统一 v3。
- 同一边界多次触发时 `pendingCadenceReviews` 用 `mergeDebt` 合并 memory/skill，不覆盖另一域。
- 未完成仍是 PTC 工具通道、detached review child、`review_wait`/resource-busy、UI 展示与真实 PTC/多会话验收。


### Round 3（2026-11-20）

- 新增 `packages/evolution-review/src/review-tool-channel.ts`：`ReviewToolChannel` 边界与 native 实现；`runReview` 优先使用 channel 的 visibleTools/execute，未提供 channel 时保留旧 header/tools 路径；`review_done` 仍由 runner 注入。native channel 测试通过（8 项 executor 测试）。
- PTC 阻塞事实：平台 `SubagentActivation` 的 local child 会进入 parent catalog；`ctx.agents.create` 存在但需要 setup/seed 且没有现成的“review child 不向父 Session/catalog 发布”的公开语义。当前不伪造 session，PTC channel 暂不实现；先把平台 detached review child 作为前置能力登记。
- `review_wait`/resource-busy 仍需在 native 工具结果上落地；当前 SkillLibrary 锁/CAS 作为最终防线保留。


### Round 4（2026-11-20）

- `review_wait` 已作为 review 专用合成工具接入 runner：模型可单独调用，工具侧 bounded sleep（1ms–60s），计入 `toolCalls`/`waitCount`，不改变父 Session；`review_wait` 夹带其他调用会 partial。
- 当前 wait 还是**有界等待**，尚未把 SkillLibrary/HomeFence 的锁状态映射成 `resource-busy`；真正的“等待锁释放”仍依赖现有写工具自身阻塞 + CAS。该差距保留在台账，不把 bounded sleep 当完整锁协议。
- `waitCount` 已写入 `ReviewExecutionResult`、event 与 activity v3；UI 展示仍未完成。
- PTC channel 仍因平台 detached review child 能力未实现而阻塞。


### Round 5（2026-11-20）

- 新增 `ReviewWriteLocks`：按 `skill:<name>` / `memory:<target>` 做进程内可恢复锁；review 之间同资源冲突时，runner 不再执行后一个写调用，而是返回 `resource-busy` 工具结果；`review_wait` 可等待 holder 释放。锁只在 review task 的写调用期间持有，最终正确性仍由 SkillLibrary 锁 + CAS 兜底。
- 该锁是进程内、只覆盖 review task，不覆盖前台写或其他进程；这是 §8 已确认的范围。
- 新增 `review-write-locks.spec.ts`（释放唤醒、超时）与 runner busy 分支代码；当前仍未做同资源真实双 task 的宿主验收。


### Round 6（2026-11-20）

- 完成语义补齐 `maxToolCalls`（默认 50）：达到上限且尚未 review_done 时返回 `partial`，原因写入 event/activity；新增 runner 单测。
- 当前仍有 `maxRounds` / `deadline` / `maxToolCalls` 三条预算；都不允许把截断标 completed。


### Round 7（2026-11-20）

- `ReviewWriteLocks` 增加 `dispose()`：插件 unload 时清空 holder 并唤醒等待者；cleanup 调用它，避免 HMR/卸载后 waiter 永久悬挂。新增 dispose 测试。


### Round 8（2026-11-20）

- PTC detached-child 原型验证：用公开 `Session.create` 建一个真实但未注册的 review child Session，并把父 agent 的 session 代理成 child，PTC `run_code` 的 `tool/ptc-dispatch*` 只写入 child；实测父 Session seq 保持 0、child seq 增长。该原型证明无需伪造 session，也无需 `SubagentActivation`（不会进 parent catalog）。
- 仍缺：把该原型产品化到 adapter 的 review-child port、在 child 上提供 review 工具集（含 review_done/review_wait）、从 `RunCodeOutput.result` 取 ReviewReport；当前未把它接到真实 AUX，避免半成品。


### Round 9（2026-11-20）

- adapter 新增 `createReviewChildAgent`（`@deepseek-ai/dsh-evolution-adapter/review-child`）：用真实 `Session.create` 建 detached child，Proxy 只替换 `agent.session`，其余属性和方法保持父 agent 绑定；附单测验证父 Session seq 不变、child 为独立 Session。
- 该 helper 是 PTC child 的产品化基础；尚未接到 PTC channel。


### Round 10（2026-11-20）

- PTC channel 已接到 AUX：检测 `run_code`-only parent，用 adapter 的 `createReviewChildAgent` 建 detached child，`run_code` 通过 child agent 执行；review_done/review_wait 只在 channel execute 期间、匹配 reviewId 的 review context 内注册，parent 模型不可见，parent Session 不落 PTC dispatch。
- `ReviewToolChannel` 增加 `instruction`/`completion()`；runner 支持 channel 报告的完成。新增 `review-ptc-channel.spec.ts`，验证工具注册只在 execute 期间存在、review_done 产生 completion。
- 仍缺真实 PTC 宿主端到端：run_code 内 `tools.review_done` 的实际嵌套工具可见性、父 Session seq 不变、child 有 PTC dispatch、真实 skill/memory review。


### Round 11（2026-11-20）

- PTC channel 的 review_done/review_wait 注册从“每次 execute 内临时注册”改为“channel 构造时注册、execute 期间用 active+reviewId 守卫”；原因是 PTC 外层步骤的工具集在 run_code 执行前已解析，execute 内新注册的工具不会进入该次 schema。
- 真实 PTC 嵌套测试仍未通过：临时复现得到 `unknown tool "review_done"`；说明外层 toolSet 解析仍未包含后注册工具，或 `when` 守卫在嵌套解析时未按预期生效。当前 PTC 注册方案**尚未完成真实验收**，不能宣称 PTC review 可用。
- 下一步需从 PTC `tools.schemas(agent, toolSet)` 的解析时机/作用域入手，可能改为在 review child 的 scoped context 注册工具，而不是全局 root 注册。


### Round 12（2026-11-20）

- PTC `unknown tool review_done` 根因定位：review channel 自己注册工具后，PTC 外层 `run_code` 的 `exec.toolSet` 已经在步骤准备时解析完成；仅在注册表里新增工具不会进入该次 toolSet。
- 修复：`ToolsPort.resolve`（adapter 转发 `tools.resolve`）；PTC channel execute 在 active 期间先 `resolve({agent: child, signal})`，把解析出的 toolSet 显式传给 `tools.execute`。
- 真实 PTC runtime 单测（临时 harness 验证，不入发布测试）已通过：
  - `run_code` 内 `tools.review_done` 可见并执行；
  - completion 返回 `{done:true, report}`；
  - parent Session seq 保持 0；
  - child Session seq 增长。
- 正式 review/adapter 测试 33 passed，构建 0 error；真实 AUX PTC 仍需接入宿主会话验收。


### Round 13（2026-11-20）

- activity → UI 读数已接通：stats 快照新增 `global.reviews`（reviewId/kind/status/startedAt/finishedAt/partialReason），host 直接读 `activity.json` 并校验；client `parseSkillStats` 容错解析。
- StatsPage 新增“最近自动复查”区块：memory/skill 分开、completed/partial/failed/timeout/aborted 分色；partial 显示原因；空态单独展示；i18n 已按 8 locale 写入 catalog 并生成。
- 测试：history-routes 5 项、history-panel 12 项、stats-page-layout 4 项通过；client 构建通过。


### Round 14（2026-11-20）

- review event/activity 补齐 `hitRoundLimit` 与结构化 `report`（summary/memoryChanged/skillsChanged/unresolved）；A/F 的“记录完整完成读数”不再依赖 summary 文本。
- activity v3 测试覆盖 hitRoundLimit/report；review 11 项 + activity 23 项通过，构建 0 error。


### Round 15（2026-11-20）

- AUX 全局并发有界：新增 `ReviewLimiter(4)`，每个插件实例一个 FIFO 信号量；review 在首个模型请求前取槽，超时/卸载可中止排队；cleanup 时 `dispose()` 唤醒等待者。无 per-session/weight 公平调度，符合 C 的范围。
- 新增 limiter 单测（槽位移交、排队中止）；接入 `tryAuxReview`。


### Round 16（2026-11-20）

- UI 回归测试补齐：`stats-page-layout.client.spec.ts` 覆盖 review 区块的 kind/status/partialReason 渲染；history-panel/stats-layout 均通过。
- 本地门禁扫描：gate-01/02/06/08–12/17/19–22/24–28/30–46 等通过；gate-05（smoke-built-entries）与 gate-29（write inventory）因本机没有默认平台 scope/profile home 为 `cannot-decide`，不是代码失败；gate-46 初次因新增 review specs 的 taxonomy 过期失败，已运行生成器刷新 `packages/scripts/reports/check-taxonomy.json` 并复跑通过。
- 仍未开始最终 pre-tag/CI 与独立复核。


### Round 17（2026-11-20）

- PTC review 工具改为**每插件实例注册一次**的 `PtcReviewToolHost`：`review_done`/`review_wait` 用 active+reviewId 守卫，handlers 从 `currentReviewContext` 查 control；支持多个 PTC review 并行，不再每个 task 重复注册同名工具。
- channel 只在 host 上打开/关闭 task 的 active 窗口；老的单 channel 构造器移除。
- review + adapter 35 项通过，构建 0 error；真实 PTC runtime 验证仍以之前 run_code 复现为准（host 重构后未重新跑临时 live test，列为待复验）。


### Round 18（2026-11-20）

- 全量本地 gates 最终读数：pass=58 fail=0 cannotDecide=3（gate-05 平台 scope、gate-29 profile home、gate-81 health corpora），skipped=1（gate-75 CI layout）。之前 gate-46 taxonomy 失败已修复。
- PTC review 工具改为每插件一次注册的 `PtcReviewToolHost`，避免同一进程中多个 PTC review 并发时重复注册 `review_done`/`review_wait`；task 通过 active+reviewId 守卫。
- post-refactor 重跑 gate-01/02/17/30/46/82 全部通过；review+adapter 35 项通过；构建 0 error。
- 仍缺真实宿主验收与独立复核。


### Round 19（2026-11-20）

- 独立复核（HEAD cf5964cd）给出 P0/P1：native aux 用冻结伪 Session 执行工具会导致真机受控工具全部抛错；PTC 被 allowlist 过滤且合成 review_done 绕过 child；PTC resolve 缺 modelSelection；AUX 计数消费后未复位；taskId/partialReason 未落 event/UI；no-op prompt 与 review_done 冲突。
- 已修：native channel 工具执行改用真实 parent agent；runner 对 PTC 只允许 channel.visibleTools（run_code），不给 PTC 模型合成 review_done/wait，完成只认 channel completion；PTC resolve 传 modelSelection；AUX 消费 debt 后复位对应 counters；event 写 taskId/partialReason；UI/activity 展示 report/unresolved；activity 旧版本（v2）按 readable 原地升级而不是 quarantine；aux/PTC 提示明确 no-op 也必须 review_done。
- 新增/调整测试：native channel execution agent、PTC run_code 经 runner、v2 升级可读；review+adapter+activity+UI 75 项通过，构建 0 error。
- 复核 P2 仍列出：queue-timeout/可配置并发、PTC 写锁门禁、wait 语义/文案、report 体积上限、auxRunning 同 kind 竞态、真机 PTC/ALS/child 策略未验证。独立复核结论：修完 P0/P1 仍需真机 cohort 验收，不能直接发布。


### Round 20（2026-11-20，第二轮独立复核后）

- 复核结论：P0=0；上一轮 6 条 P1 在代码层已修；新增 P1-A：PTC `run_code` 程序 SDK 会拿到父 preset 全量工具集。
- 已修 P1-A：`PtcReviewToolHost` 对 `tools.resolve` 的 toolSet 做 allowlist 过滤，PTC 程序只看到 `run_code` + review allowlist（`skill_manage/memory/skill/skill_search/read/glob/grep/review_wait/review_done`）；新增单测断言 forbidden `bash`/`skill_manage` 被过滤。
- 修复 `auxRunning` sticky 泄漏：preflight 早退和 lease 失败路径现在都 `releaseKind()`。
- timeout 也写 `partialReason`（`review-timeout`），UI 可显示原因。
- 未修 P2：queue-timeout/可配置并发、PTC 嵌套写门禁/actions 计数、wait abort 语义、report 体积进一步压缩、真机 PTC/ALS/child 策略、inject latest-kind 语义、seq 空转、文档/测试生产路径缺口。
- 当前 review/activity/UI 69 项通过，构建 0 error；真实宿主 cohort 验收仍未做。


### Round 21（2026-11-20，第三轮独立复核后）

- 第三轮复核结论：P0=0，P1=0（代码层）；P1-A 能力面已归零（PTC SDK 仅 review allowlist），残余为 P2 审计/写门禁。
- 进一步 fail-closed：`tools.resolve` 缺失时 PTC review 直接报错，不再回落到父 scope 全量工具；`filterToolSet` 对非 Map view 返回空 Map；保留底层 `dispose`；测试改为断言 allowed 的 `skill_manage/review_done` 保留、`bash` 被删。
- PTC setup（child/host/channel 构造）失败时释放 auxRunning/定时器/lease，避免 sticky；timeout 原因固定写 `review-timeout`。
- 仍为 P2：PTC 嵌套写门禁/actions、queue-timeout/可配置并发、wait abort 语义、inject latest-kind、seq 空转、真机 PTC/ALS/child 策略；真实宿主 cohort 验收仍未执行。


### Round 22（2026-11-20）

- 真实宿主 UI smoke：用平台 rc.5 checkout 起独立 profile（auxlab2，端口 3124），手动装入 0.58.0-dev.3 家族 tar 包，API 401 用启动输出的 token 进入 web UI；侧栏“技能整理 → 数据总览”实际渲染出新的“自动复查 / 最近一次复查结果”区块（空态“暂无复查记录”），证明 UI/activity 读数已接到真实宿主。
- 该测试 profile 没有模型 API Key，因此只验证 UI 装载与区块渲染，没有触发真实 AUX review；真实 memory/skill/PTC cohort 验收仍未完成。
- 测试 profile 与 Chrome 临时目录已清理。


### Round 23（2026-11-20）

- 修复复核 P2-7：inject 恢复 v0.58 latest-trigger-wins（只在 AUX 用 mergeDebt）；`ReviewLimiter` 默认值从 4 改成设计口径 2。
- review 35 项通过，构建 0 error。


### Round 24（2026-11-20，真实宿主 native 验收）

- 在隔离 home + rc.5 host + 0.58.0-dev.5 家族上完成真实 native AUX：一次普通会话（3 个 read）触发 cadence，memory 与 skill 两个独立 task 均以 `completed` 结束；activity v3 记录 requests/toolCalls/report/kind/status，UI 数据总览显示“已完成（记忆/技能）”。memories/MEMORY.md 实际落盘。
- 发现并修复真实宿主上的关键缺口：aux LLM 请求带了父 session 的 `toolHistory`，平台 `projectToolUpdates` 会按历史声明重建 tools，导致合成 `review_done` 不在模型工具表中（模型明确报告“工具集中没有 review_done”，两轮 review 均为 partial）。修复：aux 请求不再传 `toolHistory`，显式工具表原样发出；新增单测断言 aux 请求 tools 含 `review_done`。
- 真实宿主 UI 截图（截图路径 `D:/dsh/_e2e-ui-review.png`）显示 completed memory/skill 与旧 partial（missing review_done）并存，证明兼容与可观测性。
- 仍未做：PTC 真机会话（本次 UI 里误在标准模式发了第三轮，未切到 PTC）；AUX 并行/同 skill 冲突/计数复位/父 seq 的逐项真机断言；最终 pre-tag/CI。


### Round 25（2026-11-20，真实宿主 PTC 验收）

- 真实 native 验收完成：隔离 home + rc.5 host + dev5 家族，普通会话触发 memory/skill 两个独立 task，均 `completed`；`memories/MEMORY.md` 实际写入；activity v3 有 requests/toolCalls/report/kind/status；UI 数据总览显示“已完成 记忆/技能”，旧 partial 与 `missing review_done` 原因并存。
- 真实 PTC 验收未通过：UI 切到 PTC 模式后触发 AUX，`run_code` 调用返回 `unknown tool "run_code"`，review 只能 partial(missing review_done)。尝试过：detached Session.create（错误 `session is not live in this store`）→ 改为 live SessionStore child；随后过滤 toolSet（Map 迭代）仍未解决。
- 结论：PTC 真实宿主仍是发布阻断项；native/default 路径已真机通过。下一步需从 PTC 模式下 child agent 的 scope/toolSet/run_code registration 入手，而不是继续堆 fake 测试。


### Round 26（2026-11-20，PTC 真机根因与 native 验收）

- PTC 真机 `unknown tool "run_code"` 根因定位：`ToolRuntime.execute` 用 `selectExecutor(input.agent)`，而 `scoped.executor` 是以**父 Agent 对象身份**为 key 注册的；review child 是用 Proxy 只替换 session 的**另一个对象**，不等于父 Agent，因此选择器退回 root native executor，`run_code` 在 native registry 中不存在。`makeSessionLive`、toolSet allowlist、review_done 注册都无法改变这一对象身份不匹配。
- 结论：PTC review 需要平台级 **detached review Agent（真实 Agent/scope/executor，不是只换 session 的 Proxy）**，或平台提供“用父 scope executor + child session”执行入口；当前 rc.5 没有该公开入口。不能靠 family 侧补丁伪造 Agent，否则会绕过平台 scope/executor 与 approval/workingDirectory 语义。
- native 真机已通过（见 Round 24）：memory/skill 两 task completed、memory 落盘、activity v3、UI 完成/部分并存；aux LLM 请求不传 toolHistory 后才看到合成 review_done。
- 当前发布结论：native/default 可进入最终验收；PTC 仍为平台能力阻断，除非用户确认接受“PTC review 不可用”或先补平台 detached review Agent 能力。


### Round 27（2026-11-20，平台侧替代做法）

- 从平台源码找到替代原 Proxy-child 的做法：`@deepseek-ai/dsh-scope` 的 `createScope(ctx, key, { parent })` 可以为“与平台 Agent 同对象的 scope key”创建真实 scoped context。平台 PTC 测试正是用 `createScope(inner, agent)` + scoped `setExecutor` 选择 PTC。
- adapter `createReviewChildAgent` 现改为：child Session 用 SessionStore live create；child Agent 用 `Object.create(parent)` 且以该对象自身为 scope key；`createScope(parentCtx, childAgent, {parent: parentAgent})` 后把 `ctx` 设为 scoped ctx；PTC 模式下在 scoped ctx 动态挂载 `@deepseek-ai/dsh-tool-executor-ptc`。这样 `selectExecutor(childAgent)` 能命中 child scope 的 PTC executor，而不再是 root native executor。
- 该做法仍未在真实 PTC host 复验：本轮重建 e2e host 时模型凭据不可用，PTC 会话未成功发请求；已确认 adapter/review 构建通过、adapter 单测通过。下一步必须在可用模型凭据的宿主上验证 `run_code` 选择、child dispatch、父 seq 不变。

### Round 28（2026-11-20，平台 scope 方案单测验证）

- 在真实 PTC 执行栈的临时 harness 中验证 adopted child scope：
  - `ctx.tools.execute({ agent: childAgent, name: 'run_code' })` 命中 child scope 的 PTC executor；
  - `run_code` 内 `tools.echo` 成功；
  - 父 Session seq 保持 0；
  - child Session seq > 0。
- 这证明 `createScope + scoped PtcToolExecutor + Object.create(parent)` 的路径正确，解决了 Proxy child 的 executor-identity 问题；当前只差接入真实 AUX PTC 会话并验证 review_done/child dispatch/父 seq，和可用模型凭据下的宿主复验。


### Round 29（2026-11-20，PTC review_done 全链路单测）

- 在真实 PTC 执行栈临时 harness 中跑通完整 child-scope PTC AUX 路径：
  - `createReviewChildAgent(...,{ptc:true})` 创建 live child + child scope；
  - scoped `@deepseek-ai/dsh-tool-executor-ptc` 被 `tools.execute` 选中；
  - `run_code` 内调用 `tools.review_done` 成功；
  - `channel.completion()` 返回结构化 report；
  - 父 Session seq 保持 0，child seq > 0。
- 这同时验证了 review_done 在 PTC 嵌套工具中可达，不再只是 echo 探针。
- 测试为临时 harness，未入库（依赖平台 PTC 测试栈）；代码路径已在 adapter/review 构建与单测中通过。剩余是真实 AUX PTC 宿主复验。

### Round 30（2026-11-20，PTC 可选平台能力边界）

- 结论：`@deepseek-ai/dsh-tool-executor-ptc` 不由 family manifest 声明。平台 base bundle 内含该包，但 base/minimal 的 executor row 默认 `disabled: true`，PTC preset 才启用；因此它是“默认发行、按 preset 启用”的可选能力，不是 family 依赖。
- adapter 新增 `PtcExecutorUnavailableError` 与 `loadPtcExecutor()`：只在 PTC 模式动态 import，检查 `apply`/`inject` shape，缺失或不兼容抛 `PTC_UNAVAILABLE`，不读版本号、不猜测平台版本；adapter 单测覆盖无 scoped parent 的 fail-closed。
- 该选择保持 cohort/envelope 声明不变，代价是 PTC 集成属于平台内部 seam，必须在每个 cohort 的 PTC 真机验收覆盖；平台若提供稳定 PTC capability 再替换。

### Round 31（2026-11-20，真实 PTC AUX 通过）

- 在隔离 home + rc.5 host + dev9 家族包上，真实 PTC 会话触发 AUX，memory 与 skill 两个 task 均 `completed`：
  - memory：requests=3、toolCalls=3、report 完整；
  - skill：requests=4、toolCalls=4、report 完整；
  - `run_code` 在 PTC 内实际执行；`review_done` 返回 `ok:true`。
- 父 Session 的持久日志中没有任何 `tool/ptc-dispatch*` / `review-child` 帧；PTC dispatch 只进 child Session，父 Session seq 未被 PTC 写入。
- 修复：PTC 嵌套执行跨 async 边界后 `currentReviewContext()` 可能不可见，`review_done` 曾返回 `ok:false`。现在 `controlFor` 在 ALS 缺失时按 child Session id 中的 taskId 解析 control；同时 PTC `review_done` 参数 schema 把 `memoryChanged/skillsChanged/unresolved` 改为必填，避免模型省略字段导致 report 解析失败。
- 真实 UI 截图（`D:/dsh/_e2e2-ptc-ui.png`）：自动复查显示 PTC memory/skill 均“已完成”，并与旧 `review-timeout` / `missing review_done` 记录并存，证明 v3 兼容和状态区分。
- 并行证据：同一 session 的 memory/skill 分别在 `1795137247750` / `1795137247783` 开始（相差 33 ms），均成功结束，说明拆分后的两个 AUX task 可并行且不互相阻塞。
- 仍未做：PTC 同 skill 冲突（真实宿主）、真实 UI 的 failed 新记录、最终 pre-tag/CI 与独立复核。

### Round 32（2026-11-20，独立复核与 P1 生命周期修复）

- 独立复核结论：**P0=0，P1=1**。P1 是 PTC setup 失败/成功路径的 child Session 与 scope 生命周期：旧实现先 `sessions.create` 建 live Session，再创建 scope/加载 PTC；若加载失败，函数未返回，调用方拿不到 child 去 dispose，会泄漏 live Session 与 Cordis fiber；成功路径的 `dispose()` 也只销毁 scope，不释放 child Session。
- 修复：
  - child Session 改由 child scope 内的 capture plugin 通过 `inject:['sessions']` 创建，Session effect 归 child scope 所有；成功 `dispose()` 或失败 `catch` 都通过 `scope.dispose()` 一并回收。
  - `createReviewChildAgent` 的 catch 现在 `await scope?.dispose()` 后重抛；调用方无需拿到 child 才能清理。
  - 新增 adapter 单测：child Session 在 `dispose()` 后从 `ctx.sessions` 消失，父 seq 保持 0。
  - `index.ts` 的 `reviewChild.dispose()` 改为 best-effort，dispose 失败不再阻断 lease release/rerun。
  - PTC control 匹配从子串改为 `review-child:<taskId>:` 前缀，降低误配。
- 复核 P2 剩余：PTC `review_done` 的“program 内唯一动作”仍未强校验；control 无负向误配测试（已收紧前缀）；这些不阻塞 native/default，但 PTC 发布说明应保留边界。
- 复验：adapter 4 + PTC channel 2 + executor 13 = 19 passed；临时真实 PTC 栈 1 项全流程（run_code → review_done → completion → dispose 后 child 消失、父 seq 0）通过。

### Round 33（2026-11-20，独立复核最终结论）

- 第二次独立复核在生命周期修复上发现一个新的 P1 回归：`index.ts` 仍把已带 `aux-` 前缀的 `reviewId` 再拼一次，child Session id 变成 `review-child:aux-aux-<uuid>:N`，与 `controlFor` 的 `review-child:<reviewId>:` 前缀不匹配；真实 PTC 在 ALS 丢失时 `review_done` 会再次 `ok:false`。
- 修复：`createReviewChildAgent(agent, reviewId, …)` 直接传 `reviewId`；测试改用生产形状 `review-child:aux-review-2:0` + key `aux-review-2`；adapter 断言 sanitize 后的 child id 前缀。
- 复核复验：**P0=0，P1=0**。原生命周期 P1 已关闭；新前缀回归已关闭。
- 仍保留 P2（不阻塞）：PTC `review_done` 的 program 内唯一动作未强校验；跨包 id 不变量测试可再从 adapter 输出派生；无 sessions 有 plugin 的 mock ctx 泄漏（真实 Cordis 不可达）；`inject:['sessions']` 缺失时可能等待而非 fail-closed。

### Round 34（2026-11-20，本地门禁复核）

- 本地 `run-gates.mjs local --lane ci-static --concurrency 4` 在最终 HEAD 上：pass=57、fail=0、cannotDecide=1（gate-29 只因 `<plane home>` 占位参数无法解析）、skipped=1（gate-75 的 CI workspace 相对路径）。
- gate-29 单独用真实 home 复跑：`verify-write-inventory ... --home D:\dsh-homes\web` exit 0（34 sites / 6 symbols / 33 paths）。
- 因此本地静态门禁实际无 fail；CI 形态应由 action 注入 `$RUNNER_TEMP/plane-home`。尚未执行 pre-tag/CI 与真实发布。

### Round 35（2026-11-20，剩余项台账收口）

- 设计文档状态从“设计稿”改为“已实施”，完成语义/PTC/并行/UI 的验收状态见 §13.1。
- 明确仍保留、未在本轮关闭的项：
  1. **真实双会话同 skill 写冲突**：已有 `ReviewWriteLocks`/busy/wait 单测，未在真实宿主制造两个并发写并观察 wait→重读→CAS。
  2. **PTC child 的写路径 sandbox/approval**：真机 read 路径成功，cwd 继承已间接验证；写/审批未单独覆盖。
  3. **PTC `review_done` program 内唯一动作**：提示词要求，但未在 PTC 侧强校验（P2）。
  4. **排队超时/可配置并发**：当前固定 limiter=2，未实现 `queue-timeout` 状态或 `maxConcurrentReviews` 配置（P2）。
  5. **pre-tag/CI、release evidence、唯一最终发布**：需用户确认版本/时机后执行。
- 上述 1/2 不阻塞 native/default，但发布说明必须写明 PTC 写/审批验收边界；3/4 为 P2。

### Round 36（2026-11-20，缓存审计）

- 历史基线：desktop `activity.json` v2 中 cordis 会话 134 条 aux review 平均缓存命中 **99.65%**（`cacheRead/(input+cacheRead+cacheWrite)`）；这批数据来自旧 native 全父工具目录实现，不能代表新 native 过滤实现。
- 代码审计结论：
  - PTC 顶层 tools 仍为父 `run_code`，messages = 父 `deriveMessages` + review instruction，且已回放父 `toolHistory`，父前缀可复用；
  - native 把 tools 裁剪为 allowlist 并追加 `review_done/review_wait`，工具目录与父不同，父前缀不能完整命中；标准/创造/极简均 native，各自工具目录不同。
- activity v3 新增可选 `toolMode`/`preset`（session header `agentPreset`），只落记录；按模式聚合缓存留作开发者诊断，不进 C 端主界面。native 缓存若需修复，应采用 in-history tool addition 保持父工具目录，而不是恢复未过滤工具。

### Round 37（2026-11-20，四模式缓存实测）

- 实测环境：隔离 home + rc.5 host + dev10；同一 prompt/三文件；每模式跑一次 memory+skill AUX；UI 实际预设由 session 日志 `agent-preset/selected` 确认，而不是 header。
- 命中率（`cacheRead/(input+cacheRead+cacheWrite)`）：

  | 模式 | toolMode | memory/first | skill/second |
  |---|---|---:|---:|
  | 标准 | native | 0.98 | 0.92 |
  | PTC | ptc | 0.98 | 0.98 |
  | 创造 | native | 0.13 | 0.97 |
  | 极简 | native | 0.00 | 0.98 |

- 结论修正：PTC 首条即高命中，符合“父前缀复用”；native 并不必然首条全 miss——标准首条 0.98，创造/极简首条冷、第二条高。样本仅每模式 2 条，不能据此断言稳定命中率；需要更多轮/更长会话才能定论。
- 修正 `preset` 采集：`session.header.agentPreset` 只是创建值，UI 切换模式写 `agent-preset/selected` 投影；review 现在读 `sessionProjections` 的 `agentPreset`，避免把 PTC/创造/极简都记成 standard。

### Round 38（2026-11-20，统一统计与可配置上限）

- `reviewMaxToolCalls` 加入 review config（默认 50、上限 500），与既有 `reviewMaxRounds`/`reviewTimeoutMs` 一起作为部署配置；runner 达到工具调用上限仍记录 partial + reason。
- `SkillStatsSnapshot.global.reviewSummary` 汇总 activity 保留的全部 review：total/completed/partial/timeout/failed/aborted/hitRoundLimit、平均 requests/toolCalls。
- 自动复查 UI：
  - 顶部一行汇总：完成/部分/超时/失败、平均轮数、平均工具调用、轮数截断；
  - 最近 8 条每行补轮数、工具调用、等待次数、轮数截断标记；
  - 新增 8 语言 key，生成物同步。
- 真实 UI 截图（`D:/dsh/_e2e4-stats-ui3.png`）验证：汇总行显示完成/部分/超时/失败、平均轮数/工具调用；每行显示轮数、工具调用、等待次数。
- 当前统计仍是开发者可见的轻量摘要，不做独立图表/大屏；缓存命中率仍不进主 UI。

### Round 39（2026-11-20，native 缓存友好化）

- 决策：不能只靠 review instruction 限制工具；提示词不是执行边界。改为 native channel 向模型发送**完整父工具目录**（保持前缀），在 `execute()` 前按 allowlist 拦截，未允许的调用返回 `isError` 且不执行。
- 测试：`review-executor.spec.ts` 新增完整目录+阻断 bash 的用例；native 仍只执行 skill_manage，bash 结果为 error。
- 仍未做：`review_done`/`review_wait` 仍是末尾合成工具，完整父前缀仍有一个后缀差异；如果缓存收益仍不够，后续改为 in-history tool addition。当前缓存读数需在 dev 版重测。
- 缓存命中率指标不进入 UI；仅 activity/诊断读取。

### Round 40（2026-11-20，极简模式隔离，A1）

- 决策：极简 preset 的定位是无 skill，family 模型面不应出现。由于 `evolution-all` 的模型 row 在 profile-root、平台没有 per-session unload，本轮先用**运行时 guard** 实现 A1（模型面消失；UI/命令仍全局）。
- `evolution-core/runtime` 新增 `installMinimalPresetGuard`：监听 `agent/created` / `agent-preset/selected`，当生效 preset 为 `minimal` 时用 `tools.restrict({deny})` 隐藏 `memory`、`skill_manage`、`skill_search`、`skill`、`maintenance_probe`、`merge_stage`；切回其他 preset 时 dispose。
- `evolution-review` 在最小 preset 下直接跳过 AUX（不产生 review activity）。
- 真实极简会话验证：request header tools 从 8 个降为 3 个（`pwsh`、`read_image`、`working_directory`），无 family 工具；activity 无 review。
- 边界：这是 A1，不是 A2；family UI 面板、命令、settings 仍全局存在。真正“全插件不出现”需要组合层 preset-scoped 挂载，当前平台没有公开 extends/追加 row 能力；未做运行时 UI 卸载。
- 独立复核：P0=0/P1=0；P2 修了 guard 抛错不得否决 agent 创建、review skip 增加 header preset 回退、native instruction 点名允许工具清单。仍存 P2：native runner 的 allowedNames 退化为全目录（执行仍由 channel 单一拦截）、热载不给既有 minimal agent 补装、restrict 与 get 之间失配的理论窗口。

### Round 41（2026-11-20，final static gates after guard）

- gate-07 因新增 `ctx.get('sessionProjections')` 无 platform-declaration anchor 先红；已在 `minimal-preset.ts` 补 anchor，单门复跑通过。
- guard P2 加固后定向测试 82 passed；构建 0 error。
- 最终静态门禁待本轮 runner 输出；已知只有 gate-29 的 CI home 占位与 gate-75 CI 路径不可本地判定。

**用户确认（2026-11-20）**：极简命令面若平台当前接口不支持 `commands.restrict`，**不再开发此功能**；本版按 A1 发布（模型工具与 AUX 禁用，命令面保持平台现状）。PTC 写路径/审批与真实双会话同 skill 冲突**作为 DEFERRED**，不阻塞本版。最终版本 **0.59.0**，确认后立即走 pre-tag/CI 并发布。

### Round 42（2026-11-20，0.59.0 发布后 npm web 真机验收 → PTC 修复）

- 0.59.0 真实 npm web 验收：安装/启动/诊断通过（22/22 包 0.59.0，familyVersion=0.59.0）；PTC 会话 AUX review 记录为 `completed` 但 actions 全是 `run_code: error`，模型报告 `tools.read`/`tools.review_done` 不可用。
- 根因：review runner 直接调 LLM，未经过 agent loop，PTC executor 的 `tools:sdk`/`tools:ptc-only` system prompt section 从未组装；`review_done`/`review_wait` 的 `when` 又只在 execute 期间激活；SDK toolset 被提前 dispose，PTC 保留环境在首个程序后失去 binding。
- 0.59.1 修复：PTC channel 在创建时从 child `systemPrompt.assemble` 提取 SDK 并追加到 instruction；先激活 task 再组 SDK；SDK toolset 生命周期覆盖 review；child 执行、parent 提供 catalog。
- 发布策略：用户指定先发 0.59.1，再通过 npm web 验证 PTC 真机；0.59.0 的 PTC 验收不视为通过。
