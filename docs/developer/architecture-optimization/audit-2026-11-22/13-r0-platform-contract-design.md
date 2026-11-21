# R0 设计：平台调用约定与 LLM 终态

范围：B5 `internal/config` cordis 4.1 调用约定、D1 LLM `completeText` 的 `aborted` 终态。
目标架构关系：B5/D1 是 P1 平台接缝根因；目标架构最终由派生 ports/平台类型消除手抄，但本批先修当前 seam 的确定性错误，避免旧路径继续产生错误行为。不改变目标架构方向，不新增永久兼容层。

## 1. 已读依据

- `audit-2026-11-22/05-platform-seam.md`：B5/D1 原始证据。
- `audit-2026-11-22/10-system-framework.md`：I6 契约生成而非复述、M4 边界漂移。
- `audit-2026-11-22/11-target-architecture.md`：平台类型派生、单入口。
- 当前实现：
  - `packages/tool-skill-manage/src/index.ts`：`internal/config` hook；`readNumberParam`/`validateSkillSettings`。
  - `packages/evolution-curator/src/index.ts`：`archiveAfterDays`/`staleAfterDays` hook。
  - `packages/evolution-adapter/src/llm.ts`：`llmPort` / `completeText`。
  - `packages/evolution-platform-contract/src/llm.ts`：失败类型。
- 测试：
  - `packages/tool-skill-manage/tests/skill-settings.spec.ts`：waterfall 调用。
  - `packages/evolution-adapter/tests/review-child.spec.ts`（现有 adapter 测试风格）。
- 平台权威实现：
  - `harness-rc3/vendor/cordis/src/fiber.ts:678`：`resolveConfig` 调用 `fiber.context.waterfall('internal/config', fiber, () => config)`。
  - `harness-rc3/vendor/cordis/src/events.ts:162-171,246`：`_resolve` 只有首参是对象/函数才作为 thisArg；`waterfall` 回调收到 `[fiber, next]`。
  - 平台先例 `harness-rc3/packages/llm/llm-pi-ai/src/index.ts:198-207`：用首参 fiber。
  - `harness-rc3/packages/llm/llm/src/types.ts:163-172,488-495`：`FinishReasonMap` 的 `aborted`；`LlmRuntime.stream()` 将失败归一为 terminal `error`/`aborted` finish。
  - `harness-rc3/packages/llm/llm/src/error.ts`：`ABORTED`/`TIMEOUT`/`CONTENT_REFUSED` 等失败码。

## 2. 定性

| 问题 | 不变量 | 定性 | 风险边界 |
|---|---|---|---|
| B5 config hook 旧 `this` 约定 | I6 契约边界 | 平台 4.1 上校验永不执行；部署上限可被放宽；静默 | 只影响 `internal/config` 候选，不直接损坏字节；属于配置安全/容量边界 |
| D1 LLM `aborted` 当成功 | I6 + I4 | 取消/超时后返回半截文本，调用方按成功落盘；contract 的 `cancelled` 永不产生 | 需要 abort/timeout；当前 in-tree `completeText` 调用方少，但契约/未来 callers 会中 |

两者均不需要 DCR：与目标架构“平台契约从权威实现派生、终态统一分类”一致。

## 3. B5 设计

### 3.1 监听器签名

平台 4.1 发射给 listener 的参数是 `(fiber, next)`（`internal/config`），不是 `(this= fiber, next)`。

当前两处：

```ts
ctx.on('internal/config', function (this: Fiber, _previous, next) {
  const value = next()
  if (this !== ctx.fiber) return value
  ...
})
```

改为：

```ts
ctx.on('internal/config', (fiber: Fiber, _previous: unknown, next: () => unknown) => {
  const value = next()
  if (fiber !== ctx.fiber) return value
  ...
})
```

- `_previous` 是平台给 waterfall 的前值/候选值？在 4.1 实际回调只收到 fiber,next；保持三参函数可兼容旧调用形状，但**判定只认首参 fiber**；
- 平台先例用首参；不再用 `this`；
- 两处同步：`tool-skill-manage` 与 `evolution-curator`；
- 不改 `validateSkillSettings`/`validateCuratorSettings` 纯函数。

### 3.2 测试

- `skill-settings.spec.ts` 的 `candidate` 改成平台 4.1 形状：
  ```ts
  const candidate = (value: unknown): unknown =>
    ctx.waterfall('internal/config', ctx.fiber, value, () => value)
  ```
  - 期望 widening throws、tightening pass、无关字段 pass；
  - 现有测试已覆盖三者，改调用形状即可成为真实发射路径回归。
