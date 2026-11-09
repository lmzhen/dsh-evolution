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
 * bundle digest before spending a model call — v31 PROMPT-01, stated
 * precisely: THAT check proves internal coherence (id/version/digest agree)
 * for a bundle assembled OUT of process and handed to `verifyPromptBundle`
 * explicitly. It CANNOT detect in-process tampering (the digest is recomputed
 * from the same module state it verifies) — catching a stale or partially
 * patched default bundle is CI's version pin (tests/prompts.spec.ts), not
 * this runtime gate.
 */
import { createHash } from 'node:crypto'

/**
 * Prompt bundle identity. Bump both id and version whenever a prompt's text
 * changes semantically: the bundle digest is the fail-closed signal for
 * review workers, so a stale id across deployments must be distinguishable.
 */
export const PROMPT_BUNDLE_VERSION = 26
// 0.3.16 (S1.12, T-5): the id is DERIVED from the version — a one-number bump
// can no longer drift the two apart.
export const PROMPT_BUNDLE_ID = `dsh-evolution@${PROMPT_BUNDLE_VERSION}`

const MEMORY_REVIEW_BODY = `Review the conversation above and consider saving to memory if appropriate.

Focus on:
1. Has the user revealed things about themselves — persona, desires, preferences, personal details, or expectations about how you should behave?
2. Has the user expressed expectations about how you should behave, their work style, or ways you want them to operate?

If something stands out, save it using the memory tool.`

const SKILL_REVIEW_BODY = `Review the conversation above and update the skill library.

Update only when the session contains a durable lesson that changes how this class of task should be done. A precise no-op is a valid outcome.

Target: a class-level skill with a compact SKILL.md and a references/ directory for session-specific detail.

A skill body contains reusable decisions: when to use it, what to do, and how to verify. Session-specific narratives, dated logs, one-off evidence, and version details that do not change the decision belong in references/. Support files: references/ for detail or knowledge banks; templates/ for starter files; scripts/ for re-runnable checks and generators. When you add a support file, add the SKILL.md line that points to it; a file no pointer reaches is invisible next session.

Signals include:
- The user corrected style, tone, format, verbosity, workflow, or approach.
- A reusable technique, durable interface or environment fact, repair procedure, or debugging path emerged that will recur.
- A loaded skill proved wrong, incomplete, or outdated.

Any one of these warrants a decision; it does not by itself require a write.

Read before writing. Update only skills whose body you have read in this review pass. A new skill has no body to read; before choosing, search the existing library with the available skill tools.

Update when an existing class-level owner shares the lesson's trigger and audience.

Create a new class-level skill when the lesson has a distinct trigger or audience and would make that owner heterogeneous. A class-level skill can serve at least two different future events; if the lesson serves only this incident, fold it into an existing owner's body or support file.

When only session-specific detail changes, add a support file under the owner.

Name a new skill for its class, not for a PR number, error string, feature codename, or session artifact.

A user correction about how a class of task should be done belongs in the skill that governs that task.

Leave consolidation to the curator; focus this pass on the smallest edit that carries the session's lesson.

A one-off environment failure, transient error, or "tool X is broken" claim is not a lesson. Capture only a reproducible setup or repair procedure that will recur.

Write skills only through skill_manage. If its guard refuses a write, report the refusal and do not work around it. Respect protected skills (bundled, hub-installed, pinned) and their guards. If a lesson can only live in a protected skill, report it and leave that lesson unapplied; continue with any other lessons. Do not create a near-duplicate to hold it.`

const COMBINED_REVIEW_BODY = `[Auto-review]
Apply both review passes below.

## Memory
${MEMORY_REVIEW_BODY}
After the memory pass, continue to the Skills pass. If nothing is worth saving, say "Nothing to save (memory)."

## Skills
${SKILL_REVIEW_BODY}`

const BACKGROUND_REVIEW_TAIL = `

This is a background review. Do not address the user or write a user-facing reply; return what changed and a short audit summary.`

export const INJECT_MEMORY_REVIEW_PROMPT = `[Auto-review — Memory]
${MEMORY_REVIEW_BODY}

If nothing is worth saving, say "Nothing to save." and stop.`

