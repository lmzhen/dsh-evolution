# A7 设计：review 段末“调度成功才结账”

范围：03-curator-review-state P1-3：aux 模式在任务结束时先清零 durable 计数/删 pending debt，再调度可能失败的子代理；失败结果被 Promise.all 丢弃，复查永久丢失。

## 1. 已读依据

- `audit-2026-11-22/03-curator-review-state.md:27-31`：位置、机制、影响、建议。
- `packages/evolution-review/src/index.ts`：
  - `:770-781`：completed flush 先 `pendingCadenceReviews.delete` + `consumeReviewDebt`，再 `scheduleAuxDebt`；
  - `scheduleAuxDebt` 只 `Promise.all` 并丢 boolean；
  - `consumeReviewDebt` load→清零→save；
  - `tryAuxReview` 在 no requestHeader/no llm/lease/child setup 失败时返回 false；
  - inject/completion 路径在拒绝投递时已显式回滚闩锁（`:788-790`、`:861-863`）。
- 既有债务结构 `ReviewDebt { memory, skill }`。

## 2. 定性

| 问题 | 不变量 | 定性 | 风险边界 |
|---|---|---|---|
| 先结账后调度 | I4/I5 | transient 失败丢掉一次段末复查；计数清零 | 仅 lease/child/io 失败时；不影响已执行复查 |
| 与 inject 回滚契约不对称 | I2 | 同一语义两条实现 | 同上 |

## 3. 设计

- `scheduleAuxDebt` 改为返回 `{ scheduled?: ReviewDebt; failed?: ReviewDebt }`：
  - 只有 `tryAuxReview` 返回 true 的 kind 进入 scheduled；
  - 失败 kind 进入 failed。
- 新增纯函数 `splitScheduledDebt(debt, result)`：
  - 便于测试，无 IO；
  - 两个 kind 的布尔结果映射到 scheduled/failed。
- completed flush：
  - 先调度；
  - 只对 `scheduled` 调 `consumeReviewDebt`（清零对应计数）；
  - `failed` 写回 `pendingCadenceReviews`，下个边界重试；
  - 若全部失败，不消费任何计数。
- 不改变 inject 路径；不改变 `tryAuxReview` 的 running/rerun 语义。

## 4. 测试

- `review-debt.spec.ts`：both scheduled、partial、all failed 三例。
- `review.spec.ts` 回归。
- 现有 aux 集成测试保持；失败 path 的行为由 helper 单测 + caller 代码审查覆盖（本轮不引入新的真实 lease 故障夹具）。

## 5. 回退

- 删除 helper/返回值并恢复 `Promise.all` 丢弃；无 schema/API 变更。

## 6. 实现结果（2026-11-22，未发布）

- `scheduleAuxDebt` 返回 scheduled/failed；completed flush 只消费 scheduled，failed 写回 pendingCadenceReviews。
- 新增 `splitScheduledDebt` 纯函数与 3 条单测。
- review-debt + review.spec：2 files / 4 tests passed；build 0。
