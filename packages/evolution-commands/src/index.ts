/**
 * Human commands for the evolution family: /evolution status|pending.
 * @module @deepseek-ai/dsh-evolution-commands
 */

import type { Context } from '@deepseek-ai/cordis'

export const name = 'evolution-commands'

export function apply(ctx: Context): void {
  ctx.inject(['commands'], (commandCtx) => {
    const commands = (commandCtx as unknown as { commands: CommandRuntimeLike }).commands
    commands.register({
      name: 'evolution',
      description: 'Self-evolution status and approval controls',
      recordInput: false,
      async handler(invocation: { rawInput?: string }) {
        const input = invocation.rawInput?.trim() ?? ''
        const approval = (ctx.get('evolutionApproval') as ApprovalLike | undefined)
        if (input === 'pending') {
          const pending = approval ? await approval.list('pending') : []
          return { text: pending.length === 0 ? 'No pending evolution writes.' : pending.map(p => `${p.id}  ${p.kind}  ${p.summary}`).join('\n') }
        }
        if (input.startsWith('approve ')) {
          const id = input.slice(8).trim()
          const result = approval ? await approval.approve(id) : { ok: false, message: 'approval service not mounted' }
          return { text: result.message }
        }
        if (input.startsWith('reject ')) {
          const id = input.slice(7).trim()
          const result = approval ? await approval.reject(id) : { ok: false, message: 'approval service not mounted' }
          return { text: result.message }
        }
        if (input === 'curator run') {
          const curator = ctx.get('evolutionCurator') as { run(): Promise<{ stale: string[]; archived: string[] }> } | undefined
          if (!curator) return { text: 'Curator service not mounted.' }
          const result = await curator.run()
          return { text: `Curator run complete: ${result.stale.length} stale, ${result.archived.length} archived.` }
        }
        if (input.startsWith('restore ')) {
          const curator = ctx.get('evolutionCurator') as { skills: { restoreLatestSnapshot(): Promise<{ ok: boolean; message: string }> } } | undefined
          const result = curator ? await curator.skills.restoreLatestSnapshot() : { ok: false, message: 'Curator service not mounted.' }
          return { text: result.message }
        }
        return { text: 'Evolution: memory, skills, review, curator. Use /evolution pending | curator run | restore.' }
      },
    })
  })
}

interface CommandRuntimeLike {
  register(definition: unknown): () => void
}

interface ApprovalLike {
  list(status: 'pending' | 'approved' | 'rejected'): Promise<Array<{ id: string; kind: string; summary: string }>>
  approve(id: string): Promise<{ ok: boolean; message: string }>
  reject(id: string): Promise<{ ok: boolean; message: string }>
}
