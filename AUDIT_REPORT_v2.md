# dsh-evolution 第二轮审计报告（最新版本 rc.54）

| 项 | 内容 |
|---|---|
| 审计对象 | `D:\dsh\dsh-evolution-mirror` @ git HEAD `d2374fa`（**rc.54**，2026-08-29 19:14） |
| 对比基线 | 第一轮审计（`AUDIT_REPORT.md`，2026-08-28 17:37，对应 rc.40 状态 `fa27961`） |
| 审计方式 | ① 对第一轮全部 P0/P1/P2/D/F 项逐条核码验证修复状态；② 对基线以来 24 个提交（rc.41→rc.54，约 +3957/−1736 行）的新增/重写代码全量审计；③ 上游接口关键点复核（目标宿主仍为 `dsh-upstream-0.1.1-rc.2`，`UPSTREAM_SHA` 未变） |
| 约束 | 只读审计，未修改任何代码 |

**结论摘要**：第一轮 6 个 P0 **全部确认修复**（逐条核码通过），P1 中 10 项修复、1 项按文档裁决关闭（P1-12）、1 项以"撤销投影注册"方式消解（P1-11）；P2 大部分修复；D-1/2/4/6 与 F-4/5/6/7 清理完成。整体修复质量高——多数修复带有回归测试，且 rc.45 还主动修了修复过程引入的 3 个回归。**本轮新发现 7 项问题**（2 项 P1：`list()` 保护标记判断失效、发布 peer 范围与验证平台矛盾；5 项 P2/P3），另有 4 项第一轮遗留未清（F-1、F-3、D-5、D-7）。

---

## 1. 第一轮问题修复核验（P0/P1/P2/D/F 状态表）

### 1.1 P0 — 全部确认修复 ✅

| 编号 | 修复提交 | 核码结果 |
|---|---|---|
| P0-1 会话事件致不可恢复 | rc.42 | ✅ `session.append('evolution/*')` 与 `SessionEventMap` 扩充全部移除（全仓仅剩注释）；`evolution/review-scheduled`、`evolution/plan-applied` 改为 cordis 进程事件（payload v2 带 `sessionId`，`evolution-review/src/index.ts:164,271`）；activity 改为自有持久化 store（`activity.json`，版本化、有界、含 rc.45 的 `maxItems` 钳制）；并新增持久化 resume 端到端回归测试（`persistence-resume.spec.ts`，156 行）。旧日志不可恢复的迁移说明已写入 CHANGELOG |
| P0-2 `evolution replay` 命令非法 | rc.41 | ✅ 独立命令注册删除，并入 `/evolution replay` 子命令（`evolution-commands/src/index.ts:127-130`，返回 `{kind:'success',text}`），符合上游命令名正则与返回契约 |
| P0-3 skill-usage `root:''` | rc.41 | ✅ `config.root \|\| skillsRoot()`（`skill-usage/src/index.ts:38`），注释明确 `??` 拦不住 `''` |
| P0-4 plan-validator 缺依赖 | rc.41 | ✅ `dependencies` 补 `@deepseek-ai/dsh-evolution-core`（package.json:36） |
| P0-5 fuzzy patch 死循环 | rc.41 | ✅ 双守卫：空 `oldString` 拒绝（`skill-store.ts:273`）；全空白 pattern 经 `trimPatternBoundaries` 归空后拒绝（`:280`）；`fuzzyReplace` 改为循环 + `scanFrom = start + newString.length` 进度推进（`:254-268`），自包含 newString 不会再回配，空 newString 时内容严格收缩、必然终止。附 196 行 fuzz 回归测试（`fuzzy-patch.spec.ts`） |
| P0-6 `llm.stream` 非法 purpose | rc.41 | ✅ `purpose` 已删除（curator 全文件无此字段） |

### 1.2 P1 — 10 修复 / 1 文档裁决 / 1 消解 ✅

