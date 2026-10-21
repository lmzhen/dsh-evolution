---
name: capability-claim-audit
description: Check a tool's capability claims against its source.
version: 0.1.0
author: Hermes
metadata:
  hermes:
    tags: [Audit, Evidence, OpenSource, Evaluation]
    related_skills: [capability-replication-audit, agent-skill-evolution-benchmarking, dsh-plugin-discovery]
---

# Capability Claim Audit

Judge whether an open-source project really implements a claimed behaviour — from its source and its **defaults**, not from its README — and then classify every candidate by how it would actually be used. It does NOT run the candidates, and it does not measure their quality; it decides *presence, wiring, and default state*. A verdict is only as good as the code actually read, so this is a reading discipline first, a ranking exercise second.

**参数被接受 ≠ 被使用（2026-10-16，同一会话内四次自我推翻）**：审『平台是否支持 X』时，最硬的证据不是文档、也不是读码，而是**受控实验**——顺序是「先读消费点 → 再设计判定实验 → 最后用文档解释为什么」。本例三次翻车都出在跳步：
1. 把『传了 tools 后命中变多』当成『平台转发 tools』——**其实是同一前缀的第二次调用命中了第一次写下的条目**（顺序混淆）；
2. 把该结果写进方案前提，靠**算术**才发现错（两臂 `input+cacheRead` 完全相等 ⇒ 两臂 prompt 规模相同 ⇒ 47 个工具定义根本没进请求），再读码确认 `tools` 在实现文件里出现 **0 次**（参数被两个**对象字面量白名单**重建，无 spread）；
3. 把『空文本 + usage 全 0』归因为『平台抑制计费』——实际是**适配层把传输错误 resolve 成空消息**，且**根本没有发出 provider 请求**。

**可迁移的判定协议**：①**先验伪**：写下一个能一次否证的观测（本例：同前缀两臂的 `promptSize` 是否相等）；②**消混淆**：每个对照臂必须用**独立的新前缀**（或只跑单臂），否则先跑的那臂会污染后跑的那臂；③**分层读数**：区分『请求有没有发出』（provider 侧日志）／『回执返回了什么』（字段白名单）／『内容对不对』（文本与 usage）；④结论标**证据等级**（实测/读码/推断），推断不得升级为定案。

机读细节与完整案例（前缀缓存 64 块粒度、消息历史必须压平、`toolResult` 第三角色）：`references/parameter-accepted-vs-used.md`。

## When to Use

- "这些项目里哪些真的能满足 <条件>" — especially when the condition has a "during real use" or "no dataset" clause.
- "复检仍然符合标准后下载" — re-verify a shortlist before cloning it.
- A shortlist has to be cut down before spending disk/time on downloads.
- A candidate was recommended earlier from README claims and now needs proof.
- **对自己的工具集也同样审**：被要求"记住一条依赖某工具的偏好/规程"、或要按某个"我能调用的能力"行动时，先**枚举本会话声明的工具**（再必要时搜实现树）确认它存在；不存在就**不要落记忆**，并给出**不依赖该工具的替代表述**（例：没有压缩工具 ⇒ 写成"接近上限就精简＋落续接卡"）。

> 判定法同源：**先证明能力存在，再谈怎么用**。把"某能力不存在"写成独立结论要谨慎——它是**条件从句**（"有X就用X，没有就Y"），不是一条会被将来推翻的负断言。

**引用即断言：注释里的 `file:line` 必须打开看**（同日第二次教训）—— 家族代码注释称 20k 软线"borrowed UPSTREAM"并给了 `cli-config.yaml.example:538`／`skill_manager_tool.py:455`；读到上游 tip 才发现前者是 **sudo 提示**、后者是**函数调用行** ⇒ 引用**指错**；而上游真实纪律是"**100k 硬门 + ~100 行简单／~200 行复杂**"。沿"软线告警"这个**主题**再搜，才在另一文件找到真身：上游 `tools/skill_linter.py:56` `_BODY_SOFT_BUDGET_CHARS = 24_000` ⇒ `oversized-body` **WARNING**（两级 severity，`ERROR|WARNING`）⇒ 结论从"三档全是自造"更正为"**软线继承、2× 升级与 20 000 数字是自造**"。规矩：
1. 任何"来自上游/平台"的引用，**先打开那一行**再复述；行号随版本漂移，指不到就写"当前 tip 指不到"（别替引用背书）。
2. 追数字要**按主题扩展搜索**：一处引用失败 ≠ 上游没有该机制（本例真身在另一个文件）。
3. 顺手做"**上游有、我们缺**"差集 —— 本例捞到 `references-sprawl`、`dangling-reference`、必填节、以及**只报本次写入新引入规则的增量告警**；这类**有出处**的维度远比自造维度硬，可直接替换自造项。
4. 取上游真身的可靠路径：`gh api repos/<o>/<r>/contents/<path> --jq .content` → base64 解码落盘 → 带行号 grep；存在性用 `gh search code --repo <r> --limit 5`；大包 `fetch` 反复截断时改用 `git clone --depth 1 --filter=blob:none` 拿 tip（只读对照，不动原 checkout）。

