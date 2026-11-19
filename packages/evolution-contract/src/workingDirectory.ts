/**
 * The working-directory half of the family's platform contract.
 */
import type { Agent } from '@deepseek-ai/dsh-agent'

export interface WorkingDirectoryPort {
  ensure(agent: Agent, signal?: AbortSignal): Promise<string>
}
