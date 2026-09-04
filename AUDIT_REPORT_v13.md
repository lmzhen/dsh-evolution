# dsh-evolution 第十三轮审计报告（0.3.13）

| 项 | 内容 |
|---|---|
| 审计对象 | `D:\dsh\dsh-evolution-mirror` @ HEAD `2e595cb`（0.3.13，2026-09-04 19:52；全库 86 个 src 文件 / 11519 行 / 74 spec） |
| 对比基线 | 第十二轮审计（`AUDIT_REPORT_v12.md`，核对基准 `0cbba88`；其后全部增量 = `7a70eeb..HEAD`，47 文件 +1479/−782，覆盖 0.3.1→0.3.13 十三个提交） |
| 审计范围 | ① 增量全读：frontmatter 规范化（0.3.11）、维护模板 v11→v13 与 bundle @13、commands 增量（--facts/single-flight/cooldown/timeout）、maintenance 富化单源化、`evolution-all` 聚合包、prepare-release 守卫、release.yml/CI action；② 上游 `dsh-upstream-0.1.1-rc.2` 关键契约复核（maxDepth/stopReason/子路径行名/dsh.bundle.patch/`dsh plugin add` 通道）；③ v12 五项 P3 与历史修复回归核销；④ 发布安装文档（README/INSTALL 0.3.12 批）声明-机制比对 |
| 审计方法 | 逐 diff 人工审读 + 上游源码引证（均核对到行号） + 回归 grep 矩阵 |
| 约束 | 只读审计，未修改任何代码 |

**结论摘要**：增量代码质量延续 v12 的"机械层零偏移"水准——0.3.1/0.3.8 两处对上游语义的修复经源码核实**完全正确**（`resolveChildDepth` 绝对深度上限、`stopReason:'aborted'`），富化单源化（`buildEnrichment`）彻底消灭了 0.3.8 发现的双测量源。但本轮发现 **1 项 P1：0.3.12 旗舰特性"一条命令装全家"的发布安装路径无法交付其宣称的模型工具暴露面**——Evolution agent preset 没有任何发布态安装机制，而 README/INSTALL 明文承诺"由 preset 层安装、无需手动拷贝"。另有 **1 项 P2**（single-flight 竞态）与 7 项 P3、6 项观察。v12 遗留五项 P3 中四项已闭环，历史 P0/P1 修复全部保持。

---

## 1. 本轮新发现

### P1-1（宣称-机制失配）发布安装无法交付 Evolution agent preset："no manual copying" 承诺无机制支撑

- 位置：`packages/INSTALL.md` §0 末段；`README.md` Installation 表（"Full family"行）。
- 文档承诺：*"`dsh plugin add @lmzhen/dsh-evolution-all` … After install … select the **Evolution** agent preset … The preset lives at `$DSH_HOME/.agent-presets/evolution/` and is installed by the family's preset layer (`@lmzhen/dsh-evolution-preset`) — **no manual copying of source trees**."*
- 事实链（全部上游核实）：
  1. `dsh plugin add` 的实现（上游 `apps/cli/src/plugin.ts`，全文 158 行）**只做一件事**：把声明了 `dsh.bundle.patch` 的依赖协调进 `dsh.profile.bundles`（`:44`、`:63-89`）——**不存在任何 agent preset 安装通道**。
  2. 上游 preset 发现只扫两个文件系统根：app 自带的 shipped root 与可写根 `~/.dsh/.agent-presets`（`packages/preset/agent-presets/src/discovery.ts:37-48`）——npm 包不在其上。
  3. 家族侧：`@deepseek-ai/dsh-evolution-preset` 的 `files` **不含** `agent.cordis.yml`/`preset.yml`（仅 cordis.yml/cordis.patch.yml/lib）；携带 preset 文件的是 `dsh-evolution-agent-preset`，而它**不在任何已发布依赖闭包里**（`evolution-all` 依赖 host + 三个工具包，不含 agent-preset）。
