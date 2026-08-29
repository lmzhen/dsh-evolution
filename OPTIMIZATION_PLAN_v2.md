# dsh-evolution 第二轮分层优化计划（基于 rc.54）

> 依据：`AUDIT_REPORT_v2.md`（2026-08-29 第二轮审计，对象 git `d2374fa` / rc.54）。
> 前序：`OPTIMIZATION_PLAN.md`（第一轮计划）的 M0–M4 已基本落地（见 §2 落地度回顾），横切决策 A/B/C/D 均已实施并有测试。
> 本文只做计划，不改代码。编号沿用第二轮审计：`N-*`（新发现）、`F-*`/`D-*`（遗留项）。

---

## 1. 架构分层模型与本轮问题分布

延续第一轮的分层坐标系，标注 rc.54 现状与本轮待办：

```text
L6 组合/发布层   evolution-host / evolution-agent(Δ-only) / evolution-preset
                scripts/install-layered.mjs(rc.53 组合生成) · prepare-release / publish-scoped
                CI 双锚点验证 + compat 硬门(rc.54) · README/INSTALL
                本轮：N-2 版本口径分裂 · N-5 组合生成无撞名检测 · N-7 CI 覆盖纯度
                      D-7 tsdown 幽灵入口 · F-1/F-3/D-5 文档遗留     ← 本轮主战场
L5 观测与人机层  evolution-activity(rc.42 持久化 store) · feedback · graph · replay(并入 /evolution) · commands
                本轮：N-4 activity.json 未接入事务
L4 编排/自治层  evolution-review · evolution-curator
                本轮：无新发现（rc.41–54 修复已闭环）
L3 模型面      tool-memory · tool-skill-manage · evolution-skill-catalog
                本轮：无新发现（报告面受 N-1 毒害，修复点在 L0）
L2 控制面      policy(幽灵特性已删) · approval(hasRunner 预检) · threat · plan-validator · capability(已 opt-in)
                本轮：无新发现
L1 介质/seam 层 evolution-io(transact/isSymlink) · memory(-files) · skill-usage · state 四件套
                本轮：无新发现（N-4 的修复手段在 L1 工具层）
L0 共享核心层   skill-store / memory-store / usage / mutations / gates / io
                本轮：N-1 list() 标记判断失效(报告面回归) · N-3 created_at 校验不完整
                      N-6 archive 同秒 stamp 冲突 + 注释失实
横切面         并发模型(已统一 transact+chain) · 门体系(GateSet 单源) · origin 表(resolveOrigins)
                事件通道(进程事件，会话日志 native-only) · 测试与发布基线
                本轮：建立"报告面契约测试/侧车事务清单/版本口径守卫"三条防回归线
```

本轮问题规模与第一轮不同：**没有 P0**，全部是点状修复 + 发布工程收口。因此计划从"五个里程碑"收缩为 **三个里程碑 + 一条贯穿性防回归线**，原则是"小爆炸半径、回归测试先行、每个修复都顺手补上让同类回归逃不掉的测试"。

---

## 2. 第一轮计划落地度回顾（本计划的前提）

| 里程碑 | 状态 | 备注 |
|---|---|---|
| M0 止血（P0×6 + 测试通道） | ✅ 全部关闭 | 测试通道最终走决策 D2 的 CI overlay（镜像内不独立构建） |
| M1 L0/L1 加固 | ✅ 关闭 | fuzzy fuzz 属性测试、sidecar 事务化、字段归一均已落地 |
| M2 L2/L4 治理 | ✅ 关闭 | GateSet 单源、curator 调序/暂停门、review dispose/清扫、fail-closed 预检 |
| M3 L3/L5 收敛 | ✅ 关闭 | 事件下沉 SkillLibrary、投影退役、replay 并入命令族 |
| M4 L6 工程化 | ✅ 大部分 | 决策 D2（发布走 CI overlay）、路径/文档批次、双锚点 + compat 硬门；D-7 与版本口径两条尾巴遗留（即本轮 N-2/D-7） |
| 决策 A/B/C/D | ✅ 全部实施 | A：进程事件 + activity store；B：GateSet；C：notifyMutation 单发射点；D2：镜像=发布载体，dev tree=构建载体 |

---

## 3. 里程碑总览

