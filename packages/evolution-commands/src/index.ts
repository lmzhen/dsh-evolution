/**
 * Human commands for the evolution family: /evolution learn|pending|curator|restore|consolidate.
 * @module @deepseek-ai/dsh-evolution-commands
 */

import type { Context } from '@deepseek-ai/cordis'
import { buildLearnPrompt } from '@deepseek-ai/dsh-evolution-core'

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
          const curator = ctx.get('evolutionCurator') as { run(options?: { ignoreGates?: boolean }): Promise<{ stale: string[]; archived: string[]; errors: string[]; report: { runId: string; snapshotPath?: string } }> } | undefined
          if (!curator) return { text: 'Curator service not mounted.' }
          const result = await curator.run({ ignoreGates: true })
          return { text: `Curator run complete: ${result.stale.length} stale, ${result.archived.length} archived, ${result.errors.length} failed.\nrunId=${result.report.runId}${result.report.snapshotPath ? `\nsnapshot=${result.report.snapshotPath}` : ''}` }
        }
        if (input === 'mutations') {
          const curator = ctx.get('evolutionCurator') as { skills: { listMutations(): Promise<Array<{ at: string; skillName: string; action: string; summary: string }>> } } | undefined
          if (!curator) return { text: 'Curator service not mounted.' }
          const records = await curator.skills.listMutations()
          if (records.length === 0) return { text: 'No mutation records yet.' }
          const recent = records.slice(-5).reverse().map(record => `${record.at.slice(0, 19)}  ${record.skillName}  ${record.action}  ${record.summary}`)
          return { text: `Mutations: ${records.length} recorded (recent 5):\n${recent.join('\n')}` }
        }
        if (input === 'curator report') {          const curator = ctx.get('evolutionCurator') as { latestReport(): Promise<{ runId: string; startedAt: string; archived: Array<{ name: string }>; failed: Array<{ name: string; reason: string }> } | null> } | undefined
          if (!curator) return { text: 'Curator service not mounted.' }
          const report = await curator.latestReport()
          if (!report) return { text: 'No curator report available.' }
          const lines = [
            `runId=${report.runId}`,
            `startedAt=${report.startedAt}`,
            `archived=${report.archived.map(item => item.name).join(', ') || '(none)'}`,
            `failed=${report.failed.map(item => `${item.name}: ${item.reason}`).join(', ') || '(none)'}`,
          ]
          return { text: lines.join('\n') }
        }
        if (input.startsWith('restore ')) {
          const curator = ctx.get('evolutionCurator') as { skills: { restoreLatestSnapshot(): Promise<{ ok: boolean; message: string }> } } | undefined
          const result = curator ? await curator.skills.restoreLatestSnapshot() : { ok: false, message: 'Curator service not mounted.' }
          return { text: result.message }
        }
        if (input.startsWith('consolidate ')) {
          const names = input.slice(12).trim().split(/\s+/).filter(Boolean)
          const [target, ...sources] = names
          if (!target || sources.length === 0) return { text: 'Usage: /evolution consolidate <target> <source...>' }
          const curator = ctx.get('evolutionCurator') as { consolidate(target: string, sources: string[]): Promise<{ ok: boolean; message: string }> } | undefined
          const result = curator ? await curator.consolidate(target, sources) : { ok: false, message: 'Curator service not mounted.' }
          return { text: result.message }
        }
        if (input.startsWith('skill restore ')) {
          const name = input.slice(14).trim()
          if (!name) return { text: 'Usage: /evolution skill restore <name>' }
          const curator = ctx.get('evolutionCurator') as { restore(name: string): Promise<{ ok: boolean; message: string }> } | undefined
          const result = curator ? await curator.restore(name) : { ok: false, message: 'Curator service not mounted.' }
          return { text: result.message }
        }
        if (input === 'learn' || input.startsWith('learn ')) {
          const request = input === 'learn' ? '' : input.slice(6).trim()
          return { text: buildLearnPrompt(request) }
        }
        return { text: 'Evolution: memory, skills, review, curator. Use /evolution pending | curator run | curator report | restore | consolidate <target> <source...> | skill restore <name> | learn [request].' }
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
