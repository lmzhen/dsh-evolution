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

  /** Diagnostic view for a refused tool call; names only, no content. */
  snapshot(exec: unknown): { readonly childId?: string; readonly bound: number; readonly authors: number; readonly keys: readonly string[] } {
    const childId = childIdOf(exec)
    return { ...(childId === undefined ? {} : { childId }), bound: this.bindings.size, authors: [...this.bindings.values()].filter(context => context.phase === 'author').length, keys: [...this.bindings.keys()] }
  }

  resolve(exec: unknown): StageToolContext | undefined {
    const childId = childIdOf(exec)
    const direct = childId === undefined ? undefined : this.bindings.get(childId)
    if (direct !== undefined) return direct
    // New-child sessions may expose a session id that differs from the channel's childId.
    // Only a single author-phase binding is unambiguous; never guess with concurrent bindings.
    const authors = [...this.bindings.values()].filter(context => context.phase === 'author')
    return authors.length === 1 ? authors[0] : undefined
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
