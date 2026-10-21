---
name: capability-replication-audit
description: Judge whether a port matches its upstream point by point.
version: 0.1.0
author: Hermes
metadata:
  hermes:
    tags: [Porting, Alignment, Audit]
    related_skills: [agent-skill-evolution-benchmarking, dsh-evolution-maintenance]
---

# Capability Replication Audit

Audit, from implementation evidence, whether a port (plugin, mirror, fork) covers a bounded capability set that an upstream reference defines — then write one status document per side. It does NOT run either system, does not change code, and does not judge quality; it judges *presence and equivalence of mechanism*. A verdict is only as good as the code actually read, so this skill is a reading discipline first.

## When to Use

- "检查 X 在 A 和 B 中是否都已经复刻了" / "对齐情况如何"
- "分别写入两个情况说明文档"（one doc per side）
- Deciding whether a gap is a platform-contract limit or an unfinished port
- Reviewing a port before release, or after the upstream gained a capability

## 从差集到处置：对齐 / 超越 / 拒（2026-10-12 家族评审实测骨架）

拿到"上游有／我们缺／我们有上游没有"三张清单后，**别默认"对齐上游＝更硬"**。逐条按下面六条判：

1. **引擎照抄、规则不照抄**：抄上游的**形状**（finding 行模型 `{severity,rule,message}`、纯函数签名、增量语义——只报本次写入新引入的规则），不抄**规则文本与词表**。实测：上游必填节是英文标题（平台自带 8/8 技能都没有该标题）、替换表是本家工具名 ⇒ 搬到中文/异构宿主即 100% 误报。
2. **对齐阈值前先做双语料分离检验**：用**现状语料 vs 参照语料**跑分布（本例：用户库 33 技能 vs 平台自带 8 技能）；单位与集合口径**先冻结**（同一语料三种文件集定义差 18%，bytes vs chars 差 50%）。数字的出处要落到**活代码**：注释里的"平均值"不是线（实测：把上游注释里的 average ~20k 当成上游 24 000 那条线，两处注释都写错了）。
3. **超越必须落到已有动作**：只报"超标"不算超越 ⇒ 产出可执行载荷（如 `{heading, to_file}`）。判据：该动作**在账本里被执行过**（实测 restructure 已被用 4 次 ⇒ 缺的是触发器，不是能力）。
4. **"补丁的补丁"识别式**（两条，命中即应**替换机制**而非再加一层校验）：① 校验器读**被测对象自报的计数器** ⇒ 未进入计数体系的规则全部免疫（实测：删掉唯一被检文件后该门禁仍 EXIT 0）；② 门禁在 CI 只跑**没牙的一半**（policy-only），真判据依赖**仓外产物** ⇒ 永远回答不了问题。层级不匹配同理：containment 只认 `scripts/*.mjs` ⇒ `tsc/oxlint/vitest` 行两头都不判，删掉 CI 的 lint 步骤不会有任何门禁变红。
5. **一次标定、一处存放**：同一能力的多个阈值（20k／24k／60／14–30）是**同一件标定**的取值 ⇒ 一次做完、放一个常量模块，别做五次独立决定。
6. **读上游要防工作树为空**：浅克隆可能只有 `.git`（`git status` 会列出全部文件）⇒ 按路径读会得出"上游没有该文件"的**相反结论**；用 `gh api repos/<o>/<r>/contents/<path> --jq .content`（base64 解码）或 `git ls-tree -r --name-only HEAD` 取真身。

## Prerequisites

- Both trees readable locally, and the capability set **already chosen** by an earlier functional pass (typically the 2–6 load-bearing items after dropping generic ones). An audit diffs a fixed list; it is not a survey.
- An **independent line-locator channel**: Windows `pwsh` + `Select-String -SimpleMatch`; POSIX `grep -n -F`. Never trust one tool's numbering alone.
- File mtimes, captured before reading and again before writing: `(Get-Item <f>).LastWriteTime` / `stat -c %y`.

## How to Run

For each capability, in each tree, trace four things — **entry → decision condition → state write → failure/replay path** — then classify and document.

```text
capability set (fixed)  →  per side: entry / condition / state / failure
                        →  verdict per point (one of five)
                        →  gap class (contract limit | deliberate fork | missing impl)
                        →  one status doc per side + 前置/验收 todos
```

## Quick Reference

Verdict legend — every point gets exactly one:

