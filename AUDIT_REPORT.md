# dsh-evolution 插件全量代码审计报告

| 项 | 内容 |
|---|---|
| 审计对象 | `D:\dsh\dsh-evolution-mirror`（dsh-evolution `0.1.0-rc.1`，33 个 packages/ 子包） |
| 目标宿主 | `D:\dsh\dsh-upstream-0.1.1-rc.2`（DeepSeek Harness，`UPSTREAM_SHA=47f9438…`） |
| 审计范围 | 全部 `src/*.ts`（约 7300 行）、`scripts/*.mjs`（约 1150 行）、4 份 cordis/preset YAML、全部 package.json、tsconfig、CI workflow、README/INSTALL/CHANGELOG/docs |
| 审计方式 | 逐文件人工通读 + 上游接口逐项比对（上游源码引证均核对到行号） |
| 约束 | 只读审计，未修改任何代码 |

**问题统计**：P0（高危）6 项 · P1（中危）12 项 · P2（低危/健壮性）14 项 · 死代码/遗留物 9 项 · 文档漂移 7 项。

---

## 0. 总体结论

整体架构质量高于典型社区插件：分层（core 纯逻辑 / seam 注册表 / provider / 工具 / 编排）清晰，"模型只可写 memory 与 skills"的控制面不变量在代码层落实得比较认真（prompt bundle 失败关闭、写前威胁扫描、审计留痕、快照-归档可恢复、审批重放）。但是：

1. **与所宣称的目标宿主 0.1.1-rc.2 存在多处确证的接口冲突**，其中两处（自定义 session 事件导致会话日志不可恢复、命令名含空格导致插件挂载崩溃）在实际部署中会直接造成**会话数据不可用 / 插件整体装载失败**。
2. 存在 **2 条可触发的死循环/栈溢出路径**（skill 模糊补丁）和 **1 条数据落盘位置错误**（skill-usage `root=''`），以及 1 个**发布包必然解析失败**的依赖声明缺失。
3. 仓库自我定位为"可独立构建/发布的扁平镜像"，但 tsconfig/构建脚本/测试入口仍指向上游 monorepo 布局，**镜像内无法完成任何构建或测试**，属于结构性技术债。

---

## 1. P0 — 高危问题

### P0-1 `evolution/*` 自定义 session 事件会使持久化会话**永久无法恢复**

- 位置：`packages/evolution-review/src/index.ts:145`、`:168`、`:247`（`session.append('evolution/review-scheduled' | 'evolution/plan-applied', …)`）；事件在 `packages/evolution-core/src/events.ts:35-41` 通过 `declare module '@deepseek-ai/dsh-session/types'` 合并进 `SessionEventMap`。
- 上游事实（0.1.1-rc.2）：
  - `packages/core/session/src/known-event-types.ts:19-68` 的 `KNOWN_SESSION_EVENT_TYPES` 是**生成清单**，不含任何 `evolution/*`；文件头注释明确写着"下游（repo 外）插件事件必然不在清单内，注册接口暂缓提供"。
  - `packages/session/session-persistence/src/coordinator.ts:1061-1065` `assertEventsSupported()`：加载持久化日志时，凡类型不在清单且 `event.ignorable !== true` 的事件，**直接抛 `SessionFormatUnsupportedError`，拒绝解释整份日志**。
  - `packages/core/session/src/index.ts:596-613`：`Session.append(type, data, ...opts)` 的可变参数**仅限 Surface 事件传 `SurfaceIntent`**，没有任何通道写入 `ignorable: true`（全仓库无 `ignorable: true` 写入点）。
- 后果：只要某会话触发过一次后台 review 调度或计划落盘（默认开启 review），该会话的持久化日志即变成"未来格式"，重启/resume 时整份会话报废。`evolution/skill-mutated` 走 `ctx.emit`（进程内）无此问题——说明作者区分过两类通道，但漏掉了 append 的两个事件。
- 定性：**架构矛盾 + 数据可用性事故**，是最严重的一项。

### P0-2 `evolution replay` 命令注册即抛错，导致 evolution-replay 包装载失败