- curator：若现有集成 setup 可复用，加一条 `archiveAfterDays/staleAfterDays` 同时越界的 waterfall 断言；若 setup 成本过高，至少用直接 listener 驱动（`ctx.waterfall('internal/config', ctx.fiber, value, () => value)`)。
- 反向 drill：故意在 4.1 形状下把 hook 改回 `this` 约定应失败（通过测试调用形状本身保证；可在测试注释写明）。

## 4. D1 设计

### 4.1 `completeText` 终态分类

```ts
function finishFailure(reason: FinishReason): EvolutionLlmError | null {
  if (reason.kind === 'aborted') return new EvolutionLlmError('cancelled', 'model call aborted', reason.failure)
  if (reason.kind !== 'error') return null
  const code = reason.failure.code
  if (code === 'CONTENT_REFUSED') return new EvolutionLlmError('content-refused', ...)
  if (code === 'TIMEOUT') return new EvolutionLlmError('timeout', ...)
  if (/^(NO_ADAPTER|NO_DISCOVERY|MISSING_CREDENTIAL|INVALID_CREDENTIAL|AUTH|ACCOUNT_|QUOTA|RATE_LIMIT)/.test(code)) {
    return new EvolutionLlmError('no-route' or 'model-unavailable', ...)
  }
  return new EvolutionLlmError('transport', ...)
}
```

- 成功终态：`stop` / `tool-calls` / `max-tokens` 保留现有文本返回（`max-tokens` 是模型正常停止，不是失败；是否需要提示由调用方决定）；
- `aborted` → `cancelled`；
- `error` → 按 code 映射；`CONTENT_REFUSED` 保留；`TIMEOUT`→timeout；无路由/凭据→no-route/model-unavailable；其余 transport；
- 流在**没有 finish 帧**就结束时 → `transport`（不能返回半截文本）；
- 删除不存在的 `frame.type === 'text'` 分支；
- 保留 `stream()`/`streamRaw()` 不动，只有 `completeText` 聚合终态。

### 4.2 测试

新增 `packages/evolution-adapter/tests/llm.spec.ts`：

- fake `ctx.provide('llm', { stream: async function* ... })`；
- `text-delta` + `finish aborted` → `EvolutionLlmError.kind === 'cancelled'`；
- `finish error CONTENT_REFUSED` → `content-refused`；
- `finish error TIMEOUT` → `timeout`；
- 无 finish → `transport`；
- 成功 `finish stop` → 拼接文本；
- `finish error UNKNOWN` → transport。

## 5. 影响面与回退

- B5：两处 listener 签名；无 API/存储变更；修后平台 4.1 的配置写入会被真实校验。旧 4.0 消费方若仍用 `this` 调用，行为未定义；目标 cohort 是 rc.5/4.1，文档记录。
- D1：只改 `completeText` 聚合；`stream`/`streamRaw` 不变；无 schema/API 变更。
- 回退：两处均为小范围代码 + 测试，可独立回退；不会损坏技能字节。
- 目标架构后记：B5 最终由生成 ports/平台调用约定统一消除；D1 最终由统一 `finishToError` 放进 `evolution-platform` port，而不是散在业务调用方。

## 6. 验收

```bash
node node_modules/vitest/vitest.mjs run \
  packages/evolution/tool-skill-manage/tests/skill-settings.spec.ts \
  packages/evolution/evolution-adapter/tests/llm.spec.ts \
  packages/evolution/evolution-curator/tests/curator.spec.ts
node packages/scripts/verify-arch-guards.mjs packages --strict
```

## 7. 实现结果（2026-11-22，未发布）

- B5：tool-skill-manage 与 evolution-curator 的 `internal/config` listener 改为平台 4.1 的
  `(fiber, next)` 形状；测试改用 `ctx.waterfall('internal/config', ctx.fiber, () => value)`，
  两处真实发射路径均能拒绝越界候选。
- D1：`completeText` 按 finish 终态分类：`aborted`→cancelled、`CONTENT_REFUSED`→content-refused、
  `TIMEOUT`→timeout、无路由/凭据→no-route、额度/限流→model-unavailable、未知/无 finish→transport；
  新增 adapter LLM 单测。
- 验证：3 files / 21 tests passed；build 0；未发布。
