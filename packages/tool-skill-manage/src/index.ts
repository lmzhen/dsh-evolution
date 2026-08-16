/**
 * Model-facing skill_manage tool over ctx.evolutionIo + ctx.skillUsage.
 *
 * Mutations pass through the evolution approval seam when it is mounted;
 * approved/staged background writes are replayed by the registered runner.
 * The skill library itself never hard-deletes: archive is the maximum
 * destructive action and every curator mutation is snapshot-reversible.
 * @module @deepseek-ai/dsh-tool-skill-manage
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-evolution-io'
import { SkillLibrary } from '@deepseek-ai/dsh-evolution/src/skill-store.ts'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution/src/io.ts'
import type {} from '@deepseek-ai/dsh-evolution/src/events.ts'
import type {} from '@deepseek-ai/dsh-skill-usage'

export const name = 'tool-skill-manage'
export const inject = ['tools', 'skillUsage', 'evolutionIo']

interface ApprovalLike {
  request(input: { kind: 'skill'; summary: string; args: unknown; origin: 'foreground' | 'background_review' }): Promise<{ action: 'allow' | 'staged'; pendingId?: string; message: string }>
  registerRunner(kind: 'skill', runner: (args: unknown) => Promise<{ ok: boolean; message: string }>): () => void
}

interface SkillWriteArgs {
  action?: string
  name?: string
  content?: string
  old_string?: string
  new_string?: string
  replace_all?: boolean
  file_path?: string
  file_content?: string
  absorbed_into?: string
}

export function apply(ctx: Context): void {
  const resolveIo = () => ctx.evolutionIo.provider()
  const io: EvolutionIoLike = {
    readText: path => resolveIo().readText(path),
    writeText: (path, content) => resolveIo().writeText(path, content),
    remove: path => resolveIo().remove(path),
    list: path => resolveIo().list(path),
    exists: path => resolveIo().exists(path),
    rename: (path, destination) => resolveIo().rename(path, destination),
    copy: (path, destination) => resolveIo().copy(path, destination),
  }
  const library = new SkillLibrary(undefined, io)

  async function executeCore(args: SkillWriteArgs, origin: 'foreground' | 'background_review' = 'foreground'): Promise<{ ok: boolean; message: string; skills: string[]; pending_id?: string }> {
    const action = args.action
    const name = args.name ?? ''
    if (action === 'list') {
      const list = await library.list()
      return { ok: true, message: `Listed ${list.length} skills.`, skills: list.map(s => s.name) }
    }
    let result
    if (action === 'create') result = await library.create(name, args.content ?? '', origin)
    else if (action === 'edit' || action === 'update') result = await library.update(name, args.content ?? '')
    else if (action === 'patch') result = await library.patch(name, args.old_string ?? '', args.new_string ?? '', args.file_path ?? '', args.replace_all === true)
    else if (action === 'delete') result = await library.archive(name, args.absorbed_into ?? '')
    else if (action === 'write_file') result = await library.writeSupportFile(name, args.file_path ?? '', args.file_content ?? '')
    else if (action === 'remove_file') result = await library.removeSupportFile(name, args.file_path ?? '')
    else result = { ok: false, message: `Unknown action "${action}".` }

    if (result.ok) {
      // Lifecycle scope: curator only manages usage records created by the
      // background review pipeline. Keep the native runner aligned with the
      // legacy facade here, or review-created skills silently escape the
      // stale/archive lifecycle.
      if (name && action === 'create' && origin === 'background_review') await ctx.skillUsage.markAgentCreated(name)
      if (name && action !== 'list') await ctx.skillUsage.record(name, 'patch')
      ctx.emit('evolution/skill-mutated', {
        action: action ?? '?',
        name,
        ...result.path && action === 'delete' ? { archivedPath: result.path } : result.path ? { filePath: result.path } : {},
      })
    }
    return { ok: result.ok, message: result.message, skills: [] }
  }

  ctx.tools.register(defineTool({
    name: 'skill_manage',
    description:
      'Manage reusable skills. create/edit take full SKILL.md content; patch applies old_string -> new_string; delete archives to .archive. '
      + 'Protected bundled/hub skills reject mutation; pinned skills reject delete only. Prefer patching an umbrella over creating narrow skills.',
    parameters: {
      action: { type: 'string', required: true, enum: ['create', 'edit', 'update', 'patch', 'delete', 'write_file', 'remove_file', 'list'] },
      name: { type: 'string' },
      content: { type: 'string' },
      old_string: { type: 'string' },
      new_string: { type: 'string' },
      replace_all: { type: 'boolean' },
      file_path: { type: 'string' },
      file_content: { type: 'string' },
      absorbed_into: { type: 'string' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
          skills: { type: 'array', required: true, items: { type: 'string' } },
          pending_id: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `${value.ok ? 'OK' : 'Error'}: ${value.message}` }],
    },
    isConcurrencySafe: () => false,
    async execute(args: SkillWriteArgs, exec: { agent?: { session: { header: { origin?: string } } } }) {
      const origin = exec.agent?.session.header.origin === 'subagent' ? 'background_review' : 'foreground'
      const approval = ctx.get('evolutionApproval') as ApprovalLike | undefined
      if (approval && args.action !== 'list') {
        const decision = await approval.request({
          kind: 'skill',
          summary: `skill ${args.action ?? '?'} ${args.name ?? ''}`.trim(),
          args: { operation: args, origin },
          origin,
        })
        if (decision.action === 'staged') {
          return { ok: true, message: decision.message, skills: [], pending_id: decision.pendingId ?? '' }
        }
      }
      return await executeCore(args, origin)
    },
  }))

  ctx.inject(['evolutionApproval'], (approvalCtx) => {
    const approval = (approvalCtx as unknown as { evolutionApproval: ApprovalLike }).evolutionApproval
    const dispose = approval.registerRunner('skill', (args) => {
      const wrapped = (args ?? {}) as { operation?: SkillWriteArgs; origin?: 'foreground' | 'background_review' }
      return executeCore(wrapped.operation ?? {}, wrapped.origin ?? 'background_review')
    })
    approvalCtx.effect(() => dispose, 'tool-skill-manage.approval-runner')
  })
}
