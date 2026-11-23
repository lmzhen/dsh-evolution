/**
 * The commands half of the family's platform contract.
 */
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'

export interface CommandsPort {
  register(definition: CommandDefinition): () => void
}