| 里程碑 | 主题 | 覆盖层 | 覆盖问题 | 预估 |
|---|---|---|---|---|
| **R0 基线** | 确认双锚点绿基线 | 横切 | — | 半天 |
| **R1 止血** | 两个 P1（报告面回归 + 发布口径） | L0 + L6 | N-1、N-2 | 0.5–1 天 |
| **R2 加固** | 数据/事务/组合生成健壮性 | L0 + L1/L5 + L6 | N-3、N-4、N-5、N-6 | 1–2 天 |
| **R3 工程收口** | 构建/CI/文档尾巴 | L6 + 横切 | N-7、D-7、F-1、F-3、D-5 | 1 天 |

依赖：R0 → R1 → R2 → R3；R3 的文档批与 R2 可并行。

---

## 4. R0 — 基线（前置）

| 步骤 | 层 | 动作 | 验收 |
|---|---|---|---|
| 0.1 | 横切 | 确认 `validate`（UPSTREAM_SHA）与 `compat-check`（dsh-v0.1.1-rc.2）两条 CI 链在 HEAD 为绿；本地如需复现，按 action.yml 的 overlay 步骤手工铺树 | 双锚点绿；后续每步的"验收"都在这两条链上跑（vitest + oxlint + pack + publish dry-run） |

---

## 5. R1 — 止血（P1 × 2）

### 5.1 N-1：`SkillLibrary.list()` 保护标记判断失效（L0，报告面回归）

- **位置**：`packages/evolution-core/src/skill-store.ts:337-351`——`has('bundled')` 等比较的是 readdir 原始条目名，而标记文件是点前缀（`.bundled/.hub-installed/.pinned/.hermes-managed`，`markerPath()` :111-113）。
- **动作**：
  1. `const has = (marker: string) => entries.includes(`.${marker}`)`（或统一与 `markerPath` 对齐的单一 helper，杜绝两处字面量）；
  2. **补报告面契约测试**（这是本轮防回归线的第一块样板，见 §8）：
     - `skill-store.spec`：目录含 `.pinned` → `list()[i].protectedBy === 'pinned'`；含 `.hermes-managed` → `managed === true`；三标记同时存在时优先级 bundled > hub-installed > pinned；
     - `curator.spec`：pinned 技能出现在 `scopeView().protected` 中（防 `protectedNameMap` 再次断链）；
     - `tool-skill-manage.spec`：review 文本含 `[pinned]` 标注。
- **验收**：三个测试在修复前红、修复后绿；`/evolution curator scope` 与 `skill_manage review` 输出恢复保护标注。

### 5.2 N-2：发布 peer 范围与 compat 硬门验证的平台一致（L6）

- **位置**：`release.yml:18`（`UPSTREAM_VERSION: 0.1.0-rc.6`）→ `prepare-release.mjs releaseSpec()` 把 `@deepseek-ai/dsh-*` peer 重写为 `^0.1.0-rc.6`；而 compat 门验证 `dsh-v0.1.1-rc.2`（semver 下 `^0.1.0-rc.6` 不匹配 `0.1.1-rc.2`）。
- **动作**：
  1. 版本口径收敛为一处：workflow 只保留一个 `PLATFORM_VERSION`（与 compat 门 `upstream_ref` 同源，如 `dsh-v0.1.1-rc.2` ↔ `0.1.1-rc.2`），baseline 的 `UPSTREAM_SHA` 保持为"开发钉点"仅用于 validate job，不再参与发布元数据；
  2. `releaseSpec()` 的 dsh-* 分支改用 `PLATFORM_VERSION`（发布 peer 范围 `^0.1.1-rc.2`）；
  3. **加 CI 口径守卫**：pack 后断言任一 manifest 的 dsh-* peer 范围 === `^${PLATFORM_VERSION}`，不一致即 fail（防再次漂移，见 §8）；
  4. CHANGELOG/README 注明 semver prerelease 语义（`^0.1.1-rc.2` 匹配 0.1.1-rc.2+，不匹配 0.1.0.x），以及旧 peer 包的升级路径。
- **验收**：dry-run 产物中抽查 manifest peer 范围与 compat 锚点一致；守卫步骤存在且对人为错配会红。

---

## 6. R2 — 加固（P2 × 4）

### 6.1 N-3：`created_at` 有效性校验（L0）

