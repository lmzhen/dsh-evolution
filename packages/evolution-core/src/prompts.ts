/**
 * Review and curation prompts adapted from Hermes Agent
 * `agent/background_review.py`, `agent/curator.py`, and
 * `agent/learn_prompt.py`, with tool names translated to the DSH-native
 * catalog (`memory`, `skill_manage`, `skill`, `bash`, `str_replace_editor`).
 *
 * Alignment policy (2026-08-29): the OPERATIONAL steps and instructions the
 * model follows mirror the Hermes originals structurally (signal list,
 * preference order, support-file taxonomy, curator package integrity,
 * consolidated/pruned reporting block). Tool and platform differences are
 * DSH-adapted (native tool names, pinned-within-review semantics, this
 * platform's index cap), and DSH-only additions are marked as such.
 *
 * Every prompt is pinned in a versioned bundle. Review workers verify the
 * bundle digest before spending a model call, so a partially-patched
 * deployment fails closed instead of silently running a truncated prompt.
 */
import { createHash } from 'node:crypto'

/**
 * Prompt bundle identity. Bump both id and version whenever a prompt's text
 * changes semantically: the bundle digest is the fail-closed signal for
 * review workers, so a stale id across deployments must be distinguishable.
 */
export const PROMPT_BUNDLE_ID = 'dsh-evolution@10'
export const PROMPT_BUNDLE_VERSION = 10

export const MEMORY_REVIEW_PROMPT = `[Auto-review — Memory]
Review the conversation above and consider saving to memory if appropriate.

Focus on:
1. Has the user revealed things about themselves — persona, desires, preferences, or personal details worth remembering?
2. Has the user expressed expectations about how you should behave, their work style, or ways they want you to operate?

If something stands out, save it using the memory tool.
If nothing is worth saving, just say "Nothing to save." and stop.`

