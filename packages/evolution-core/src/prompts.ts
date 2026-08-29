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
export const PROMPT_BUNDLE_ID = 'dsh-evolution@5'
export const PROMPT_BUNDLE_VERSION = 5

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

Preference order — prefer the earliest action that fits, but do pick one when a signal above fired:
  1. UPDATE A CURRENTLY-LOADED SKILL. Look back through the conversation for skills the user loaded or you read. If any of them covers the territory of the new learning, PATCH that one first. It is the skill that was in play, so it's the right one to extend.
  2. UPDATE AN EXISTING UMBRELLA. If no loaded skill fits but an existing class-level skill does, patch it. Add a subsection, a pitfall, or broaden a trigger.
  3. ADD A SUPPORT FILE under an existing umbrella. Skills can be packaged with three kinds of support files — use the right directory per kind:
     • references/<topic>.md — session-specific detail (error transcripts, reproduction recipes, provider quirks) AND condensed knowledge banks: quoted research, API docs, external authoritative excerpts, or domain notes you found while working on the problem. Write it concise and for the value of the task, not as a full mirror of upstream docs.
     • templates/<name>.<ext> — starter files meant to be copied and modified (boilerplate configs, scaffolding, a known-good example the agent can reproduce with modifications).
     • scripts/<name>.<ext> — statically re-runnable actions the skill can invoke directly (verification scripts, fixture generators, deterministic probes, anything the agent should run rather than hand-type each time).
     Add support files via skill_manage action=write_file with file_path starting 'references/', 'templates/', or 'scripts/'. The umbrella's SKILL.md should gain a one-line pointer to any new support file so future agents know it exists.
  4. CREATE A NEW CLASS-LEVEL UMBRELLA SKILL when no existing skill covers the class. The name MUST be at the class level. The name MUST NOT be a specific PR number, error string, feature codename, library-alone name, or 'fix-X / debug-Y / audit-Z-today' session artifact. If the proposed name only makes sense for today's task, it's wrong — fall back to (1), (2), or (3).

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

Preference order for skills — pick the earliest that fits:
  1. UPDATE A CURRENTLY-LOADED SKILL. Check what skills were loaded or read in the conversation. If one of them covers the learning, PATCH it first. It was in play; it's the right place.
  2. UPDATE AN EXISTING UMBRELLA. Patch it.
  3. ADD A SUPPORT FILE under an existing umbrella via skill_manage action=write_file. Three kinds: references/<topic>.md for session-specific detail OR condensed knowledge banks (quoted research, API docs excerpts, domain notes) written concise and task-focused; templates/<name>.<ext> for starter files meant to be copied and modified; scripts/<name>.<ext> for statically re-runnable actions (verification, fixture generators, probes). Add a one-line pointer in SKILL.md so future agents find them.
  4. CREATE A NEW CLASS-LEVEL UMBRELLA when nothing exists. Name at the class level — NOT a PR number, error string, codename, library-alone name, or 'fix-X / debug-Y' session artifact. If the name only fits today's task, fall back to (1), (2), or (3).

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
2. Do not touch bundled, hub-installed, pinned, or scheduled-task-referenced (referenced) skills. Referenced skills MAY be consolidated into an umbrella — but only because the curator rewrites scheduled-task skill references to follow consolidations; never simply prune them.
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

Your toolset:
  - skill_manage action=list / review — read the current landscape.
  - skill_manage action=patch — add sections to the umbrella.
  - skill_manage action=create — create a new umbrella SKILL.md.
  - skill_manage action=write_file — add a references/, templates/, or scripts/ file under an existing skill (the skill must already exist).
  - skill_manage action=delete — archive a skill. MUST pass absorbed_into=<umbrella> when you've merged its content into another skill, or absorbed_into="" when you're truly pruning with no forwarding target.
  - skill_manage action=consolidate — merge source bodies into a target and archive the sources when patching by hand is error-prone.
  - skill_manage action=restore — bring one archived skill back (recoverability is the archive's contract).
  - For moving support files, keep it inside the skill tree: support files move via reading and writing through skill_manage write_file/remove_file.

'keep' is a legitimate decision ONLY when the skill is already a class-level umbrella and none of the proposed merges would improve discoverability. 'This is narrow but distinct from its siblings' is NOT a reason to keep — it's a reason to move it under an umbrella as a subsection or support file.

Expected output: real umbrella-ification. Process every obvious cluster. If you end the pass with obvious clusters still untouched, you stopped too early — go back and look at the clusters you left alone.

Keep the umbrella body tight and scannable: exact commands, verbatim paths, ~100-200 lines; never invent flags or APIs.

When done, write a human summary AND a structured machine-readable block so downstream tooling can distinguish consolidation from pruning. Format EXACTLY:

## Structured summary (required)
\`\`\`yaml
consolidations:
  - from: <old-skill-name>
    into: <umbrella-skill-name>
    reason: <one short sentence — why merged, not just 'similar'>
prunings:
  - name: <skill-name>
    reason: <one short sentence — why archived with no merge target>
\`\`\`

Every skill you moved to .archive/ MUST appear in exactly one of the two lists. If you consolidated X into umbrella Y (patched Y, wrote a references file to Y, or created Y with X's content absorbed), X goes under consolidations with into: Y. If you archived X with no absorption — truly stale, irrelevant, or obsolete — X goes under prunings. Leave a list empty (consolidations: []) if none. Do not omit the block. The block comes AFTER your human-readable summary of clusters processed, patches made, and decisions left alone.`

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
 * System-prompt guidance section (Hermes `SKILLS_GUIDANCE`, DSH-adapted).
 * Registered as a system-prompt section by tool-skill-manage (it mounts
 * exactly when `skill_manage` is available — the DSH analogue of Hermes'
 * `if "skill_manage" in agent.valid_tool_names` condition). Instructs the
 * model to save/repair skills on its own initiative.
 */
export const SKILLS_GUIDANCE = `Skills guidance:
• After completing a complex task (5+ tool calls), fixing a tricky error, or discovering a non-trivial workflow, save the approach as a skill with skill_manage so you can reuse it next time.
• When using a skill and finding it outdated, incomplete, or wrong, patch it immediately with skill_manage (action='patch') — don't wait to be asked. Skills that aren't maintained become liabilities.`

export function reviewPrompt(kind: 'memory' | 'skill' | 'combined'): string {
  if (kind === 'memory') return MEMORY_REVIEW_PROMPT
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
  curator: CURATOR_PROMPT,
  completion: COMPLETION_SKILL_REVIEW_PROMPT,
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
