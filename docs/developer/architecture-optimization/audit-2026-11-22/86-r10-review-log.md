# DCR-85 R10 独立复核记录

本页是 R10 各轮独立复核的**整理稿**，不是逐字转录；原始对话在会话记录中，代码与门禁证据在工作区。目的只有一个：让“复核过、修了什么、还欠什么”可追溯。

## 复核方式

- 只读代码 + 文档 + 测试，不先采信实现者注释；
- 先做净差集，再判断“新引入”还是“既有”；
- 结论只分 P0/P1/P2；
- P0/P1 必须落到代码/测试/门禁，P2 进 [80-p2-ledger](80-p2-ledger.md)。

## 第一轮

- 结论：P0=0，P1=8。
- 主要问题：
  - full manifest 未在 unit 事务内落盘；
  - usage 双介质；
  - migrate 多 root 遗漏；
  - migration 锁序；
  - gate-88..92 缺失。
- 已修：manifest 写入 `StoreMutation.treeManifest`、usage 单介质、migrate roots、迁移锁序、gate-88..92 注册。
- 证据：`packages/evolution-core/src/store/store-kernel.ts`、`packages/scripts/gates/`、`packages/scripts/verify-store-*.mjs`。

## 第二轮

- 结论：P0=1，P1=3。
- 主要问题：
  - staged migration 双速（pending 写 legacy 但 v2 已可读）；
  - GC 在写事务内执行；
  - 同步 head preflight；
  - 不安全恢复路径。
- 已修：staged pending + 启动 promote、GC 移到 commit 后且 best-effort、去掉同步 preflight、删除不安全恢复。
- 证据：`packages/evolution-core/src/state/migrate.ts`、`store-kernel.ts`、`tests/state/store-service-plugin.spec.ts`。

## 第三轮

- 结论：P0=0，P1=4。
- 主要问题：
  - activation oracle 分散；
  - activation record 字段不足；
  - tree manifest 增量写入与“全量权威”冲突；
  - 层间职责重叠。
- 已修/已设计：
  - `state/activation.ts` 成为唯一 oracle，gate-94 禁止直读 marker；
  - record 增加 `mode/generation/lastActiveCommitId`，revert/re-stage 落地；
  - 每个 tree unit 写完整 manifest，内容仍 materialized；
  - R10.7 删除 commit-tree 层。
- 证据：`state/activation.ts`、`state/migrate.ts`、`verify-store-activation-oracle.mjs`、`85` R10.7。

## 最近一轮（R10 收口复核）

- 结论：新 P0=0，新 P1=1。
- 问题：`pruneTreeChangeUnits` 被改成“仅 recovery 有结果才执行”，健康 home 上 unit 快照无界增长，且 recovery 每次扫共享目录变慢。
- 已修：
  - skill unit journal/snapshot 落为 skill root 内 flat `.unit-*.json`；
  - prune 只数 `.unit-snapshot-*`，≤keep 短路，并恢复无条件调用；
  - `mutation-recovery`、`skill-history`、`skill-store`、`create-tree-reads` 回归。
- 证据：`skill-store.ts`、`mutation-storage-adapter.ts`、`80-p2-ledger` R10-P2-11。

## 第五轮（full-suite 警告复核）

- 结论：新 P0=0，新 P1=1。
- 问题：flat unit 文件放在 skill root 内后，`snapshot restore` 的清理集把它们当成“快照未声明的残留”并准备删除，会丢 unit journal/snapshot 恢复数据。
- 已修：restore 的 writer 探测与清理集都跳过 `.unit-*`；`skill-store-boundary` 断言 restore 后 `.unit-journal-*` / `.unit-snapshot-*` 仍在。
- 证据：`skill-store.ts` restore 清理、`skill-store-boundary.spec.ts`、85 R10.6。

## 第六轮（state codec + gate 收口复核）

- 结论：新 P0=0，新 P1=0。
- 复核点：
  - `stateCodec` 的 read/transact 路径与旧 command 路径的 source/expectedCommit/原子性一致；
  - kernel 路径与 service 路径的坏文档都抛 `StoreCorruptError`；
  - inject gate 只读声明，`export const` 与 `static` 都覆盖，字面量检查 fail-closed；
  - gate title/manifest/CONTRIBUTING/drill evidence 与代码一致。
- 残余 P2（不升 P1）：数组内注释会被判非字面量、只取第一个 inject 声明、对象式 `Inject` 未支持；curator late-provide 矩阵仍缺。
- 证据：`state/v2-provider.ts`、`verify-store-lifecycle.mjs`、`guards.mjs`、`installation-matrix.spec.ts`、`boundary.spec.ts`。

## 当前未决

- P2-3：已收敛为 inject 声明契约（字面量、含 static、数组内注释剥离）；对象式 `Inject` 不支持是当前策略。
- P2-4：已由 resolver + sidecar + 最小 mount + HMR/GC 证据链关闭；curator 不单独建 LLM e2e。
- P2-10：本页即为该条的可审计记录；原始对话不在库内。
- manifest-pending 不做：boot 全树对账已覆盖，O(tree)/boot 接受。
- `usage/merge/memory/discovery/feedback` 走同一个 `scopedTextIO` 文本 codec；不再逐域手写 reader/writer。
- promote 只在 pending 存在时发生；re-stage 归档旧 store，无需额外拒绝开关。
- `state.provider` surface 已删除（无生产消费者，内部改为 `stateCodec`）。
- 仅余：真机验收矩阵、最终独立复核、版本确认与唯一一次发布。

## 复核结论的用法

- 发布前以最新一轮复核为准，旧轮次只用于追溯；
- 任何 P0/P1 未归零，不进入发布；
- P2 未修完必须有 owner/reason/expiry/判据，不能只写“以后再说”。