- 位置：`packages/evolution-replay/src/index.ts:145-150`：`commands.register({ name: 'evolution replay', … })`；`:149` handler 返回裸 `{ text: … }`。
- 上游事实：`packages/interaction/commands/src/index.ts:28` 与 `:171-172` 强制命令名匹配 `^[a-z][a-z0-9_-]*$`（**不允许空格**，注册时抛错）；handler 返回值必须是 `{kind:'success',text?} | {kind:'error',text}`（`types.ts:34-42`，运行时校验 `index.ts:219-240`），裸 `{text}` 会被拒。
- 后果：host bundle / preset 的 `- insert:` 列表挂到 evolution-replay 行时，整条 composition 装载失败（同一文件里两个独立 bug：名字 + 返回形状）。对照 `evolution-commands/src/index.ts:20-21` 的正确写法（`kind:'success'/'error'`），此处是明确的实现遗漏。

### P0-3 `skill-usage` 未配置 root 时使用**空字符串路径**，遥测数据落盘到进程 CWD

- 位置：`packages/skill-usage/src/index.ts:27`（`root: z.string().default('')`）+ `:37`（`this.root = config.root ?? skillsRoot()`）。
- `??` 只拦 `null/undefined`，拦不住 `''`。host bundle 的 `skill-usage` 行不带 config → `root === ''` → `usageFile('')` = `join('', '.usage.json')` = **相对路径 `.usage.json`**，写到 DSH 宿主进程的当前工作目录，而不是 `~/.dsh/skills/.usage.json`。
- 后果链：curator 在 `skillsRoot()` 读 sidecar（`evolution-curator/src/index.ts:393`）永远读不到工具遥测 → 质量评分、use/patch 计数、`markAgentCreated`、`markArchived` 全部与真实数据断裂；`invalidate()`/`flush()` 同样错位。同仓库其他消费方都用了 `rawConfig.root || undefined` 的正确写法（`tool-skill-manage/src/index.ts:75`、`evolution-skill-catalog/src/index.ts:58`、`evolution-state-json/src/index.ts:32`），唯独此处失守。
- 定性：**空指针类缺陷的字符串变体**（falsy 值穿透 nullish 合并），静默数据错位。

### P0-4 `evolution-plan-validator` 声明缺失对 `dsh-evolution-core` 的依赖，发布包无法解析

- 位置：`packages/evolution-plan-validator/src/index.ts:7` **值导入** `DEFAULT_MAX_OPS_PER_PLAN / DEFAULT_MEMORY_CHAR_LIMIT / DEFAULT_SKILL_CONTENT_CHARS / DEFAULT_USER_CHAR_LIMIT from '@deepseek-ai/dsh-evolution-core'`；但其 `package.json` 的 `dependencies` 仅 `@deepseek-ai/schemastery`，`peerDependencies` 仅 `dsh-invariants`、`cordis`。
- 后果：单独安装发布包（非 hoisted workspace）时模块解析直接失败；`prepare-release.mjs` 的 smoke 也只会因 hoisted 布局侥幸通过。`evolution-review` 依赖它（`evolution-review/package.json` dependencies 含 plan-validator），故障会向上传播。

### P0-5 `SkillLibrary.patch` 模糊匹配存在两条**死循环 / 栈溢出**路径

位置：`packages/evolution-core/src/skill-store.ts:165-243`。

1. **空白串 `old_string` → 无限递归**。`trimPatternBoundaries('  ')` 产生空串 `''`（`:205-210`）；`fuzzyIndexOf(content, '')` 在 `start=0` 处立即满足 `patternIndex === pattern.length`，返回 `[0,0]`（`:173-199` 的循环体一次都不进）→ `fuzzyReplace` 命中。`replace_all=true` 时 `fuzzyReplace` 递归 `fuzzyReplace(patched, …, true)`（`:213-219`），替换后的文本在 0 位仍模糊匹配空串 → **无限递归，`RangeError: Maximum call stack size exceeded`**。`replace_all=false` 时则是把 `new_string` **插到文件开头并报成功**——两种都是错误行为且无 try/catch 兜底。
2. **`new_string` 自身模糊包含 `old_string` + `replace_all` → 同样无限递归**。首次替换后新文本在原位置再次匹配 `old_string`，递归永不收敛（exact 路径 `split/join` 无此问题，仅模糊路径受影响）。
- 触发者：模型经 `skill_manage action=patch` 即可触发（工具无异常兜底，异常会以工具错误形式冒泡，最坏情况拖死当轮）。