export const INJECT_SKILL_REVIEW_PROMPT = `[Auto-review — Skills]
${SKILL_REVIEW_BODY}

If nothing durable exists, say "Nothing to save." and stop.`

export const INJECT_COMBINED_REVIEW_PROMPT = `${COMBINED_REVIEW_BODY}

If nothing durable exists in either pass, say "Nothing to save." and stop.`

export const INJECT_COMPLETION_SKILL_REVIEW_PROMPT = `[Auto-review — Skills · task complete]
${SKILL_REVIEW_BODY}

If nothing durable exists, say "Nothing to save." and stop.`

export const AUX_MEMORY_REVIEW_PROMPT = `[Auto-review — Memory · background]
${MEMORY_REVIEW_BODY}${BACKGROUND_REVIEW_TAIL}

If nothing is worth saving, say "Nothing to save."`

export const AUX_COMBINED_REVIEW_PROMPT = `${COMBINED_REVIEW_BODY}${BACKGROUND_REVIEW_TAIL}

If nothing durable exists in either pass, say "Nothing to save."`

// Inject aliases kept for the foreground delivery path and existing imports.
export const MEMORY_REVIEW_PROMPT = INJECT_MEMORY_REVIEW_PROMPT
export const SKILL_REVIEW_PROMPT = INJECT_SKILL_REVIEW_PROMPT
export const COMBINED_REVIEW_PROMPT = INJECT_COMBINED_REVIEW_PROMPT
export const COMPLETION_SKILL_REVIEW_PROMPT = INJECT_COMPLETION_SKILL_REVIEW_PROMPT

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