| 编号 | 状态 | 核码证据 |
|---|---|---|
| P1-1 consolidate 回滚缺口 | ✅ rc.43 | 归档失败从 `return` 改 `throw new Error(result.message)` 进 catch 回滚（`skill-store.ts:711-725`），带抛错 IO 代理回归测试 |
| P1-2 评分/转移顺序颠倒 | ✅ rc.43 | `scoreTree` 移到 `computeLifecycleTransitions` 之前（`evolution-curator/src/index.ts:459-470`） |
| P1-3 子代理不 dispose | ✅ rc.43 | `start()` 之后全部包进 try/finally，dispose 失败 warn 不吞错（`evolution-review/src/index.ts:245-298`） |
| P1-4 state-domain open 中毒 | ✅ rc.44 | 3 次指数退避重试 + reject 时清空 `opening`（`evolution-state-domain/src/index.ts` diff），域测试覆盖 |
| P1-5 catalog 失效缺口 | ✅ rc.49（决策 C） | 事件发射下沉 `SkillLibrary.notifyMutation`（create/update/patch/archive/consolidate/restore/write_file/remove_file/快照恢复全覆盖，`skill-store.ts:319-326` 及各方法尾部）；tool/curator/graph/review 四处调用方统一经构造回调发 `ctx.emit`，tool-skill-manage 手工 emit 已删 |
| P1-6 空文件判漂移 | ✅ rc.44 | `detectDrift` 对 `raw === null \|\| raw.trim() === ''` 返回 false（`memory-store.ts`） |
| P1-7 无 state 服务 curator 即跑 | ✅ rc.43 | `(await loadCuratorState()) ?? null` 归一化，首跑延迟/间隔门/pause 门统一走 persisted 三态（`evolution-curator/src/index.ts:398-438`） |
| P1-8 控制面绕门 | ✅ rc.46（决策 B） | `EvolutionGateSet`（新文件 `evolution-core/src/gates.ts`）为唯一门源，四个消费方（lifecycle/scopeView/gateConsolidations/控制面 consolidate）全部接入；`blockReason` 给出拒绝原因；`gateConsolidations` 还补上了 protected-builtin |
| P1-9 不可批准的 pending | ✅ rc.47+rc.48 | `hasRunner(kind)` 预检 + approval 侧 staging 时 warn（`evolution-approval/src/index.ts`）；**rc.48 把 rc.47 的"直通执行"纠正为 fail-closed 拒写**（enabled 审批 + 无 runner → 跳过该 op 并可见 warn，不留 pending）——这个二段修复的方向判断是对的 |
| P1-10 计时表无界增长 | ✅ rc.43 | 阈值 128 触发按存活 agent 清扫（`sweepDeadSessionEntries`，`evolution-review/src/index.ts:122-130,457-475`） |
| P1-11 projection 双契约 | ✅ rc.42 消解 | 投影注册整体退役（`sessionProjections` 零引用），改用 activity 持久化 store——不再有与上游契约对赌的字段 |
| P1-12 前台创建不入生命周期 | ✅ rc.46 文档裁决 | 按 rc.39 对齐审计"行为与 Hermes 一致"的结论，README:249-251 记录 `manageUnmanaged` 语义；接受为设计而非缺陷 |

### 1.3 P2 — 修复面

