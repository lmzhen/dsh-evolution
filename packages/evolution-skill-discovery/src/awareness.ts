import type { Context as CordisContext } from '@deepseek-ai/cordis'
import type { Context as HostContext } from '@deepseek-ai/cordis/src/context.ts'

type Context = CordisContext & HostContext
import { systemPromptPort } from '@deepseek-ai/dsh-evolution-core/platform'

/** Static 1–2 sentence awareness; no domain list/tree. */
export const DISCOVERY_AWARENESS = 'When skill coverage for a task is uncertain, the domain cards and skill_search can reduce it; search is optional, not a required step.'

/**
 * Register the static awareness section; absent systemPrompt is a no-op.
 * platform-declaration anchor: the optional systemPrompt service declared in core PLATFORM_SERVICE_PROBES.
 */
export function installDiscoveryAwareness(ctx: Context): () => void {
  const prompt = systemPromptPort(ctx)
  if (prompt === undefined) return () => {}
  return prompt.section({ name: 'evolution-skill-discovery-awareness', order: 40, text: DISCOVERY_AWARENESS, interpolate: false })
}