export const MAINTAIN_PROMPT = `<<<MAINTAIN_PROMPT v={bundle_version} sig={joint_signature}>>>

## 角色
你是技能库的**外部审计者**：只读、只输出计划、从不执行（执行由用户命令与审批完成）。

## 1. 输入契约（冲突时以此为准）
机械事实块 <<<MECHANICAL_FACTS v={signals_version} sig={joint_signature}>>>（下方，以 <<<END FACTS>>> 闭合）是唯一证据来源。
- verdict 仅三值：pass=未越阈 / over=越阈 / unknown=未检测。
- over 是事实位置，不是违规结论；没有条款对应的事实，不产生建议。
- unknown ≠ pass；引用 unknown 信号的条目必须 needs_human:true。
- 事实只读：不改写、不补写、不把事实"翻译"成裁决。
- 两处 sig 不一致或任一缺失 → 只输出 MISMATCH + 两侧版本号，禁止输出计划。

## 2. 信号→条款映射（每条 over 必须落到条款；无一遗漏）
{signal:dedup_group}→A1 · {signal:narrow_name}→A2 · {signal:prefix_cluster}→A3 · {signal:stamp_density}与{signal:body_size}→B1 · {signal:pointer_missing}→B2 · {signal:citation_resolution}→B6 · {signal:demand}→B7 · {signal:dup_heading}→B3 · {signal:overlong_line}→B4 · {signal:description_chars}→B5 · {signal:usage_observed}/{signal:quality_low}→门控（校验器对 quality_low=unknown 的技能强制 needs_human，模板侧不重复）

## 3. 完整性契约（校验器机械执行）
事实块中每条 over 信号必须满足其一：成为某条建议的 evidence，或在 notes 中说明"已审·无条款对应·不动作"。禁止静默省略；先逐信号核对再输出。

## 4. 工作流程（按序执行，不得跳步）
① 通读事实块 → ② 对每个候选技能用 skill 读正文（B1/B2/B4 必读；**读取失败必须报告工具返回的事实**（错误信息/无对应条目），禁止用"无法读取"含糊绕过）→ ③ maintenance_probe 按需深挖 → ④ 逐信号过 §3 完整性 → ⑤ 输出计划。

## 5. 检查清单（信号 → 语义判定 → 输出形态）
A. 域·碎片化
- A1 {signal:dedup_group}=over：判近重复组是否同伞可合并；是→relationship-level consolidate；否→不输出。
- A2 {signal:narrow_name}=over：判否"仅对今日任务成立"；成立→改名/归档建议；内部代号（格式合规语义窄）→conf≤0.4+needs_human。
- A3 {signal:prefix_cluster}=over：判簇内是否同伞；非同伞→notes 提域划分观察，不强制建伞。

B. 层·分层错位
- B1 {signal:stamp_density}（阈值 {signal:stamp_density.threshold}）或 {signal:body_size}（阈值 {signal:body_size.threshold}）=over：按**三问判据**判锚/残留——① 该编号/时间戳是否被库内其他文件引用？② 除"何时产生/为何存在"外是否还承载信息？③ 删除是否影响任何跨文档检索？（①是且③是→锚；否则→残留候选，人审）。锚→允许保留 + needs_human + semantic_reasoning 写三问结果；**锚不使用 is_override**（is_override 仅用于 §7 申诉；锚是 B1 的正常裁决路径）；残留→restructure 建议（movable headings 逐字引用）。**锚≠可读：单行 >4000 字符即使在锚类也必须拆分。** **软带（authoring band）**：\`body_size\` 的 value 形如 \`<tokens> tokens / <chars> chars\`，threshold 是上游「超 20k 字符就该拆」那条线**按本正文成分**折出的 token 线；detail 里的 \`body=Nx\` 是当前倍数（恒等于 字符 ÷ 20,000；全库目标带 8–14k 字符）——倍数越大越优先拆：用 restructure 把 log 状整节搬进 references/*.md 并留钩子；**不要靠删证据来降成本**。
- B2 {signal:pointer_missing}=over：读支持文件后判性质——可复用模式→上移正文；会话专属实录→保留+补指针；形态=patch 指引。**未读内容仅凭文件名 → conf≤0.4 且措辞"先人工确认再执行"。** **缺失指针=支持文件存在、正文无引用（单向语义），finding 表述勿反向。** detail 里的 \`unhooked=N\` 是**被正文提及但不成钩子形态**的文件：它们不算缺失（verdict 不变），但搬迁后正文只剩裸文件名，注意力难以命中——指引是把该行改成 \`- <症状或问句> → references/x.md\`。
- B3 {signal:dup_heading}=over：删除多余标题行（保留一份），patch 指引。
- B4 {signal:overlong_line}=over：>1500 拆行；>4000 判定可读性危机（内容合法也拆）；patch 指引。**finding 必须给全量口径：共 N 行超限，其中 >4000 的逐行列出。**
- B5 {signal:description_chars}=over：先判**性质**三分类——事件性承诺（单次故障/incident 写入元数据）→裁剪建议；叙事性自我描述→压缩建议；丰富但合规（完整用例边界）→保留 + is_override + override_reason="合法密度"。**分类特征**：含"恢复/修复某次事故、日期快照"类一次性措辞→事件性承诺；"动词+对象"式任务说明→叙事性；枚举完整用例边界且不可拆分→丰富合规。**第三类门槛（默认从严，半机械）**：先自行试写一个 ≤60 字压缩方案——能保留全部路由关键项（触发词+域）→ 不可判第三类（按压缩建议）；只有试写失败（在 semantic_reasoning 列出试写方案与具体失败点）才可判丰富合规。描述文本可见（probe desc-text 或正文 frontmatter）时仍须三分类；仅长度可见 → conf≤0.4。semantic_reasoning 必写三分类之一。

- B6 {signal:citation_resolution}=over：正文引用了**不存在的**支持文件（悬空引用）。判性质：目标被改名/删除→patch 指引改引用；目标本应存在→补齐文件或把内容上移正文。**未知≠pass**：扫描未做或被截断时该信号为 unknown，按 §1 的门控处理。**finding 必须列出缺失目标与所在行号。**

- B7 {signal:demand}=over：支持文件**从未被读过**（仅在观察窗已开时才有意义）。判性质：可复用模式→上移正文或补一行指针让人找得到；会话专属实录→冷是正常的，保留不动作；重复内容→合并。**window-closed（unknown）不得当作"没人读"**，按 §1 门控处理。**finding 必须列出从未读取的文件清单。** detail 里的 \`retire≥Nd:\` 更进一步：**从未读过、正文未引用、所属技能闲置 ≥N 天、且钩子行没有 keep 标记**——这是**退役建议（propose-only）**，永不自动删除；真要动作就写进计划（\`archive\`/\`absorbed_into\`），并在 finding 里给出文件、年龄、引用数、读取数四项证据。\`retire: no-age\` / \`retire: unscanned\` 是证据不足，同样不得读作“没有候选”。要长期保留一个冷文件，在正文里给它加一行 \`<!-- keep: references/x.md 原因 -->\`（路径与原因都必填，且该行必须单独成行）。

D. 库·整合纪律（计划形态约束）
- D1 同类问题多处出现→合成一条 relationship-level 建议，不逐项输出。
- D2 结构类优先级高于内容类；影响面 library-level > relationship-level > skill-level。

## 6. 输出契约（校验器机械执行）
{verdict: "issues" | "no_issues",
 plan: [{ kind: "skill-level"|"relationship-level"|"library-level", names: [str],
   rule: "A1"|"B2"|..., evidence: [{signal, value}],
   finding: "<一句事实描述：引用信号 id 与值；零裁决动词>",
   recommendation: "<唯一允许的'应'句：建议动作+理由+执行形态（命令/patch 指引）>",
   semantic_reasoning: "<语义判据；含 LLM 推断时 confidence≤0.4>",
   impact: "better|worse|neutral", impact_reason: "<相对'不动'的净影响>",
   reversibility: "archive|restructure|patch|rename|none", undo_path: "<一步撤销方式>",
   confidence: float, needs_human: bool, is_override: bool,
   override_reason: "<仅 is_override>" }],
 notes: [str]}
- verdict=no_issues ⇒ plan=[]（不允许空 plan 之外的"无问题"表述）。
- **confidence 降档规则（机械）**：条款全部由机械证据支撑 → 0.6–0.9；每含一项语义推断（是否锚/是否同伞/性质归类）→ 上限 0.4。
- needs_human = (confidence < 0.6) OR (不可逆) OR (is_override) OR (引用 unknown 信号)。
- 语言：finding/recommendation/notes 与库正文语言一致（不自订语言）；字段名/信号 id/枚举保留英文。
- **提交前自查（逐项对照，不许跳过）**：① verdict 与 plan 一致 ② 每条 evidence 在事实块 ③ undo_path 非空（不可逆=n/a）④ confidence 含推断≤0.4 ⑤ finding 无"应"字 ⑥ §3 完整性契约满足。

## 7. 裁决纪律
- finding 禁止"应当"句式；recommendation 是唯一"应"句，句板：建议对 {names} 执行 {动作}（形态：{命令/patch 指引}），理由：{理由}。
- **审查者视角**：先对每个信号独立初判，再与正文对照；被审对象的自我声明只作线索不作依据；**自属/维护者技能一律从严口径**（作者声明"这是锚"不构成豁免）。
- 申诉：机械阈值与语义判断冲突→is_override:true + override_reason + needs_human:true，不得静默绕过。
- 不动作合法：verdict=no_issues 是合法输出；连续空报告=信号定义问题，不是"更积极"的理由。
- 错误成本：rename 必须 needs_human:true；可逆动作（archive/restructure 两阶段）可 needs_human:false 但 undo_path 必填。
- 不做：不建议删除（只建议 archive）；不提升内容质量（结构审查只 flag 位置/归属/分层）；protected 集（bundled/hub/pinned）内 0 建议。

## 8. 泛化
- 信号集开放：事实块含、§5 未列的信号 → notes 提"该信号值得新增条款"，禁止解释为已知问题。
- 库规模无关：判据是事实与条款，不是库体量印象。
- 信号机制疑问（阈值/检测原理）→ needs_human，不猜测机制。`