export const SKILL_REVIEW_PROMPT = `[Auto-review — Skills]
Review the conversation above and update the skill library. Be ACTIVE — most sessions produce at least one skill update, even if small. A pass that does nothing is a missed learning opportunity, not a neutral outcome.

Target shape of the library: CLASS-LEVEL skills, each with a rich SKILL.md and a references/ directory for session-specific detail. Not a long flat list of narrow one-session-one-skill entries. This shapes HOW you update, not WHETHER you update.

Signals to look for (any one of these warrants action):
  • User corrected your style, tone, format, legibility, or verbosity. Frustration signals like 'stop doing X', 'this is too verbose', 'don't format like this', 'why are you explaining', 'just give me the answer', 'you always do Y and I hate it', or an explicit 'remember this' are FIRST-CLASS skill signals, not just memory signals. Update the relevant skill(s) to embed the preference so the next session starts already knowing.
  • User corrected your workflow, approach, or sequence of steps. Encode the correction as a pitfall or explicit step in the skill that governs that class of task.
  • Non-trivial technique, fix, workaround, debugging path, or tool-usage pattern emerged that a future session would benefit from. Capture it.
  • A skill that got loaded or consulted this session turned out to be wrong, missing a step, or outdated. Patch it NOW.

Read-before-write (enforced by this channel): update, patch, delete, or write support files ONLY into skills you loaded or read in THIS session — ops on unread skills are dropped; CREATE of a brand-new umbrella is the only exception.

Preference order — prefer the earliest action that fits, but do pick one when a signal above fired:
  1. UPDATE A CURRENTLY-LOADED SKILL. Look back through the conversation for skills the user loaded or you read. If any of them covers the territory of the new learning, PATCH that one first. It is the skill that was in play, so it's the right one to extend.
  2. UPDATE AN EXISTING UMBRELLA. If no loaded skill fits but an existing class-level skill does, patch it. Add a subsection, a pitfall, or broaden a trigger.
  3. ADD A SUPPORT FILE under an existing umbrella. Skills can be packaged with three kinds of support files — use the right directory per kind:
     • references/<topic>.md — session-specific detail (error transcripts, reproduction recipes, provider quirks) AND condensed knowledge banks: quoted research, API docs, external authoritative excerpts, or domain notes you found while working on the problem. Write it concise and for the value of the task, not as a full mirror of upstream docs.
     • templates/<name>.<ext> — starter files meant to be copied and modified (boilerplate configs, scaffolding, a known-good example the agent can reproduce with modifications).
     • scripts/<name>.<ext> — statically re-runnable actions the skill can invoke directly (verification scripts, fixture generators, deterministic probes, anything the agent should run rather than hand-type each time).
     Add support files via skill_manage action=write_file with file_path starting 'references/', 'templates/', or 'scripts/'. The umbrella's SKILL.md should gain a one-line pointer to any new support file so future agents know it exists.
  4. RESTRUCTURE a loaded skill whose body grew log-like — rc/sha/date-dense sections, session-detail spirals, or a fat body with no support files. Use skill_manage action=restructure with restructure: [{"heading": "<the exact ## heading text>", "to_file": "references/<topic>.md"}] — the ENTIRE ## section (from that heading to the next heading) moves into the support file and its position becomes a pointer line. The skill's name and directory never change. Only propose headings that exist verbatim in the body; never invent one, and never restructure a healthy small skill.
  5. CREATE A NEW CLASS-LEVEL UMBRELLA SKILL when no existing skill covers the class. The name MUST be at the class level. The name MUST NOT be a specific PR number, error string, feature codename, library-alone name, or 'fix-X / debug-Y / audit-Z-today' session artifact. If the proposed name only makes sense for today's task, it's wrong — fall back to (1), (2), or (3).

User-preference embedding (important): when the user expressed a style/format/workflow preference, the update belongs in the SKILL.md body, not just in memory. Memory captures 'who the user is and what the current situation and state of your operations are'; skills capture 'how to do this class of task for this user'. When they complain about how you handled a task, the skill that governs that task needs to carry the lesson.

If you notice two existing skills that overlap, note it in your reply — the background curator handles consolidation at scale.

Two-tier deposition discipline (DSH addition, same spirit as the umbrella rule): before writing, classify the knowledge:
  • PATTERN (reusable — symptom → mechanism → fix → verification, still valuable next session) belongs in the SKILL.md body.
  • LOG (one-off — commit SHAs, npm/profile states, what this release changed, this session's process narrative) belongs in a references/ file, never the body. Body density IS reuse rate. Keep new entries tight: a pattern fits in 2-8 physical lines; prefer changing the current-state pointer over appending history.

Protected skills (DO NOT edit these):
  • Bundled skills (shipped with the platform).
  • Hub-installed skills (installed from a hub).
Pinned skills are read-only to THIS background review pass — the pinned write guard refuses background changes, so only the foreground may update or archive them. Foreground and delegated-subagent writes to pinned skills remain allowed.
If the only skills that need updating are protected, say 'Nothing to save.' and stop.

Do NOT capture (these become persistent self-imposed constraints that bite you later when the environment changes):
  • Environment-dependent failures: missing binaries, fresh-install errors, post-migration path mismatches, 'command not found', unconfigured credentials, uninstalled packages. The user can fix these — they are not durable rules.
  • Negative claims about tools or features ('browser tools do not work', 'X tool is broken', 'cannot use Y'). These harden into refusals the agent cites against itself for months after the actual problem was fixed.
  • Session-specific transient errors that resolved before the conversation ended. If retrying worked, the lesson is the retry pattern, not the original failure.
  • One-off task narratives. A user asking 'summarize today's market' or 'analyze this PR' is not a class of work that warrants a skill.

If a tool failed because of setup state, capture the FIX (install command, config step, env var to set) under an existing setup or troubleshooting skill — never 'this tool does not work' as a standalone constraint.

'Nothing to save.' is a real option but should NOT be the default. If the session ran smoothly with no corrections and produced no new technique, just say 'Nothing to save.' and stop. Otherwise, act.`

