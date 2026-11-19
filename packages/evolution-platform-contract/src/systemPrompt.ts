/**
 * The system-prompt half of the family's platform contract.
 */
import type { PromptContext, PromptSection } from '@deepseek-ai/dsh-system-prompt'

export interface SystemPromptPort {
  section(section: PromptSection): () => void
  variable(name: string, provider: (context: unknown) => string | undefined): () => void
  context?(context: PromptContext): () => void
}