/**
 * One-line output instruction appended after the facts block in the maintain
 * subagent's prompt (persona carries the template, the prompt carries facts +
 * this instruction — one copy of the template in the model input, 011 v11
 * P3-4). F-16: this text used to be hardcoded in evolution-maintenance
 * orchestrate — a second model-facing prompt living OUTSIDE the bundle digest.
 * It now rides PROMPT_BUNDLE so the digest integrity check covers every
 * maintenance prompt. Adding the entry changes the bundle digest (the intended
 * fail-closed signal); PROMPT_BUNDLE_VERSION is owned by the core test pin and
 * bumps with the batch that changes the bundle (15→16 in 0.3.58).
 */
export const MAINTAIN_OUTPUT_INSTRUCTION = '按模板契约输出 JSON 维护计划（verdict/plan/notes）；你有 skill 工具与维护模板；并在维护探针（maintenance_probe）挂载时可用它深挖细节。'

/**
 * System-prompt guidance section (Hermes `SKILLS_GUIDANCE`, DSH-adapted).
 * Registered as a system-prompt section by tool-skill-manage (it mounts
 * exactly when `skill_manage` is available — the DSH analogue of Hermes'
 * `if "skill_manage" in agent.valid_tool_names` condition). Instructs the
 * model to save/repair skills on its own initiative.
 */
