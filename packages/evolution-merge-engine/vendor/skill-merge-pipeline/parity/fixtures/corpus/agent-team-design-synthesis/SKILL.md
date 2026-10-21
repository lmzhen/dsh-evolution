---
name: agent-team-design-synthesis
description: Design via parallel facets with adversarial review.
version: 0.1.0
author: Hermes
metadata:
  hermes:
    tags: [Agent Teams, Design Review, Synthesis, Adversarial Verification]
    related_skills: [capability-claim-audit, dsh-context-visibility]
---

# Agent-Team Design Synthesis

Fans a design question across independent facets written by separate teammates, then synthesizes them under
explicit adjudication criteria, then has **different** teammates try to falsify the result. It produces a
design document set, not code. It does not replace reading the code: every facet still owes `path:line`
evidence. The failure mode it exists to catch is a composed design whose parts each look right while the
whole contradicts itself.

Seat charters (mandated stance, named adversary, three ranked proposals, self-falsification), how shared material and platform facts reach the seats, and the lead-only judgments (keystone code points, irreversibility gating, overrule list): `references/seat-charters-and-lead-vantage.md`.

## When to Use
## 多轮对抗轮次法（R1→R2→R3，实战校准）
### 共享协作文件的写入纪律（2026-10-13 事故后固化，必须遵守）

- **共享文件只追加，禁止整文件回写**：多席并发时任何人 `read` 全文再 `write` 回去，都会用**自己读到的那部分**覆盖他人内容。用 `appendFileSync`（或 `edit` 只改自己那一段）而不是 `write`。
- **`read` 会在超大文件上静默截断**：事故判据＝**读到的字符数 ≪ 文件字节数**（实测：文件 39,213 字符，`read` 只返回 27,771 字符，且末行落在文件中间）；回写那刻文件已 91,380 字节，结果**约 2.3 万字符被覆盖且无法自动恢复**（无 spill 副本、无 `.bak`）。⇒ **读大文件后绝不可整文件回写**。
- **权威口径**：综合与验收一律**以各席自己的 `R<N>-<seat>.md` 为准**，共享 CROSS-TALK 只作索引（并发写会丢段）。
- **事故处置模板**：①让各席把发在共享文件里的段落**追加重贴一次**（他们各自的 R 文件是完整的）②宣布新纪律（只追加）③在文件末尾追加事故说明与纠正措施 ④把工具级教训（静默截断判据）写进技能库。**先恢复内容，再追责**：这属于流程错误，不按个人过失处理。
- **整读前的可证伪断言（门禁口径，注意编码陷阱）**：确需整读共享文件时先断言真实长度；**不要**写 `s.length === statSync(p).size` —— 中文文件里 `s.length` 是 **UTF-16 码元**、`.size` 是**字节**，两者不等，会**误报**（实测该中文文件 43,571 字符 ≠ 其字节数）。严格写法：`Buffer.byteLength(s, "utf8") === fs.statSync(p).size` ✓；不等即中止并改用分段读。本次事故就是缺这一条（39,213 → 27,771）。重贴后若旧标记仍在，说明覆盖是**部分**的 ⇒ 重贴可能产生"同内容重复"，须在段首标注"以最新一段为准"。

- **R1 领域轮**：每席只写自己领域的结论清单＋权威依据（`文件:行`）＋失效模式＋**不做清单**＋未核实项。写进各自 `R1-<seat>.md`；再由 Lead 综合成一份"起点事实 + 优先级 + 三分（平台已有/插件职责/需新增）"的草案。
- **R2 领域内裁决轮**：每席对草案**逐条表态**（支持／要改／要删），并**点名要替换的既有实现**（不是泛泛建议）；要求给出**迁移偏序＋反证**（例："门禁先于点亮只能 CANNOT DECIDE"）。
- **R3 总体观点轮（关键）**：用户明确"一个人满意的设计另一个人未必满意" ⇒ 每席**跨出领域**答七问：①是否根治（最强支撑＋最强反对）②最危险的一条（出事形态）③最该删的一条（删后哪条判据仍防回归）④**只准保留三条**（按序）⑤**与哪一席价值观正面冲突、谁的证据更强**（点名，引 `文件:行`）⑥若你是 Lead 会怎么改（要具体）⑦**你自己的保守处**（前两轮没敢说的取舍）。
- **指定价值观对手**：Lead 按 R2 的结论为每席配一个**真冲突**的对手（不是假配合），并要求在共享文件里**直接 @ 对手**回应。
- **收口三件套**（不要折中）：①**表决矩阵**（每条 × N 席：支持/要改/要删，并裁定"谁的证据更强"——按 `文件:行` 与可跑读数，不按声量）②**冲突消解表**（把价值判断换成**可判定实验或门禁**）③**"只留三条"的交集**（交集＝真共识；无交集的分歧点单列给用户定）。
- **纪律**：权威以各席 `R<N>-<seat>.md` 为准、共享 CROSS-TALK 文件只作索引（并发读改写会丢段/标题正文分离）；允许并鼓励**自证撤回**（"因为谁的哪条证据"）；每条都要"怎么算红"。

- The user asks for a design/plan "from the perspective of a whole team" (架构师/PM/UI/工程/算法…), especially with 大范围重构 or 忽略短期工程量.
- A design must satisfy several **non-negotiable invariants** conjured by the user, and multiple subsystems could each satisfy them differently.
- The user will later ask "第 N 轮审查" / 独立复核 — i.e. the deliverable is expected to survive adversarial reading.
- Any design big enough that one author cannot hold all facets at once.
- **用户已点名"用一支智能体团队来严肃讨论"时，禁止单人交稿** —— 单人方案会被当场判"不对"；必须真派队友、真反驳、真复核（见下"执行机制"）。

