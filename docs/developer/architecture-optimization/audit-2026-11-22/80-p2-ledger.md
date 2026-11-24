# 发布前 P2 台账与阻断项

基线：0.59.6；当前树未发布。P0=0、P1=0（第 80 轮独立复核后修复了 3 个 P1，见下）。

## 本轮修复的 P1

| ID | 问题 | 修复 | 证据 |
|---|---|---|---|
| P1-CI-20 | `verify-core-surface` 仍按已删除的 `write-kernel.ts`/`mutation-unit.ts` 校验 | `writeOwned` 改为当前 `write.ts` 导出面 | `run-gates ci --lane ci-static` 通过 |
| P1-CI-26 | `family-test-lines` 用 family commit 做 git diff，CI overlay 无此历史 | 注册表增加 `specDigest`（spec 字节摘要），校验不再依赖 git 历史 | mirror + overlay 两边 digest 一致，`ci-only-26` 通过 |
| P1-SERIAL | `UnitKernel.apply` 丢了旧 `MutationUnit.apply` 的 `serial` 包裹 | `apply` 恢复 `this.serial` 包裹，并加 serial 顺序测试 | unit-kernel 30 tests；全量套件 |

## P2 台账（DEFERRED）

| ID | P2 | 文件 | owner | reason | expiry | 判据 |
|---|---|---|---|---|---|---|
| D1-MARKER-FAIL | marker 写失败后 store 已存在、marker 缺失，重试被拒绝 | `state/migrate.ts` | D1 | 失败恢复需要显式人工核对 | 0.61.0 | 注入 marker 写失败测试，并给恢复指引 |
| D1-ROLLBACK | 删 marker 回退 domain 会丢 store-era 新写 | `tests/state/store-migration.spec.ts` | D1 | 单向回退未覆盖 store-era 写 | 0.61.0 | 增加 store 新写后回退测试/警告 |
| D1-STORE-PIN | 显式 pin `store` 时不校验 marker，缺失 store 按空读 | `state/index.ts` | D1 | 显式 pin 属高级配置，auto 已 fail-closed | 0.61.0 | 显式 pin 同样要求有效 store |
| D1-MARKER-DEPTH | marker 只验顶层 image，record/curator 损坏延迟到首次读 | `state/index.ts` | D1 | 顶层合法后坏记录会由 provider 读时报错 | 0.61.0 | 完整 parse/record 负例 |
| D1-HOME | `EvolutionState.home` 与 store-plugin/命令 home 可能不一致 | `state/index.ts`、`state/store-plugin.ts` | D1 | 生产只用 `evolutionHome()`；仅自定义配置有风险 | 0.61.0 | 单一 home 来源 + 自定义 home 测试 |
| D1-HMR | provider Map 缓存首次 IO，HMR 替换 IO 后仍用旧 IO | `state/store-plugin.ts` | D1 | HMR 罕见，注册幂等已修 | 0.61.0 | 换 IO 测试/按 ctx 清理 |
| D1-LOCK-READ | 每次 state 读也持锁；只读 home/长迁移可能阻塞 | `state/index.ts` | D1 | 读一致性优先，性能待基准 | 0.61.0 | 只读策略或基准 + 长迁移测试 |
| D1-OLD-PIN | 旧 profile pin domain 时迁移不切换，命令不提示 | `evolution-commands/src/host-commands/migrate-state.ts` | D1 | 旧 profile 覆盖 pin 的人为配置 | 0.61.0 | 命令检测 pin 并提示下一步 |
| D2-JOURNAL-FAIL | snapshot committed 先于 journal committed；journal 失败时 target 回滚而 snapshot 仍 committed | `unit-kernel.ts` | D2 | 崩溃恢复窗口已由 snapshot 优先保护；失败分支待硬化 | 0.61.0 | 注入 journal committed 失败并核对恢复 |
| D2-HANDLE | `PreparedMutation` 可重复 commit/release，忘记 release 会占锁 | `unit-kernel.ts` | D2 | 当前所有调用方都在 finally/commit 释放 | 0.61.0 | handle 状态机 + double commit/release 测试 |
| D2-JOURNAL-ERR | commit catch 内 journal failed 写失败会抛出而非结构化结果 | `unit-kernel.ts` | D2 | 二次失败路径，未观测 | 0.61.0 | 失败注入测试 |
| D3-SETTINGS | SettingsPort 仍手写（Fiber/unknown 不兼容） | `contract/settings.ts`、`docs/79` | D3 | 平台 `configure` owner 是 Fiber，family 端口是 unknown | Phase E | 统一 owner 类型后 Pick/生成 |
| D3-OTHER-PORTS | 其余 family-facing ports 仍手写 | `docs/79` | D3 | 只有 3 个端口可机械派生 | Phase E | 逐个判定可生成性 |
| D2-TARGET-WRITER | 低层 `TargetWriter` 不在 `write.ts` 公共导出 | `write.ts`、`verify-core-surface.mjs` | D2 | 公共面收窄，内部实现 | next minor | 更新 gate/文档，决定是否公共导出 |

## 2026-11-24 收口