### P0-6 curator LLM 调用传入上游**封闭联合之外**的 `purpose`

- 位置：`packages/evolution-curator/src/index.ts:243-249`：`llm.stream({ …, purpose: 'evolution-curator' })`。
- 上游事实：`packages/llm/llm/src/types.ts:376` `purpose?: 'compaction' | 'session-title'` —— 封闭联合，自定义值类型不合法，运行时行为取决于适配器（可能被当普通会话计费/路由）。
- 定性：接口冲突（类型层必报错，运行时是未定义行为）。

---

## 2. P1 — 中危问题（功能缺陷 / 一致性）

### P1-1 `SkillLibrary.consolidate` 两阶段提交的回滚不完整
`skill-store.ts:555-572`：注释承诺"a source that cannot be archived aborts before target is touched"并完整回滚；但源归档循环里 `if (!result.ok) return result`（`:559`）**直接 return，不触发 catch 里的回滚**——若第 2 个源归档失败，第 1 个源已被移入 `.archive/` 而 target 未合并，树处于"部分合并"的中间态，违背其自述的两阶段语义。

### P1-2 curator 质量评分与生命周期转移的**执行顺序颠倒**
`evolution-curator/src/index.ts:399` 先 `computeLifecycleTransitions`（内部读 `record.quality_warn` 决定 `qualityWarnStaleAfterDays`），`:410` 才 `scoreTree` 写入本轮质量分。`quality_warn` 永远是**上一轮**的旧值：首次启用 `qualityWarnStaleAfterDays` 或刚安装时，"质量差 7 天即 stale"的策略至少滞后一个 curator 周期（默认 7 天×168h）才生效。

### P1-3 review 子代理在**超时/异常路径不 `dispose()`**
`evolution-review/src/index.ts:222-224` 仅在 `await run.result` 成功后 `dispose()`；`AbortSignal.timeout(reviewTimeoutMs)` 触发或 result reject 时走 `:263-269` 的 catch，**子代理运行体泄漏**（localAgent 会话、spawn 进程内资源不回收）。长时宿主上每次 review 超时都累积泄漏。

### P1-4 `evolution-state-domain` 打开失败的 promise **永久中毒**
`evolution-state-domain/src/index.ts:65-72`：`opening ??= facility.open(...)` —— `open` reject 后 `opening` 不清空、`domain` 保持 null，此后每次调用都 await 同一个 rejected promise，provider 整体不可用直到进程重启。虽默认 `disabled: true`，但这是显式启用后的可用性缺陷。

### P1-5 skill catalog 失效事件存在**覆盖缺口**
`evolution-skill-catalog/src/index.ts:107-109` 只监听 `evolution/skill-mutated` 来 `control.invalidate()`，但该事件**只在 `tool-skill-manage` 里发出**（`tool-skill-manage/src/index.ts:114-119`）。以下变更路径不经过它：
- curator 的 `archive` / `consolidate`（`evolution-curator/src/index.ts:571`、`:604`）；
- learning-graph 的 `nodeDelete`（`evolution-learning-graph/src/index.ts:174-190`）；
- `restoreLatestSnapshot` / `restoreFromArchive`。
后置结果是原生 `ctx.skills` 目录表与磁盘树不一致，直到下一次工具写才被纠正——与该包自述"removing the filesystem-watcher latency/window"的目标相悖。

### P1-6 `MemoryStore` 把**0 字节 MEMORY.md/USER.md 判定为外部漂移**，写路径永久拒绝
`memory-store.ts:50-52` `render([])` 返回 `'\n'`；`:354-371` `detectDrift` 比较 `render(normalizeEntries(raw)) !== raw`——`raw === ''` 时不等 → drift → `add/replace/remove/applyBatch` 全部走"External drift detected … Fix the file manually"（`:192`、`:240`、`:273`）。用户无法用工具自身修复（所有写路径都拒绝），只能手工删文件。空文件是合法的"从未写入"状态，应视为无漂移。