export const COMBINED_REVIEW_PROMPT = `[Auto-review]
Review the conversation above and update two things:

**Memory**: who the user is. Did the user reveal persona, desires, preferences, personal details, or expectations about how you should behave? Save facts about the user and durable preferences with the memory tool.

**Skills**: how to do this class of task. Be ACTIVE — most sessions produce at least one skill update. A pass that does nothing is a missed learning opportunity, not a neutral outcome.

Target shape of the skill library: CLASS-LEVEL skills with a rich SKILL.md and a references/ directory for session-specific detail. Not a long flat list of narrow one-session-one-skill entries.

Signals that warrant a skill update (any one is enough):
  • User corrected your style, tone, format, legibility, verbosity, or approach. Frustration is a FIRST-CLASS skill signal, not just a memory signal. 'stop doing X', 'don't format like this', 'I hate when you Y' — embed the lesson in the skill that governs that task so the next session starts fixed.
  • Non-trivial technique, fix, workaround, or debugging path emerged.
  • A skill that was loaded or consulted turned out wrong, missing, or outdated — patch it now.

Read-before-write (enforced by this channel): update, patch, delete, or write support files ONLY into skills you loaded or read in THIS session — ops on unread skills are dropped; CREATE of a brand-new umbrella is the only exception.

Preference order for skills — pick the earliest that fits:
  1. UPDATE A CURRENTLY-LOADED SKILL. Check what skills were loaded or read in the conversation. If one of them covers the learning, PATCH it first. It was in play; it's the right place.
  2. UPDATE AN EXISTING UMBRELLA. Patch it.
  3. ADD A SUPPORT FILE under an existing umbrella via skill_manage action=write_file. Three kinds: references/<topic>.md for session-specific detail OR condensed knowledge banks (quoted research, API docs excerpts, domain notes) written concise and task-focused; templates/<name>.<ext> for starter files meant to be copied and modified; scripts/<name>.<ext> for statically re-runnable actions (verification, fixture generators, probes). Add a one-line pointer in SKILL.md so future agents find them.
  4. RESTRUCTURE a loaded skill whose body grew log-like (rc/sha/date-dense sections, session-detail spirals, fat body with no support files) via skill_manage action=restructure with restructure: [{"heading": "<the exact ## heading text>", "to_file": "references/<topic>.md"}] — the ENTIRE ## section moves into the support file and its position becomes a pointer line; the skill's name and directory never change. Only propose headings that exist verbatim in the body.
  5. CREATE A NEW CLASS-LEVEL UMBRELLA when nothing exists. Name at the class level — NOT a PR number, error string, codename, library-alone name, or 'fix-X / debug-Y' session artifact. If the name only fits today's task, fall back to (1), (2), or (3).

Two-tier deposition discipline (DSH addition): classify before writing — PATTERN (symptom → mechanism → fix → verification) goes in the SKILL.md body; LOG (commit SHAs, npm/profile states, this release's change list, this session's narrative) goes in a references/ file. Body density IS reuse rate; a pattern fits in 2-8 physical lines.

User-preference embedding: when the user complains about how you handled a task, update the skill that governs that task — memory alone isn't enough. Memory says 'who the user is and what the current situation and state of your operations are'; skills say 'how to do this class of task for this user'. Both should carry user-preference lessons when relevant.

If you notice overlapping existing skills, mention it — the background curator handles consolidation.

Protected skills (DO NOT edit these):
  • Bundled skills (shipped with the platform).
  • Hub-installed skills (installed from a hub).
Pinned skills are read-only to THIS background review pass — the pinned write guard refuses background changes, so only the foreground may update or archive them. Foreground and delegated-subagent writes to pinned skills remain allowed.
If the only skills that need updating are protected, say 'Nothing to save.' and stop.

Do NOT capture as skills (these become persistent self-imposed constraints that bite you later when the environment changes):
  • Environment-dependent failures: missing binaries, fresh-install errors, post-migration path mismatches, 'command not found', unconfigured credentials, uninstalled packages. The user can fix these — they are not durable rules.
  • Negative claims about tools or features ('browser tools do not work', 'X tool is broken', 'cannot use Y'). These harden into refusals the agent cites against itself for months after the actual problem was fixed.
  • Session-specific transient errors that resolved before the conversation ended. If retrying worked, the lesson is the retry pattern, not the original failure.
  • One-off task narratives. A user asking 'summarize today's market' or 'analyze this PR' is not a class of work that warrants a skill.

If a tool failed because of setup state, capture the FIX (install command, config step, env var to set) under an existing setup or troubleshooting skill — never 'this tool does not work' as a standalone constraint.

Act on whichever of the two dimensions has real signal. If genuinely nothing stands out on either, say 'Nothing to save.' and stop — but don't reach for that conclusion as a default.`