**假阴性防线（2026-10-12 实测教训）**：我曾在只搜 `SkillLimits`／`constants` 后断言"SKILL.md 没有任何长度预算"，被用户当场纠正 —— 真实机制在 `evolution-core/src/skill-health.ts`（`verdict: healthy|warn|needs-restructure`）＋ `frontmatter.ts`（写入拒绝）里，且阈值**换了名字**：`softBodyChars === AUTHORING_SPLIT_LINE_CHARS`（20k 字符，2 倍进 `needs-restructure`），硬线 `MAX_SKILL_CONTENT_CHARS`（100k）才拒绝写入。三条规矩：
1. **按行为词搜，不按你期待的名字搜** —— `split|warn|restructure|health|limit|budget|threshold`，并留意**常数别名**（同一数字两个名字）。
2. **找到定义不算完，要追消费方** —— 谁产出 verdict、谁执行 enforcement、谁渲染提醒（本例：curator 健康视图 + `/evolution skills health` + 维护层 `body_size` 信号）。
3. **结论写成条件从句并给出边界** —— 不写"没有预算"，写"在 `<模块>` 未发现；另有 `<机制>`（数值 X 触发 A、Y 触发 B）" ⇒ 顺带能发现**范围缺口**（本例：它只管 SKILL.md 正文，不管 `references/`）。

## Prerequisites

- The criteria list is **fixed before reading** (2–4 clauses, each independently checkable). An audit diffs a fixed list; it is not a survey.
- Repos readable locally (`git clone --depth 1`) or via `gh api repos/<o>/<r>/contents/<path>` for single files.
- `gh api` authenticated (5 000 core req/h) — never burn the anonymous 60/h on a sweep.
- Accept that a README clause is *evidence of intent*, never evidence of behaviour.

## How to Run

For each candidate, answer the same five questions in this order, and stop as soon as one fails:

```text
1 载体     what object is being changed (skill file / program / agent code / weights / context)
2 触发     what event fires it, and is it during real use or an offline batch
3 默认态   is the switch on by default; if off, what config key turns it on
4 验证门   what decides "better" (test / evaluator / deterministic check / rubric / none)
5 兜底     can it be undone (rollback / version / backup / PR-not-push)
```

Mechanics that save a whole sweep — probing real repo size before cloning, silent `--depth 1` failures, the two GitHub-search encoding traps, arXiv existence checks, PDF triage, and the evidence-table shape — live in `references/repo-audit-toolbox.md`.