| Verdict | Meaning |
|---|---|
| 完全对齐 | mechanism present and equivalent |
| 语义一致形态不同 | same semantics, different shape (record the shape) |
| 部分 | subset present; name what is missing |
| 缺失 | re-checked absence on current bytes |
| 本侧更强 | port adds guarantees the upstream lacks (list them) |

Gap classification — every gap gets exactly one:

- **平台契约边界造成** — the host platform cannot express the mechanism; state the prerequisite part the port would have to build itself.
- **有意分叉** — a recorded reason exists; cite where it is recorded.
- **实现缺失** — nothing blocks it; directly actionable.

Doc placement: each side's doc goes into **that side's own docs home**, adopts that repo's existing verdict legend and header conventions, carries a **snapshot stamp** ("行号为 <timestamp> 读码快照"), gives per-gap **前置 → 验收** todos, and **cross-links** the sibling doc.

## Procedure

1. Fix the capability set and the selection criterion (name what was dropped as generic, so the reader can contest the cut).
2. Per capability per side, read the implementation and quote the fourtrace points. **Module headers, IMPL docs, and design notes are not evidence** — they state intent and drift.
3. Assign the verdict; for each gap assign the class, and re-read the region that decides it.
4. Re-check every **absence** claim on current bytes with a keyword search (`-SimpleMatch` on Windows) — absence claims rot fastest. Use **several phrasings and case variants**, and expect the target text to wrap: one grep of `Confirm with user` returned ZERO while `confirm with the user before creating or deleting` was present, and `patch it immediately` was missed only because it wraps across a line. A single-phrasing search is not a measurement. **And a capability is often implemented under the port's own identifier rather than the upstream's wording** — one absence claim survived three prose phrasings and was still wrong because the port names it `skillWriteConfirm` (a registry parameter, owner recorded in its own param table). For every absence claim also enumerate the port's naming conventions — registry/param ids, tool ids, config keys, error codes — and search those, plus the generated settings-UI parameter list, which frequently carries the only human-readable description.
5. Verify each load-bearing line number with the independent channel. If a cited file's mtime moved during the session, **re-locate all its citations and re-read the touched regions** before writing.
6. Write one status doc per side: purpose + method + snapshot stamp, verdict table, per-point evidence, gap classification, todos with 前置/验收, coverage declaration (已查/未查).
7. Cross-link the two docs; later updates edit the same doc — one fact, one home.
8. When the audit feeds an **existing report/template** rather than a standalone status doc, measure that document's own density first — survey every table (cols×rows + header row + one sample cell) and a couple of paragraphs — then size your table to it. In the class of report this was built on, comparison tables ran 2–6 data rows with cells of one clause (≤60 chars); a denser table reads as out of place even when the facts are right. Enumerate the slots the author left (placeholder prompts, `XXX`, empty `【】` cells) and fill those, don't restructure; and report author-side defects you notice (a misspelled row key, a summary column left empty) instead of silently working around them. Write every filled slot in **formal report register** (书面陈述、术语首现给标识符、数值带条件与单位), and re-render the page holding any table afterwards — a register pass changes line counts, and one extra line in a lead paragraph is enough to push a table row onto the next page (references/officecli-report-filling.md). Then match the *paragraph formatting*, not just the wording: an empty slot paragraph usually carries no direct formatting, so filled text lands flush-left in the style default while the document's authored body paragraphs are justify + first-line indent + an explicit font/size (see references/officecli-report-filling.md).

## Pitfalls

- **Gate numbers borrowed from a stale tree.** When a port's tests can only run inside a host tree, confirm that
  tree carries the same version as the source under audit *before* quoting any result: a local overlay of this
  family sat at 0.10.0 while the mirror was 0.15.2, so its green run would have measured the wrong code. Compare
  the package version first (`package.json`), and when a gate genuinely cannot run, write *that* into the
  document with the reason ("本地构建线停在 0.10.0") rather than filling the slot with borrowed numbers — a
  source-level audit count and a test-gate count are different evidence and must be labelled as such.