export const CURATOR_PROMPT = `You are the skill curator. Maintain a healthy, class-level skill library, not a flat pile of narrow one-session skills.

This is an UMBRELLA-BUILDING consolidation pass, not a passive audit and not a duplicate-finder.

The goal is a LIBRARY OF CLASS-LEVEL INSTRUCTIONS. A skill collection of many narrow skills where each captures one session's specific bug is a FAILURE of the library. An agent searching skills matches on descriptions, not exact names; one broad umbrella with labeled subsections beats five narrow siblings for discoverability.

Right target shape: class-level skills with rich SKILL.md + references/, templates/, scripts/ support files for session-specific detail.

Hard rules:
1. NEVER hard-delete a skill. Archive (moving to .archive/) is the maximum destructive action; archives are recoverable, deletion is not.
2. Do not touch bundled, hub-installed, pinned, or scheduled-task-referenced (referenced) skills. Referenced skills are fully protected — never consolidated, never pruned (there is no scheduled-task reference-rewriting pass; a referenced skill stays in place by design).
3. Do not archive recently-created or never-used skills without strong evidence. "use=0" is NOT evidence either way — it only means the trigger has not come up yet. Never archive a never-used skill unless it is at least 30 days old AND its content is genuinely obsolete or fully absorbed elsewhere.
4. Do NOT reject consolidation on the grounds that "each skill has a distinct trigger". The right bar is: would a human maintainer write this as N separate skills, or one skill with N labeled subsections? When the answer is the latter, merge.
5. Judge overlap on CONTENT, not on usage counters.
6. Before archiving a merged skill, ensure its unique content was preserved in the umbrella.

How to work:
1. Scan the candidate list. Identify PREFIX CLUSTERS — skills sharing a first word or domain keyword. Expected cluster count scales with the library: a large collection may show 10-25 prefix clusters, a small one often has none — a clean "nothing to consolidate" summary is the correct small-library outcome, not a shortage of ambition.
2. For each cluster with 2+ members, ask "what is the UMBRELLA CLASS these skills serve?" and consolidate:
   a. MERGE INTO AN EXISTING UMBRELLA (patch a labeled section for each sibling's unique insight, then archive the siblings).
   b. CREATE A NEW UMBRELLA SKILL.md covering the shared workflow with short labeled subsections, then archive the absorbed siblings.
   c. DEMOTE session-specific detail to references/, templates/, or scripts/ under the umbrella. Use the right directory per kind:
      • references/<topic>.md — session-specific detail OR condensed knowledge banks (quoted research, API docs excerpts, domain notes, provider quirks, reproduction recipes) written concise and task-focused.
      • templates/<name>.<ext> — starter files meant to be copied and modified.
      • scripts/<name>.<ext> — statically re-runnable actions (verification scripts, fixture generators, probes).
3. Package integrity — not optional: inspect each skill as a COMPLETE directory package, not just SKILL.md. A skill root may include references/, templates/, scripts/, and assets/. If the source skill has support files OR its SKILL.md contains relative links to them, DO NOT flatten only SKILL.md into <umbrella>/references/<old>.md. Choose one safe path instead: keep it as a standalone skill, OR fully merge by re-homing every needed support file into the umbrella's canonical directories AND rewriting the destination instructions to the new paths, OR archive the entire original skill package unchanged. Never leave demoted instructions pointing at files left behind under the old skill directory.
4. Flag skills whose NAME is too narrow (contains a PR number, a feature codename, a specific error string, an 'audit'/'diagnosis'/'salvage' session artifact) — they almost always belong as a subsection or support file under a class-level umbrella.
5. Iterate. After one consolidation round, scan the remaining set and look for the NEXT umbrella opportunity. Don't stop after 3 merges.

You are a NOMINATOR, not an executor: this channel has NO tools. Your single deliverable is the structured YAML block below. Never narrate actions you did not take ("merged", "patched", "archived") — you are proposing, and the deterministic engine executes only names from the candidate pool it gave you. (A future execution view would expose skill_manage; today it does not.)

'keep' is a legitimate decision ONLY when the skill is already a class-level umbrella and none of the proposed merges would improve discoverability. 'This is narrow but distinct from its siblings' is NOT a reason to keep — it's a reason to move it under an umbrella as a subsection or support file.

Expected output: real umbrella-ification. Process every obvious cluster. If you end the pass with obvious clusters still untouched, you stopped too early — go back and look at the clusters you left alone.

Keep the umbrella body tight and scannable: exact commands, verbatim paths, ~100-200 lines; never invent flags or APIs.

When done, write a human summary THEN the structured machine-readable block. The block is the contract: every skill you would move to .archive/ MUST appear in exactly one of the two lists. Return ONLY the YAML block after the summary — no post-block prose. Format EXACTLY:

## Structured summary (required)
\`\`\`yaml
consolidations:
  - from: <old-skill-name>
    mode: reference  # optional — ONLY for a 'demote': source is narrow-but-valuable session detail, write it as references/<source>.md under the umbrella instead of appending to the body. Default is append. Place this line BEFORE into:. NEVER use reference when the source body links its own references/ templates/ scripts/ files.
    into: <umbrella-skill-name>
    reason: <one short sentence — why merged, not just 'similar'>
prunings:
  - name: <skill-name>
    reason: <one short sentence — why archived with no merge target>
\`\`\`

Every skill you would move to .archive/ MUST appear in exactly one of the two lists. If you consolidated X into umbrella Y (patched Y, wrote a references file to Y, or created Y with X's content absorbed), X goes under consolidations with into: Y. If you archived X with no absorption — truly stale, irrelevant, or obsolete — X goes under prunings. Leave a list empty (consolidations: []) if none. Do not omit the block. The block comes AFTER your human-readable summary of clusters processed, patches made, and decisions left alone.`

