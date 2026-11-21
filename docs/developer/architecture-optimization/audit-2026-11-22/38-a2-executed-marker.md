# A2 部分：审批回放的跨进程执行标记

范围：03-curator-review-state P1-1 的最危险后果——两个宿主共用 DSH_HOME 时，B 的 domain 缓存看不到 A 已 approved 的 pending，B 可能再次 claim 并重放非幂等 runner。

## 1. 已读依据

- `audit-2026-11-22/03-curator-review-state.md:13-17`：domain 缓存为读判据、claim/resolve 不刷新、双执行。
- `packages/evolution-approval/src/index.ts`：
  - `approve` 已有 `withApprovalLease`（authority 挂载时跨进程 lease）；
  - `doApprove` 先 claim pending → 执行 runner → resolve；
  - 状态来自 `evolutionState` provider，domain provider 进程内缓存。
- `packages/evolution-state/src/domain/index.ts`：单例 domain，无刷新/重载。
- 先尝试 reload/close domain：单元测试出现 `DomainError: already open/closed`，并发 approve 无法安全重开；已回退。

## 2. 设计

在 approval 判决层增加一个**durable executed marker**，作为 pending id 的跨进程幂等屏障：

- 路径：`$DSH_HOME/evolution/approval/executed/<encoded pendingId>`；
- `approve(id)`：
  - 进入前查 marker；存在 → 拒绝“已执行过，不会重复回放”；
  - 取得 approval lease 后**再查一次**（跨进程窗口）；
  - 只有 `doApprove` 返回 `ok:true` 才写 marker；
  - marker 写失败只 warn，不放宽判定。
- marker 通过 `ctx.get('evolutionIo')` 写；没有 io 的纯测试/嵌入场景跳过，保持旧行为。
- 不在 `run()` 直接回放通道写 marker（那是显式后台回放，不是 pending 判决）。

## 3. 边界

- 修复：B 的 stale pending 在 A 成功后会被 marker 拦住；不依赖 domain 刷新。
- 未修复：review/curator counter 的跨进程 lost update（仍需 StateStore / transact 介质）。
- marker 当前不自动清理；pending id 唯一，属于受控增长，StateStore 组把 marker 并入统一事务/清理。
- marker 写在 runner 成功之后；进程在“runner 成功 → marker 落盘”之间崩溃仍可能重放一次（与任何非事务副作用同一窗口），这是显式残余风险。

## 4. 验证

- 新增测试：成功 approve 后 marker 存在；
- 新增负例：预置 marker 后 approve 返回 false、runner 0 次调用；
- `evolution-approval` 全量：3 files / 56 tests passed；
- build 0；arch/doc/test-lines 0。

## 5. 实现结果（2026-11-22，未发布）

- approval.approve 在 lease 前后各查一次 executed marker，成功 replay 后写 marker。
- 新增成功路径 marker 测试与“预置 marker 时 runner 不执行”负例；approval 3 files / 56 tests passed；build 0。
- A2 仍为部分收口：review/curator counter 跨进程更新未迁移 StateStore。

## 6. 追加：domain provider reload

- `EvolutionStateStorage.reload?()`；domain provider 在 **provider 队列**内 close→reopen：
  - 所有 provider 调用与 reload 共享一个队列；
  - 空闲队列同步启动调用，E-17 dispose 仍能看到 in-flight open；
  - reload 前无并发 provider 调用，避免 `DomainError: domain already open/closed`。
- `approve` 在 lease 内、marker 检查前 `state.reload()`，因此 B 的 claim 读取的是介质现状，不是进程缓存。
- 验证：state/state-domain/approval/curator 19 files / 200 tests passed；build 0。
- 仍未迁移：review/curator 自身写计数时没有每次 reload；它们要在 Phase D 接入 StateStore。

## 7. 追加：review counter 事务

- `withReviewStateLock` 现在：
  - 保持 in-process 队列；
  - authority 挂载时 acquire `review-state:<session>` lease（busy 短暂等待，超时 warn）；
  - lease 内 `evolutionState.reload()`，再执行 load→advance→save；
  - 最后释放 lease。
- 覆盖 review 的三处 counter RMW：段末清零、turn/end advance、debt consume。
- 验证：review + state + approval + curator 31 files / 244 tests passed；build 0。
- 仍未迁移：curator state 的跨进程 RMW 仍走 domain 缓存，Phase D 统一 StateStore。