## 设计阶段的分工纪律（接口先冻结，再分代码区）

**详细设计不能整包外包给一个"设计智能体"，也不能按"角色"切** —— 后者会得到几份各自正确、拼起来互相矛盾的稿（本会话先例：三名队友把四条边界证成三条，因为边界定义本身没冻结）。正确顺序：
1. **Lead 先冻结一页接口契约**：模块与依赖方向、类型与字段名、出口与断点、阈值与口径存放处、不可变式。**这一页不外包** —— 它是所有 facet 的共同真源；
2. **按"不重叠的代码区"分配**（不是按头衔）：每个 facet 一个模块／一条链路，写域互不重叠；发单时说明"**你只补细节、不改契约**"，有意见写**契约异议**一节由 Lead 裁决；
3. **设计稿的交付形状**：函数签名／数据结构／调用点 `file:line`／错误面／**验收判据（命令＋期望输出）**；不写实现代码（实现是下一阶段，且由 Lead 定顺序）；
4. **收口判据**（三条全中才动代码）：各稿之间**接口一致**（同一形状只出现一次，出现两次即退回）＋ 每份都有可执行验收判据 ＋ 契约异议逐条裁决完毕。

判据之所以是"接口一致"而不是"每份都对"：分片设计的失败模式不是单点错，而是**缝**上错。

## 角色差异必须落在 prompt 层（2026-10-12 所有者口径）

**不要用「同一段公共说明 ＋ 一句话角色名」凑团队** —— 那样拿到的是同一视角的四种说法。每个角色要各写一段**领域化提示词**，至少四样不同：
1. **术语与概念**：架构＝依赖方向／接口契约／边界与不变量；度量＝分布／分离度／标记率／阈值标定；产品＝失效／判据／批次／回滚单元；工具链＝runner／门禁集合／发布顺序／干跑。
2. **证据标准**：架构要 `file:line` 与调用链；度量要**双语料读数**与统计量；产品要「可观察结果或命令」；工具链要**反事实**（删掉某步骤会不会变红）。
3. **输出结构**：各自的报告骨架不同（依赖图／分布表／判据表／对账表），别统一成同一张表。
4. **反驳对象**：指定每人反驳**哪一类**结论（架构反驳机制层、度量反驳阈值与出处、产品反驳价值与验收、工具链反驳门禁有效性）。

**共用的是事实基线，不是视角**：把已核实事实放进一份共享 brief（避免各人重推同一批事实），但角色段落必须独立撰写。判据：把各段角色提示词并排看，**术语、证据标准、输出骨架三样都不该重复**。

### 视角差异的完整清单（不止术语）
每个角色的**视角层级、看问题的角度、方向与顺序、关注点**都要不同 —— 只换术语仍会得到同一个视角：
- **层级**：元层（这套工作凭什么说有效）／机制层（依赖与接口）／界面层（用户在这一屏要做什么决定）／工具链层（哪个环节会失守）。
- **角度**：方法学与统计／调用链与不变量／认知负荷与决策路径／反事实（删掉会不会变红）。
- **方向**：外部→内部（从论文/上游倒推我方）与内部→外部（从用户任务倒推字段/接口）要**分配给不同人**，否则人人同向。
- **顺序**：先方法与实验设计→再看结果→再判可否外推；对比"先定用户决定→倒推字段→再定层级与动作"。
- **关注点**：效应量与样本／阈值与出处／信息密度与可执行动作／门禁有效性与发布顺序。

### 为什么派子智能体：上下文保护，而不是"人多"
派人的首要目的是**防止上下文过长导致信息遗漏**：Lead 不试图把全部细节放进一个脑袋。因此每份 brief 必须**自足**（事实基线＋术语＋证据标准＋输出骨架齐备），队友只回**结论与证据**（≤25 行），细节留在他们的报告文件里供 Lead 按需读取。

### 收尾：系统工程式综合（全部队友完成后才做）

**第 0 步（不先做这一步，后面全是空转）：把各席互相矛盾的数字用一次实测结掉。**

本会话实测：八席八轮产出**四张互相矛盾的成本表**（6.0 倍 / 大于等于 6.0 倍 / 3 951–23 881 / 8.35 倍），全部由读码推断加算术推得；一次真机捕获（父加两档对照，30 秒）直接定案，**四张表全部作废**。

- 规则：**推断可以定位问题，不能给成本定价。** 凡要进成本／收益表的数字，必须来自一次实测捕获；给不出实测就标「未测」，并且**不得进表**。
- 触发判据：**当两席对同一个量给出不同数字时，不要再开一轮分析** —— 那是把分歧乘以人数。先问「哪个量能一次测出来」。
- 反面实例：本会话中「system 段按工具集分支渲染」这条读码推断**方向正确、幅度被夸大**（真实 39k 降到 19.9k 字符），而全席据此推出「归零」「8.35 倍」等结论。