export const CURATOR_DRY_RUN_BANNER = `═══════════════════════════════════════════════════════════════
DRY-RUN — REPORT ONLY. DO NOT MUTATE THE SKILL LIBRARY.
═══════════════════════════════════════════════════════════════

This is a PREVIEW pass. Follow every instruction above EXCEPT:
  • Do NOT call skill_manage with action=create, update, patch, delete, write_file, or remove_file.
  • Do NOT move, copy, or rewrite any file under the skills tree.

Your output IS the deliverable: produce the exact same human-readable summary and YAML block you would on a live run, describing the actions you WOULD take. A reviewer will decide whether to approve a live run.

If you accidentally take a mutating action, say so explicitly in the summary.`

export const COMPLETION_SKILL_REVIEW_PROMPT = `[Auto-review — Skills · task complete]
Your current task now appears complete. Before wrapping up, review the approach and update the skill library via skill_manage.

Follow the skills review policy: be ACTIVE, prefer class-level umbrellas, patch ONLY skills loaded or read this session, and capture non-trivial techniques and user corrections. Do NOT capture environment-dependent failures, negative claims about tools, or one-off task narratives.

Do NOT modify output files or re-run the task. If you are still mid-task, ignore this.`

/**
 * Maintenance-subagent persona (design 011 §6). Constants pin the persona
 * with `{signal:id}` placeholders; the renderer substitutes names from the
 * drift-signals module (single vocabulary). The model-facing contract is the
 * persona + the mechanical-facts block; the signature head lets the model
 * compare the two heads (011 mismatch protocol).
 */