- **Comment-level evidence.** The trap that triggered this skill: a first pass sourced verdicts from module headers and an IMPL doc; the code disagreed on line-level facts. Read the branch conditions and the state writes.
- **Line-number drift.** Symptoms: a cited line shows an unrelated statement; two tools disagree; a file grew a feature mid-session. Fix: independent re-locate, then re-read the whole region rather than shifting numbers.
- **Platform limit misread as omission.** Before writing 缺失, ask whether the contract permits the mechanism at all (e.g., a synchronous approval hook with no pending-queue API cannot do stage → approve → replay without an external store). Those are 结构性不同 plus a prerequisite, not a defect.
- **Recommended double-interruption.** A "confirm before writing" contract may already be carried by an approval gate; define the boundary before recommending it.
- **Verdict mush.** "Mostly ported" is not a verdict. Use the legend, one per point.
- **No coverage declaration.** Without 已查/未查 the reader cannot distinguish "absent" from "not looked at".
- **Anchor escaping when folding results back into a doc.** When the append is driven by a program-embedded string, build the `old_string` anchor from **plain text**: an anchor containing backticks silently fails to match (`old_string was not found`) even though the line is present. Re-anchor on the nearest backtick-free phrase instead of retrying the same string.

## 何时升级为「打分对比」（本技能只管对齐；要排名时用这套）

对齐审计回答「有没有、是否等价」，**不打分**。当用户要的是「两个实现该装哪个」，加一层七维评分即可，且结论必须在换权重后仍然成立。

- 七维 × 0–10，求和（满分 70）：① 原生适配（是否贴平台接缝，还是 patch 全局/自建服务）② 流量与凭证安全（是否拦截模型流量、重签请求头）③ 代码质量 ④ 测试规模与深度 ⑤ 功能完备度 ⑥ 安装与依赖风险 ⑦ 维护与可持续。再算一遍**加权版**，两版结论不一致就说明排序不稳，不要给推荐。
- 评分必须有可复算的事实锚点，别写形容词：嵌套深度（文件内最大缩进的均值/p90）、`as unknown` 密度/千行、超 800 行文件数、测试文件与用例数、test:src 比值、开放 issue 数与关闭率、peer 区间是否覆盖目标版本、运行时依赖数、license。
- 让维度自己说话：移植版常在 ①⑥⑦ 领先，上游常在 ④⑤ 领先；把「上游更强」的部分明确写成"如果这些维度权重更高，结论会翻转"，比强行给一个总分诚实。
- 推荐段必须同时给出：**未做**（没跑运行时/没做端到端）、**回退路径**（卸载命令 + 要撤销的 patch 行）、**可证伪点**（≥3 条"出现什么现象就下调哪一维"）、**移植版的已知边界**（缺失能力/命名陷阱/内核跟随策略）。
- 写进独立评测文档（"评分对比报告.md"式），含 rubric、逐维证据表、总分表、机制差异、推荐与原因、边界、可证伪点——不要塞进本技能正文。

## Verification

- Every absence claim has a re-run search on current bytes; every load-bearing citation has an independent line lookup; every cited file's mtime is known.
- Each side's doc carries the snapshot stamp, the verdict table, the gap classification, per-gap 前置/验收, and the coverage declaration.
- Reading the two docs alone tells a reader which side lacks what **and why** (contract limit vs deliberate fork vs unfinished) without opening either repo.

## 与"最初设想"对表：先认主轴，再把每个缺口归到层（2026-10-13 实测）

审"最终的实现离最初的设想有多远"时，**第一件事不是看实现，是认设想的主轴**。实测教训：一个设想的四条里有两条是"让模型**造**工具"（生产侧），两条是"让模型**用**工具"（消费侧）；我只审了消费侧就交了报告，被当场指出"跑歪了"。⇒ 做法：

1. **把设想拆成可判定的主张，并且把"动机条款"也拆进去。** 设想里"工具多了会稀释注意力"这种话看着像理由，其实是**独立的主张**——它决定"多选"能否覆盖**自造**出来的工具。漏掉它，"多选已交付"这条结论就是错的（实测：自造工具的最自然归属恰好落在治理面够不到的那一层）。
2. **逐条判"原子缺"还是"管道缺"**：原子＝平台公开的构造块（注册一个东西、撤销、写文件、收窄），管道＝把这些原子按工序串起来的那条路。**只有原子缺才是真障碍**；管道缺只是活。判法：去平台源码里读这些原子的**文档注释原文**——它们通常把作用域与限制写死在注释里（本例：注册那句写明"globally or in the calling agent scope"、返回精确 disposer；收窄那句写明只作用于 **global** 工具、且"scope-local names … fail"、"scoped registrations remain visible"）。⇒ **注释就是约束的原文，别转述**：转述会丢掉"谁能被治理"这一半。
3. **找出两条主张之间的张力，而不只是各自的缺口。** 最有价值的发现往往是"A 主张的实现方式恰好让 B 主张失效"（本例：造更多工具 ↔ 收窄看不见自造工具）。这类张力要写成**一条**发现，而不是两条缺口——它是设计级结论，决定后面所有取舍。
4. **每条判定标证据等级**（实测／读码／设计稿／推断），并单列一节 **"未核"**。用户口径：无证据的推测会被当场驳回；"未核"比"看起来没问题"有用得多。