- **位置**：`packages/evolution-core/src/usage.ts` `normalizeUsageRecord`——只查 `typeof === 'string'`，垃圾字符串（`"not-a-date"`）→ `Invalid Date` → NaN 传入质量分与生命周期比较。
- **动作**：`created_at` 通过 `Number.isFinite(Date.parse(value))` 才保留，否则锚定 `base.created_at`（= now，符合注释已声明但未实现的语义）；`last_used_at/last_viewed_at/last_patched_at/archived_at` 同步加同一判定（isTimestamp 目前也只查类型）。
- **测试**：`usage.spec` 增加 `"not-a-date"` / `"2026-13-99"` 用例；`quality.spec` 增加脏记录 → score 为有限数、warn 为布尔；`curator.spec` 增加脏记录不参与/正常参与转移。
- **验收**：NaN 不再可能进入 `computeQualityScores` 与 `computeLifecycleTransitions`（三个测试面各一条红转绿）。

### 6.2 N-4：activity store 接入 `io.transact`（L1 工具 + L5 消费）

- **位置**：`packages/evolution-activity/src/index.ts:123-133`——裸 `readText + writeText` RMW，仅进程内 chain。
- **动作**：load→fold→save 收进 `transactIo(io, activityFile(root), task)`（`task` 返回整份 JSON）；`ActivityIoLike` 扩展可选 `transact` 或直接复用 core 的 `EvolutionIoLike`（推荐后者，删除本地接口复制）；保留进程内 chain 作为第二层。
- **测试**：两个并发 fold 的交错模拟（fake io 延迟）在 transact 下不丢记录；无 `transact` 的 fallback io 路径行为不变。
- **验收**：与 usage/mutations/suppressed 同一事务标准；`§8` 的侧车清单更新。

### 6.3 N-5：组合生成加行 id 冲突检测（L6）

- **位置**：`packages/scripts/install-layered.mjs` `generateAgentPreset()`（:237-239）——运行时 standard 与 delta 纯拼接，无撞名检测（已核对 rc.2 当前无冲突，风险在未来平台演进，最可能的撞名是 `tool-session-query`）。
- **动作**：
  1. 拼接前用轻量行解析（`/^- id:\s*(\S+)/`）取两侧 id 集合，交集非空 → 抛错并列出撞名 id（fail loud，与该函数"猜基线宁可报错"的既有取向一致）；
  2. 提供 `DSH_EVOLUTION_ALLOW_ROW_COLLISIONS=1` 显式逃逸（警告 + 继续），供上游未来把某行收编进 standard 时过渡；
  3. 测试：用包含 `tool-session-query` 的 standard fixture 断言抛错；用 rc.2 真实 standard 断言生成结果与当前快照一致。
- **验收**：两种 fixture 各一条测试；现有 installer.spec 不回归。

### 6.4 N-6：L0 杂项收口

- `archive()` 同秒 stamp 冲突（`skill-store.ts:645-647`）：对齐 `snapshotAll` 的同毫秒守卫思路——`while (await exists(dest))` 加随机后缀；测试：同一秒内两次 archive 同名技能产生两个不同 dest 且内容各自完整。
- `retainSnapshots` 注释（:896 "oldest folded into .backups history"）改为与行为一致的表述（直接删除，keep=5）。
- `consolidate()`（:676）注释与代码挤行还原为正常格式。

---

## 7. R3 — 工程收口（L6 + 横切）

### 7.1 D-7：tsdown 入口配置（L6 构建）

- **位置**：`packages/tsdown.package.config.ts:6`——`entry: ['lib/types/{index,invariant,startup}.js']`，`startup` 不存在、入口取自 tsc 产物目录。
- **动作（二选一，倾向 a）**：
  - a. 最小修正：glob 改为 `{index,invariant}`，头注释写明两段式管线（先 tsc 产 `lib/types`，tsdown 只做 JS 转译）——不动管线，风险最低；
  - b. 彻底修正：entry 直指 `src/*.ts`，验证 `files`/exports 与 `lib/types` 声明仍满足——收益是单一构建面，但需在 CI 双锚点全链验证。
- **验收**：`build-lib.mjs` 在两条 CI 链上产出可用 `lib/`，pack 校验（main/exports 存在性）不红。

### 7.2 N-7：CI 纯度（L6）

1. composite action 的 `copy_host_tsconfig: 'false'`（released 锚点）分支**不覆盖**上游 `tsconfig.base.json`（或覆盖前断言 diff 为空，diff 非空即红——把"两树该文件应一致"变成显式契约）；
2. 在 `docs/release/decisions.md` 记录 publish 只用 baseline 产物、compat 门为拦截不产发布物的既定设计。

### 7.3 文档批次（L6）

