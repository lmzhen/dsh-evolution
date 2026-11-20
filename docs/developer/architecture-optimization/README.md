# 架构优化：执行入口

> Goal id：`goal-11516794-1c0c-490f-9382-c0b94bc0d4c4`
> 长期目标与文档索引：[27-architecture-goal-and-document-index.md](D:/dsh/_research/plugin-code-audit-2026-11-09/audit-2026-11-12/reports/27-architecture-goal-and-document-index.md)
> 目标架构：[26-architecture-optimization-plan.md](D:/dsh/_research/plugin-code-audit-2026-11-09/audit-2026-11-12/reports/26-architecture-optimization-plan.md)
>
> **DCR-2（2026-11-16）**：0.50.0 只适配 DSH `0.2.2-rc.3`，rc.1 兼容层删除，直接发 npm `latest`。本文中 rc.1 的测试/编译读数只作 0.49 历史基线。
>
> **多版本重构（2026-11-19）**：以 [multi-version-support.md](multi-version-support.md) 为唯一设计源，goal `goal-0eb89255-0cd9-46dd-8940-4d5524c2c6ed`；全部优化完成并通过全量验收/独立复核后才发布，过程中不发布中间版本。
>
> **当前进度（2026-11-19）**：P0/P0b/P0c 完成；P1 envelope/cohort、rc.3/rc.5 双线矩阵、cohort smoke、release evidence cohort 读数完成；P2 的 bundle 平台 row 覆盖清理、doctor cohort 显示完成。发布包 22、源码包 23；cohort 为 `0.2.2-rc.5`（rc.5 已实测）；剩余发布门禁全量执行、独立复核与唯一一次正式发布。

## 1. 这个目录是什么

这里是 Phase 0 开始的**执行层文档**：把 26 的目标拆成可检查的端口清单、行为基线、组合草稿和阶段门。它不重复 26 的设计理由；只记录“现在是什么、目标是什么、怎么证明”。

## 2. 阶段状态

| Phase | 内容 | 状态 |
|---|---|---|
| 0 | 基线、行为 fixtures、双版本 harness | **完成（DCR-1）**：223 绿 + 历史 rc.1/rc.3 编译 0/0；merge pre-tag 全量移交 lane |
| 1 | 平台端口补完（rc.3-only） | **完成**：生产直接访问只剩 `platform/` 适配器；rc.3 96/96、commands 63/63、state 6/6、skill-discovery+doctor 45/45、platform view+doctor 45/45、settings read 50/50、review 3/3、编译 0 |
| 2 | 子代理执行内核 | **内核完成**：kernel 唯一实现；`run/open` 共享 `prepare()+startRun()`，均走 `SubagentRun`；continue 非 completed 改 unavailable；rc.3 96/96、编译 0；剩余 feature 迁移/公开 start 端口 |
| 3 | 技能 mutation pipeline | **完成**：`SKILL_ACTIONS` 表 + 全 mutation 派发 + needsName + `SkillPlan`（extract）+ `commitSkillAction` + SkillLibrary journal；rc.3 96/96、write-gates 30/30、commands 63/63 |
| 4 | 组合生成 | **完成**：`bundle-rows.json` 单源 + `gen-bundle-patches.mjs`；`--check` 通过；bundle-mutual-exclusion 8/8 |
| 5 | 客户端契约 | 进行中：生成契约 + `platformUiModule` + `registerSurface`；client UI 6/6、seats/tokens/i18n 全绿；剩余 rc.3 Web 真机截图 |
| 6 | 错误/清理 | 进行中：基线空 catch 0、any 176、as never 36；Result/FamilyError/Code 已落地（2/2）；ConnectionPort.tryRegister 边界已迁移 |
| 7 | 包边界/导出 | **0.50 范围完成（DCR-3）**：根 `export *` 72→69；extract/result/errors 子路径；拆包延后 0.51 |

## 3. 基线（2026-11-16）

| 项 | 值 |
|---|---|
| 仓库 | `D:\dsh\dsh-evolution-mirror` |
| HEAD | `aeedc8fe` = tag `v0.49.0` |
| 工作区 | 大量未提交架构改动（Phase 0-7 进行中）；HEAD 仍是 0.49 tag |
| 源码包 | 19 个（`packages/evolution-*`） |
| rc.1 worktree | `D:\dsh\harness-rc1`，`dsh-v0.2.2-rc.1` / `66491b05`（仅历史） |
| rc.3 worktree | `D:\dsh\harness-rc3`，`dsh-v0.2.2-rc.3` / `38a6a5c9` |
| npm latest | `@deepseek-ai/dsh@0.2.2-rc.1` |
| rc.3 测试线 | 8 suites **96/96**，`--config vitest.family.config.mts` |
| 定向测试 | 75/75（channel 8、write-gates 30、tool-skill-manage 37），历史基线 |
| rc.3-only 编译 | 0 error |

> 4 lane gate 的读数来自 0.49.0 发布证据（`reports/24-release-0.49.0.md`），Phase 0 不重跑全量；进入发布门时重跑。

当前阻塞（详见 27 §10）：Phase 5 rc.3 Web 真机截图、Phase 6 业务边界迁移、全 lane/独立复核/0.50 元数据。

## 4. 文档

| 文档 | 用途 |
|---|---|
| [multi-version-support.md](multi-version-support.md) | 多版本目标架构、全量问题台账、P0–P3 迁移与冻结不变量（当前设计源） |
| [aux-review-completion.md](aux-review-completion.md) | aux 后台 review 的 partial/truncated、`review_done`、PTC 适配、memory/skill 拆分并行与综合目标架构 |
| [aux-review-redesign.md](aux-review-redesign.md) | aux review 目标重构：触发/调度/runner/工具通道/锁等待/PTC 的详细设计 |
| [skill-write-concurrency.md](skill-write-concurrency.md) | skill 写入并发/防双写：对标上游 fs 观察+CAS 的 SkillWriteService 综合方案 |
| [platform-ports.md](platform-ports.md) | 当前端口覆盖、直接 `ctx.get` 清单、目标 `PlatformPorts` |
| [characterization.md](characterization.md) | 行为基线：spec/用例/不变量/命令 |
| [26](D:/dsh/_research/plugin-code-audit-2026-11-09/audit-2026-11-12/reports/26-architecture-optimization-plan.md) | 目标架构（外部报告目录） |
| [27](D:/dsh/_research/plugin-code-audit-2026-11-09/audit-2026-11-12/reports/27-architecture-goal-and-document-index.md) | goal、DCR、backlog、发布门 |

> `docs/developer/architecture.md` 的 “36 个包” 是历史包组/逻辑行口径；当前物理源码包是 23 个、发布包 22 个。

## 5. 规则

- 每组问题按 27 §4 的五步走；设计先写 27 §6，再改代码。
- 改分层/包边界/阶段/发布门写 DCR。
- 新发现先入 27 §9 backlog，不擅自扩 Phase。
- Phase 0 只做基线/夹具/端口清单，不改生产行为。