### P1-7 `evolution-state` 未挂载时 curator 的间隔门/首跑延迟**全部失效**
`evolution-curator/src/index.ts:358-391`：`stateService?.loadCuratorState()` 在服务缺失时返回 `undefined`，而首跑门写的是 `persisted === null`（`:378`）——`undefined !== null`，"first-run defer"不触发；间隔门 `Date.now() - persisted.lastRunAt < …` 中 `persisted.lastRunAt` 为 undefined → NaN 比较 → 恒 false。结果：无 state 服务的组合里 curator **装好即跑**，与"first-sight defer"设计相矛盾。null/undefined 三态混用是典型的空值缺陷。

### P1-8 控制面 `/evolution consolidate` 绕过 `referenced/suppressed` 门
`evolution-curator/src/index.ts:708-722` 的 `consolidate()` 只检查 `excludeSkillNames`；而 LLM 提名路径有完整的 `gateConsolidations`（exclude+referenced+suppressed，`:82-90`）。同一能力两条入口、两套门——人工命令可以把被 `referencedSkillNames`（计划任务引用）保护的 skill 合并归档，与"referenced skills never auto-transition"的注释承诺不一致。

### P1-9 启用审批 + host-only 组合时 pending 写**永远无法落地**
`evolution-review/src/index.ts:299-309` `runApproved`：审批启用时走 `approval.run(kind, …)` 重放；host-only 组合不挂 tool-memory/tool-skill-manage → 无 runner → `doApprove` 返回 "No replay runner registered" 并释放 claim（`evolution-approval/src/index.ts:179-180`）→ pending 记录**永久滞留且不可批准**。代码注释（`:303-307`）只处理了"挂了服务但 disabled"的分支，没有处理"enabled 但无 runner"的分支（例如 `submit` 前无能力预检）。

### P1-10 review 内部计时表**按 SessionId 无限累积**
`evolution-review/src/index.ts:107-109`：`turnStarts`（仅 turn/end 时删除）、`cumulativeToolCalls`（永不删除）、`completionInjected`（永不删除）；`:366-370` 仅在插件 dispose 时清理。长驻宿主上每个历史会话各占三份条目，属慢性内存泄漏（量小但确定性增长）。

### P1-11 session-projection 注册携带上游契约**之外的字段**
`evolution-activity/src/index.ts:90-99` 同时提交 `stateSchema+wire.viewSchema`（0.1.1 契约）和 `schema+view`（0.1.0-rc.6 契约）。上游 0.1.1-rc.2 的 `ProjectionDefinition`（`packages/session/session-projection/src/index.ts:42-81`）**没有 `schema`/顶层 `view` 字段**。若注册表对未知键宽松则只是冗余，一旦收紧校验即装载失败。CHANGELOG 自述"每个注册器忽略不认识的字段"是**未经上游源码证实的赌注**（本次审计未在 0.1.1-rc.2 中找到显式的"忽略未知键"证据）。

### P1-12 主会话（foreground）创建的 skill **逃出 curator 生命周期**
`tool-skill-manage/src/index.ts:111`：仅 `origin !== 'foreground'` 的 create 才 `markAgentCreated`。但"foreground"包含**主 agent（模型）在用户会话里**的创建——这是该插件最主要的写入口之一。这些 skill 的 `created_by=null`，默认 `manageUnmanaged:false` 下 curator 永不管理它们（`lifecycleCandidate`，`evolution-core/src/curator.ts:173-174`）。代码注释称这是有意为之（"curator only manages records created by the background review pipeline"），但与 README"自进化库由 curator 统一治理"的产品叙述矛盾：模型前台建的 skill 永远 active、永不 stale/archive。至少是文档-实现矛盾，建议按产品意图二选一。

---

## 3. P2 — 低危 / 健壮性 / 性能