| 项 | 动作 |
|---|---|
| F-1 | README:234/311/339 的 `skill_search/skill_load` 表述改为与 Config 默认 `['skill']`、host patch 注释一致；保留 `reviewToolAllow` 作为扩展示例但注明平台现状 |
| F-3 | README:360 的静态测试数字（45 files/90 tests）改为中性表述（"由 CI 双锚点持续验证"）或移除，避免再次过期 |
| D-5 | `packages/README.md:15` 删除 `dsh-evolution` facade 行；顺带核对 :61 的 `id: dsh-evolution` 示例是否会被误读为已退役包名，必要时改 id |
| 布局注记 | 在 README/INSTALL 用一句话写明双布局路径：dev tree/CI overlay 为 `packages/evolution/scripts/`，镜像内为 `packages/scripts/`（F-2 的最终口径） |

---

## 8. 横切面：三条防回归线（本轮的元产出）

第二轮的两个 P1 本质都是"修复某问题时引入同类回归、且缺契约测试兜底"。本轮把防线固化下来：

1. **报告面契约测试**（N-1 教训）：凡被用户/模型可见面消费的字段（`protectedBy`、`managed`、quality 文本、scope 名单），必须有针对**磁盘真实形态**（点前缀标记文件）的断言；重写实现时这些测试先行存在。
2. **版本口径守卫**（N-2 教训）：平台版本只允许一个定义点，CI 在 pack 后机械比对发布元数据与 compat 锚点；任何漂移红灯。
3. **侧车事务清单**（N-4 教训）：维护"全部 RMW 侧车文件"清单（usage / mutations / suppressed / activity / feedback / curator-state），清单上每个文件对应一条"transact 存在且 fallback 行为不变"的测试；新增侧车必须入清单（写进 `docs/release/decisions.md`）。

---

## 9. 风险与回滚

| 风险 | 影响 | 缓解 |
|---|---|---|
| N-2 改 peer 范围可能影响已按 `^0.1.0-rc.6` 安装的用户 | 已发布包 | 已装包不受影响（安装时已解析）；新包以 `--tag next` 发布并在 CHANGELOG 声明支持范围 |
| D-7 若选方案 b（entry 指 src）动摇打包管线 | 构建 | 默认走方案 a（最小修正）；b 仅在 a 验证后另行评估 |
| N-5 fail-loud 可能挡住上游"收编了 delta 行"的新平台安装 | 安装器 | 提供 `DSH_EVOLUTION_ALLOW_ROW_COLLISIONS` 逃逸 + 报错文案说明两种处置 |
| N-4 transact 给 activity 增加锁竞争 | L5 | plan-applied 频率低（每轮 review 至多一次），且 200 条上限使文件很小；风险可忽略 |
| N-6 archive 守卫改动触碰归档路径 | L0/L4 | 纯新增 while-exists 循环，现有 archive 测试全量回归 |

## 10. 明确不做（Scope 控制）

- 不重写 fuzzy patch 为正则/差分算法（P0-5 守卫已消除危害）。
- 不为 activity 引入 storage-domain 表（rc.42 审计已裁决 defer）。
- 不动 GateSet / resolveOrigins / 事件通道三项已收敛的横切决策，除非测试暴露缺口。
- 不重启 D-8（28 份 invariant 模板去重）与 D-9（capability 调用面）——维持 rc.51 的搁置/opt-in 结论。
- 不在安装器中引入 YAML 解析库——保持行级解析 + 冲突检测的最小实现。
- 不在本轮变更 P1-12 的生命周期语义（rc.46 已按对齐审计裁决并写入 README）。

## 11. 建议提交切分

| 提交 | 内容 | 附带测试 |
|---|---|---|
| rc.55 | N-1 修复 + 报告面契约测试（§5.1） | skill-store/curator/tool-skill-manage 三面 |
| rc.56 | N-2 版本口径收敛 + CI 守卫（§5.2） | pack 断言步骤 |
| rc.57 | N-3 + N-6（L0 数据卫生批） | usage/quality/curator/archive 用例 |
| rc.58 | N-4 + N-5（事务 + 组合生成健壮性） | activity 交错用例、installer fixtures |
| rc.59 | D-7 + N-7 + 文档批次（工程收口） | tsconfig 契约断言 |

每提交保持"代码 + 回归测试 + CHANGELOG"三件套，沿用 rc.45/rc.48 以来的自审惯例：合入前对上一提交做一次聚焦复审，重点看修复是否引入新面（本轮 N-1 即上轮 P2-6 修复的次生回归）。
