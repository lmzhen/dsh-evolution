/** The read-only skill history and its undo (the undo write stays behind the refusal seam). */
import type { EvolutionErrorId, HostLocale } from '@deepseek-ai/dsh-evolution-core'
import type { CommandResult } from '@deepseek-ai/dsh-evolution-adapter/contract'
import { hostErrorText } from '../host-locale.ts'
import { partitionVersions, type SkillVersion } from '@deepseek-ai/dsh-evolution-core/skills'

/** What the two handlers need. */
export interface SkillHistoryCommandContext {
  readonly input: string
  readonly ctx: { get(name: string): unknown }
  readonly locale: HostLocale
  readonly refusal: (what: string) => CommandResult | undefined
}

const ok = (text: string): CommandResult => ({ kind: 'success', text })
const err = (text: string): CommandResult => ({ kind: 'error', text })
const hostError = (locale: HostLocale, id: EvolutionErrorId): string => hostErrorText(locale, id)

/** `skill history <name>`: content versions and support-file versions, kept apart. */
export async function runSkillHistoryCommand(context: SkillHistoryCommandContext): Promise<CommandResult | undefined> {
  const { input, ctx, locale } = context
  if (!input.startsWith('skill history ')) return undefined
  const name = input.slice(14).trim()
  if (!name) return err('用法：/evolution skill history <name>')
  const curator = ctx.get('evolutionCurator') as { history(name: string): Promise<SkillVersion[]> } | undefined
  if (!curator) return err(hostError(locale, 'e-302-curator-service-not-mounted'))
  const versions = await curator.history(name)
  if (versions.length === 0) return ok(`技能 "${name}" 还没有内容版本：下一次经 skill_manage 写入后才会出现。`)
  const groups = partitionVersions(versions)
  const row = (entry: SkillVersion): string => `v${entry.v}\t${entry.at}\t${entry.action}\t${entry.chars} chars\t${entry.hash.slice(0, 12)}${entry.unitId === undefined ? '' : `\tunit:${entry.unitId}`}${entry.summary === undefined ? '' : `\t${entry.summary}`}`
  const lines = [`技能 "${name}" 的内容版本（由旧到新，${groups.content.length} 条，最多保留这么多）：`, ...groups.content.map(row)]
  if (groups.support.length > 0) {
    lines.push('支撑文件版本（仅在历史里 —— 撤销恢复的是 SKILL.md，不是这些字节）：', ...groups.support.map(row))
  }
  return ok(lines.join('\n'))
}

/** `skill undo <name> [--to vN | --unit <id>]`. */
export async function runSkillUndoCommand(context: SkillHistoryCommandContext): Promise<CommandResult | undefined> {
  const { input, ctx, locale, refusal } = context
  if (!input.startsWith('skill undo ')) return undefined
  const rest = input.slice(11).trim()
  const toMatch = /--to\s+v?(\d+)/.exec(rest)
  const unitMatch = /--unit\s+(\S+)/.exec(rest)
  const marker = [toMatch?.index, unitMatch?.index].filter((index): index is number => index !== undefined).sort((a, b) => a - b)[0]
  const name = (marker === undefined ? rest : rest.slice(0, marker)).trim()
  if (!name) return err('用法：/evolution skill undo <name> [--to v<N> | --unit <id>]')
  if (toMatch !== null && unitMatch !== null) return err('--to 与 --unit 不能同时使用')
  const blocked = refusal('skill undo')
  if (blocked !== undefined) return blocked
  const curator = ctx.get('evolutionCurator') as {
    undo(name: string, v?: number): Promise<{ ok: boolean; message: string }>
    undoUnit(name: string, unitId?: string): Promise<{ ok: boolean; message: string }>
  } | undefined
  const target = toMatch?.[1] === undefined ? undefined : Number(toMatch[1])
  const unitId = unitMatch?.[1]
  const result = curator === undefined
    ? { ok: false, message: hostError(locale, 'e-302-curator-service-not-mounted') }
    : unitId !== undefined
      ? await curator.undoUnit(name, unitId)
      : target === undefined ? await curator.undo(name) : await curator.undo(name, target)
  return result.ok ? ok(result.message) : err(result.message)
}
