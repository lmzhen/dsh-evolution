/**
 * Open-ended `/evolution learn` prompt builder.
 *
 * `learn` is open-ended: the user can name anything they can describe — a
 * directory of code, an API doc URL, a workflow they just walked the agent
 * through, or pasted notes. The prompt instructs the live agent to gather the
 * named sources with its existing tools, then author a single SKILL.md via
 * `skill_manage` following `DSH_AUTHORING_STANDARDS`. There is no separate
 * distillation engine and no model-tool footprint.
 */

import { DSH_AUTHORING_STANDARDS } from './prompts.ts'

/**
 * Build the agent prompt for an open-ended `/evolution learn` request.
 *
 * @param userRequest free-text the user gave after `/evolution learn`; an
 *   empty string falls back to "the workflow we just went through".
 * @returns a complete instruction the agent runs as a normal turn.
 */
export function buildLearnPrompt(userRequest: string): string {
  const request = userRequest.trim()
  const resolved = request || 'the workflow we just went through in this conversation — review the steps taken and distill them into a reusable skill'
  return [
    '[/learn] The user wants you to learn a reusable skill from the request below, and save it.',
    '',
    'THE REQUEST:',
    resolved,
    '',
    'The request is open-ended and may mix two kinds of content, in any order: SOURCES to gather (directories, file paths, URLs, "what we just did", pasted notes) AND REQUIREMENTS that shape the skill (what to focus on, what to leave out, scope, naming, the angle to take). Treat EVERY part of the request as load-bearing. In particular, prose that comes after a path or link is NOT incidental — it is the user telling you what they want from that source. A request like `<url> focus on the auth flow, skip the deprecated endpoints` means: gather the URL AND honor "focus on auth, skip deprecated" as authoring requirements. Never fetch the first source and ignore the rest.',
    '',
    'Do this:',
    '1. Gather every source the user named, using the tools you already have — reads and searches for local files or directories, web access for URLs, this conversation history if they referred to something you just did, and the text they pasted as-is. If the request is ambiguous about scope, make a reasonable choice and note it; do not stall.',
    '2. Author ONE SKILL.md, applying every requirement, focus, and constraint in the request — these govern what the SKILL.md covers and emphasizes, not just which sources you read.',
    "3. Save it with the `skill_manage` tool (action=\"create\"). Pick a sensible category. If the procedure needs a non-trivial script, add it under the skill's `scripts/` with `skill_manage` write_file and reference it by relative path.",
    '',
    DSH_AUTHORING_STANDARDS,
    '',
    'When done, tell the user the skill name, its category, and a one-line summary of what it captured.',
  ].join('\n')
}