| ID | 状态 | 修复/证据 |
|---|---|---|
| D1-OLD-PIN | FIXED | `migrate state` 通过 `EvolutionState.providerSelection()` 检测 effective provider；仍是 domain 时在结果后追加 `command.migrate state.pin` 提示（8 locale），提示改 auto/store 并重启。
| D1-HMR | FIXED | `store-plugin` 不再缓存模块级 provider Map；每次 apply 都用当前 `ctx.evolutionIo.provider()` 构造 provider，由 `ctx.effect` 清理旧注册，HMR 替换 IO 后不会读旧 IO。
| D1-MARKER-DEPTH | FIXED | marker 校验现在调用 `parseStateStoreImage` 做嵌套 record/curator 全量校验，空 store 也拒绝；损坏记录不再延迟到首次读。
| D1-STORE-PIN | FIXED | 显式 `provider: store` 现在要求 migration marker 存在并校验完整 store 镜像；缺 marker 时 mount/首次读即报错，不再把空 store 当权威。
| D3-SETTINGS | FIXED | `SettingsPort.configure` 的 owner 统一为平台 `Fiber`，`settingsPort` 适配器不再 `unknown` cast；`gen-contract-ports --check` 仍只生成可机械派生端口。
| D3-OTHER-PORTS | DECIDED | 其余 family-facing 端口是平台 service 的收窄子集，不能机械 `Pick`；保留手写并在 79 文档逐个说明，不为了生成器扩大平台依赖。
| P1-AUTHORITY-NEST | FIXED | 复核发现 curator/merge 仍在构造时冻结 fence，并在缺 fence 时新建第二个 HomeAuthority，与 SkillLibrary 的 live authority 自锁超时。curator 改为 `currentHomeFence()` 每次读 ctx；`MergeUnitTransactions` 增加 `resolveFence`，merge 在 commit 时解析 live fence；rollback/finalize/rollForward 使用 `fence.run` 而非 lease，避免嵌套公共写自锁；skills library 移除显式 lock 快照。
| ISSUE-23 (P1-candidate) | FIXED | `SkillLibrary` 不再把 `mutationLock`/`homeFence` 冻结在构造函数：`newSkillLibrary` 注入 resolver，`lockPort()`/`keyedTargetLocks()`/`currentFence()` 在写时重新读 `ctx.evolutionMutationAuthority`；factory 不再在构造时 snapshot 默认值，晚挂载/晚 provide 的 authority 可自愈。新增 late-provide 测试。
| D2-TARGET-WRITER | FIXED (DECIDED) | 低层 `TargetWriter` 保持内部；`verify-core-surface` 新增“不得泄漏到 write.ts 公共面”的硬检查，79 文档同步。
| D1-ROLLBACK | FIXED | marker 缺失但 store 已存在时，auto 拒绝静默回退 domain，并提示显式 pin `provider: domain`；store 保留。78/测试同步更新。
| D1-MARKER-FAIL | FIXED | `migrateDomainToStore` 现在遇到已存在且可解析的 store、但 marker 缺失时，按 store 内容补写 `domain-store-recovered` marker 并返回真实计数；不再拒绝重试。
| D2-HANDLE | FIXED | `unit-kernel.ts` 的 PreparedMutation 现在由 WeakMap 状态机消费：prepare→committing→released；重复 commit 返回 `unit-handle-consumed`，release 幂等。
| D2-JOURNAL-FAIL | FIXED | snapshot committed 成为恢复权威；之后的 journal committed 失败只入 warnings，不再触发 target rollback + 已 committed snapshot 的分叉。
| D2-JOURNAL-ERR | FIXED | commit catch 的 journal failed 写入失败被捕获为 warning，提交失败仍返回结构化结果。
| D2-HANDLE/JOURNAL 测试 | EVIDENCE | `unit-kernel.spec.ts` 33 tests；新增 double commit/release、journal committed failure、journal failed failure 三例。

其余 D1/D2/D3 行仍按上表 DEFERRED（owner/reason/expiry/判据）。

## 发布阻断项（不是 P2）

1. **release evidence 仍是旧数据**：`packages/scripts/release-evidence-rehearsal.json` 的 `measuredCommit`、traceability source 都是 0.59.6 旧值；发布前必须重新 build、pack、复算 dist sha256，并重测 S1–S4。
2. **最终 dist 已重打**：`D:\dsh\harness-rc3\packages\evolution\dist` 已是 0.60.0 正式 pack，20 个 tarball；all sha256 `200514...7cf7`，lab60 已从该 dist 安装并验收。
3. **候选 web 验收已完成**：lab60 已记录 0.60.0 最终 dist 验收（见 81）；正式 npm 包发布后仍需做 publish 后 web 验收。
4. **D1c domain fallback**：本版保留 domain provider/row 作为迁移窗口；发布说明必须写“先 `/evolution migrate state`、重启后用 store、domain 留一版回退”，且 DCR-4 用户确认前不能声称 domain authority 删除完成。
5. **trusted publisher 未 OTP 复核**：`npm trust list` 本会话被 EOTP 挡住；正式 tag 前必须核对 repo/file/environment。
6. **全量套件已在最终 HEAD 复跑**：448 files / 2457 tests passed（1518.48s）。