- 后果：按文档推荐的发布安装后——host 行照常挂载（后台自治可用），`tool-memory`/`tool-skill-manage`/`evolution-skill-catalog` 被装进 profile 的 node_modules 但**没有任何 preset 把它们暴露给会话**（host 有意不挂模型工具）；会话切换器里**不存在可选的 Evolution preset**。README 表四行里 "Full family" 与 "Fine-grained exposure" 两行的承诺在发布态均不可达；唯一能让工具可达的发布态路径是标着 "Legacy compatibility only" 的 `dsh-evolution-preset`（它把模型工具挂进每个会话，恰是文档让新部署避免的姿态）。用户唯一的正规出路是 README 标注为 "development only" 的源码安装器或手动拷贝——恰是文档宣称"无需"的那个动作。
- 定性：新功能交付面的**宣称-机制失配**（非数据风险，故 P1 不升 P0）。0.3.12 的聚合包与依赖闭包本身正确，缺的是最后一公里：要么上游/家族补一个 preset 投递机制，要么文档如实降级（"发布安装 = host 态；preset 需源码安装器或手动拷贝两份 YAML"）。
- 修复方向（任选其一）：① `evolution-all`/`evolution-preset` 的 `dsh` 清单或 postinstall 落 preset 拷贝（需上游扩展通道，成本高）；② 文档修正 + 发布 `@lmzhen/dsh-evolution-agent-preset` 并给出一条显式拷贝指引（`cp node_modules/@lmzhen/dsh-evolution-agent-preset/{agent.cordis.yml,preset.yml} $DSH_HOME/.agent-presets/evolution/`）；③ 让 host bundle 附带一个"preset 目录探测"说明。②成本最低、可立即自洽。

### P2-1（并发守卫）maintain single-flight 存在 TOCTOU 竞态：检查与置位之间隔着最慢的异步段

- 位置：`packages/evolution-commands/src/index.ts:235`（检查 `maintainInFlightSince > 0`）→ `:247`（`await buildEnrichment(ctx, library)`）→ `:251`（`maintainInFlightSince = Date.now()`）。
- 机制：两个快速重触发都在第一个 `await` 处让出——守卫检查（同步）与置位（富化完成后）之间是**全库 list+read 的富化段（大库上以秒计）**。竞态窗口内的重触发双双通过守卫、双双 spawn——按其自己的 0.3.8 证据链（"command retry cancels the previous invocation"），平台层会取消第一个运行，**恰好复现 0.3.8/0.3.11 要消除的"重提交取消前一扫描"症状**，且冷却窗帮不上忙（`lastMaintainAt` 在 settle 后才更新）。
- 修复：把置位移到**第一个 await 之前**（进入 maintain 分支即 `maintainInFlightSince ??= Date.now()`，finally 清零；同时给 in-flight 分支加上"已运行 X 秒"信息即现状文案）。一行级修复，配一个并发重入回归用例（现有 single-flight 测试是串行模拟，测不到该窗口）。

### P3 本轮清单（7 项）

| # | 问题 | 位置 | 说明 |
|---|---|---|---|
| P3-1 | 011 设计文档两处数字/理由过期 | `docs/design-review/011-maintenance-subagent-v2.md:207-208` | 仍写 `maintainTimeoutMs 默认 120_000`（0.3.10 起为 600_000）与冷却 130s 及已被 80ec941 撤回的"≥超时才无重叠窗口"理由（0.3.5 起为 30s，理由改为防误触）。与 v12 P3-1/P3-2 同类的文档漂移，且恰在同一文件 |
| P3-2 | `maintain --foo` 静默落入帮助文本 | `evolution-commands/src/index.ts:223`（regex 不匹配 → 落到 `:314` 帮助分支） | 分支注释自称"reject unknown args explicitly"（011 §3），实际未知参数/`--timeout=600000` 等价式都无声落到通用帮助，无错误提示。建议补一个 `^maintain\b` 前缀的显式拒绝分支 |
| P3-3 | frontmatter 规范化与 `parseFrontmatter` 的**闭合定界判定不一致** | `skill-store.ts`（normalize/detector 要求整行 trim 后 === `'---'`；`parseFrontmatter` 用 `indexOf('\n---', 3)`，`\n----` 也命中） | 闭合行写成 `----` 的文件：家族解析认为有 frontmatter、规范化器认为没有（end<0 原样返回）→ 写点不加引号、`catalogInvalid` 也不标。罕见（此类文件平台严格解析本就会拒），建议统一为 parseFrontmatter 的判定或注明边界 |
| P3-4 | 多行 flow collection 首行会被误加引号 | `skill-store.ts` normalize（`[a,` 无闭合 → 落入前导指示符规则 → 引成字符串 `"[a,"`） | `related_skills: [a,\n  b]` 这类合法多行流式值被改写成损坏（仍是合法 YAML 但值变了）。检测器自称"single-line entries only"，但无法区分"单行流式"与"多行流式首行"。建议：前导 `[`/`{` 且无同行闭合的行**跳过不改写**（保守 > 修复） |
| P3-5 | 模板 §7 "protected 集 0 建议"仍未被校验器机械执行 | `evolution-maintenance/src/validate-plan.ts`（全文件无 protected 消费） | 0.3.11 已把 `protected` 送进 facts meta 与 `DriftReport.skills[].protected`，校验器拿得到却不用——建议条目命中 protected 名时可直接 reject/强制 needs_human。现状是纯提示层约束（计划无执行权 + 用户门，风险有限），属纵深防御缺口 |
| P3-6 | abort 误判面 | `orchestrate.ts` catch（`/abort/i` 对 name+message 联合匹配） | 与取消无关但消息里含 "abort" 的错误会被翻译成"已中止"文案。仅影响报错措辞；建议收紧为 `name === 'AbortError' || message === 'This operation was aborted'` |
| P3-7 | 根/各包 manifest 版本仍为 `0.1.0-rc.1`，与 0.3.x 发布线脱节 | `package.json`、各包 manifest | 发布版本由 CI `platform_version` + pack 时重写（`prepare-release`），机制自洽；但人读 manifest 与 CHANGELOG 差了 13 个小版本。建议 normalize-mirror 或 CI 顺带把 manifest 版本对齐（纯观感，延续 v1 D 类遗留） |

