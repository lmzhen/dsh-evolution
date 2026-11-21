# A4 设计：repair 走平台 takeover claim

范围：01-core-write P1-4：`TargetLockSet.repair` / `HomeAuthority.repair` 直接 `rm` 锁文件，绕过平台 takeover claim；与另一进程刚写入的锁交错时可能删掉活锁，造成双持有。

## 1. 已读依据

- `audit-2026-11-22/01-core-write.md:34`：位置/机制/影响/建议。
- `packages/evolution-core/src/authority.ts`: `TargetLockSet.repair` 读 pid 后直接 `rm`；`HomeAuthority.repair` 同形。
- 平台协议 `harness-rc3/packages/util/atomic-write/src/index.ts:150-178,238-273`：
  - 读 lock record；
  - 写 `${lock}.takeover-<hash(record)>` claim (`wx`)；
  - claim 下重读 record + pid；
  - 仍是被接管者才 `rm`；
  - finally 删 claim。
- 理论：claim 序列化“删除死锁”，另一个 contender 不能在无 claim 时删除；claim 名字绑定 record，新锁不会被旧 claim 删。
- 测试 `authority-target-locks.spec.ts`：release failure → repair。

## 2. 定性

| 问题 | 不变量 | 定性 | 风险边界 |
|---|---|---|---|
| repair 直接 rm | I2 单一写权威 | 锁互斥语义可被破坏；双持有后并发写同一树 | 窗口需 release 失败 + 另一进程抢锁；后果为丢失更新 |

修复：把平台 takeover claim 逻辑复刻为 `removeExitedLock`，两个 repair 共用；不新增依赖/协议。

## 3. 设计

`removeExitedLock(lockPath)`：

1. 读 record；ENOENT → true（已无锁）；其他错误 throw。
2. 解析 pid；活的外部 pid → false。
3. claim path = `${lockPath}.takeover-${sha256(record).slice(0,16)}`；`writeFile(...,'wx')`；EEXIST/EPERM → false。
4. claim 内重读：
   - ENOENT → true；
   - record 不同 → false；
   - 新 pid 活 → false；
   - `rm(lockPath)`；再读确认 ENOENT。
5. finally 删 claim（best-effort）。

`TargetLockSet.repair`：对每个 broken key 调用；true 则删除 broken key/repaired，false 则 skipped（异常也 skipped）。
`HomeAuthority.repair`：pending+未持有时调用；false → noop。

## 4. 测试

`authority-target-locks.spec.ts`：

- 制造 broken lock（release failure），写死 pid；
- 预置对应 claim 文件 → `repair` 返回 skipped，lock 保留；
- 删除 claim → `repair` 返回 repaired，lock 消失。
- 现有 repair/lease 测试回归。

## 5. 回退

- 删除 `removeExitedLock` 并恢复直接 `rm`；无 schema/API 变更。
- 只影响 repair 并发语义，不改变正常获取/释放。

## 6. 实现结果（2026-11-22，未发布）

- `authority.ts` 新增 `removeExitedLock`：takeover claim + 重读 record/pid + 再删；
  `TargetLockSet.repair` 与 `HomeAuthority.repair` 共用。
- 新增测试：预置 claim 时 repair skipped 且锁保留；删除 claim 后 repaired。
- authority-target-locks + authority = 2 files / 15 tests passed；build 0。