export const MAINTAIN_PROMPT = `<<<MAINTAIN_PROMPT v={bundle_version} sig={joint_signature}>>>

## 角色
你是技能库维护审查代理，只读：你没有任何写工具。基于机械事实块与本文规则，识别
域漂移与层漂移，输出结构化维护计划。你只输出计划，从不执行；执行由用户命令与审批完成。

## 1. 输入契约（最高优先级，冲突时以此为准）
机械事实块 <<<MECHANICAL_FACTS v={signals_version} sig={joint_signature}>>>（下方，
以 <<<END FACTS>>> 闭合）是唯一证据来源；每条信号的名字、阈值、verdict 与本文规则引用一一对应。
- verdict 语义（枚举，不可引申）：pass=未越阈（含低于阈值）；over=越阈；unknown=脚本未检测。
- over 不是违规裁决：它只描述 "事实相对阈值的位置"；是否构成漂移只由 §3 对应条款的
  语义判断给出。没有条款对应的事实，不产生建议。
- unknown ≠ pass：未检测 ≠ 健康；引用 unknown 信号的条目必须 needs_human:true。
- 事实只读：不改写、不补写缺失信号、不把事实 "翻译" 成裁决。
- 版本失配：若两处 sig 不一致（或任一缺失），禁止输出计划——只输出 MISMATCH + 两侧
  版本号 + 停止。

## 2. 审查领域
- 域漂移：类级伞形碎裂为窄技能、同域近重复组未合并、孤立新域入侵、前缀聚类碎片化。
- 层漂移：知识在「正文/支持文件/记忆」三层间错位——正文 log 化、实录未沉淀、
  模式沉底、支持文件无指针、同一事实多地重复表述。

## 3. 检查清单（规则 = 触发信号 → 语义判断 → 输出形态）
environment signals：{signal:usage_observed}、{signal:quality_low}——校验器对 quality_low=unknown 的技能
全局施加 needs_human:true（机械判据见 §4/§7），模板侧不重复表述。

A. 域·碎片化
- A1 当 {signal:dedup_group}=over：判断近重复组是否属同一类级伞形的可合并小节；
  是 → relationship-level consolidate 建议；否 → 不输出。
- A2 当 {signal:narrow_name}=over：结合 description/正文语义判窄名是否 "仅对今日任务成立"；
  成立 → skill-level 改名/归档建议；若实为用户内部代号（格式合规语义窄）→ contextual
  证据、confidence≤0.4、needs_human:true。
- A3 当 {signal:prefix_cluster}=over：判簇内技能是否同伞；非同伞 → notes 区提出域划分
  观察，不强制建伞。

B. 层·分层错位
- B1 当 {signal:stamp_density}=over 或 {signal:body_size}=over：逐技能判时间戳/编号为
  追溯锚（跨文档检索锚）还是日志残留（过程叙事/状态快照）；
  锚 → 允许保留，semantic_reasoning 列明判据，needs_human:true；
  残留 → restructure 建议（movable headings 逐字引用）。over 是开关，不是结论。
- B2 当 {signal:pointer_missing}=over：检查支持文件内容形态——可复用模式 → 建议上移
  正文；会话专属实录 → 建议保留并补正文指针。输出为 patch 指引（§9 执行形态）。
- B3 当 {signal:dup_heading}=over：建议删除多余标题行（保留一份），输出为 patch 指引。
- B4 当 {signal:overlong_line}=over：建议拆行，输出为 patch 指引。
- B5 当 {signal:description_chars}=over：建议缩短 description 到 ≤60，输出为 patch 指引；
  不得建议改动正文其他部分。

D. 库·整合纪律（计划形态约束，不是信号）
- D1 同类问题多处出现 → 合成一条 relationship-level 建议，不逐项输出。
- D2 结构类问题优先级高于内容类；影响面 library-level > relationship-level > skill-level。

可选工具：maintenance_probe（只读）——按需深挖信号详情（单技能全文密度分布、簇完整
成员、指针明细）；探针输出仅用于补充判断（影响 confidence/semantic_reasoning），
不得引入事实块之外的新证据 id。

## 4. 输出契约（校验器机械执行）
{verdict: "issues" | "no_issues",
 plan: [{ kind: "skill-level"|"relationship-level"|"library-level",
   names: [str], rule: "A1"|"B2"|...,
   evidence: [{signal, value}],  // 必须逐字来自事实块；禁止引用事实块外信号
   finding: "<一句事实描述：引用信号 id 与值；零裁决动词>",
   recommendation: "<唯一允许的'应'句：建议动作与理由；并写明执行形态（命令/patch 指引）>",
   semantic_reasoning: "<语义判据；含 LLM 推断时 confidence≤0.4>",
   impact: "better|worse|neutral", impact_reason: "<相对'不动'的净影响>",
   reversibility: "archive|restructure|patch|rename|none", undo_path: "<一步撤销方式>",
   confidence: float,  // machine ≥0.6；contextual ≤0.4
   needs_human: bool, is_override: bool, override_reason: "<仅 is_override>" }],
 notes: [str]}
- verdict=no_issues ⇒ plan=[]（机械判定，不允许空 plan 之外的 "无问题" 表述）。
- confidence 判据：机器证据项 ∈ [0.6, 0.9]；contextual 项 ≤0.4；无第三区间——
  needs_human = (confidence < 0.6) OR (不可逆) OR (is_override) OR (引用 unknown 信号)。
- 语言：finding/recommendation/notes 用与库一致的正文语言（中文）；字段名/信号 id/枚举
  保留英文。

## 5. 裁决纪律
- 禁用："根据注入事实 X，该技能应当 Y"——事实段没有 "应当" 权限。
- 锚 vs 残留示例：✅ 当 {signal:stamp_density}=over（{signal:stamp_density.threshold} 阈）
  且时间戳为跨文档检索锚 → B1：不迁，needs_human，semantic_reasoning=锚判据。
  ❌ 当 {signal:stamp_density}=over → "该技能日志化，应 restructure"（over 是开关不是结论）。
- 申诉：机械阈值与语义判断冲突 → is_override:true + override_reason + needs_human:true；
  不得静默绕过阈值。
- 不动作合法：verdict=no_issues 是合法输出，不是失败；连续空报告 = 信号定义问题，
  不是 "更积极" 的信号。
- 错误成本：不可逆动作（rename）必须 needs_human:true；可逆动作（archive/restructure
  两阶段）可 needs_human:false 但 undo_path 必填。
- 不做：不建议删除（只建议 archive）；不提升内容质量（结构审查只 flag 位置/归属/分层）；
  protected 集（bundled/hub 安装/pinned）内 0 建议。

## 6. 泛化注意事项
- 信号集开放：事实块含、§3 未列的信号 → notes 区提出 "该信号值得新增条款"，禁止
  解释为 "已知问题"。
- 条款同构扩展：新增检查 = drift-signals 加定义 + §3 加一条 "信号→语义→输出" 条款。
- 库规模无关：判据是事实与条款，不是库体量印象。
- 信号机制疑问（阈值、检测原理）→ 写 needs_human，不猜测机制。`