| # | 问题 | 位置 | 说明 |
|---|---|---|---|
| P2-1 | `failureCount` 从不按轮重置，报错文案却写 "this turn" | `memory-store.ts:117-132` | 计数跨轮、跨会话累计（store 进程级单例），3 次失败后所有后续失败都被告知"停止重试"，文案误导 |
| P2-2 | sidecar 读-改-写**跨进程**竞态 | `mutations.ts:54-64`、`usage.ts:70-73` + `io.ts:60-86` | `withWriteLock` 只罩最终 write；read→compute→write 整体不在锁内，多进程部署仍可丢失更新（单进程有 chain 串行，`memory-files:43-48`、`skill-usage:51-55`） |
| P2-3 | `loadUsage`/`loadMutations` 不校验字段类型 | `usage.ts:49-68`、`mutations.ts:33-51` | 损坏文件里 `use_count:"3"`（字符串）等会以 NaN 传播进质量分与生命周期比较 |
| P2-4 | `nodeEvolutionIo.list` 吞掉一切错误（含 EACCES） | `io.ts:108-111` | 权限故障时 `listNames` 得空表 → `snapshotAll` 产出"空快照"；有 pre-rollback 快照兜底，但恢复链依赖此前提 |
| P2-5 | `update/patch/archive/writeSupportFile` 用**未 trim** 的 name 拼路径 | `skill-store.ts:434-436`、`:452`、`:490`、`:607-608` | `badName` 内部 trim 校验，随后 `skillDir(root, name)` 用原值；带尾随空格的名字在 Windows 上行为怪异（`create`/`setPinned` 用了 trim 后值，写法不一致） |
| P2-6 | N+1 IO | `skill-store.ts:256-275`（list 每技能 5 次 stat/read）、`skill-catalog:87`（get 再 list 一遍）、`curator:531-546`（referenceCounts 全树读） | 技能树大时 review/catalog 查询放大 |
| P2-7 | `session-query-sqlite` 覆盖行的 env 回退在 Linux 退化为相对路径 | `evolution-host/cordis.patch.yml`（`DSH_HOME ?? USERPROFILE ?? '.'`） | 上游有 `dshHomePath` helper（app-boot 提供，供 `!!js` 使用，见 `packages/boot/app-boot/src/index.ts:770`），此处手工拼装且 `.` 兜底会落 CWD |
| P2-8 | 共享默认值未按 constants.ts 的自我约定单源化 | `memory-files/src/index.ts:28-32`（硬编码 2200/1375/3）、`tool-memory:111`（200 写两处）、`curator:100`（7） | `constants.ts:1-21` 注释声称"cross-package shared tunable defaults 必须引用 DEFAULT_*"，三处违反 |
| P2-9 | 两处 subagent 契约**未经上游证实** | `evolution-review/src/index.ts:209-217` | `toolFilter:{allow}` 形状、`outputSchema.items:{type:'json'}` 的 `'json'` 类型、`maxDepth:0`（0 是否会被 `??` 默认值覆盖或被当作"禁止再生"）均需以 0.1.1-rc.2 源码确认 |
| P2-10 | 冗余自赋值（死代码） | `evolution-review/src/index.ts:241-243` | `validation.accepted.skillOps = acceptedSkillOps` 赋的是同一数组引用（`filterUnreadSkillOps` 已原地 splice） |
| P2-11 | `policy.json` 是幽灵特性 | `evolution-policy/src/index.ts:111`、`:131` | `protectedPaths` 拼出 `$DSH_HOME/evolution/policy.json` 并加以保护，但全仓库没有任何代码读写该文件 |
| P2-12 | dispose 期间的落盘是 fire-and-forget | `evolution-feedback/src/index.ts:157-159` | `void feedback.flush(io)` 在 effect dispose 中，进程退出时可能不落盘（与该包"durable feedback"的自我描述不符） |
| P2-13 | `feedback.record` 装载竞态窗口 | `evolution-feedback/src/index.ts:133-137` | `restore()` 后台进行，`ctx.provide` 先行；restore 前的 record 走内存、restore 后 merge（memory 优先），方向正确但"先 record 后 restore"的记录若尚未 flush 会在 merge 中被磁盘旧值遮蔽的窗口存在 |
| P2-14 | 快照恢复对**未知 extras/目录**的容忍面 | `skill-store.ts:763-807` | restore 后未清理"快照中存在但 manifest 未列"的残留目录（legacy 分支除外），依赖 manifest 完整性 |

