/**
 * Model-facing skill_manage tool over ctx.skills + ctx.skillUsage.
 * @module @deepseek-ai/dsh-tool-skill-manage
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { SkillLibrary } from '@deepseek-ai/dsh-evolution/src/skill-store.ts'
import type {} from '@deepseek-ai/dsh-skill-usage'

export const name = 'tool-skill-manage'
export const inject = ['tools', 'skillUsage']

export function apply(ctx: Context): void {
  const library = new SkillLibrary()

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
        },
      },
      render: (_args, value) => [{ type: 'text', text: `${value.ok ? 'OK' : 'Error'}: ${value.message}` }],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const origin = (exec.agent?.session.header.delegationDepth ?? 0) > 0 ? 'background_review' : 'foreground'
      const action = args.action
      const name = args.name ?? ''
      let result
      if (action === 'list') {
        const list = await library.list()
        return { ok: true, message: `Listed ${list.length} skills.`, skills: list.map(s => s.name) }
      } else if (action === 'create') result = await library.create(name, args.content ?? '', origin)
      else if (action === 'edit' || action === 'update') result = await library.update(name, args.content ?? '')
      else if (action === 'patch') result = await library.patch(name, args.old_string ?? '', args.new_string ?? '', args.file_path ?? '', args.replace_all === true)
      else if (action === 'delete') result = await library.archive(name, args.absorbed_into ?? '')
      else if (action === 'write_file') result = await library.writeSupportFile(name, args.file_path ?? '', args.file_content ?? '')
      else if (action === 'remove_file') result = await library.removeSupportFile(name, args.file_path ?? '')
      else result = { ok: false, message: `Unknown action "${action}".` }

      if (result.ok && name) await ctx.skillUsage.record(name, 'patch')
      return { ok: result.ok, message: result.message, skills: [] }
    },
  }))
}
