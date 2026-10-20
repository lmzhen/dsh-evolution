/**
 * Child-scoped stage-tool bindings. A round child is bound only for the window in which its
 * staging writes are legal; the tool resolves the caller from the platform exec and refuses
 * when no binding exists.
 */
import type { StageToolContext } from './stage-tool.ts'

export class StageToolRegistry {
  private readonly bindings = new Map<string, StageToolContext>()

  bind(childId: string, context: StageToolContext): void {
    this.bindings.set(childId, context)
  }

  unbind(childId: string): void {
    this.bindings.delete(childId)
  }

  clear(): void {
    this.bindings.clear()
  }

  resolve(exec: unknown): StageToolContext | undefined {
    const childId = childIdOf(exec)
    return childId === undefined ? undefined : this.bindings.get(childId)
  }
}

function childIdOf(exec: unknown): string | undefined {
  if (typeof exec !== 'object' || exec === null) return undefined
  const agent = (exec as { agent?: unknown }).agent
  if (typeof agent !== 'object' || agent === null) return undefined
  const session = (agent as { session?: unknown }).session
  if (typeof session === 'object' && session !== null) {
    const id = (session as { id?: unknown }).id
    if (typeof id === 'string') return id
  }
  const sessionId = (agent as { sessionId?: unknown }).sessionId
  return typeof sessionId === 'string' ? sessionId : undefined
}
