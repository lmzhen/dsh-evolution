# dsh-evolution 分层优化计划

> 依据：`AUDIT_REPORT.md`（2026-08-28 全量审计）。本文只做计划，不改代码。
> 编号沿用审计报告：`P0-*`（高危）、`P1-*`（中危）、`P2-*`（低危）、`D-*`（死代码）、`F-*`（文档漂移）。

---

## 1. 架构分层模型（优化工作的坐标系）

```text
L6 组合/发布层   evolution-host / evolution-agent / evolution-preset
                scripts/install-layered.mjs · prepare-release / publish-scoped / build-lib
                tsconfig 体系 · CI · README/INSTALL/CHANGELOG
L5 观测与人机层  evolution-activity · evolution-feedback · evolution-learning-graph
                evolution-replay · evolution-commands
L4 编排/自治层  evolution-review · evolution-curator          ← 后台自治的两台发动机
L3 模型面      tool-memory · tool-skill-manage · evolution-skill-catalog
L2 控制面      evolution-policy · evolution-approval · evolution-threat
                evolution-plan-validator · evolution-capability
L1 介质/ seam 层 evolution-io(-node) · memory(-files) · skill-usage
                evolution-state-storage / -domain / -json / evolution-state
L0 共享核心层   evolution-core（MemoryStore / SkillLibrary / threats / usage
                / mutations / curator 生命周期 / quality / prompts / signals）
横切面         并发模型 · 门(gate)体系 · origin 语义 · 事件通道 · 测试与发布基线
```

三条排程原则：

1. **自底向上修复，自顶向下止血**——P0 中会直接造成数据不可用/装载崩溃的问题（不依赖分层顺序）先落；其余按 L0→L6 依赖序推进，避免上游层改动被下层返工作废。
2. **每个里程碑以"横切面决策"开路**——凡涉及两个以上层的语义（事件通道、gate 体系、origin 映射），先在横切面拍板，再分层落地，杜绝同一语义三处实现（现状的病根）。
3. **每步必须可验收**——现状测试只能在上游 monorepo 跑（审计·架构张力 1），因此 M0 的第一件事是恢复镜像内可验证性，否则后续所有"验收"都是空话。

---

## 2. 里程碑总览

| 里程碑 | 主题 | 覆盖层 | 前置 | 预估规模 |
|---|---|---|---|---|
| **M0 止血** | 恢复可用性与可验证性 | 横切 + L3/L5/L6 | 无 | 小（6 个点状修复 + 测试脚手架） |
| **M1 核心与介质加固** | L0/L1 数据正确性 | L0、L1、横切(并发) | M0 | 中 |
| **M2 控制面与编排治理** | 门体系统一、自治层修正 | L2、L4、横切(gate/origin) | M1 | 中偏大 |
| **M3 模型面与观测层收敛** | 写通道事件化、观测修正 | L3、L5 | M2 | 中 |
| **M4 组合与工程化** | 构建/发布/文档基线对齐 | L6、横切(基线) | M0（文档部分可与任意里程碑并行） | 中 |

依赖链：`M0 → M1 → M2 → M3 → M4(构建部分)`；`M4` 的文档与基线部分只依赖 M0，可并行。

---

## 3. 需要先拍板的架构决策（横切面）

以下 4 个决策决定 M1–M3 的具体形态，建议在 M0 结束前定稿，写入 `packages/docs/design-review/`。

### 决策 A：`evolution/*` 会话事件的持久化通道（影响 L4→L5）
- **问题**：`session.append` 写入的自定义事件使会话日志不可恢复（P0-1），而 activity 投影（L5）目前以会话事件为数据源。
- **候选方案**：
  - A1（推荐，短期）：`evolution/review-scheduled`、`evolution/plan-applied` 改为 `ctx.emit` 进程内事件；activity/plan 记录改存 **evolution-state 自有表**（seam 已存在，天然跨介质），投影改为从该表派生。会话日志里不再出现任何 `evolution/*`。
  - A2（长期）：跟踪上游"插件事件注册面"（`known-event-types.ts` 头注释明确留了口子），等其落地后恢复 session.append + `ignorable`。
- **验收底线**：任何部署下，含 evolution 活动的会话必须可 resume（以 0.1.1-rc.2 `assertEventsSupported` 为判据）。

