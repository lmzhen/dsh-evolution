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
  /** The visible tool under this scope, or undefined; the opt-in probe reads this. */
  get(name: string, scope?: unknown): unknown
  /** Resolve the step admission for one review child agent. */
  resolve?(context: unknown): Promise<unknown>
  /** Raw execute for callers that own the platform call shape (review aux path). */
  execute?<T = unknown>(input: unknown): Promise<T>
}