---

## 2. 上游契约复核（本轮关键声明逐条证实/证伪）

| 声明/修复 | 结论 | 上游证据 |
|---|---|---|
| 0.3.1 `maxDepth` 语义修复（默认 0→1，"绝对深度上限"） | ✅ **正确** | `packages/subagent/subagent/src/child-agent.ts:48-56`：`childDepth = delegationDepthOf(parent) + 1`，`maxDepth !== undefined && childDepth > maxDepth` → `SubagentDepthError`——0 必拒 spawn；review/maintain 的父会话深度恒 0，默认 1 恰好"允许本体、禁止嵌套" |
| 0.3.8 `stopReason === 'aborted'` 取消判定 | ✅ **正确** | `types.ts:202-212`（`SubagentStopReasonMap.aborted`）+ `lifecycle.ts:240-253`、`out-of-process.ts:187-191`（取消路径 resolve 为 `aborted`） |
| composition 行名使用子路径 `@deepseek-ai/dsh-evolution-maintenance/tools` | ✅ **可行** | loader `tree.import(name)`（`vendor/loader/src/config/tree.ts:145-155`）走标准 import → 命中 maintenance 包 `exports['./tools']`；tsdown entry 已含 `tools`（`tsdown.package.config.ts`） |
| README：`plugin add` 自动识别 `dsh.bundle.patch` 并拉依赖树 | ✅ **属实** | `packages/boot/app-boot/src/profile.ts:10-11,41-43`（`"dsh": {"bundle": {"patch": …}}` 即 bundle 认定依据） |
| INSTALL：preset "由 preset 层安装、无需手动拷贝" | ❌ **失实** | 见 P1-1（`plugin.ts` 无 preset 通道 + `evolution-preset` 不携带 preset 文件） |
| bundle @13 fail-closed | ✅ | `verifyPromptBundle` 仍按 pinned 常量比对；`prompts.spec.ts` 以常量引用 + drift 拒绝用例钉住（不硬编码版本号，升级不破测试） |
| CI `.github/actions/evolution-validate` | ✅ 设计正确 | overlay 进上游树构建/测试/pack/dry-run；`platform_version` 单点定义 + N-2 guard 断言重写生效；`copy_host_tsconfig` 区分基线与发布上游两锚——v1 审计"架构张力 1（镜像 vs monorepo 构建）"由此在 CI 层闭环，仓库内 tsconfig 保持上游形态是有意的双布局纪律（README "Development and tests" 已如实声明） |

---

## 3. 回归核销（历史问题保持性）

