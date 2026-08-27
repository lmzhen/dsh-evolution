/**
 * Review and curation prompts adapted from Hermes Agent
 * `agent/background_review.py`, `agent/curator.py`, and
 * `agent/learn_prompt.py`, with tool names translated to the DSH-native
 * catalog (`memory`, `skill_manage`, `skill`, `bash`, `str_replace_editor`).
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
export const PROMPT_BUNDLE_ID = 'dsh-evolution@2'
export const PROMPT_BUNDLE_VERSION = 2

export const MEMORY_REVIEW_PROMPT = `[Auto-review — Memory]
Review the conversation above and consider saving to memory if appropriate.

Focus on:
1. Has the user revealed things about themselves — persona, desires, preferences, or personal details worth remembering?
2. Has the user expressed expectations about how you should behave, their work style, or ways they want you to operate?

If something stands out, save it using the memory tool.
If nothing is worth saving, just say "Nothing to save." and stop.`

export const SKILL_REVIEW_PROMPT = `[Auto-review — Skills]
Review the conversation above and update the skill library. Be ACTIVE — most sessions produce at least one skill update, even if small.

Target shape: CLASS-LEVEL skills with a rich SKILL.md and a references/ directory for session-specific detail. Not a flat list of narrow one-session skills.

Signals that warrant action:
- The user corrected your style, tone, format, verbosity, workflow, or approach.
- A non-trivial technique, fix, workaround, or debugging path emerged.
- A loaded skill turned out wrong, missing, or outdated — patch it now.

Preference order:
1. Patch a skill that was loaded or read this session.
2. Patch an existing umbrella skill.
3. Add references/, templates/, or scripts/ support under an existing skill.
4. Create a new class-level umbrella skill only when nothing fits.

Protected skills (bundled/hub-installed) must not be edited. Pinned skills may be patched but not archived.

Do NOT capture:
- Environment-dependent failures (missing binaries, unconfigured credentials).
- Negative claims about tools ("browser tools do not work").
- Transient errors that resolved during the session.
- One-off task narratives.

If a tool failed because of setup state, capture the FIX under an existing setup skill — never "this tool does not work" as a standalone constraint.

"Nothing to save." is a real option but should NOT be the default.`

export const COMBINED_REVIEW_PROMPT = `[Auto-review]
Review the conversation above and update two things.

**Memory**: who the user is. Save durable user preferences, personal details, and expectations with the memory tool.

**Skills**: how to do this class of task. Be ACTIVE. Follow the same class-level umbrella policy, preference order, protected-skill rules, and do-not-capture list as a skill review.

Act on whichever dimension has real signal. If genuinely nothing stands out on either, say "Nothing to save." and stop — but don't reach for that conclusion as a default.`

export const CURATOR_PROMPT = `You are the skill curator. Maintain a healthy, class-level skill library, not a flat pile of narrow one-session skills.

The goal is a LIBRARY OF CLASS-LEVEL INSTRUCTIONS. A skill collection of many narrow skills where each captures one session's specific bug is a FAILURE of the library. An agent searching skills matches on descriptions, not exact names; one broad umbrella with labeled subsections beats five narrow siblings for discoverability.

Right target shape: class-level skills with rich SKILL.md + references/, templates/, scripts/ support files for session-specific detail.

Hard rules:
1. NEVER hard-delete a skill. Archive (moving to .archive/) is the maximum destructive action; archives are recoverable, deletion is not.
2. Do not touch bundled, hub-installed, pinned, or scheduled-task-referenced (\`referenced\`) skills. Referenced skills MAY be consolidated into an umbrella, but never simply pruned.
3. Do not archive recently-created or never-used skills without strong evidence. "use=0" is NOT evidence either way — it only means the trigger has not come up yet.
4. Do NOT reject consolidation on the grounds that "each skill has a distinct trigger". The right bar is: would a human maintainer write this as N separate skills, or one skill with N labeled subsections? When the answer is the latter, merge.
5. Judge overlap on CONTENT, not on usage counters.
6. Before archiving a merged skill, ensure its unique content was preserved in the umbrella.

How to work:
1. Scan the candidate list. Identify PREFIX CLUSTERS — skills sharing a first word or domain keyword (expect 10-25 clusters).
2. For each cluster with 2+ members, ask "what is the UMBRELLA CLASS these skills serve?" and consolidate:
   a. MERGE INTO AN EXISTING UMBRELLA (patch a labeled section for each sibling's unique insight, then archive the siblings).
   b. CREATE A NEW UMBRELLA SKILL.md covering the shared workflow with short labeled subsections, then archive the absorbed siblings.
   c. DEMOTE session-specific detail to references/, templates/, or scripts/ under the umbrella.
3. Keep the umbrella body tight and scannable: exact commands, verbatim paths, ~100-200 lines; never invent flags or APIs.

Produce a YAML summary with exactly this shape:
consolidations:
  - from: <old-skill-name>
    into: <umbrella-skill-name>
    reason: <one short sentence>
prunings:
  - name: <skill-name>
    reason: <one short sentence>
Nominate a pruning only when archival is clearly safe (stale AND genuinely obsolete or fully absorbed elsewhere).`

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

Follow the skills review policy: be ACTIVE, prefer class-level umbrellas, patch skills loaded this session, and capture non-trivial techniques and user corrections. Do NOT capture environment-dependent failures, negative claims about tools, or one-off task narratives.

Do NOT modify output files or re-run the task. If you are still mid-task, ignore this.`

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
})

export function verifyPromptBundle(bundle: PromptBundle = PROMPT_BUNDLE): boolean {
  const canonical = JSON.stringify({
    id: bundle.id,
    version: bundle.version,
    prompts: Object.fromEntries(Object.entries(bundle.prompts).sort()),
  })
  return bundle.sha256 === sha256(canonical)
}

export const DSH_AUTHORING_STANDARDS = `Follow the Hermes skill-authoring standards, translated to DSH tools.

Frontmatter:
- name: lowercase-hyphenated, <=64 chars, no spaces.
- description: ONE sentence, <=60 characters, ends with a period. State the capability, not the implementation. No marketing words. Do NOT repeat the skill name. Count the characters before saving.
- version: 0.1.0
- author: always the literal value "Hermes". NEVER fill it from the environment, git config, or any identity you can probe.
- platforms: declare [macos], [linux], and/or [windows] only when the skill is genuinely OS-bound; omit for portable skills.
- metadata.hermes.tags: a few Capitalized, Relevant, Tags.

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
- References go in \`references/\`, templates in \`templates/\`.`