| 编号 | 状态 | 证据 |
|---|---|---|
| P2-1 失败计数跨轮 | ✅ rc.44 | 10 分钟滚动窗口衰减（`FAILURE_WINDOW_MS`），文案保留"this turn"并在注释声明为近似 |
| P2-2 sidecar 跨进程 RMW | ✅ rc.50 | `io.transact`（O_EXCL 锁内读改写）+ `mutateUsage`/`recordMutation`/`updateSuppressedNames` 迁入；curator 抑制集改为**增量合并**（rc.52，只加本轮 additions，不复活并发删除的名，`evolution-curator/src/index.ts:689-700`） |
| P2-3 sidecar 字段不校验 | ✅ rc.44 | `normalizeUsageRecord` 逐字段归一；但见**新发现 N-3**（created_at 校验不完整） |
| P2-4 list 吞 EACCES | ✅ rc.50 | ENOENT/ENOTDIR → []，其余抛出 |
| P2-5 名字 trim 不一致 | ✅ rc.42 | `dirOf` 单点拼路径 + 各方法入口 trim |
| P2-6 N+1 IO | ✅ rc.49 | `list()` 单次目录列举替代逐 marker exists、catalog get 共享 list、快照并行拷贝；**但引入新发现 N-1** |
| P2-7 session-query 相对路径 | ✅ rc.50 | 改用上游 `dshHomePath` helper（host/preset 两份 yml） |
| P2-8 常量未单源 | ✅ rc.44 | memory-files/tool-memory 引用 `DEFAULT_MEMORY_CHAR_LIMIT/USER_CHAR_LIMIT/CONSOLIDATION_FAILURES`；包内私有 tunable 保留并在注释声明 |
| P2-9 subagent 契约未证实 | ✅ rc.47 | 三点（toolFilter/outputSchema items type:'json'/maxDepth:0）已对照 rc.2 源码验证并由 smoke 断言钉住 |
| P2-10 死赋值 | ✅ | `validation.accepted.skillOps = acceptedSkillOps` 自赋值已移除 |
| P2-11 policy.json 幽灵特性 | ✅ rc.46 删除 | `protectedPaths/isProtectedPath` 与文件工具臂整体删除 |
| P2-12 dispose 丢 flush | ✅ rc.50 | effect 返回 flush promise，cordis await |
| P2-13 feedback 装载竞态 | ✅ rc.50 | restore 经 `mutate` 队列串行 + awaitable dispose |
| P2-14 快照恢复残留 | ✅ rc.50 | 恢复前清空活动根全部非点前缀条目，manifest 为唯一恢复权威 |
| （v1 遗留）archive 同秒 stamp 冲突 | ❌ 未修 | `skill-store.ts:645-647` 仍用秒级 stamp，同秒二次归档可能互相覆盖（低危，见 N-6） |

### 1.4 D / F — 清理面

| 编号 | 状态 | 说明 |
|---|---|---|
| D-1 JsonState | ✅ rc.51 | `state-store.ts` 只剩 `evolutionHome()`，JsonState 与其测试删除 |
| D-2 MemoryStore.replace/remove | ✅ rc.44 | 已删（错误面 G5 统一走 applyBatch） |
| D-3 MemoryRegistry.snapshot | ✅ | registry 与 memory-files 的 snapshot 实现移除 |
| D-4 PUBLISH_EXCLUDE 空转 | ✅ rc.51 | 已删；prepare-release 改为强要求 `--version/--upstream-version` |
| D-5 packages/README facade 行 | ❌ 未清 | `packages/README.md:15` 仍列 `dsh-evolution | Legacy one-row facade`（包已不存在） |
| D-6 io.ts facade 叙事 | ✅ | 头注释重写为"evolution plugin family" |
| D-7 tsdown 入口含幽灵 `startup` | ❌ 未修 | `packages/tsdown.package.config.ts:6` 仍为 `lib/types/{index,invariant,startup}.js`——`startup` 不存在、入口取自 tsc 产物目录（rc.51 死代码批次漏项；CI 绿说明 glob 静默跳过，属潜伏配置债） |
| D-8 invariant 模板 ×28 | ➖ 未动 | 计划中列为低优先，合理搁置 |
| D-9 capability 挂载无入口 | ✅ rc.51 | 从 host bundle 与 preset 移除（`cordis.patch.yml`/`cordis.yml`/两份 package.json），部署方按需加行 |
| F-1 README reviewToolAllow 声称 `skill_search/skill_load` | ❌ 未清 | README.md:234/311/339 与 Config 默认 `['skill']`、host patch 注释（"该发现对工具在本平台不存在"）矛盾——第一轮已报，rc.51 文档批次未覆盖 |
| F-2 安装路径 `packages/evolution/scripts/` | ➖ 条件正确 | 决策 D2 落地后：该路径在"上游 dev tree/CI overlay"布局正确，镜像内实际路径为 `packages/scripts/`。建议 README 标注两种布局，不再算错误 |
| F-3 README 测试数字 45 files/90 tests | ❌ 过期 | 现有 spec 文件已增至 60+（新增 gates/fuzzy-patch/usage/persistence-resume/lifecycle/approval-precheck/catalog-path-consistency 等 13 个测试文件） |
| F-4 "retired at rc.18" 不可溯 | ✅ rc.51 | 改为 "v0.1.0-rc.18 release tag" 表述 |
| F-5 normalize-mirror 幽灵路径 | ✅ rc.51 | 注释改为 D2 口径 |
| F-6 minimal preset 场景表 | ✅ rc.51 | 已消解（按 D2 口径重写 README 场景章节） |
| F-7 INSTALL 测试命令路径 | ✅ 同 F-2 口径 | |