### v12 遗留（5 项 P3 + 1 发布期验收）
| 项 | 状态 | 证据 |
|---|---|---|
| P3-1 模板基准注记 | ✅ 已修 | `011:197`（"以 core MAINTAIN_PROMPT 常量为实现基准；本文为语义基准"） |
| P3-2 quality_low 行文 | ✅ 已修 | `011:76`（"侧车 quality_score 统一收口字段；分缺失=unknown"） |
| P3-3 `--plan` 浅实现 | ➖ 维持既定裁决（结果文本注记，无持久面） | 未回退 |
| P3-4 `--facts` 0-token 预览 | ✅ 已实现 | `commands/index.ts:206-221`（`buildMaintainFacts` 单源、零子代理、无冷却）+ `commands.spec.ts:485` 测试 |
| P3-5 probe 暴露面理由记录 | ✅ 已修 | `evolution-maintenance/README.md` "Known Limitations"（全局只读、与 skill 同暴露层级、白名单限定）——记录位置在包 README 而非 v12 建议的根 README，可接受 |
| 发布期验收（probe 深挖改变 confidence） | ⏳ 仍待真实 LLM 冒烟 | 不变 |

### 历史修复保持性（抽查矩阵，全部通过）
| 检查项 | 结果 |
|---|---|
| v1 P0-1 `session.append('evolution/*')` | ✅ 零命中；events.ts 注释明示教训，review 走 `ctx.emit` payload v2 |
| v1 P0-2 命令名契约 | ✅ 全部合法（`evolution`/`graph`；replay 并入 `/evolution`） |
| v1 P0-3 skill-usage root | ✅ `config.root || skillsRoot()`（`:84`） |
| v1 P0-4 plan-validator 依赖 | ✅ dependencies 已含 `dsh-evolution-core` |
| v1 P0-5 模糊补丁死循环 | ✅ 迭代化 `fuzzyReplace`（`scanFrom`，`:438-448`） |
| v1 P0-6 `purpose` 越界 | ✅ 零命中 |
| v7 P3-1 supportRefs 窄匹配 | ✅ 已放宽 `[A-Za-z0-9._/-]+`（`:503-507`） |
| 决策 B/C（门体系/事件单发射点） | ✅ `evolution-core/src/gates.ts` 存在；`SkillLibrary.notifyMutation` 为唯一失效事件源（tool-skill-manage 注释明示"emitted by SkillLibrary itself (decision C)"） |
| 0.3.11 写点规范化 | ✅ create/update/patch 三路齐备，normalize 后二次 validateFrontmatter，威胁扫描作用于规范化后内容 |
| 0.3.12 聚合包 | ✅ 依赖闭包与 README 表述一致（P1-1 的 preset 缺口除外）；契约测试钉死四依赖且"多一个都不行" |

### 本轮增量代码质量评语
- `buildEnrichment` 单源化（0.3.9）是教科书式的收口：probe/scan/--facts 三个消费方共享同一构造，0.3.8 的双测量源问题从结构上不可再现。
- `prepare-release` 三连修（一次性迭代器 bug、npm 11/12 pack 形状、lib 级未重写守卫 + 本地 import 存在性守卫）都是真实事故的正确止血，守卫从"抽查 index.js"升级为"全部 bundle × 全部名字 × 本地引用闭包"。
- 模板 v11→v13 的信息密度提升（三问判据、B5 三分类半机械门、confidence 机械降档、§3 完整性契约）与 `validate-plan` 的归一化（undo_path n/a）配合良好；阈值占位符经 `thresholdNoun` 从 core 常量单源渲染，无第二真相源。

---

## 4. 观察项（不计缺陷）

1. `maintenance_probe` 每次调用重建全量富化（`tools.ts` → `buildEnrichment` 全库 list+read）——probe 是按需深挖、频次低，可接受；若未来模板鼓励高频 probe，建议在一次扫描会话内缓存。
2. `--facts` 与 full scan 之间无互斥——两者皆只读，无风险；仅提示 `--facts` 也会吃掉一次全库读。
3. single-flight 文案 "the result appears when it finishes" 与命令通道无推送事实之间的落差：结果要靠用户再次输入查看（维持现状合理，属产品选择）。
4. `snapshotFromLibrary` 对 list 命中但 SKILL.md 读为 null 的技能静默跳过（竞态窗口）——facts 不出现该技能也无标记；与 P3-3 同属"审计盲区"小类。
5. 模板 v13 语言规则已解耦中文硬编码（"与库正文语言一致（不自订语言）"）——跨语言库的审查输出语言歧义仍在（多语言库以哪种为准未定义），留给下次真实运行观察。
6. 仓库出现 `.git`（213 提交）与 v9–v11 审计归档（`aebc32f`），审计谱系管理规范；建议把本报告编号规则与 CHANGELOG 的"template vN"（维护模板版本）在 REVIEWS.md 里显式区分，避免 v12/v13 两个序列混淆（0.3.11 的 "template v12" 指维护模板，与本审计报告 v12 无关但同号）。