---

## 4. 死代码与遗留物

| # | 对象 | 位置 | 证据 |
|---|---|---|---|
| D-1 | `JsonState` 整个文件（state-store.ts，90 行）在生产代码中**零调用** | `evolution-core/src/state-store.ts` | 全仓 grep：仅 7 个 `tests/*.spec.ts` 引用；功能已被 `evolution-state-json` provider 取代，属"退役未删" |
| D-2 | `MemoryStore.replace()` / `MemoryStore.remove()` | `memory-store.ts:218-224` | 生产调用方全部走 `applyBatch`；仅剩公共 API 面积 |
| D-3 | `MemoryRegistry.snapshot()` 与 memory-files 的 `snapshot` 实现 | `memory/src/index.ts:76-78`、`memory-files/src/index.ts:64-68` | 无任何生产调用方 |
| D-4 | `prepare-release.mjs` 的 `PUBLISH_EXCLUDE` 空集 + 已删除 facade 的长注释 | `prepare-release.mjs:37-42` | facade 包在树中已不存在，排除逻辑成为永久空转；注释描述的 `dsh-evolution` 已无处可寻 |
| D-5 | `packages/README.md:15` 仍列出 `dsh-evolution | Legacy one-row facade` 行 | `packages/README.md` | 该包不在 `packages/` 中；表内其余条目与实际一致 |
| D-6 | "legacy facade"叙事散留在生产注释 | `evolution-core/src/io.ts:1-7` 等 | io seam 的文档主体仍以"facade stores"开场，实际消费方全是原生包 |
| D-7 | `tsdown.package.config.ts` 入口含**不存在的 `startup`** 且指向产物目录 | `packages/tsdown.package.config.ts:6` | `entry: ['lib/types/{index,invariant,startup}.js']`——全仓无 `startup.ts`；入口从 `lib/types`（tsc 产物）取 js 再打到 `lib`，管线可疑且 `dts:false` 与各包 `files` 声明 `lib/types/**/*.d.ts` 的关系依赖 build-lib 里先跑 tsc |
| D-8 | 28 份 `invariant.ts` 逐字复制模板 | 各包 `src/invariant.ts`（每份 14 行） | 仅 `PACKAGE_NAME` 一词不同；纯样板，可由共享工厂生成（低优先） |
| D-9 | `evolution-capability` 挂载但无任何调用面 | `evolution-capability/src/index.ts` | `submit/listPending/approvedPackage` 仅测试调用；host bundle 挂了它，没有命令/工具/UI 入口（README 称"Creator mode 手动激活"，但插件内无入口说明） |

---

## 5. 与上游 0.1.1-rc.2 的接口比对结果

### 5.1 确证冲突（已在 P0/P1 详述）
1. `evolution/*` session 事件 vs 持久化白名单（P0-1）。
2. 命令名 `'evolution replay'` + 裸 `{text}` 返回值（P0-2）。
3. `llm.stream` `purpose` 封闭联合（P0-6）。
4. projection 定义多余字段（P1-11，风险级）。