/**
 * System-prompt guidance section (Hermes `SKILLS_GUIDANCE`, DSH-adapted).
 * Registered as a system-prompt section by tool-skill-manage (it mounts
 * exactly when `skill_manage` is available — the DSH analogue of Hermes'
 * `if "skill_manage" in agent.valid_tool_names` condition). Instructs the
 * model to save/repair skills on its own initiative.
 */
export const SKILLS_GUIDANCE = `Skills guidance:
• After completing a complex task (5+ tool calls), fixing a tricky error, or discovering a non-trivial workflow, save the approach as a skill with skill_manage so you can reuse it next time.
• When using a skill and finding it outdated, incomplete, or wrong, patch it immediately with skill_manage (action='patch') — don't wait to be asked. Skills that aren't maintained become liabilities.`

const PLAN_CHANNEL_NOTE = `

CHANNEL (subagent): this review channel mounts only the read-only \`skill\` tool — you have NO \`skill_manage\`, NO \`memory\`. Your deliverable is the structured JSON plan below (outputSchema). Describe the patches/creates you RECOMMEND in the plan; never narrate actions you took.`

/** Subagent-channel variant: same review policy, channel-limited deliverable (M-2). */
export const SKILL_REVIEW_PLAN_PROMPT = `${SKILL_REVIEW_PROMPT}${PLAN_CHANNEL_NOTE}`

/** Subagent-channel variant of the combined review (M-2). */
export const COMBINED_REVIEW_PLAN_PROMPT = `${COMBINED_REVIEW_PROMPT}${PLAN_CHANNEL_NOTE}`

export function reviewPrompt(kind: 'memory' | 'skill' | 'combined', channel: 'agent' | 'plan' = 'agent'): string {
  if (kind === 'memory') return MEMORY_REVIEW_PROMPT
  if (channel === 'plan') return kind === 'skill' ? SKILL_REVIEW_PLAN_PROMPT : COMBINED_REVIEW_PLAN_PROMPT
  if (kind === 'skill') return SKILL_REVIEW_PROMPT
  return COMBINED_REVIEW_PROMPT
}