For the companion shape question ("统一通用的框架，还是每种模式针对一个数据集特化") — including the follow-up that re-describes the reference as a **management system for skills** — `references/architecture-shape-audit.md` gives the gates. Gate 3 (dead-seam call-site test) and Gate 6 (identity + layering: can a new skill be added without editing the reference's core?) are the load-bearing ones; Gate 6 also names the plane that already owns plugin lifecycle, so the answer does not propose a second manager.

For auditing **your own spec against your own tree** (a design document whose claims the code and tests must back), `references/claim-sweep-vs-source.md` gives the three-surface sweep, its false-positive triage (3 of 4 "gaps" in one measured run were the probe's own errors), the revocation-sync discipline for withdrawing a claim across a whole document chain, and the "a mechanism with no reader is net-harmful, not just dead" test.

For the release-completeness variant ("有没有把关键代码放出来 / is this a stub"), the four gates — prove the tree view is complete, run the stub scan and classify every hit, trace the advertised surface down to a real algorithm, then separate "not released" from "fetched from upstream" — live in `references/release-completeness-audit.md`. Read it before the audit, not while writing the report.

For the companion shape question ("统一通用的框架，还是每种模式针对一个数据集特化"), `references/architecture-shape-audit.md` gives the four gates: dependency direction, implementation-count-versus-consumer-count, the dead-seam call-site test, and reading each consumer's real entry. The load-bearing one is the third — a unified seam that nothing calls turns "it is a general framework" into "it is unified at the contract level only".

When the user then pivots to *building their own system* that absorbs the reference ("我要做一个更通用的东西"), the question changes from evaluating this project to deciding what to port: `references/first-principles-porting-audit.md` — carry the reference's invariants, never its scene decomposition, and check the host platform's existing tools before proposing any capability.

**Inverse operation**: when the deliverable is your own multi-facet design (not someone else's repo) and the user expects it to survive "第 N 轮审查", use the `agent-team-design-synthesis` skill — same `path:line` + `[实测]/[读码]/[推断]` discipline, but the failure mode is composition self-contradiction rather than an unsupported claim.

Then classify: **pass** (all criteria hold by default) · **pass with conditions** (holds, but switch default-off or scope-restricted — state the exact key) · **fail** (name the file:line that kills it).

## Quick Reference

Verdict vocabulary — use exactly these three, and always attach evidence:

| Verdict | Means | Must state |
|---|---|---|
| pass | criteria hold with no extra setup | the trigger site + verification gate |
| pass (conditional) | holds after enabling something, or scoped | the config key and its default, plus the scope limit |
| fail | a required mechanism is absent or offline-only | file:line of the counter-evidence |

Search patterns that answer each question fast:

- 触发: grep for the entry (`def evolve`, `scheduleAuto`, `turn/end`, `idle`, `on_session_end`), then read the caller.
- 默认态: grep the config schema/defaults file for the key and read `= False` / `= True` plus its help text.
- 验证门: grep for `validate`, `assert`, `test`, `evaluator`, `judge`, `gate`, and read whether the result is *used* or only stored.
- 兜底: grep `rollback`, `backup`, `snapshot`, `version + 1`, `never push`.

## Procedure

1. Fix the criteria list and write it down before opening any repo.
2. Metadata pass: `gh api repos/<o>/<r>` for stars / license / pushed_at / size; drop archived and stalled repos first.
3. Clone only the shortlist, `--depth 1`, into a **new** folder — never into an existing project tree.
4. Per candidate, answer the five questions with `grep` + `read`, recording `path:line` and a ≤120-char quote for each.
5. Assign the verdict. A mechanism that exists but is default-off is **conditional**, not pass — and the condition is part of the deliverable.
6. Keep failed candidates on disk when the user asked for "download if it still qualifies": the code is the evidence, and the report should say the folder can be deleted.
7. Write one report file at the download root (`README.md`) holding the verdict table, the per-candidate evidence, and the method/boundary section — same discipline as one-home archiving.
8. For survivors, a verdict alone is not the deliverable the user wants: they will ask **how each one actually implements it**. Produce a second document tracing every survivor through the same six stages (see `references/implementation-path-tracing.md`) and stating explicitly whether it does **generation** (produces a new unit), **evolution** (changes an existing one), or **both**, plus the split point in code where the two diverge. Every claim must be re-checkable from the code; a summary that paraphrases the README does not count.

## Presenting the verdict

Two failure modes this user has corrected, both about the reporting frame rather than the evidence.

**Anchor the subject before researching — never the tool's own environment.** In a session auditing one
repo, the follow-up arrived as a bare pronoun + verb ("这个东西在不同任务上是不是一样?"). It got answered
against DSH's own skill injection, because that is what *our* tooling had been touching. The user's
correction was two words: "我说的是 <项目>". A short follow-up with a demonstrative refers to **the
project under audit**, not to the platform, not to your own harness, and also not to the skill library
we just patched. Disambiguate before the first tool call, not after the report: state the subject in the
opening line, and if there is genuine ambiguity with our own environment, ask in one sentence first.

**Name the mechanism, never the generic word.** "技能集合" / "skill" / "技能" are *generic words the user
reaches for*; each project spells the same idea differently (a `profile.tools` allow-list, a
`codex.md`/`claude.md` prompt pair, a tool schema). Never present the project's own abstraction name as
the universal term, and never treat one project's vocabulary as every project's vocabulary — say "在这个
项目里就是 `<具体字段>`", then answer in the user's words.

**When the filter is the mechanism, read the injection payload.** For questions of the form "does the
model see the same X for every task / which X does it get", the model-visible surface is a composed
payload, not a README line. Read the producer end to end — per-specialization `profiles.py` →
`*_tools.py` / prompt builders → whenever the profile's allow-list filters and validates the final set.
Then sort every element into **invariant** (one definition, every consumer), **specialized** (one per
consumer), or **per-instance** (data). A consumer that assembles its own prompt instead of appending the
shared fragment is a finding. Same-name ≠ same tool: two projects can both expose `play` with schemas
that share nothing, so compare the schema, not the tool name — the name is the easy false conclusion.

## Pitfalls

- **README wording is not wiring.** A feature can be described in prose, listed in a config placeholder, and still never be called. Grep for call sites before believing it; a docstring saying "Legacy placeholders (not wired)" is a fail.
- **"Default off" is the most common gap.** In this domain most frameworks gate generation/evolution behind a switch; a pass that omits the default is a wrong answer. Always quote the config line.
- **Distinguish "during real use" from "offline batch".** A tool that evaluates candidates on a held-out split, or is driven by an `run_eval_*`/`run_loop` script, does not satisfy a during-real-use criterion no matter how good its results are.
- **Misspelled field of view:** check whether the *generation* path and the *evolution* path are the same subsystem. A retrieval/injection layer adjacent to an evolution layer is not the evolution layer.
- **One repo, two evolution subsystems.** A project can ship an online path *and* an offline `--dataset train|eval` path side by side. Decide which one the default entry runs before writing the verdict: read `docker-compose.yml` `command:` lines and the README quickstart, not just the module list. The offline path may be a separate package the default entry never touches (verdict survives), or the only path there is (verdict dies) — the two look identical from a directory listing.
- **Zero call sites is the decisive test.** Write-side code can run, persist real artefacts, and still never reach the model: grep the function that *merges* the artefact back (e.g. a `get_skill_with_patches`) — if the name appears only on its own `def` line, that branch never executes and the artefact is write-only. "The file is on disk" and "the skill changed" are different claims.
- **A config key can be read only for display.** A switch that appears in status output / a settings UI / a `click.echo` line and nowhere else is a dead switch: it renders but never gates. The real default lives at the construction site (a hard-coded argument or a different key).
- **A subagent's "no paper exists" is not proof.** Re-check the repository's own README badges/links and the arXiv abstract page yourself; a paper link added after the subagent's snapshot is invisible to it.
- **Version drift between two looks at a repo is normal** (stars move by a few per day). Quote the star count as "measured at <time>", never as a fixed truth.
- **Don't download a 1.7 GB repo because GitHub says so.** That number includes history; probe the tree first (see `references/repo-audit-toolbox.md`).
- **Stubs hide behind an SDK the repo does not ship.** When a project wraps a third-party runtime (a game engine, an eval platform, a rendering SDK), the adapters can be complete and the feature still non-existent for a reader, because the object that does the work is not in the tree. Judge the layer the repo owns by whether it carries real logic — model construction, retry policy, recorded per-run directories — and say plainly that the behaviour is present, with the external runtime as the dependency. If the repo additionally contains **no library-level analysis at all** (only test/suite adapters over a service that grades remotely), that is the decisive observation: the reference implementation is private, not merely dependency-heavy. Reading the tree is the wrong depth for this call — read the harness's own logic before concluding either way.
- **A unified entry point with zero callers is not an extension point.** When asked whether a project is one general framework or N per-dataset implementations, grep the shared seam repo-wide before believing it: a `run_episode`-style runner can carry a confident docstring, be exported, and still have no caller, while the real loop sits duplicated in two per-provider files. Read each consumer's `main` to see which path actually runs, and count implementations against consumers. Report the discrepancy as **debt**, not as framework neutrality — the method is in `references/architecture-shape-audit.md`.

## Verification

- Before delivering a multi-document audit, run `references/delivery-consistency-checklist.md`: re-measure every printed number, reconcile every count against its frame, make tables agree with sections, and re-test any "the only one that…" claim after later additions.
- Every verdict in the report has at least one `path:line` + quote; no verdict rests on a README sentence alone.
- Every "conditional" verdict names the exact config key and its default value.
- The report carries an explicit boundary line stating what was NOT done (typically: no candidate code was executed).
