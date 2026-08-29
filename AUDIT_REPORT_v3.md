# dsh-evolution 第三轮审计报告（最新版本 rc.62）

| 项 | 内容 |
|---|---|
| 审计对象 | `D:\dsh\dsh-evolution-mirror` @ git HEAD `980b60b`（**rc.62**，2026-08-29 23:45） |
| 对比基线 | 第二轮审计（`AUDIT_REPORT_v2.md`，rc.54 `d2374fa`） |
| 审计范围 | ① 逐条核验第二轮计划（OPTIMIZATION_PLAN_v2 R1–R3）八项修复；② 全量审计 rc.55→rc.62 新增/重写代码（约 +1538/−161 行，含超出计划的新特性：提示词 bundle v4/v5、authoring feedback 桥、合并链、layout-sync/platform-range 守卫、sidecar 清单门） |
| 约束 | 只读审计，未修改任何代码 |

**结论摘要**：v2 计划的 R1–R3 **八项修复全部确认落地且质量良好**（N-1 单源 markerEntryName + 三面契约测试、N-2 单一 PLATFORM_VERSION + CI 机械守卫、N-3 日期有效性、N-4 activity 事务化、N-5 撞名守卫 + 逃逸、N-6 归档冲突守卫、N-7 alias 注入、D-7/F-1/F-3/D-5 清理），并出现了一个新的最佳实践——sidecar 事务清单从文档变成**机械强制的测试门**（还真的借此抓到 feedback 未事务化）。**本轮新发现 7 项**：1 项 P1（rc.59/60 提示词与执行通道的矛盾，且提示词直接驱动真实归档行为）、2 项 P2、4 项 P3。无 P0。

---

## 1. 第二轮问题修复核验（全部确认 ✅）

| 编号 | 修复提交 | 核码证据 |
|---|---|---|
| N-1 list() 标记判断 | rc.55 | `markerEntryName()` 单一来源（`skill-store.ts:113-119`），`list()` 与 `markerPath()` 共享点前缀名；`skill-store/curator/tool-skill-manage` 三个报告面契约测试齐备且"修复前红"已验证 |
| N-2 版本口径分裂 | rc.56 | workflow 单一 `PLATFORM_VERSION: 0.1.1-rc.2` 派生 compat 锚点（`dsh-v${PLATFORM_VERSION}`）与 peer 范围（`^${PLATFORM_VERSION}`）；`verify-platform-ranges.mjs` 在双锚点 job 的 pack 后机械断言；`--platform-version` 传参贯通 |
| N-3 created_at NaN | rc.57 | `validTimestamp = Date.parse` 有限性判定（`usage.ts:49-52`），created_at 与四个活动时间戳共用；三消费面回归测试 |
| N-4 activity 无事务 | rc.58 | fold 收进 `transactIo` + 懒 adapter；本地 `ActivityIoLike` 删除（core `EvolutionIoLike` 唯一 IO 面）；`EvolutionIo` 注册表接口补声明 transact/isSymlink |
| N-5 组合撞名 | rc.58 | `rowIds()` 行解析 + 双侧交集 fail-loud；`DSH_EVOLUTION_ALLOW_ROW_COLLISIONS=1` 逃逸带警告；`DSH_EVOLUTION_DELTA_PATH` 测试注入口 |
| N-6 归档 stamp 冲突 + 注释 | rc.57 | `while (await exists(dest))` 随机后缀探测（对齐 snapshotAll）；`retainSnapshots` 注释改为如实描述 |
| N-7 CI 覆盖纯度 | rc.58 | released 锚点不再覆盖上游 tsconfig.base.json，改 `inject-evolution-paths.mjs` 只注入 evolution/zod/@lmzhen alias 行（单源：镜像 base），上游已声明同键时 fail-loud |
| D-7 tsdown 幽灵入口 | rc.55 | entry 改为 `lib/types/{index,invariant}.js`，`startup` 移除；layout-sync 守卫（rc.62）防止 dev/mirror 再单边漂移（还真抓到一次 build-lib.mjs 的 CRLF 漂移） |
| F-1/F-3/D-5 文档 | rc.58 | README reviewToolAllow 口径修正（默认 `[skill]`）、静态测试数字改为 CI 表述、packages/README facade 行与 `id: dsh-evolution` 示例移除、双布局路径注记补入 |
| （计划外）P2-⑥ | rc.62 | 三个慢安装测试显式 60s 超时；本地全套 222/222 首次全绿 |

**工程亮点（保持项）**：`sidecar-inventory.spec.ts` 把 v2 计划 §8.3 的"侧车事务清单"从文档约定升级为**机械门**（逐文件断言 transactIo 存在），并在本轮真的拦下了 feedback 的裸覆盖写（P1-③）；rc.60 的合并链端到端信任测试补上了"LLM 提名 → 门 → 吸收 → 归档 → 报告"从未被覆盖的通路；报告新增 `consolidated` 字段使实际执行的合并可审计。

---

## 2. 本轮新发现（rc.55→rc.62 引入/暴露）

### M-1（P1 · 架构矛盾）CURATOR_PROMPT 的"工具集"清单与提名通道的执行现实三层不符，且提示词直接驱动真实归档

