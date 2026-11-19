# Aux Review 目标重构设计

> 状态：设计稿（2026-11-20），待评审后实施。
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

- 直接从 frozen parent header 取工具 schema，过滤 review allowlist（`skill_manage`、`memory`、`skill`、`skill_search`、`read`、`glob`、`grep`、`review_done`、`review_wait`）。
- 执行走现有 `tools.execute`，agent 使用 review parent proxy；只读/写工具分区。
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
- `review_wait` 计入 `toolCalls`；不计入模型轮数（模型只在工具结果后发下一轮），但有 wait 上限，避免占用 120s 总预算。
- 不实现自动 rebase；不做跨进程资源协调器；desktop/web 共用 home 不作为当前目标。

### 8.3 多会话

- 不同 session 的 task 可并行。
- 同一 session 的 memory/skill 可并行；各自独立队列/预算。
- 同一 skill 的并发写由 `SkillLibrary` 锁 + CAS 兜底；单轮失败是模型可恢复信息。
- 全局只加一个并发上限（默认 2）和一个简单 FIFO；不做复杂公平调度。

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

## 14. 非目标

- 不做逐位置技能修改校验；信任模型 agent 能力。
- 不做自动 rebase/重放引擎；单轮工具失败由模型 wait/重读处理。
- 不做 desktop/web 共用 home 的跨进程协调。
- 不改变前台 inject 提示词和投递方式。