### 1.5 优化计划（OPTIMIZATION_PLAN.md）落地度

M0 全部 7 步完成；M1 全部完成（含 1.6 fuzz 属性测试）；M2 完成 2.0–2.4、2.7–2.9（2.5 以"阈值清扫"替代理想方案，2.6→3.3 已做）；M3 完成 3.1/3.3/3.4/3.6/3.7（3.2 部分、3.5 replay 按设计保持内存态由 activity store 承担持久化）；M4 完成 4.1（决策 D2：发布走 CI overlay，镜像不做独立构建——rc.51 提交明确声明）/4.2/4.4 部分/4.5/4.6（双锚点验证 + compat 硬门）/4.7 未动（合理）。横切决策 A/B/C/D 全部落地且有测试。

---

## 2. 本轮新发现（rc.41→rc.54 引入/暴露）

### N-1（P1 · 报告面回归）`SkillLibrary.list()` 保护标记判断带错名字，protectedBy/managed 永远为空

- 位置：`packages/evolution-core/src/skill-store.ts:337-351`。
- rc.49 的 P2-6 修复把逐 marker `exists()` 探测改为**一次 `io.list(dir)` + `entries.includes(marker)`**；但 `markerPath()` 生成的标记文件是**点前缀**（`.bundled`/`.hub-installed`/`.pinned`/`.hermes-managed`，`:111-113`），readdir 返回的条目名带点，`has('bundled')` 等比较**永远不命中**（除非目录里恰好存在无点同名文件）。
- 影响链：
  - `curator.protectedNameMap()`（`evolution-curator/src/index.ts:819`）恒空 → `computeScopeView` 的 `protected` 名单恒空 → `/evolution curator scope` 对 pinned/bundled/hub 技能的保护状态失真；
  - `skill_manage review` 的 `[bundled]`/`[pinned]` 标注永不显示（`tool-skill-manage/src/index.ts:138`），模型据此判断"哪个技能受保护"时得到系统性错误信息；
  - `list().managed` 恒 false。
- **执行面不受影响**：`writeProtection/deleteProtection/isBundled/isPinned` 仍走 `exists()`（点前缀路径正确），curator 生命周期门控正常——所以这是一个纯报告/可观测性回归，但恰好毒害的是给模型和运维看的两个面。
- 测试缺口：`skill-store.spec.ts` 只有写入 `.bundled` 后断言**保护拒绝**（:205），没有断言 `list()` 的 `protectedBy`。
- 建议修复方向：`const has = (m) => entries.includes('.' + m)` 或统一比较 `markerPath` 结果。

### N-2（P1 · 发布配置矛盾）发布的 peer 范围与 compat 硬门验证的平台不一致