### 决策 B：统一"门(gate)体系"为单一模块（影响 L2/L4/L5）
- **问题**：三套门集合各不相同——`lifecycleCandidate`（L0）、`gateConsolidations`（L4，exclude/referenced/suppressed）、控制面 `consolidate()`（仅 exclude）（P1-8）。
- **方案**：在 evolution-core 抽出 `EvolutionGateSet`（pinned / bundled / hub / exclude / referenced / suppressed / protected-names 一个不缺），四个消费方（lifecycle 引擎、scope view、LLM 提名门、控制面 consolidate/commands）全部改为引用同一实例。门集合为"闭集 + 单测快照"，新增保护类别只改一处。
- **验收**：任意门类别 × 任意入口（自动/LLM 提名/人工命令）的矩阵测试全部拒绝。

### 决策 C：skill 变更事件的唯一发射点（影响 L3/L4/L5）
- **问题**：`evolution/skill-mutated` 只在 tool-skill-manage 发射，curator/graph/restore 路径漏发，catalog 失配（P1-5）。
- **方案**：把发射下沉到 **SkillLibrary 的变更方法内部**（构造时注入 emit 回调，或 core 定义 `SkillMutationListener` seam），所有写路径（工具/curator/consolidate/restore/snapshot-restore）自动覆盖；删除 tool-skill-manage 里的手工 emit。
- **验收**：catalog 失效与磁盘树一致性测试（写→立刻 list 原生 ctx.skills 目录）。

### 决策 D：镜像构建布局二选一（影响 L6 全部）
- **问题**：仓库自居独立镜像，但 tsconfig/构建/测试均指向上游 monorepo 布局（审计·架构张力 1、D-7）。
- **候选**：
  - D1（推荐原文）：镜像内自成构建——修正各包 tsconfig（extends 根 base、去掉 vendor/app references）、`tsdown.package.config.ts` 入口改为 `src/*.ts`、镜像内置最小 vitest 工程，跑全部 51 个 spec。
  - D2：明确声明"构建只在上游树进行"，删除镜像内误导性配置，README 写死前置条件。
  - **定稿（rc.51）**：采纳 **D2**——构建/测试复用上游 monorepo（`UPSTREAM_SHA` overlay），镜像只承载发布；D1 收益低于成本。
- **无论选哪个**：`packages/evolution/scripts/...` 与 `packages/scripts/...` 的路径分裂必须消除（F-2）。

---

## 4. M0 — 止血（P0 全清 + 可验证性）

| 步骤 | 层 | 来源 | 动作 | 验收 |
|---|---|---|---|---|
| 0.1 | 横切 | 架构张力 1 | 按决策 D 搭建镜像内测试/类型检查通道（最小 vitest + tsc） | `vitest run` 在镜像内可执行，现存 51 个 spec 的基线通过/失败清单产出 |

> **已裁决（rc.51 决策 D = D2）**：构建与测试只在上游树进行，镜像只承载发布——本行随 D2 隐式取消（原取代关系详见已归档的集成计划）。
| 0.2 | L4→L5 | P0-1 | 按决策 A1 改事件通道；对**已写坏**的会话日志提供检测说明（文档：遇到 `SessionFormatUnsupportedError` 的处置） | 含 evolution 活动的会话 restart/resume 通过；会话日志 0 个 `evolution/*` 类型 |
| 0.3 | L5 | P0-2 | `evolution replay` → 改名 `evolution-replay`（或并入 `/evolution replay` 子命令由 evolution-commands 承接，推荐后者以减少命令数量）；handler 返回 `{kind:'success',text}` | commands 注册不抛错；运行时返回形状过校验 |
| 0.4 | L1 | P0-3 | skill-usage root 改 `rawConfig.root || skillsRoot()`，与其余 4 处写法对齐 | 未配置 root 时 sidecar 落在 `~/.dsh/skills/.usage.json` |
| 0.5 | L0/L2 | P0-4 | plan-validator 补 `@deepseek-ai/dsh-evolution-core` dependencies | 干净目录 `npm i` 后可解析加载 |
| 0.6 | L0 | P0-5 | fuzzy patch 加两道守卫：①空/全空白 pattern 直接返回"未找到"；②`fuzzyReplace` 改循环 + 每轮进度断言（替换后必须不再匹配才继续） | 空串/自包含 new_string 两类回归用例；不再栈溢出 |
| 0.7 | L4 | P0-6 | 删除 `purpose` 或收敛到上游联合；同时移除 curator 硬编码 provider 默认值的隐性依赖（与 F-3 基线对齐一并做可延后） | tsc 对 0.1.1-rc.2 类型零报错 |

