import type { Context } from '@deepseek-ai/cordis'
import type { PromptSection } from '@deepseek-ai/dsh-system-prompt'

/** Static 1–2 sentence awareness; no domain list/tree. */
export const DISCOVERY_AWARENESS = 'When skill coverage for a task is uncertain, the domain cards and skill_search can reduce it; search is optional, not a required step.'

interface PromptRegistry { section(section: PromptSection): () => void }

/** Register the static awareness section; absent systemPrompt is a no-op. */
export function installDiscoveryAwareness(ctx: Context): () => void {
  const prompt = ctx.get('systemPrompt') as PromptRegistry | undefined
  if (prompt === undefined) return () => {}
  return prompt.section({ name: 'evolution-skill-discovery-awareness', order: 40, text: DISCOVERY_AWARENESS, interpolate: false })
}