- **位置**：`evolution-core/src/prompts.ts`（rc.59 CURATOR_PROMPT 新增 "Your toolset:" 段，指示调用 `skill_manage action=list/review/patch/create/write_file/delete(absorbed_into="")/consolidate/restore`）vs `evolution-curator/src/index.ts` `recommend()`。
- **三层矛盾**：
  1. **通道无工具**：`recommend()` 是裸 `llm.stream`（provider/model/messages/maxTokens，无 tools 绑定、无子代理）——被指示"去合并/去归档"的模型**没有任何执行面**，只能产出文本；
  2. **工具不支持**：即使接上工具，`tool-skill-manage` 的 action enum（`index.ts:196`）不含 `consolidate`/`restore`；`absorbed_into=""` 的"真修剪"语义也与 review 通道 `plan-validator` 的"delete 必须带 absorbed_into"规则相反——教会模型的行为模型与两处校验器都冲突；
  3. **输出直接驱动真实变更**：提名结果经 `gateConsolidations`（仅 GateSet 名单门）+ `treeNames.has` 后由 `applyMutations` **确定性执行**（归档 + 合并 + usage 翻转）。一个被鼓励"立即动手"却拿不到工具的模型，很可能在输出里"叙述已完成的合并"（幻觉操作），这些 YAML 里的 `from/into` 若恰好是树内真实存在的 GateSet 之外名字，就会被当作真提名执行——rc.60 的信任链测试假设模型返回良构提名，未覆盖"模型叙述了它没做的事"这一模态。
- **后果**：轻则提名质量退化/YAML 契约破坏（`parseCuratorNominations` 解析到噪声，落空返回空提名）；重则幻觉性 consolidation 落地为真实树变更（可恢复但未 vetted）。`llmReview` 默认 false 使该通道平时休眠，一旦开启即暴露。
- **建议方向**：把 CURATOR_PROMPT 拆为"提名视图"（明确"你没有工具，唯一产出是结构化 YAML 块"）与未来的"执行视图"（若真给工具，需先补 enum + absorbed_into 语义对齐）；或至少在提示词头部加一段与 `buildReviewRequest` 结尾同款的"Return ONLY the YAML block"硬约束。

### M-2（P2 · persona/通道错配加剧）SKILL_REVIEW 重写后的操作性指令对子代理通道不可达

- **位置**：`evolution-review/src/index.ts:228-229`——`persona: reviewPrompt(kind)` 同时服务两条通道；`toolFilter: { allow: [...config.reviewToolAllow] }` 默认 `['skill']`（只读目录工具，**无 skill_manage**）。
- rc.59 将 SKILL_REVIEW/COMBINED 重写为强操作性文本（"PATCH that one first"、"Add support files via skill_manage action=write_file"），而子代理的真实契约是请求文本末尾的 "Return ONLY the structured JSON plan"。此前 persona 措辞温和，矛盾尚可忽略；现在"立即用 skill_manage 动手"与"只返回 JSON 计划"在**同一次子代理调用里正面冲突**——inject 回退路径（主 agent 有 skill_manage）指令可达，子代理路径指令不可达。最坏路径：模型尝试调用不存在的工具或输出"已修复"的叙述 → `!result.structured` → `return true` 静默无产出（该静默分支是第一轮已记录的观察盲点，本轮措辞变化放大其触发概率）。
- **建议**：拆分 review persona（子代理版强调"产出计划，不是执行计划"；inject 版保留操作指南），或 persona 生成时按通道注入一句通道限定。

### M-3（P2 · 行为扩大）pruning 候选池失去 deterministic stale 门，活跃技能可被 LLM 提名归档

- **位置**：`evolution-curator/src/index.ts:461-482,287`——rc.62 P2-⑤ 把 `computeDedupGroups` 成员并入 `recommend()` 候选池；`prunings.filter(name => candidates.includes(name))` 的过滤池随之从 `markStale` 扩大为 `markStale ∪ dedupMembers`。
- 后果：一个**活跃、非 stale、非 pinned** 的技能只要与另一技能 token-Jaccard ≥0.95，即可被 LLM 提名进 `prunings` → `archiveCandidates` → 直接归档（`archive()` 只挡 marker 保护，不查生命周期状态）。存在反向选择面：A stale、B 活跃且互为重复时，模型可归档 B 而保留 A。提示词仍写"prunings 只提名 clearly safe (stale AND obsolete)"，但过滤层不再执行——提示词软约束与过滤器硬行为脱节。若 rc.62 的意图只是给**合并**（consolidations）提供重复组输入，实现把 pruning 池一并放宽了。
- **建议**：prunings 过滤保持 `markStale`（或对 dedup 成员补"活跃但在 dedup 组"的显式豁免门 + 报告字段标注来源），consolidations 照常。

### M-4（P3 · 行为变化）memory RMW 事务化后，失败路径会在缺失文件上**创建空文件**