**M0 出口标准**：P0-1~P0-6 全部关闭；镜像内 `tsc + vitest` 可运行；一条端到端冒烟（触发 review → 无 session.append → resume 成功）。

---

## 5. M1 — L0 共享核心层 + L1 介质层加固（数据正确性）

### L0 组（evolution-core）

| 步骤 | 来源 | 动作 | 验收 |
|---|---|---|---|
| 1.1 | P1-6 | `detectDrift` 将 `raw === ''`（及纯空白）视为"从未写入"，不判漂移 | 0 字节/空白文件上 add/replace/applyBatch 全部成功 |
| 1.2 | P2-1 | `failureCount` 增加 turn 边界重置（review 每轮 foldTurn 时调 `resetFailures`，或计数器带时间窗）；文案与行为一致 | 跨 turn 后第 1 次失败仍给普通失败文案 |
| 1.3 | P2-3 | `loadUsage`/`loadMutations` 增加字段级类型归一（数值字段非数值→按 emptyRecord 兜底或拒绝该条） | 损坏 sidecar 回归用例：NaN 不再进入 quality/生命周期计算 |
| 1.4 | P2-5 | `SkillLibrary` 全部方法统一先 normalize name 再拼路径（抽 `private dirOf(name)`） | 带首尾空格的名字在 create/update/patch/archive 行为一致 |
| 1.5 | D-1/D-2/D-3 | 删除 `state-store.ts`(JsonState)、`MemoryStore.replace/remove`、`MemoryRegistry.snapshot`（及 memory-files 对应实现）；同步删除仅覆盖它们的测试或在测试中标注用途迁移 | knip/导出面复核：无生产零引用导出 |
| 1.6 | P0-5 后续 | fuzzy patch 补属性测试（fuzz old/new/content 随机组合断言：不异常、不丢内容、patched 与原文件差异仅匹配段） | 1000 组随机用例通过 |

### L1 组（seam 与 provider）

| 步骤 | 来源 | 动作 | 验收 |
|---|---|---|---|
| 1.7 | P2-2 | 侧车文件读-改-写整体加锁：把 `withWriteLock` 提升为"事务"语义（`io.transact(path, fn)`），usage/mutations/suppressed 三处读改写迁入；单进程 chain 保留为第二层 | 双进程并发写同一 sidecar 的丢更新回归用例通过 |
| 1.8 | P1-4 | state-domain `ensure()` 失败时清空 `opening`（catch 中 `opening = null`）+ 指数退避重试 | 首次 open 失败后下一次调用可重试成功 |
| 1.9 | P2-4 | `nodeEvolutionIo.list` 区分 ENOENT（→[]）与 EACCES/EIO（→抛）；`snapshotAll` 遇 list 抛错时拒绝产出空快照 | 权限故障场景：快照报错而非产出空 manifest |
| 1.10 | 架构张力 | state-json 与 state-domain 的 claim/resolve 语义用同一组契约测试钉死（10 分钟 claim 过期、exactly-once resolve） | 两 provider 跑同一 `contract.spec` 全绿 |

---

## 6. M2 — L2 控制面 + L4 编排层治理（门与自治）

### 横切前置
| 步骤 | 来源 | 动作 | 验收 |
|---|---|---|---|
| 2.0 | 决策 B | 落地 `EvolutionGateSet`（见 §3.B），四消费方接入 | 门矩阵测试（类别×入口）全绿 |

### L2 组（控制面）

| 步骤 | 来源 | 动作 | 验收 |
|---|---|---|---|
| 2.1 | P1-9 | approval `request()` 增加预检：kind 对应无已注册 runner 时直接拒绝 staging（返回明确错误），消灭"永久不可批准的 pending" | host-only + enabled 组合下 review 不再产生 pending |
| 2.2 | P2-11 | `policy.json` 二选一：实现（policy 快照持久化 + 启动加载）或删除 protectedPaths 拼装；推荐先删（YAGNI） | 导出面/文档无幽灵路径 |
| 2.3 | 横切(origin) | 抽 `resolveWriteOrigin(sessionHeader, channel): WriteOrigin` 单一映射函数（tool-memory/tool-skill-manage/review 三处复用），语义表进 README | 三处调用点替换；语义表与代码一致性测试 |

