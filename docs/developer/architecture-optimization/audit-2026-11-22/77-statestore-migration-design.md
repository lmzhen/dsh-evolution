# D1b 设计：domain → StateStore 显式迁移与切换

前置：D1a 已验证 file provider（`state/store.ts`）通过 conformance，且不挂载、不改变行为。

## 目标

把 pending / review / curator 三类现有 durable state 从 `storage-domain` provider 迁到 `store` 文件 provider，并让 bundle 默认 `evolution-state.provider` 指向 `store`；不删除旧 domain 数据，保留一个版本的回退窗口。

## 迁移命令

```text
/evolution migrate state [--dry-run]
```

- 默认拒绝覆盖已有 `<evolutionHome>/state/store.json`；
- 先打开旧 `EVOLUTION_DOMAIN`，逐表读取并应用 `recordIssue` 校验；任一非法记录 ⇒ 整次迁移失败，不写 store；
- 读出 review 全部 session 行（直接读 domain table，`EvolutionStateStorage` 没有 list-sessions 方法）、curator 单行、pending 全部行；
- 在内存组装完整 StoreFile：`{ version:1, review, curator, pending }`；
- 用 `io.createTextIfAbsent(store.json, serialized)` 发布：文件已存在会 EEXIST，迁移不会覆盖；发布是完整文件，不会出现半迁移；
- 成功后写 `state/.migrated-from-domain.json`（时间、counts、源 provider `domain`、目标 `store`）；
- **不删除/不修改 domain 数据**；
- `--dry-run` 只读、只打印 counts，不写 store/marker。

失败路径：

| 失败点 | 结果 |
|---|---|
| domain 打不开/校验失败 | store 不写，原数据不变 |
| store 已存在 | 命令失败，不覆盖 |
| createTextIfAbsent 失败 | store 不写，可重试 |
| 成功写 store 后 marker 写失败 | store 已完整；命令报告 marker 缺失，重启后仍可读 store |

## 切换

1. 用户运行迁移；
2. bundle row `evolution-state` 的 `config.provider` 从 `domain` 改为 `store`；
3. domain provider 仍注册但不再被选中（保留一个版本的只读回退）；
4. 下一个 minor 删除 `domain` provider 与 storage-domain rows。

回退：

- 把 `provider` 改回 `domain` 并重启；domain 数据从未被改，store 文件保留；
- 不需要“反向迁移”。

## 验收

- 迁移负例：已有 store、非法 domain 记录、domain 打开失败 ⇒ 均不写 store；
- 迁移正例：domain 写入的 pending/review/curator 全部经 store provider 读出，字段完整；
- 切换负例：provider 配错在 mount 期报错（现有 registry 已做）；
- 双进程：迁移命令与运行中的 host 不并发；命令在 host 停止/未持有迁移锁时执行（若不能保证，先做 `--dry-run` + host 停止提示）；
- 回滚演练：切回 domain 后 pending/review/curator 仍可读。

## 范围边界

- 本步只迁 pending/review/curator；activity/usage 仍是文件侧车，D1c 另议；
- approval 的完整 SkillPlan 属于 Phase D 审批面，本步不改 plan 形状；
- UI/提示词/aux 前缀无变化。

## 实现进度（D1b-1）

已完成核心迁移函数，未接命令、未切换 row：

- `packages/evolution-core/src/state/migrate.ts`：`migrateDomainToStore(ctx, { io, home?, dryRun? })`；
- 优先读已挂载的 domain provider（避免同一 KV domain 二次 open 的 `already-open`）；新增可选 seam `listReviewStates()` 供迁移/诊断读全部 review 行；
- 完整 snapshot 通过 `writeStateStoreSnapshot` 的 create-if-absent 发布；不覆盖已有 store；
- 成功后写 `.migrated-from-domain.json`；domain 数据不改；
- `dry-run` 只计数、不写；
- 失败路径：已有 store / domain 打不开 / 非法记录 ⇒ 不写 store。

验证：

```text
core state: 8 files / 49 tests passed
build-lib: 0
run-gates local: 61 pass / 0 fail / 3 cannot-decide
全量 family 套件: 444 files / 2438 tests passed（1173.32s）
store-migration: 4 tests passed（含迁移后 auto 读 store、删 marker 回退 domain）
```

已接 `/evolution migrate state [--dry-run]`（commands 3 tests，commands 全套 52 tests）；仍待 bundle provider 切换、domain provider 删除与回滚演练。

## D1b-2 实现进度

- `/evolution migrate state [--dry-run]` 已接入：commands 3 tests + commands 全套 52 tests；
- bundle 新增 `evolution-state-store` row（注册 `store` provider），并新增 `state/store-plugin.ts`；
- `evolution-state` row 的 `provider` 从 `domain` 改为 `auto`；
- `auto`：有迁移 marker ⇒ `store`；否则 `domain`；marker 存在但 store provider 未挂载 ⇒ fail loud；
- 回退：删除 marker 并重启 ⇒ 回 `domain`；旧 domain 数据从未修改；
- 全量 family 套件：446 files / 2442 tests passed（1171.60s）；
- `run-gates local`: 61 pass / 0 fail / 3 cannot-decide。

仍待：删除 domain provider/row、更新 `evolution-state-domain` 的运行时描述、真实升级/回滚演练。

## D1b-3 独立复核修复

复核指出两个 P1，已修：

1. **运行中迁移无锁**：`EvolutionState` 的每个状态操作与 `migrateDomainToStore` 共用同一把跨进程 `state.lock`（`withFileLock`）；迁移持有锁跨“读 domain → 写 store → 写 marker”，状态写不能插入。新增阻塞测试证明迁移期间的状态读必须等锁。
2. **marker 存在但 store 缺失/为空时静默读空**：`auto` 现在要求 marker + 非空 store 文件；缺失/0 字节直接 fail loud，测试覆盖两者的抛错。

验证：

```text
core state: 9 files / 54 tests passed
全量 family 套件: 446 files / 2446 tests passed（1188.86s）
`run-gates local`: 61 pass / 0 fail / 3 cannot-decide
```

剩余 P2：marker 写失败后 store 已存在会阻止重试、dry-run 不检查已有 store、HMR 二次注册、旧 pin domain 命令不切换提示、README row 计数/tsconfig 子路径。