- 位置：`.github/workflows/release.yml:18`（`UPSTREAM_VERSION: 0.1.0-rc.6`）→ `prepare-release.mjs releaseSpec()`（`@deepseek-ai/dsh-*` peer 一律重写为 `^0.1.0-rc.6`）。
- rc.53/54 把 `compat-check`（验证 `dsh-v0.1.1-rc.2`）升级为 **publish 的硬门**，但发布物的 peerDependencies 仍声明 `^0.1.0-rc.6`。按 npm semver 语义，`^0.1.0-rc.6` **不匹配 `0.1.1-rc.2`**（不同 [major,minor,patch] 元组的 prerelease 不被 `^` 范围命中）。
- 结果：代码被证明与 0.1.1-rc.2 兼容，但发布包在 0.1.1-rc.2 宿主上做严格 peer 解析时会被声明排除——"验证的平台"与"声明的平台"分裂。
- 同时，"版本单源"（prepare-release 头注释自称 workflow env 是唯一钉版本处）实际是**三处口径并存**：`UPSTREAM_SHA`（baseline 验证）/`dsh-v0.1.1-rc.2`（compat 门）/`0.1.0-rc.6`（发布 peer 范围），第三处落后于第二处。
- 建议：`UPSTREAM_VERSION` 与 compat 门锚点同源（同一变量/文件），发布 `0.1.1-rc.2` 兼容版时 peer 范围升为 `^0.1.1-rc.2`（或放宽为 `>=0.1.0-rc.6` 区间并注明）。

### N-3（P2）`normalizeUsageRecord` 对 `created_at` 的校验与声明不符，垃圾字符串仍能产出 NaN

- 位置：`packages/evolution-core/src/usage.ts`（`created_at: typeof raw.created_at === 'string' ? raw.created_at : base.created_at`）。
- 注释与 CHANGELOG 声称 "an invalid `created_at` anchors the age clock at now"，实现只挡**非字符串**；`created_at: "not-a-date"` 通过校验 → `new Date('not-a-date')` 为 Invalid → `quality.computeQualityScores` 的 `daysBetween` 得 NaN → `usageFrequency = clamp01(NaN) = NaN` → score 为 NaN 且 `warn: NaN < 0.3 === false`；curator `daysSince` 同样 NaN，使该记录的 idle 比较恒 false（永不转移）。这正是 P2-3 要消灭的 NaN 传播类，只是从"错误类型"换成了"非法内容"。
- 测试缺口：`usage.spec.ts` 只覆盖非字符串（:34）与合法 ISO（:40）两例。
- 建议：`Number.isFinite(Date.parse(value))` 校验后才保留，否则锚定 now。

### N-4（P2）`activity.json` 的 RMW 未接入 `io.transact`，与 rc.50 的侧车加固不一致

- 位置：`packages/evolution-activity/src/index.ts:123-133`——事件落盘是 `loadActivity → applyActivityEvent → saveActivity`，进程内 chain 串行，但读写用裸 `readText/writeText`。
- rc.50 已为 usage/mutations/suppressed 建立了"跨进程事务"标准（`transactIo`，读改写全程持锁），activity 是**同批次新增的同类侧车**却没有跟进：多进程共享 DSH_HOME 时两个宿主各持一份内存 items 交替整文件重写，会互相覆盖丢失记录（每文件还有界 200 条，丢失面可控，但与自述"records survive host restarts"的多进程语义不完整）。
- 建议改走 `transactIo(io, activityFile(root), task)`，load/fold/save 收进同一事务。

### N-5（P2）rc.53 组合生成无行 id 冲突检测

- 位置：`packages/scripts/install-layered.mjs` `generateAgentPreset()`（:237-239）——把运行时 `standard` 组合与 delta（`tool-memory`/`tool-skill-manage`/`tool-session-query`/`evolution-skill-catalog`）纯文本拼接。
- 已核对 rc.2 的 `standard/agent.cordis.yml` 不含这四个 id，当前安全；但该机制的设计目标恰是"跟随任意未来平台版本"——一旦上游 standard 未来挂载 `tool-session-query`（最可能的撞名），生成的 preset 就含重复行 id，loader 行为未经验证。安装器既不检测也不去重。
- 建议：生成前对两侧行 id 求交集，非空时 fail loud（或在 README 记录该前提）。
- 附带小点：Windows 全局 root 用 APPDATA 固定布局猜测，自定义 npm prefix 的用户会得到"找不到 standard"的响亮报错——fail loud 可接受，但报错文案可补充该情形。