---

## 5. 统计与结论

- **本轮新发现：9 项 = P1×1 + P2×1 + P3×7**；观察 6 项。
- 十三轮趋势：39（6 P0）→ 7 → 7 → 6 → 7 → 3 → 4 → … → v12 0 新缺陷（5 P3 文档）→ **本轮 1 P1 + 1 P2**。P1 回归到"新交付面（发布安装）的宣称-机制失配"，与 v7 的"新功能组装层失误"同构：**新代码面 ⇒ 新缺陷面**，而本体的并发/恢复/单源语义已连续多轮零新增 P1。
- 严重度分布的重心持续左移：本轮 7 项 P3 中 5 项是文档同步/边界一致性/纵深防御类，核心数据面（memory/skills/state/audit）本轮未发现任何正确性缺陷。
- **建议处理顺序**：① P1-1 立即（发布自洽性——文档修正或补投递机制，随 0.3.14 携带）；② P2-1 一行修复 + 并发回归；③ P3-1/P3-2/P3-6 随手批；④ P3-3/P3-4 归入 frontmatter 规范化器的下一轮边界加固；⑤ P3-5（validator 消费 protected）与 P3-7 列入 0.4 候选。
- **0.3.x 发布判定**：增量工程质量支持继续发布；P1-1 修复前，建议在 README 首页对 "Full family" 行加一条已知限制注记，避免发布态用户按文档走完安装后困惑于"选不到 Evolution preset"。

---

## 6. 实施状态（0.3.14，2026-09-04）

用户批准"按升级后的批次开工"——**9 项全部随 0.3.14 携带**（超出 §5 建议的 ⑤ 拆分：P3-5/P3-7 未留给 0.4）。

| 项 | 状态 | 落地 |
|---|---|---|
| P1-1 | ✅ 已修 | `evolution-all` 依赖 += `dsh-evolution-agent-preset`（预设文件进入发布闭包）+ 新 `/evolution preset install` 命令（幂等复制 agent.cordis.yml/preset.yml 到 `$DSH_HOME/.agent-presets/evolution/`）；README/README.zh/INSTALL.md 从"no manual copying"失实改为真实的 one-time 命令步骤。**0.3.15 跟进**：0.3.14 的命令只复制 delta 片段，而预设注册表将组合文件**原样挂载**——delta 单独会得到一个只剩 delta 行的 agent；0.3.15 改为"读运行时 standard + 合并 delta"（core `composePresetComposition`，与 install-layered 逐字节一致，installer.spec 钉死） |
| P2-1 | ✅ 已修 | `maintainInFlightSince` 提前到首个 await 之前（检查+置位隔同步代码）；并发窗口回归 |
| P3-1 | ✅ 已修 | `011:207-208` 数值更正（600_000 / 30s + 撤回"≥超时"理由）+ "以 code 常量为准"注 |
| P3-2 | ✅ 已修 | `^maintain\b` 显式拒绝分支（替代静默落帮助文本） |
| P3-3 | ✅ 已修 | 共享 `frontmatterBlock`（严格闭合行）为 parse/normalize/detector 单源 |
| P3-4 | ✅ 已修 | `normalizeFrontmatter` 用 js-yaml（平台目录同款解析器）验证每次重写；失败回滚 + issues fail-loud；evolution-core 新增 js-yaml 依赖 |
| P3-5 | ✅ 已修 | `validate-plan` 从 `report.skills[].protected` 建 protectedNames → 命中即拒（§7 机械层） |
| P3-6 | ✅ 已修 | abort 判定收紧（hoisted signal + 精确名称/消息，替换 `/abort/i`） |
| P3-7 | ✅ 已修 | `normalize-mirror` 从 CHANGELOG 最新 `## x.y.z` 派生版本（31 manifest → 0.3.14）；dev twin 文档化 no-op；pack 版本仍以 tag + prepare-release 为单源 |

观察项 1.-6.：未实施（维持现状；2/3 产品选择、4 记入下一轮审计盲区候选、5 留给真实运行观察、6 编号规则建议留存）。

本地门禁：vitest 64/64（398）、oxlint 0/0、tsc -b（core/maintenance/commands/all）0。