### 5.2 需注意但不冲突
- `ctx.subagents` 服务名正确（包名是 `@deepseek-ai/dsh-subagent`，插件只 `ctx.get('subagents')`，未引错包）；`prompt` 传的是 `ContentBlock[]`，合规。
- `header.origin` 上游仅允许字面量 `'subagent'`：插件只做 `=== 'subagent'` 读比较，合规。
- `tools.guard` / `tools/pre-execute` / `PreToolDecision{kind:'deny',reason}` 用法与上游一致（guard 收完整 `ToolExecution`，子集兼容）。
- `defineTool` 参数 DSL 的 `required:true` 写在字段内、`additionalProperties` 显式声明——与上游 `schema.ts:97/335-411` 一致（注意上游**拒绝未知键**，后续给工具加 JSON-Schema 风格键会挂）。
- `user-approval` 的 `overrideOf(session) ?? config.policy ?? 'ask'` 复刻正确。
- `storage-domain` 的 `table.update(key, fn)`、`entries()`、`close()` 存在。
- `ctx.skills.registerProvider((control)=>provider)` + `control.invalidate()` 存在；`SkillCandidate` 有 `rank/locator`，`SkillDefinition` 没有——插件 `get()` 未返回 rank/locator，**恰好合规**。
- `tool-skill` `catalogDescriptionMaxLength` 存在（默认 500），host 覆盖为 60 合法。
- preset 机制（`agent.cordis.yml` + `preset.yml` 的 name/description/order）、`cordis:group` + `isolate`、`- insert:` patch 词汇、行字段 `disabled/id/name/config` 全部与上游 loader 一致。
- `session.append` 的 `seq` 语义 = `log.length`（append 时即事件下标），review 的 `turnStarts`/`foldTurn` 索引换算正确。
- `agents.get/list`、`agent.inject`、`AbortSignal.timeout`、`invariants.register(唯一包名)`、`systemPrompt.section/context` 均一致。

### 5.3 版本基线矛盾（见 §6）
peerDependencies 发布时会被 `prepare-release.mjs` 重写为 `^0.1.0-rc.6`（`prepare-release.mjs:35` 默认值、`.github/workflows/release.yml` 的 `UPSTREAM_VERSION: 0.1.0-rc.6`），而本次审计目标为 0.1.1-rc.2、README 自述 "Developed against `0.1.0-rc.5`"（README.md:286）。三处基线互不一致；P0-1 的持久化校验正是 rc.6→0.1.1 之间持续存在的上游行为，说明按 rc.6 基线发布同样命中。

---

## 6. 文档与实现漂移

| # | 文档说法 | 实际 |
|---|---|---|
| F-1 | README.md:234-236、292-293：review 子代理默认允许 `skill, skill_search, skill_load` | `evolution-review` Config 默认 `['skill']`（index.ts:51）；host patch 显式 `reviewToolAllow: [skill]` 并注释"skill_search/skill_load 在本平台不存在"。README 是旧文案（CHANGELOG Phase 3 时代），**会误导使用者与审计者** |
| F-2 | README/INSTALL 全部安装命令写 `packages/evolution/scripts/install-layered.mjs` | 镜像中实际路径是 `packages/scripts/install-layered.mjs`；`build-lib.mjs`、`prepare-release.mjs` 头注释同样写旧路径 |
| F-3 | README.md:341-342 "vitest 45 files / 90 tests passing" | 镜像内 `*.spec.ts` 实为 **51 个**；且镜像内无 vitest 配置，测试只能在（不存在的）上游 monorepo 布局下运行 |
| F-4 | `evolution-preset/cordis.yml:9` 与 `prepare-release.mjs:39` 注释 "retired at rc.18" | 根/各包版本号均为 `0.1.0-rc.1`，rc.18 无对应版本痕迹，注释失去可追溯性 |
| F-5 | `normalize-mirror.mjs:5` 注释指向 `D:/claw/dsh-evolution` | 本仓库位于 `D:/dsh/dsh-evolution-mirror`，注释是另一台机器/路径的残留 |
| F-6 | README.md:197 "Minimal preset: … the complete persona suppresses evolution prompt text" 等 scenario 表 | 仓库内没有任何 minimal preset 相关实现/测试；scenario 表描述的是上游宿主行为，未见对应验证物 |
| F-7 | `packages/INSTALL.md:171` `vitest run packages/evolution/evolution-host/tests/...` | 同 F-3，路径与可执行性在镜像内均不成立 |

---

## 7. 架构评估

**做得好的（保持项）**
- 控制面/模型面分离彻底：policy 快照冻结、plan-validator 拒绝 `policy/threshold/prompt_hash/model_route/evolution_config` 字段、`tools.guard` 单调拒绝、prompt bundle sha256 失败关闭（`verifyPromptBundle` 校验的是 pinned 常量而非包自身，`prompts.ts:158-169`，这个细节是对的）。
- 破坏性动作的三重护栏（归档不硬删、run 前全量快照、审批重放走注册 runner）真实存在且互相咬合；失败路径大多有显式注释与 best-effort 降级。
- 并发治理有层次：进程内 `chain` 串行（memory-files/skill-usage/state-json/feedback）+ 跨进程 O_EXCL 写锁（io.ts），并把"锁只是 best-effort"写明。
- seam 设计（evolutionIo / evolutionStateStorage / memory registry / skills provider）让介质可替换的声明大体兑现。