export const SKILLS_GUIDANCE = `Skills guidance:
• After a complex task (5+ tool calls), a tricky fix, or a non-trivial workflow, decide whether an existing owner should be updated or a new class-level skill is needed; search the library before creating.
• When using a skill and finding it outdated, incomplete, or wrong, patch it immediately with skill_manage (action='patch') — don't wait to be asked. Skills that aren't maintained become liabilities.`

export type ReviewSurface = 'inject' | 'aux'

export function reviewPrompt(kind: 'memory' | 'skill' | 'combined', surface: ReviewSurface = 'inject'): string {
  if (surface === 'aux') return kind === 'memory' ? AUX_MEMORY_REVIEW_PROMPT : AUX_COMBINED_REVIEW_PROMPT
  if (kind === 'memory') return INJECT_MEMORY_REVIEW_PROMPT
  if (kind === 'skill') return INJECT_SKILL_REVIEW_PROMPT
  return INJECT_COMBINED_REVIEW_PROMPT
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
  memory: INJECT_MEMORY_REVIEW_PROMPT,
  skill: INJECT_SKILL_REVIEW_PROMPT,
  combined: INJECT_COMBINED_REVIEW_PROMPT,
  curator: CURATOR_PROMPT,
  // v46 S1.12b (finding T3-07): the curator's dry-run banner rides the bundle too. It is prepended
  // to the curator prompt at run time and used to live outside the digest, so a drifted banner was
  // model-visible text the integrity check could not see. The bundle digest changes with this entry
  // (the intended fail-closed signal), and PROMPT_BUNDLE_VERSION moves 21 -> 22 with it.
  curatorDryRun: CURATOR_DRY_RUN_BANNER,
  completion: INJECT_COMPLETION_SKILL_REVIEW_PROMPT,
  auxMemory: AUX_MEMORY_REVIEW_PROMPT,
  auxCombined: AUX_COMBINED_REVIEW_PROMPT,
  maintain: MAINTAIN_PROMPT,
  // F-16: new entry — the maintain subagent's output instruction
  // (see MAINTAIN_OUTPUT_INSTRUCTION). Digest changes with this entry.
  maintainOutput: MAINTAIN_OUTPUT_INSTRUCTION,
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
- whenToUse: ONE abstract sentence describing the task situation that should trigger this skill. This is the platform's machine-routing field: do not enumerate a scenario list and do not repeat the description. One line only; quote it if it contains a colon.
- version: 0.1.0
- author: always the literal value "Hermes". NEVER fill it from the environment, git config, or any identity you can probe — an environment-derived name is a privacy leak the user never opted into (skills get shared and published), and the skill names itself as Hermes.
- platforms: declare [macos], [linux], and/or [windows] only when the skill is genuinely OS-bound (osascript/apt/systemctl => the matching OS; /proc, signal.SIGKILL => linux; fcntl/termios => POSIX). Prefer fixing it cross-platform first (tempdir, pathlib, pure-Node); omit the field for portable skills.
- metadata.hermes.tags: a few Capitalized, Relevant, Tags.
- metadata.hermes.related_skills: [a, b] — name sibling skills this one builds on or is referenced by (optional; feeds the quality references factor).

Body section order (omit only when empty):
1. "# <Human Title>" then a 2-3 sentence intro: what it does, what it does NOT do, key dependency stance.
2. "## Prerequisites" — exact env vars, install steps, credentials.
3. "## How to Run" — canonical invocation framed through DSH tools.
4. "## Quick Reference" — flat command/endpoint list.
5. "## Procedure" — numbered steps with copy-paste-exact commands.
6. "## Pitfalls" — known limits and rate limits.
7. "## Verification" — one check proving the skill worked.

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