## 让一个角色专门"证伪"：审计结论的独立性（2026-10-13 实测）

审计报告里的"平台事实"往往来自**注释、类型声明、函数名**——这三样都不算证据。实测：一轮审计里 4 条自有论断＋若干文档论断送**独立复核角色**回读实现，结果**我自己的 2 条被证伪**（"工具调用结束即回收"——effect 归属传进来的 ctx 所属 fiber，活到 agent 销毁；"某行是模型可见工具面的权威行"——那行其实是另一条链路的构建点），文档侧另有 5 条被证伪（含"图片 ref 是 opaque id"——实现里铸的是内容摘要）。

做法（可直接照搬）：
1. **单设一个只做证伪的角色**，它的产出格式固定为「论断 → 原文摘录（文件:行）→ 判定（已复核／**证伪**／未核）」；不复述方案、不提建议。
2. **强制标证据等级并区分读码与实跑**：读宿主**已安装产物**是 `[读码]`，不是 `[实测]`；同一份报告里两者不能混用同一个词。
3. **注释与实现冲突时以实现为准，并把冲突记成证伪**（不是记成"注释过时"就放过）。
4. **作者自己也要交"待答清单"**：把"我这条依赖别人证实"的点明写成可判定的问句（例："工具体内注册的工具会不会随调用回收？"），让复核者有的放矢——本轮正是靠这份清单一次性结案 4 条。

附加收益：复核者会补出**所有文档都漏掉的机制**（本轮补出第 7 条 per-agent 工具面机制 `presentAs`）——因为它的任务是"穷尽回读"，而不是"支持某个结论"。

## Raising an evidence grade: run the experiment against the INSTALLED build (2026-10-13)

When a claim must go from "read the code" to "measured", do not add dependencies and do not rewrite the platform's test file — **import the installed build by absolute path** and reimplement the platform's own harness shape:

1. Resolve each package entry yourself: read `<host>/<pkg>/package.json`, take `main` (or `exports["."]`), and `import(pathToFileURL(dir + entry).href)`. Absolute paths bypass the repo's bare-import universe, so packages the project cannot resolve at all (scope machinery, system-prompt, runtime) become usable; the probe therefore lives outside shipped code (`_probe/*.mjs`) and adds no dependency.
2. **Reuse the platform's own fixture shape** found in its tests (e.g. `mount()` = `new Context()` + `plugin(SystemPrompt, {})` + `plugin(ToolRuntime)`, and a scope minter whose plugin declares `inject: [...]` because *the scoped context resolves services through the minting plugin's dependency chain*). Reimplementing those two shapes took one read of the platform spec and made all assertions runnable.
3. Assert the **falsification consequence** for each claim, and probe the cases the platform's own tests *skip* — that is where the new findings are. Measured yield from 12 assertions: the load-bearing premise held (so a planned degradation was cancelled), and two behaviours no upstream test covered surfaced: a child scope can **shadow a name an ancestor denied** (so the filter is a visibility mask, not a security boundary), and registering from a scope-less context **succeeds silently** into the global layer (so any "never fall back to the root context" rule is now measured, not inferred).

## Extend the probe you already have, and encode a post-call check as two assertions (2026-10-13)

- When a host call has **no precondition check** (measured: registering a capability into a scope succeeds silently even from a scope-less context, landing it globally), the only defence is a **read-back after the call**. Encode that read-back as **two** assertions, not one: “the effect is visible to the party that asked for it” **and** “it is invisible to everyone else”. The second is what catches the silent fall-through to a global/default scope — a single positive assertion passes in both the right and the wrong case.
- Cheapest way to get this measured rather than argued: **extend the probe that already mints the composition** (the one built for the earlier scope experiments) with three lines — register, read back for self, read back for a third party, then dispose and read back again. No new harness, no new dependencies, and the probe’s total assertion count becomes the evidence (`15/15` here).

## Support files

- `references/hermes-skill-authoring-five-points.md` — the worked case: the five-point capability set, both side docs' verdicts, and the evidence anchors as of the 2026-09-24 snapshot.