**等所有人交付**，然后把**所有文档 ＋ 所有回传消息**一起综合，而不是逐份转述。采用系统科学/系统工程的看法：
1. **层次与边界**：把结论按"平台／宿主／插件核心／工具面／界面"分层，写明每层的**边界与不变量**（谁的职责，谁的约束）；
2. **结构与接口**：列出跨层接口（谁产出、谁消费、契约是什么），把"同一件事的多种说法"合并成一处；
3. **反馈与稳态**：找出闭环（度量→动作→再度量）与**断环**（只有度量没有动作、只在写入时提示而存量永不再提示）；
4. **失效模式与冗余**：按"哪一环失守会导致什么"排风险，标出**同义冗余**（第二套语义/第二道同义门）与**假安全**（自证计数器、只跑没牙的一半）；
5. **一次到位**：给出**唯一执行稿**＋批次＋每批的回滚单元与验收判据，并显式列出**对既有文档的更正**；
6. **不做清单**：把被否掉的项留一行台账（理由＋判据），不留在正文当可选层。

## 执行机制（2026-10-12 家族评审实测，可直接照用）

- **必须要求落成 md 文档（给路径，且是硬性交付物）**：所有者观察 —— 只要求"回信总结"时，子智能体的**思考时间与工具调用次数会明显变少**。做法：在 `team_task_create` 的 description 里写明**唯一可写文件**（如 `…/team/R3-P-paper-evidence.md`）＋**≤150 行的报告要求**＋回信只作**索引**（≤25 行）；Lead 收工时先核**文件存在性与行数**（本次 9 份报告 11–22 KB／60–149 行，逐份核过），再读回信。判据：**报告文件在、行数达标、每条结论带 file:line 或实测输出** ⇒ 三者缺一即退回重做。
- **成员上限 8**：`spawn_teammate` 超限会报 `Team member limit 8 reached` ⇒ 先 `list_agents` 找 inactive 队友，用 `send_message` **复用**，并把用户点名的角色映射到已有成员（例：架构→`audit-arch`、度量/算法→`audit-core`、产品+项管+UI→`audit-surface`）。
- **brief 放共享任务，不放聊天**：队友不共享你的上下文 ⇒ 把"输入路径＋已核实事实＋输出纪律＋唯一可写文件"写进 `team_task_create` 的 description；聊天消息只写"读 `task-N` → claim → 做 → 写报告 → complete"。**写域互不重叠**（每人一个报告文件，放在 `…/team/` 下）。
- **★ 多轮讨论后，必须把「Lead 自己上一轮的提议」列进 brief 作为待否证项（本会话实测有效）**：用户与 Lead 来回多轮后，Lead 提出的方案会变成下一轮的**承重假设**。做法：在共享 brief 的边界节里写明「以下 N 条是 Lead 的提议，不是既定边界」，并要求每人逐条判**成立／不成立／成立但需缩小**并给证据；综合稿必须有一节**「被本轮推翻的既有认知（含 Lead 自己的）」**，逐条写谁否决的、依据什么、代价是什么。本会话据此推翻了 Lead 的**三条**（含一条是 Lead 转述平台行为说错的），全部靠队友读平台源码证伪 ⇒ 不这样做，错的前提会被下游四份报告继承。
- **强制反驳（关键）**：要求每人回复 ≤25 行且固定三段 —— ①最硬的 3 条结论（带 `file:line` 或实测输出）②**你不同意其它文档的 1–3 点**（附反驳依据）③别人还没看到的缺口 2 条。实测这一条让三名队友共纠正我草稿 **7 处**（含一个"均行长异常"结论被平台语料直接证伪）。
- **★ 当评审的前提被质疑时，不要打补丁——开第二轮（两段式），本会话实测有效。** 触发条件三类：① 术语跨系统可疑同名 ② 参考物的**全量接口面没普查过**（本轮新增「接口普查员」才发现我们对平台的认识只有手边那几条）③ 上一轮的判死依据只来自**一条子路径／一个文件**。做法：**第一段**用**新角色**做独立普查（接口全量 ＋ 语义审计），产物是一份差缺补漏文档；**第二段**把这份文档发给**原班角色**，每人只**追加**一节 `## 第二轮修订`，只答两件事——「我哪几条作废／缩小」与「我视角下仍该做的两条」，**≤60–80 行**；Lead 最后出第二份综合稿，逐条写谁否掉的、依据是什么。**本轮净收益**：推翻 Lead 自己的 2 条判词，而 4 份修订里 1 份明确「无一条被推翻」——这本身就是有价值的结论。
- **★ 同名异实必须由独立角色审计，不能靠 Lead 的常识。** 跨系统复用概念时（例：把某个框架的 skill 映射到宿主平台的 skill），两边**可能根本不是同一个东西**——本轮实测：那个参考框架里**不存在**该概念（同名串全是无关的后端配置），而宿主平台的同名物只承载文本、不注册也不执行。⇒ 词表里凡出现借来的名词，配一条**可操作判据**（能不能被模型调用？有没有独立生命周期？是不是持久化契约的一部分？），并逐条点名哪些既有结论依赖了这个等价假设、处置是作废还是重述。Lead 自己写的词表也可能写反——这正是要独立角色的原因。
- **Lead 必须自己复核承重断言**：把队友引用的行**自己读一遍**；读不到就标"未复核"（本例一处平台文件路径在树上不存在 ⇒ 该结论全程标记未审，不写进结论）。
- **最终稿必须有"对先前草稿的更正"节**并写明"本文件为准"，否则新旧文档互相矛盾（用户讨厌"勘误节"式留痕，但更讨厌互相打架的两份稿）。
- **任何新维度/新阈值先做双语料分离检验**：用现状语料（用户库 vs 平台自带）跑分布 ⇒ 只有"分离成立 **且** 标记率落带 5%–25%"才立项，否则删。本例据此删掉"均行长"维、保留"20k 软线"。