### N-6（P2/P3 · 遗留未清）杂项

1. `SkillLibrary.archive` 归档目标同秒 stamp 冲突仍在（第一轮 P2 遗留）：同秒对同名技能两次归档 → 相同 `name-<stamp>` 目标 → `copy(force)` 覆盖/混树（`skill-store.ts:645-647`）。snapshotAll 在 rc.43 加了同毫秒守卫，archive 没有对齐。
2. `retainSnapshots` 注释 "oldest folded into .backups history" 与行为（直接删除）不符（`skill-store.ts:896`）。
3. `consolidate()`（`skill-store.ts:676`）注释与代码挤在同一行，可读性回归（rc.42 修复时引入）。

### N-7（P3 · CI 观察项）

1. composite action 在 `copy_host_tsconfig: 'false'`（released 锚点）分支**仍覆盖上游 `tsconfig.base.json`**（action.yml:41）——mirror 副本与上游该文件一旦分叉，"released 验证"就不再纯。当前两树一致所以绿，属隐性耦合，建议该分支不覆盖 base 或校验 diff 为空。
2. publish job 只发布 **baseline** 产物，compat 门只是拦截不产发布物（设计如此；意味着最终发布物在 released 树上验证过、但被打包的是 baseline 树——两者当前等价，记录在案即可）。
3. `UPSTREAM_VERSION` 的 stale 问题已单列为 N-2。

---

## 3. 上游接口（0.1.1-rc.2）复核增量

- P0-1 修复后插件与持久化白名单的冲突**解除**：会话日志回归 native-only，进程事件走 cordis Events（声明合并合规）。
- 新的持久化依赖面：activity store / feedback / usage / mutations / suppressed / curator state 全部走 `evolutionIo`（node provider，原子写 + 事务），不再触碰宿主会话设施。
- rc.53 组合拼接依赖上游 `standard` 预设的当前形状（顶层行列表、无尾随元数据）——已核对成立；见 N-5 的前瞻风险。
- 其余第一轮 §5.2/§5.3 的结论维持；`UPSTREAM_VERSION` stale 一项升级为 N-2。

---

## 4. 总体评价与建议

**修复质量**：24 个提交对 33 项第一轮问题做了系统性收口，多数修复带针对性回归测试（fuzzy-patch 196 行 fuzz、persistence-resume 端到端、approval-precheck、gates 矩阵等），并且两次主动复审（rc.45、rc.48）抓出了自身引入的回归——rc.48 把 rc.47 的"直通执行"纠正回 fail-closed 尤其体现正确的安全取向。架构横切决策（A 事件通道、B 门单源、C 事件下沉、D2 发布载体）全部落地且方向正确。

**本轮需优先处理**（按序）：
1. N-1：一行修复（`'.' + marker`）+ 补 `protectedBy` 断言——不修会让 scope/review 两个报告面持续失真。
2. N-2：`UPSTREAM_VERSION` 与 compat 锚点同源，发布前必须解决，否则 0.1.1-rc.2 用户装到的包声明不支持其平台。
3. N-3：`created_at` 加 `Date.parse` 有效性校验 + 回归用例。
4. N-4：activity store 迁入 `transactIo`。
5. N-5：组合生成加 id 冲突检测（防未来平台演进）。
6. 清遗留：F-1（README reviewToolAllow）、F-3（测试数字）、D-5（README facade 行）、D-7（tsdown 幽灵入口）、N-6 杂项。

**统计**：本轮新发现 7 项（P1×2、P2×4、P3 观察一组）；第一轮遗留未清 5 项（F-1、F-3、D-5、D-7、archive stamp 冲突）；其余第一轮问题全部关闭或按文档裁决消解。
