/**
 * The system-prompt implementation half of the family's platform boundary.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { PromptContext, PromptSection } from '@deepseek-ai/dsh-system-prompt'
import type { SystemPromptPort } from '@deepseek-ai/dsh-evolution-platform-contract'

export type { SystemPromptPort } from '@deepseek-ai/dsh-evolution-platform-contract'

interface SystemPromptServiceLike {
  section(section: PromptSection): () => void
  variable(name: string, provider: (context: unknown) => string | undefined): () => void
  context?(context: PromptContext): () => void
}

/** Resolve the system-prompt port; undefined means the host has no such service. */
export function systemPromptPort(ctx: Context): SystemPromptPort | undefined {
  // platform-declaration anchor: systemPrompt is declared in core PLATFORM_SERVICE_PROBES.
  const service = ctx.get('systemPrompt') as SystemPromptServiceLike | undefined
  if (service === undefined || typeof service.section !== 'function' || typeof service.variable !== 'function') return undefined
  return {
    section: (section) => service.section(section),
    variable: (name, provider) => service.variable(name, provider),
    ...(typeof service.context === 'function' ? { context: (context: PromptContext) => service.context!(context) } : {}),
  }
}