## 让角色互相认识、并允许它们直接对话（2026-10-13 实测）

用户口径：**每个角色都要知道团队里还有谁**，遇到涉及他人的内容就**直接跟那个人交流**，而不是全部经 Lead 转手。做法（可直接照搬）：

1. **派单前先写两份共享底稿**：① 共同底稿（硬约束／已核实事实／输出格式／证据等级）；② **名册表**：`| 代号 | 角色 | 本轮产出 | 它拥有的事实 |` —— 最后一列是关键，它把"谁知道什么"变成可查的表，队友问问题时知道该找谁。
2. **协议三条**：一条消息只问一件事（≤10 行：**我要什么／为什么依赖／我按什么判据接受答案**）；**同一队友每人 ≤2 条**（先问、后确认，防拉锯）；**收方必须回**结论＋`文件:行`，或标"未核＋怎么核"。
3. **派单时附"跨角色依赖表"**（谁的设计依赖谁的什么事实＋建议问法）。实测收益：把重复问句压到 7 条未核问句、**7/7 全部收到回复**——没有这张表，八个角色会各自去问同一件事。
4. **要求每份文档带"与他人接口"节**（向谁要了什么／拿到了什么／还差什么）。没有这一节，Lead 综合时看不出协作是否真的发生，也看不出哪些结论还悬着。
5. **收益量级**：一轮八个角色的详细设计里，**四个缺陷有两个是队友互相证伪查出来的**，其中一条是**被证伪一半**——结论对、归因错（"非法参数会被归错因"不成立，因为更早的一行已校验；真正缺的是声明面的 `enum`）。⇒ 复核者要写清"哪一半活下来了"。
## Prerequisites

