/**
 * The tools half of the family's platform contract.
 */
import type {
  ToolDefinition,
  ToolGuard,
  ToolRegistrationOptions,
  ToolRestriction,
} from '@deepseek-ai/dsh-tools'

/** The subset of the platform tools registry the family consumes. */
export type { ToolDefinition, ToolRegistrationOptions } from '@deepseek-ai/dsh-tools'

export interface ToolsPort {
  register(definition: ToolDefinition, options?: ToolRegistrationOptions): () => void
  guard(guard: ToolGuard): () => void
  restrict(filter: ToolRestriction): () => void
  get(name: string, scope?: unknown): unknown
  resolve?(context: unknown): Promise<unknown>
  execute?<T = unknown>(input: unknown): Promise<T>
}