**结构性张力（建议在设计层面收口）**
1. **双布局矛盾**：仓库以"扁平镜像"自居（root package.json、installer、publish 脚本按 `packages/*` 运转），但 `tsconfig.host.json`（include `apps/web/...`、references `vendor/*`、`packages/evolution/*`）和每个包的 `tsconfig.json`（`extends ../../../tsconfig.base.json` + references `../../../vendor/cordis`）都只在**上游 monorepo** 里成立——镜像内 `tsc -b`、`build-lib.mjs`、`vitest` 全部不可运行。发布流程（prepare-release）实际上要求先在上游树里构建，这一依赖没有在任何文档中写明。
2. **origin 三态语义**（foreground / subagent / background_review）在三处映射不一致：`tool-memory:207` 把 subagent 一律映射为 `background_review`；`tool-skill-manage:185-191` 刻意区分 `libraryOrigin='subagent'` 与 `reviewOrigin='background_review'`；`SkillLibrary` 又只认 'background_review'。当前行为正确，但正确性靠注释维持，建议把映射收敛到单一函数。
3. **门（gate）不齐**：lifecycleCandidate（curator.ts:163-178）与 gateConsolidations（curator.ts:82-90）与 control-plane consolidate（仅 exclude）三套门集合各不相同（P1-8），是策略漂移的温床。
4. **catalog 失效通道**应改为：所有 SkillLibrary 破坏性操作统一发 `evolution/skill-mutated`（或 curator/catalog 共享一个 write-through hook），而不是指望每个调用点记得 emit（P1-5）。

---

## 8. 修复优先级建议（不含代码改动）

1. **立即**：P0-1（改为 `ctx.emit` 或等上游提供 ignorable/注册面，并对已写日志给出迁移说明）；P0-2（改名 `evolution-replay` + 返回 `{kind:'success',text}`）；P0-3（`|| skillsRoot()`）；P0-4（补 dependencies）。
2. **本迭代**：P0-5（fuzzyIndexOf 对空 pattern 直接返回 null；fuzzyReplace 用循环 + 进度守卫替代递归）；P0-6（去掉 purpose 或收敛到上游联合）；P1-1/P1-2/P1-3/P1-7。
3. **规划**：P1-4~P1-12、P2 批次；删除/收编 D-1~D-4 死代码；统一 F-1~F-7 文档；在 README 明确"构建发生在上游 monorepo"这一前提（架构张力 1）。

---

### 附：审计中验证为"一致/正确"的关键上游对接点清单
cordis（Context augment / Service 构造 / effect / inject / provide / on / emit / Events 合并）· dsh-tools（defineTool DSL、guard、pre-execute、PreToolDecision、output.render、isConcurrencySafe、exec.agent）· dsh-session（Session.append/seq/events/header.origin/deriveMessages、turn 事件形状、SessionEventMap 可合并、`/types` 导出）· dsh-llm（createUserMessage + source:{kind:'plugin',form:'notice',summary}、BlockAssembler、GenerateOptions 必填 provider/model/messages）· dsh-agent（inject）· subagent（start('spawn')、SubagentStartRequest 字段、SubagentRun.localAgent/result/dispose）· user-approval（overrideOf/policy）· session-projection（key/stateSchema(zod)/init/apply 纯函数/wire/stateVersion 主体契约）· storage-domain（defineDomain/domainTable/update/close）· skills（registerProvider/control.invalidate/SkillCandidate.rank/locator/source:'user-dsh'）· tool-skill（catalogDescriptionMaxLength）· agent-presets（agent.cordis.yml/preset.yml/cordis:group/isolate/insert）· systemPrompt（section/context）· commands（recordInput、`{kind}` 返回——除 replay 外）· agents 注册表 · invariants · session-query-sqlite 覆盖行 + `!!js`。
