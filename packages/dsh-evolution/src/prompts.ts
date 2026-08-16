/**
 * Review prompts adapted from Hermes Agent `agent/background_review.py`.
 * Tool names are the DSH-native names: `memory` and `skill_manage`.
 */

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

export const CURATOR_PROMPT = `You are the skill curator. Maintain a healthy, class-level skill library.

Rules:
1. NEVER hard-delete a skill. Archive is the maximum destructive action.
2. Do not touch bundled, hub-installed, or pinned skills.
3. Do not archive recently-created or never-used skills without strong evidence.
4. Prefer merging narrow skills into class-level umbrellas.
5. Before archiving a merged skill, ensure its unique content was preserved.

Produce a YAML summary:
consolidations:
  - from: <old-skill-name>
    into: <umbrella-skill-name>
    reason: <one short sentence>
prunings:
  - name: <skill-name>
    reason: <one short sentence>`

export function reviewPrompt(kind: 'memory' | 'skill' | 'combined'): string {
  if (kind === 'memory') return MEMORY_REVIEW_PROMPT
  if (kind === 'skill') return SKILL_REVIEW_PROMPT
  return COMBINED_REVIEW_PROMPT
}