- **位置**：`evolution-core/src/memory-store.ts`——`add/applyBatch` 的事务回调以 `core.write ?? (current ?? '')` 兜底（注释正确指出 `null` 在 transact 契约里是 DELETE，故 no-op 不能返回 null），但当 `current === null`（文件不存在）且操作失败（如单条超限、威胁扫描命中）时，兜底值是 **`''` 而非 null** → `transactIo` 走写入分支，**凭空创建空的 MEMORY.md/USER.md**。旧实现失败路径完全不落盘。空文件已被 drift 逻辑视为"从未写入"，无数据危害，但属无意义 IO + 首写失败的副产物文件。
- **建议**：`current === null && write === null` 时返回 null 并在 transactIo 的 DELETE 分支处理（文件不存在时 rm force 是 no-op），即"失败 + 文件原本不存在 → 保持不存在"。

### M-5（P3 · 可移植性）`verify-layout-sync.mjs --auto` 硬编码机器绝对路径

- `--auto` 默认值为 `D:/dsh/deepseek-harness/...` 与 `D:/dsh/dsh-evolution-mirror/...`（脚本头注释声称"run from either tree root"但 --auto 并不相对定位）。与第一轮 F-5（normalize-mirror 的 `D:/claw/...` 残留）同类；显式传参不受影响。建议 --auto 从脚本自身位置推导（`dirname(fileURLToPath(import.meta.url))` 已可获得）。

### M-6（P3 · 守卫覆盖与声明不符）layout-sync 守卫只比对了 `scripts/`

- `verify-layout-sync.mjs` 头注释称比较"the SAME source set (`packages/<pkg>` plus `scripts/`)"，实现只比较两个 `scripts/` 目录；`packages/*/src` 的 dev/mirror 同步仍无机械门。声明应收敛为实际覆盖面，或把 packages 树纳入比对（体量大，需排除 lib/dist/node_modules）。

### M-7（P3 · 低危）散点

1. `tool-skill-manage` 挂载 SKILLS_GUIDANCE 用 `apply()` 内 `ctx.get('systemPrompt')` 软探测（`index.ts:81-85`），而同文件对 approval 用 `ctx.inject` 惰性注入——systemPrompt 若晚于本插件挂载则 section 静默丢失（当前 host-plane 先行挂载，风险低，但同文件两种风格并存属一致性债）；
2. feedback `parseState` 的 `typeof parsed.skills === 'object'` 会放过数组/`null`（spread 后恰好无害，纯健壮性瑕疵）；
3. `verify-platform-ranges.mjs` 的家族豁免判断 `name.startsWith('@deepseek-ai/dsh-') && !name.startsWith(\`${ourScope}/dsh-\`)`——若 `--our-scope` 恰为 `@deepseek-ai`（默认发布即此 scope），家族包与平台包无法区分、全被豁免，守卫变空转；当前 CI 固定传 `@lmzhen` 不触发，属潜伏参数陷阱。

---

## 3. 上游接口与发布口径（0.1.1-rc.2）增量

- **发布口径已对齐**：`PLATFORM_VERSION: 0.1.1-rc.2` 同时派生 compat 锚点与 `^0.1.1-rc.2` peer 范围，并有机械守卫——第二轮 N-2 的"验证平台 ≠ 声明平台"矛盾解除。
- **CI 纯度约束显式化**：released 树的 root config 除 alias 注入外零接触；`inject-evolution-paths.mjs` 的 alias 集（evolution/memory/tool-memory/skill-usage/tool-skill-manage/zod/@lmzhen）成为新的单一来源——上游未来吸收任一键时 CI 会 fail-loud 提示适配，符合预期。
- **提示词 bundle v5**：混合版本部署 fail-closed 设计不变；`skillsGuidance` 入 bundle 并由 tool-skill-manage 挂载（挂载条件 = 本工具存在，语义正确）。

---

## 4. 总体评价与优先级建议

三轮对比：第一轮 6 P0 + 33 项 → 第二轮 7 项（含 2 P1）→ **本轮 7 项（1 P1 + 2 P2 + 4 P3）**，问题总量与严重度持续收敛，且历轮修复均带"修复前红"的回归测试，两个跨轮回归（rc.49→N-1、rc.47→rc.48）都被自审或审计闭环。剩余风险高度集中在 **rc.59/60 的提示词大改**（M-1/M-2 同根：为 Hermes 对齐重写的操作型措辞，未同步区分"有工具的通道"与"无工具的通道"）。

建议处理顺序：

1. **M-1**：提名通道提示词加"唯一产出 = YAML 块"硬约束，删除/重述工具集段；若保留工具叙事，先补 enum 与 absorbed_into 语义（避免幻觉提名落地为真实归档，可临时给 `applyMutations` 的 consolidation 执行加"提名必须来自候选池 ∪ 报告字段标注"双保险）；
2. **M-3**：prunings 过滤池收回 `markStale`（一行），或为 dedup 成员补显式门与来源标注；
3. **M-2**：review persona 按通道拆分或加通道限定句；
4. M-4/M-5/M-6/M-7 随下一批次顺手收口。

**统计**：本轮新发现 7 项（P1×1、P2×2、P3×4）；v2 计划遗留 0 项；历史遗留仅余 D-8（invariant 模板去重，维持搁置）与 archive 之外的低危散点。