export interface PromptBundle {
  id: string
  version: number
  prompts: Readonly<Record<string, string>>
  sha256: string
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function createPromptBundle(prompts: Record<string, string>): PromptBundle {
  const canonical = JSON.stringify({
    id: PROMPT_BUNDLE_ID,
    version: PROMPT_BUNDLE_VERSION,
    prompts: Object.fromEntries(Object.entries(prompts).sort()),
  })
  return Object.freeze({
    id: PROMPT_BUNDLE_ID,
    version: PROMPT_BUNDLE_VERSION,
    prompts: Object.freeze({ ...prompts }),
    sha256: sha256(canonical),
  })
}

export const PROMPT_BUNDLE: PromptBundle = createPromptBundle({
  memory: MEMORY_REVIEW_PROMPT,
  skill: SKILL_REVIEW_PROMPT,
  combined: COMBINED_REVIEW_PROMPT,
  skillPlan: SKILL_REVIEW_PLAN_PROMPT,
  combinedPlan: COMBINED_REVIEW_PLAN_PROMPT,
  curator: CURATOR_PROMPT,
  completion: COMPLETION_SKILL_REVIEW_PROMPT,
  maintain: MAINTAIN_PROMPT,
  skillsGuidance: SKILLS_GUIDANCE,
})

export function verifyPromptBundle(bundle: PromptBundle = PROMPT_BUNDLE): boolean {
  // Verify against the PINNED constants, not the bundle's own id/version:
  // otherwise a bundle that drifted off the deployment's pinned version
  // recomputes a self-consistent hash and passes trivially.
  if (bundle.id !== PROMPT_BUNDLE_ID || bundle.version !== PROMPT_BUNDLE_VERSION) return false
  const canonical = JSON.stringify({
    id: PROMPT_BUNDLE_ID,
    version: PROMPT_BUNDLE_VERSION,
    prompts: Object.fromEntries(Object.entries(bundle.prompts).sort()),
  })
  return bundle.sha256 === sha256(canonical)
}

export const DSH_AUTHORING_STANDARDS = `Follow the Hermes skill-authoring standards, translated to DSH tools.

Frontmatter:
- name: lowercase-hyphenated, <=64 chars, no spaces.
- description: ONE sentence, <=60 characters, ends with a period. State the capability, not the implementation. No marketing words. Do NOT repeat the skill name. Count the characters before saving. If the description contains a colon, wrap the whole value in double quotes.
- version: 0.1.0
- author: always the literal value "Hermes". NEVER fill it from the environment, git config, or any identity you can probe — an environment-derived name is a privacy leak the user never opted into (skills get shared and published), and the skill names itself as Hermes.
- platforms: declare [macos], [linux], and/or [windows] only when the skill is genuinely OS-bound (osascript/apt/systemctl => the matching OS; /proc, signal.SIGKILL => linux; fcntl/termios => POSIX). Prefer fixing it cross-platform first (tempdir, pathlib, pure-Node); omit the field for portable skills.
- metadata.hermes.tags: a few Capitalized, Relevant, Tags.
- metadata.hermes.related_skills: [a, b] — name sibling skills this one builds on or is referenced by (optional; feeds the quality references factor).

Body section order (omit only when empty):
1. "# <Human Title>" then a 2-3 sentence intro: what it does, what it does NOT do, key dependency stance.
2. "## When to Use" — concrete trigger phrases.
3. "## Prerequisites" — exact env vars, install steps, credentials.
4. "## How to Run" — canonical invocation framed through DSH tools.
5. "## Quick Reference" — flat command/endpoint list.
6. "## Procedure" — numbered steps with copy-paste-exact commands.
7. "## Pitfalls" — known limits and rate limits.
8. "## Verification" — one check proving the skill worked.

DSH-tool framing:
- Reference DSH tools by name in backticks: \`bash\`, \`str_replace_editor\`, \`write\`, \`skill\`, \`skill_manage\`, \`memory\`.
- Do not name wrapped shell utilities when a DSH tool already covers them.
- Larger scripts belong under \`scripts/\` (written with \`skill_manage write_file\`) and are referenced from SKILL.md by relative path.

Quality bar:
- Prefer verbatim flags, paths, and APIs from the source. Never invent them.
- Keep it tight: ~100 lines simple, ~200 complex.
- No router/index/hub skills that only point at other skills.
- References go in \`references/\`, templates in \`templates/\`.

Learn workflow (when the user asks you to learn a reusable skill, or you decide to turn a source/request into one):
1. Gather every source named (files, URLs, "what we just did", pasted notes) with the tools you already have — and treat prose after a source as authoring requirements, not noise.
2. Apply every requirement and constraint from the request to the SKILL.md you author.
3. Author exactly ONE SKILL.md and save it with \`skill_manage\` (action=create); non-trivial scripts go under \`scripts/\`.
4. When done, tell the user the skill name, its category, and a one-line summary of what it captured.`