### L4 组（review + curator）

| 步骤 | 来源 | 动作 | 验收 |
|---|---|---|---|
| 2.4 | P1-3 | `trySubagentReview` 用 try/finally 保证 `dispose()`；超时/异常也释放 | 超时回归用例：dispose 被调用 |
| 2.5 | P1-10 | 监听会话结束/清理点移除 `cumulativeToolCalls/turnStarts/completionInjected` 对应条目（上游 session 生命周期事件不可用时退化为 LRU 上限） | 长跑模拟：Map 尺寸有界 |
| 2.6 | P1-2 | curator 调序：`scoreTree` → `computeLifecycleTransitions`（评分先行，转移用当轮质量分）；dry-run 克隆逻辑保持 | 单测：首轮运行 qualityWarnStaleAfterDays 即生效 |
| 2.7 | P1-7 | curator 对 `evolutionState` 缺失显式化：`stateService === undefined` 时按"无持久化"路径走首跑延迟（与 null 同一分支）并 warn 一次 | 无 state 组合：装好后首跑延迟、间隔门生效 |
| 2.8 | P1-8 | 控制面 `consolidate()` 接入 GateSet（含 referenced/suppressed）；`gateConsolidations` 改为引用同模块 | 门矩阵测试覆盖命令入口 |
| 2.9 | P1-12（产品决策） | 前台（主 agent）创建的 skill 是否纳入 lifecycle：二选一并同步 README——推荐"纳入但默认 `manageUnmanaged` 语义改为按 `created_by ∈ {agent, model}`"或保持现状但 README 明示"前台创建需手动 pin/exclude" | 决策记录 + 行为与文档一致 |
| 2.10 | P2-9 | 对 0.1.1-rc.2 源码核实 `toolFilter` 形状、`outputSchema.items.type:'json'`、`maxDepth:0` 语义，并把结论固化为类型/测试 | 三项均有上游行号引证的测试或注释 |

---

## 7. M3 — L3 模型面 + L5 观测层收敛

### L3 组（工具与 catalog）

| 步骤 | 来源 | 动作 | 验收 |
|---|---|---|---|
| 3.1 | 决策 C | 事件发射下沉 SkillLibrary（见 §3.C），删除 tool-skill-manage 手工 emit | catalog 一致性测试（写→原生目录立即可见） |
| 3.2 | P2-6 | catalog `get()` 与 `list()` 共享一次 list 缓存（同 tick 内 memoize）；`snapshotAll` 并行拷贝 | 大树（200 skills）下 get 延迟不随 N 线性 |
| 3.3 | P1-12 联动 | `create` 不再记 `patch_count`（新增 `create` 计数或独立字段），质量公式同步 | 质量回归用例：新建 skill 首轮分数合理 |

### L5 组（观测与人机）

| 步骤 | 来源 | 动作 | 验收 |
|---|---|---|---|
| 3.4 | P1-11 | 以 0.1.1-rc.2 源码核实 projection 注册的未知键处理：若宽松→删除 `schema/view` 双契约、只留 `stateSchema+wire`；若严格→立即只留新契约 | 注册定义与上游 `ProjectionDefinition` 逐字段一致 |
| 3.5 | 决策 A 落地 | activity/replay 的数据源切换后：replay 从内存 leaderboard 改为读 evolution-state 活动表（重启不丢）；`/evolution` 帮助文本同步 | 重启后 `evolution-replay` 仍能比较历史计划 |
| 3.6 | P2-12/P2-13 | feedback：dispose flush 改为可等待（或改为每次 record 即持久化，量小）；restore 与 record 的顺序用同一 `mutate` 队列串行 | 关闭宿主不丢最后一条反馈；并发 record/restore 无遮蔽窗口 |
| 3.7 | D-9 | evolution-capability：补一个最小调用面（`/evolution capability submit|pending` 子命令）或从 host bundle 移除挂载并降级为可选包 | 不再存在"挂载但零入口"的服务 |

---

## 8. M4 — L6 组合与工程化（可部分与 M1–M3 并行）