- **A fixed shared brief** (`PROJECT.md`): invariants (numbered), the minimal interface, non-goals, the evidence paths, and the reporting conventions. Facets must be written *against* it, or they each invent a different contract.
- **Explicit adjudication criteria** (`METHOD.md`): 4–8 numbered judges (e.g. "every decision must name which segment of the lifecycle it serves") that make a conflict decideable without taste. Keep them few and load-bearing.
- **A fixed taxonomy for failures**, so robustness is enumerated rather than asserted.
- One writer per output file, disjoint write scopes, and **fresh-context** teammates (they do not inherit your session's assumptions).
- Verifiers must be **different members from the writers**, and read-only.

## How to Run

1. **Write the brief before spawning anyone.** Invariants are yours to fix; if the user gave 5–7 invariants, they are the acceptance criteria.
2. **Carve facets by artifact, not by job title.** Group roles so every artifact has exactly one author ("平台接缝 / 插件集成 / 数据模型 / 生命周期+UI"), and tell each what the others own so they don't re-derive it.
3. **Spawn all facets at once**, each instructed to read the brief first, claim its shared task, write exactly one file, and report a few lines back.
4. **Forward cross-facet facts as they land.** When facet A discovers something that invalidates an instruction you gave facet B, message B immediately — a wrong instruction propagates into every downstream file.
5. **Synthesize with the judges, not by voting.** For each conflict: present both positions, name the judge that decides, give the evidence, and **write down the losing option's cost** plus the condition under which it would win. Record it as a 取舍 record — never as an errata section (see Pitfalls).
6. **Spawn two adversarial verifiers** with disjoint scopes: one for **external facts** (does the cited byte actually say that?) and one for **internal coherence** (do the retained invariants still have mechanisms?). Instruct them to falsify, to write how they *tried* to falsify where they found nothing, and to list 证据不足 rather than defaulting to OK.
   **A pre-release CODE audit is a different commission from a design verifier — brief it explicitly.** When the gate is "may this ship?", the reviewer's brief carries the weight; these six clauses turned a diffuse read into a decidable verdict:
   - **Make it run the gates itself first** (`node --test`, the checker script) — never let it inherit "tests pass" from your summary; the whole point is that your green suite missed the last four defect classes.
   - **Name the historically-fragile areas and say "do not sample".** ("Contract conformance has been wrong five times — align *every* module's exports against §3.") Uniform attention wastes the reviewer; the defects live where they've lived before.
   - **Require independent re-verification of your own "already fixed" claims.** The handoff card lists things as done; the reviewer must **check** them, not read them. This is the single highest-yield clause.
   - **Demand a decidable deliverable**: "can this be released? if not, which items block?" A report with no verdict gets re-read forever.
   - **Ask for a "what was done right" section** — a purely negative report makes the author over-correct, and it identifies which practices are load-bearing enough to keep.
   - **Read-only, and evidence-classed.** Forbid edits (so the review cannot pollute the state it judges), require `[实测]/[读码]/[推断]` per finding, and say **"do not pad the list"** — an invented P2 costs more than a missing one, because it teaches the author to skim.
7. **Merge both reports into the body**, one edit per item, then re-read the specific lines to confirm no splice (patching lists silently merges bullets).
8. **Deliver**: verdict first, decision tables, the 不做清单, the 未审 list, and the one or two items you genuinely need the user to decide.

## Quick Reference

**Design the facets so each one can fail loudly**: a facet that only produces prose cannot be verified. Require `path:line` or command output per claim, tagged `[实测]` / `[读码]` / `[推断]`.

**Evidence tags are load-bearing.** A verifier's job is to reclassify `[读码]` claims as `[实测]`, `证据不足`, or `不成立` — not to admire them.

**Verifier scopes must not overlap.** External-fact verification and internal-coherence verification find different bug classes; one verifier doing both finds neither well.

## Scope discipline (the mistakes that happen *before* any facet is written)

These are not facet errors — they are framing errors, and they poison every downstream document.

- **Conflating two temporal scopes silently imports a whole competing product category.** Real instance: a design was framed as "images the model can use", but its feature list (dedup, retrieval, thumbnails, retention) had drifted into **long-term memory** — at which point the real competitors became *document/project memory*, not the peers being studied, and the case became indefensible (why keep a local image store when the image can live in the repo?). ⇒ **State the temporal scope out loud in the opening sentence** (当下使用 / 本会话 / 跨会话), and when a candidate capability only pays off in the *other* scope, **cut it** rather than letting it justify itself.
- **When the gap you fill is narrow, "no comparable project exists" is the expected result, not a bad search.** The correction was one line — *"因为太窄了，所以找不到类似的项目"* — and it changed the evidence standard: for a platform-gap plugin there is no category to be a member of, so **novelty cannot be validated by peers**. What validates it instead: the platform does the adjacent work well, the gap is real and observed, and the platform will not close it. Corollary: **a search whose hits are all off-scope is telling you the scope is narrow — not that the idea is wrong.**
- **Two evidence bars: a *primitive* vs a *feature*.** Adding an operation that converts a **perceptual judgment into a numeric one** (read the exact colour; compute the diff between two regions) needs no scene evidence — the evidence is that the runtime currently forces the model to eyeball it, and the return is strictly fewer tokens for the same answer. Adding a **feature** still requires a concrete past instance. Apply the bar that matches what you are adding.
- **A count-only constraint is the fragile way to express a taxonomy.** "No more than 4 tools" says nothing about *why* a 5th is wrong. Replace it with the rule it was standing in for — **"one tool = one class of question"** — and then every addition must argue that it answers a *new class*. A count bends without an argument; a taxonomy does not.
- **Cutting scope is a decision with FOUR parts — and "not now" must never read as "never" or as "blocked".** When the user answers a batch of open decisions with a principle (here: *"建议部分按照『最小实现最广适配』来即可"*), resolve each item by writing down all four:
  ① **the decision** (keep the default / don't build it / delete the guard);
  ② **the restart trigger** — the concrete observation that would reopen it (e.g. "a real session hits the cap and genuinely needs retention"), because an untriggered deferral becomes folklore;
  ③ **the gate restated** — say explicitly that the *minimal* path **completes** that milestone, or the plan stalls forever waiting on a feature nobody chose to build (G2 = adapter + one backend, **done**; the other backends are not part of its completion);
  ④ **the path kept wired** — leave the deferred pieces as contract-shaped stubs so enabling one is **one line plus one test** (`runContractSuite('verbatim', verbatimBackend)`), not a re-derivation.
  Also worth stating the principle's own reading: *minimal implementation* and *widest adaptability* can point opposite ways (local-only vs published-to-every-installer) — when they do, look for the option satisfying both rather than picking a side.
- **An error's classification must match the advice the caller will give.** Classify what the *user* can do about it, not just where it came from: an *admission* rejection (too large / wrong type) is **correctable** — the caller should be told "crop or downscale first"; a disk-full write failure is **not** — telling the model to crop there sends it to fix a healthy image. Same round also produced the mirror rule at the read boundary: **an empty result from a lower layer is a failure classification, not a valid empty value** — "read zero bytes" must surface as `corrupt`, because silently returning empty turns "it's broken" into "it was empty".

## Keeping a design SET in sync (a change is not done when the definition is updated)

A design set is N documents that each restate the same facts. Changing one fact (tool count, file count, enum values, pass lines) means updating **every restatement**, and the failure is silent: the definition looks right while consumers read stale numbers. Real instance: after adding a 5th tool, the plan's G3 header was updated and the change was reported as done — the user asked *"分组落地计划也相应的修改了吗？"* and the body still said "四工具" / "四个工具共用同一个 `resolveId`" / "契约层（G2，30 条）". ⇒ **Never report a sync as complete off the definition edit; report it off a grep.**

- **Grep every form the fact can take, then fix each hit deliberately.** One fact hides as: Arabic numeral + CJK numeral + bare count + a *related* word (`四段执行时序`, `×4`, `4=4=4`) + the number inside a pass line (`30/30`, `5=5=5`). A search for one form finds ~half.
- **Inserting a subsection renumbers everything after it.** Adding `§3.8` pushed the old 3.8→3.9, 3.9→3.10, 3.10→3.11 — so every **cross-reference** (`/* §3.10 */`, "见 §3.8") must be updated too, and the shift is invisible in a diff of the new section alone. Check this first if the set numbers its sections; matching `^### ` after the edit both confirms continuity and reveals duplicates.
- **Renumbering is where you introduce duplicates.** In one pass this happened twice (`2.3` duplicated, then a gap at `2.3`). ⇒ After any renumber, print the numbered headings and read the sequence; a duplicate heading is the signature.
- **Leave frozen history alone and say so.** Earlier-round facet documents carry the old counts by definition. Rewriting them adds drift and buys nothing — the live chain is what gets read at implementation time. **State the boundary explicitly** in the reply (which documents were synced, which were deliberately left), rather than silently sweeping or silently skipping. One exception worth honouring: a document that is still *cited as input* (e.g. the round's own spec) is not frozen history — annotate it with the round it belongs to.
- **Content-level errors survive renames.** One deliverable needed rewriting, not resyncing: it had mis-classified 6 items under a heading that implied they were peers, when 4 were off-scope and 2 were different-mechanism. Renaming a file does not fix a wrong classification inside it.
- **★★ Two of your own documents can CONTRADICT each other — and that is not a sync task, it is a design conflict.** Distinct from every bullet above: nothing changed, the set was simply never consistent. Real instance: the client-design doc said *"`client.js` only `require('react')`"* while the module-contract doc declared dependency direction **D5: `client.js` → `lib/form.js`**, a plan doc explained a work-group *because of* D5, and a whole `§3.10` specified that module's export surface. Meanwhile the platform's module loader **cannot resolve relative specifiers in a synchronous `require` at all** (it matches only seed words / materialized ids / package factories). ⇒ **Neither doc was stale; one was unimplementable.** ⇒ Resolution rule: **do not adjudicate by recency, seniority, or preference — find the EXTERNAL constraint that disqualifies one side and cite it** (here: a contract read plus a measured runtime failure). Then amend the specs to follow the platform, not the other way round.
- **★ Your design set probably already has a conflict protocol — grep for the previous time.** This same set had earlier recorded *"X1 (volatile read semantics) and X2 (`byte_backend` has no group to live in) must go back to `SYNTHESIS`/`11` to be corrected before any code changes."* That precedent supplied the pattern: **name the conflict (X3), amend the authority chain, and only then implement.** Reusing it kept the change reviewable; inventing a fresh process would have hidden it. When you hit a new issue *class*, search your own docs for how you handled the last one.
- **The tempting middle path is often the exact defect class you have been hunting.** Offered three routes — inline (delete the module), a build step (keep both), or "keep the module but only tests import it" — the third looks conservative and is **dead production code**: a mechanism that exists in the docs with no live consumer, which is precisely the defect that had recurred four times in this same project. ⇒ When a fix's "safe" option is *keep a thing nobody uses*, take the harder option and record why the safe-looking one is the bug.
- **Keep the coverage when you must inline: extract from source.** Deleting a module to satisfy the platform does not license dropping its tests. Read the hosting file, **brace-match** the moved function out of it, evaluate that text, and run the *identical* assertions — the subject moved house, the contract assertions did not. Pair it with a **strict double**: upgrade the fake `require` from "return a stub for anything" to **"allow exactly the one spec that is legal, throw otherwise"**, so the harness itself becomes an assertion about what the code may depend on.
- **Report sync scope by CLASSIFYING every hit, never by a raw count.** "38 hits, 5 fixed" is not a status. Bucket all of them: **fixed**, **still stale (list them, with what to change)**, and **deliberately frozen — with the reason**. The frozen bucket has a non-obvious member: **statements of historical MEASUREMENT** ("at G3 completion the tree was 16 files / 47 exports") must **not** be updated, because editing them falsifies the record; distinguish those from live claims wearing the same words. And check the *gates* too: a checker rule still pointing at a deleted path **silently skips** and reads as passing — the vacuous-gate hazard, arriving through a file move.
- **★ The outstanding-work list rots too — and it is the most insidious artifact in the set.** After classifying a sync sweep, you will naturally write a table of *"still stale, to change"* items. Fix those items next round and **that table becomes a false record**: it asserts work is outstanding when it is done, and it reads as diligence. Real instance: a 6-row debt table was written, all 6 were closed the following round, and the table survived until noticed. ⇒ **Treat a debt list as a claim with the same lifetime as any other restatement** — when you close its items, amend the list *in the same pass*, converting it to `closed (how) / still-open / deliberately frozen`. Corollary that generalises: any document you write *about* the state of the work (checklists, gap lists, "known issues", handoff cards) is subject to the identical staleness rule as the specs — the sync discipline applies to your own bookkeeping, not only to the design documents.

## Settling a project name (and the assertion trap that follows it)

- **When a name is taken, read what took it — before writing any conclusion that rests on it.** Real instance: after finding `dsh-loupe` occupied, the reply asserted *"the pixel slot in the ecosystem is empty"* — but that was **inference dressed as evidence**; the user's next question was *"被占用的 dsh-loupe 是干啥的"*. Once actually read, the package turned out to be a **text-selection explainer** (published, 6 versions, MIT, 1★) — a *different domain* (text vs pixels), not a competitor. So the honest finding was two-part: the core word is taken **and** the collision is harmless — and the second half was only knowable by reading it. ⇒ **"the space looks empty" is a conclusion you earn by reading the occupants, not a premise you start from.**
- **A probe that fails looks exactly like a probe that succeeds.** `npm view <name> version` returning an error is *not* "available": under PowerShell the shell may block `npm.ps1` (execution policy) and the error text does not start with a version, so a naive "does it look like a version?" test reports **可用 when it only means 探测失败**. Use **`npm.cmd`**, and treat only an explicit **E404** as the availability signal — any other error means the probe didn't run.
- **Check three things, in this order**: ① npm name (E404 = free), ② GitHub repo/topic collision (same word in the same ecosystem), ③ **what each occupant actually does** — a textual collision is not a semantic one. Then decide whether to keep the word with a disambiguating prefix or drop it.
- **A shared metaphor is evidence for the name, not against it.** The word `loupe` ("a lens for looking at detail") had been independently chosen by an unrelated author for an unrelated plugin — which means the metaphor **self-explains**: nobody has to be taught it. Count that as a point in favour when the domains don't collide.
- **Write the rationale with the collisions in it.** A README naming section that says only "the space is empty" ages badly and is unverifiable; the durable version names what was occupied, by whom, doing what, and why the overlap is acceptable.

## Mechanical gates: build them so they can turn red

> 全文移入 **`references/gate-discipline.md`**：判据必须是可运行脚本；判据的**作用域**要自检（扫 0 个文件也是"通过"）；变异测试；剥注释再匹配（含它**在临时探针里把答案说反**的形态）；不区分真假的分支式断言；悬空基数引用；以及"规则误报正确代码时该改规则"。
> ★ **2026-10-13 分册**（主文件曾涨到 100 492 字符、超过上游 100k 上限）：其中两节已移出，**内容逐字未改**（拆分脚本自带 bullet 守恒校验：99 条 → 60 ＋ 26 ＋ 13）：
> - **`references/fixtures-and-instruments.md`**（26 条）—— 谓词／夹具／仪器：**夹具是旧不变量的化石**、double 必须**写回**回调的返回值、**"量出 0 先怀疑仪器"**、**闸的作用域要按"合法区域"定义而不是"代码碰巧在哪"**、**自己的重构会让闸静默失去覆盖**。
> - **`references/naming-and-documentation.md`**（13 条）—— 命名／结构／"照实现写文档"：**"判据/文档的形状"与"实现"必须对得上**、**改了代码没回写权威文档**、**文档承诺而代码没有**。
> **⇒ 找夹具/仪器类的纪律去第一册；找命名/文档类的去第二册；判据机制本身（怎么让闸变红）留主文件。**
> **五条机械检查**（改完文档必跑）在主文件里，含 `MISSING:`（被吃掉的锚）、`TIGHT:`（标题后紧跟内容）、成员出现次数=1（重复尾）、围栏配对。

## Perishable-state hazards when driving edits from a shell

- **Console garbling ≠ file corruption.** A shell that mis-decodes CJK output makes *files* look corrupted in error text. Read raw bytes and count the replacement char (`EF BF BD`)/invalid sequences before believing it — otherwise you "fix" healthy files. Observed both in one pass: the console lie first, the real corruption second.
- **The real one: a shell's default text writer can destroy non-ASCII files.** PowerShell 5.1's `Set-Content`/`Add-Content` write the ANSI codepage ⇒ a 3-byte UTF-8 char is truncated to 2 bytes and the file becomes **invalid UTF-8**. Detect with a syntax check (`node --check` fails without a readable message). Restore with an explicit encoder: `[IO.File]::WriteAllText(path, text, [Text.UTF8Encoding]::new($false))`. **Before mutating a file for a test, make the restore path an explicit-UTF-8 write — not the same shell verb that broke it.**

## Pitfalls

- **Composition failures escape per-facet review.** The worst defects found in this class were *mine, at synthesis time*: each facet was sound, but the merged design was self-contradictory. Always re-check the whole, not just the parts.
- **Adopting a mechanism can silently delete the mechanism a retained invariant depends on.** Real instance: the synthesis adopted "zero listeners, no projection fold" (sound on its own) while also keeping "the dedup ledger's scope is the live context" — which was *only* achievable via the fold it had just removed. The text still read correctly; the capability was gone. ⇒ **For every invariant, name the mechanism that implements it; then check the adopted decision set still contains that mechanism.**
- **A guard you just wrote can require the mechanism you just removed.** Second instance: the compensating "startup reconciliation" guard required reading the log at a point where no log handle exists. ⇒ **A guard must be checkable at the point you place it.**
- **A mitigation is useless if your own schema blocks it.** Third instance: the "round-trip path: feed the platform's printed identity back to the tool" was blocked by that tool's own `id` regex, and the escape hatch was undercut by a discipline line telling the model not to re-request. ⇒ **Trace each promised capability through the actual input schema and the prompt text that governs it.**
- **Reducing a mechanism deletes its measurable signal.** If you drop the tracker, drop the metric built on it too (e.g. a "resend after context reset" counter that can now never increment) — otherwise it reads as evidence forever at value 0.
- **Never deliver an errata section.** Corrections merge into the body; the user treats a visible errata list as unfinished work. Keep a separate review file, but the design file must read as if the errors never existed.
- **Scope drift is checked, not assumed.** With the new section above: every delivered document must state its **temporal scope** in §1, and every feature must answer "which scope does this serve?" — a feature whose honest answer is the scope you excluded is a deletion, not a debatable addition.
- **State the level of any guarantee.** "Unified at the contract level, not the engine level" is a real answer; "unified" alone is a wrong one. Same for "cached", "lossless", "reversible".
- **UI 面的观感结论需要真实渲染；拿不到就别造。** 本会话实测：队友起的隔离浏览器被宿主页面 token 挡在 401 ⇒ 它把结论上限定为"与平台权威 CSS 逐行比对"，并在报告里明写"像素级观感未验证"。**这是合格交付**；把"推导出的对比度"写成"实测不可读"则是不合格。同理适用于任何需要真机渲染/真机截图的面。
- **Don't let a facet's inference become a downstream fact.** Facets quote each other; a `[推断]` promoted to `[实测]` by repetition is the most common cross-facet corruption. Route all such items to the 未审 list.
- **★ 本机看到过的机制 ≠ 平台契约（本会话实测翻车）。** 队友把用户根目录下的 `.history/**`、`.usage.json`、`.archive/` 当成平台的版本账与归档契约，实际它们在**平台仓里零命中**，是本机安装的**第三方插件**自建的私有账。⇒ 判据：宣称「平台已有 X」之前必须在平台树里 grep 到它；只在本机文件系统里见过 ⇒ 记为**本机环境事实**，与契约分开写。Lead 复核承重断言时要连带问一句：这条有没有平台仓出处？
- **★ "文件不在"要分两种：没写 / 写了没回填。** 子智能体在收尾时报 failed 时，它可能已经**落盘了临时文件**却没来得及并入正文（本轮实测：一个角色的修订写成 `.tmp-<角色>-r2.md`，正文里查不到、主文件也没有）。⇒ 复查顺序：① 核**正文**有没有那节 ② 找不到就 `readdir` 该目录，看有没有 `.tmp-*`／草稿文件 ③ 有则**按原文追加进正文并注明来源**（不要自己重写、不要丢掉它的措辞），再顺手清理临时文件。**不要因为"文件里没有"就判定它没干活，直接重做。**
- **★ Lead 自己的引证也要被独立核对。** 本轮 Lead 的**两处**判词被队友回读实现纠正：一处把"`Agent` 只有 id"当成了完整面（其实另有一个 `declare module` 运行时增强面），另一处**引错了函数**——把写入侧的校验当成读回侧的校验，于是得出了相反的结论（"没有逐字节比对"，而实现里确实有）。⇒ 团队规则要写明：**Lead 的每一条判词也是待核对的断言**，派单时给出它、并要求"发现与实现不符就直说"；综合稿里带头写"Lead 更正：我上一版引错了位置"。这条比任何纪律条目都更能提升整体质量，因为它示范了"没有人的结论免检"。
- **Timeout is not completion.** Re-list agents and tasks after every wait; a finished file can exist before the owner reports.
- **★ 参数面缺席 ≠ 内容缺席（A/B/C 三面判据）。** 本会话八席同犯的错：由「`SubagentRunParams` 没有 history 入参」（B 面：请求参数面）推出「worker 提示词里没有请求方对话」（A 面：内容在不在）。**缺席证据只能否定它自己那一面。** ⇒ 凡写「拿不到 X」必须写明是哪一面：A 内容在不在／B 字节对不对齐／C 通道能不能做。
- **★ 归因 ≠ 数字相似。** 单次读数只说明「用了多少」，**不说明「与谁共享」**——它可能是与同档上一次运行共享。本会话这个混淆（同档自暖 vs 与源头共享）**换了三张皮复发**。⇒ 归因必须带**同档前置基线**，或用内容身份（哈希）把「数字相似」换成「身份相同」。
- **★ 阴性实验必须带阳性对照。** 「没搜到」「没触发」既可能是真的没有，也可能是仪器没工作；而这类实验的失败模式**系统性偏向确认假说**。⇒ 先把标记放进**已知可见**的位置证明「找得到」，再问目标位置有没有；没有阳性对照的否定结果**不可证伪**。
- **★ 引用共享且正在被编辑的文件，必须带快照 + 单位 + 测点。** 行号会腐坏（同一文件在两次读取之间从 487 行长到 635 行）；「某串出现 N 次」必须**自己跑计数**，不接受转述（用户一眼能看出的计数差异，曾让一席据此写出错误纠正）。单位＋测点三例：字符 vs 字节（247,294 vs 248,064）、字符 vs token（32,516 vs 32,521）、解析后 vs 文件内转义（32,516 vs 33,397）。
- **★ 能力与属性必须按「文件」陈述，不按「整包/整路线」陈述。** 同一个包内不同文件的可用性可以相反（内联字段被截断、边车未截断），而且**字段未必存在**（同类文件在另一个包里没有那个字段）。本会话一席把同一张路线能力表改了三次，前两次都错在**只看一个文件的内联字段就概括整条路线**。⇒ 结论写成「某文件的某字段能不能回答某问题」，并注明该字段的**存在性逐例核过**。
- **★ 先用后删的仪器产物，删前先落读数。** 删**整个目录**而不是主文件（边车常常是正文的第二份副本：`system-prompt.txt` / `prompts.json.system`）；读数含**包内文件清单＋各文件字节＋哈希＋时刻**。别把「隐藏」当「清理」（例如 `archivedAt` 只是把条目移出默认列表）；对外承诺（purge 之类）**必须列出它不覆盖什么**——一句做不到的承诺，比一条写清楚的边界更贵。

## Verification

- Every numbered invariant in the brief maps to a §-level mechanism in the synthesis, and that mechanism appears in the adopted decision set (not in the rejected one).
- Every design decision carries a judge id and an evidence tag; no decision rests on "obviously" or on a README sentence.
- Each conflict has a 取舍 record naming the losing option's cost, not just the winner.
- Two verifier reports exist with disjoint scopes, each containing a 反例/证据不足 section; every 不成立 item is resolved by an edit you then re-read.
- The 未审 list is non-empty and honest — a design with no unknowns was not verified, it was narrated.
- **After any fact change, the delivery states the sync scope in facts**: which documents were edited, what each stale-count grep returned, and which documents were deliberately left frozen. A bare "已同步" is not an answer.
- **Every shipped gate has two red proofs on the record**: it failed on a degenerate input (empty tree), and a deliberate mutation made it red before restoring green.