| 步骤 | 来源 | 动作 | 验收 |
|---|---|---|---|
| 4.1 | 决策 D | 构建布局定稿（D1/D2），修正 tsdown 配置（entry 指向 `src/*.ts`、删除 `startup`）、各包 tsconfig references | 镜像内 `build-lib.mjs` 产出可用 `lib/` |
| 4.2 | F-2/D-4 | 路径统一：README/INSTALL/脚本头注释全部改为实际路径；`PUBLISH_EXCLUDE` 空集与 facade 相关注释删除 | 全仓 grep `packages/evolution/scripts` 零命中 |
| 4.3 | F-1/F-3 | README 事实修正：reviewToolAllow 默认值、测试数字（51 spec）、minimal preset 场景表删除或标注"上游行为" | 文档-代码一致性抽查清单通过 |
| 4.4 | §5.3 | 版本基线单源化：`UPSTREAM_VERSION` 只在根 `package.json`（或 `UPSTREAM_SHA` 旁的 `UPSTREAM_VERSION` 文件）定义，CI/prepare-release/README 引用同一来源；与目标 0.1.1-rc.2 对齐并重新过 §5.2 比对 | 三处引用同一值；peerDependencies 重写结果为 `^0.1.1-rc.2` |
| 4.5 | D-5/D-6/F-5 | packages/README 包表删除 facade 行；io.ts 等"legacy facade"叙事改写；normalize-mirror 注释路径修正 | 文档残留清零 |
| 4.6 | CI | release workflow 增加"0.1.1-rc.2 类型比对 + 冒烟装载"job（把审计 §5 的比对脚本化：至少覆盖 P0 相关的 5 个接口点） | CI 红灯可拦截此类回归 |
| 4.7 | 技术债 | 每包 28 份 invariant 模板收敛为共享工厂（低优先，纯去重） | 新增包只需一行注册 |

---

## 9. 横切工作流（贯穿 M1–M4）

1. **测试先行**：每个步骤的"验收"先写成失败用例再实现（镜像内 vitest，步骤 0.1 产物）。
2. **契约快照**：门矩阵（§3.B）、origin 映射（§2.3）、projection 定义（§3.4）、上游接口比对（§4.6）四张快照表入库，任何改动 diff 可见。
3. **发布纪律**：每里程碑合入后跑一次 `prepare-release --scope @lmzhen --dry-run`，确认依赖重写/export 完整性校验仍通过（M0-0.5 后 plan-validator 才能过这关）。
4. **文档同步**：README/INSTALL/CHANGELOG 的修改与代码同一 PR，违反 F-* 类漂移不再新增。

## 10. 风险与回滚

| 风险 | 影响步骤 | 缓解 |
|---|---|---|
| 决策 A1 切换数据源后，旧会话日志里的历史 `evolution/*` 记录仍不可读 | 0.2 | 迁移说明 + 提供"截断 evolution 事件"的一次性清洗脚本方案（写入 decisions.md，不在本计划实现） |
| GateSet 收紧后，既有依赖"绕门"的工作流（脚本化 consolidate）被拒 | 2.8 | 变更记录 BREAK NOTE；提供 `--force` 显式逃逸（仅 foreground，审计留痕） |
| 投影契约若上游严格校验（3.4），双契约删除需与宿主升级同步 | 3.4 | 先以运行时探测（typeof registry 检查）过渡一个版本 |
| 构建布局切换（4.1）影响发布流水线 | 4.1 | D2 兜底：若 D1 两个月内未达成，回退 D2 声明 |
| 前台创建纳入 lifecycle（2.9）改变用户可见行为 | 2.9 | 默认关闭新语义，配置项灰度一个里程碑 |

## 11. 明确不做（Scope 控制）

- 不重写 fuzzy patch 为正则/差分算法（守卫修复已消除危害，重写收益低风险高）。
- 不引入新外部依赖（含 ORM、schema 库更换）；zod/schemastery 双轨维持现状（activity/state-domain 用 zod，其余 schemastery，与上游一致）。
- 不做 UI/网关侧的观测面板——evolution-state 活动表落定后由上游生态消费。
- 不追查 `deepseek-v4-flash/pro`、`deepseek-official` 等 provider/model 名的上游有效性（超出本次宿主基线可验证范围，列入 4.6 CI 比对 job 的可选扩展）。
