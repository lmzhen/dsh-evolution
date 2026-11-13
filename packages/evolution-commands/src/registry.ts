/**
 * Subcommand registry — the SINGLE SOURCE for the /evolution command surface.
 *
 * 0.3.55 (WD1): the input-declaration hint, the bare `/evolution` help output
 * and the README command table all render FROM this table; a hand-written
 * copy anywhere is drift waiting to happen (v10 R-13 proved it once).
 * PLAN S5.3 (2026-09-16): "the README command table" means the FAMILY README
 * (`packages/README.md` — the T-WD2 anchor). Package-level READMEs cite that
 * home instead of restating the table (doc-facts rule N19).
 * Keep `usage` in the exact shape a user can type after `/evolution`.
 */
import { HOST_COMMANDS } from './generated/host-commands.ts'
import type { HostLocale } from '@deepseek-ai/dsh-evolution-core'

export interface CommandEntry {
  /** The subcommand as typed after `/evolution`. Variants use `|` (curator run|pause). */
  usage: string
  /** C7: true when the subcommand only READS (no skill/param write). Stored: not derivable. */
  readonly: boolean
  /** One-line purpose rendered in the help output. */
  summary: string
}

/** The flags the TABLE declares for one subcommand (name → `--flag`), DERIVED from its usage. */
export function flagsOf(name: string): string[] {
  const entry = COMMAND_ENTRIES.find(candidate => entryName(candidate) === name)
  return entry === undefined ? [] : entryFlags(entry)
}

/**
 * C7 shape, DERIVED: the entry IDENTITY key, and it is HIERARCHICAL (E-08).
 *
 * The key used to be the first token alone, and `flagsOf` finds an entry with `.find(...)` - the FIRST
 * match - so `maintain handoff` / `maintain cancel` and `skill restore` / `skill history` / `skill undo` /
 * `skill pin` all derived the SAME key as their parent and every flag lookup silently saw the parent entry
 * only (nine collisions). A bare parent (`maintain [--timeout]`) keeps its one-token key, so parent lookups
 * still resolve: the one call site that named an entry by a name the key no longer produced was the preset
 * dispatch branch, and it now asks for the entry own key (`preset install`).
 */
export function entryName(entry: CommandEntry): string {
  // `noUncheckedIndexedAccess` makes both index reads `string | undefined`; destructuring with a
  // default says the same thing without two casts (the CI build line proved it).
  const [head = '', second = ''] = entry.usage.split(' ')
  const name = head.split('|')[0] ?? ''
  const secondIsName = /^[a-z][a-z-]*$/.test(second) && !second.startsWith('--')
  return secondIsName ? name + ' ' + second : name
}

/** C7 shape, DERIVED: the flags a `usage` declares, in the form `--flag` (value flags keep their name). */
export function entryFlags(entry: CommandEntry): string[] {
  const found: string[] = []
  for (const match of entry.usage.matchAll(/--[a-z][a-z-]*/g)) {
    if (!found.includes(match[0])) found.push(match[0])
  }
  return found
}

export const COMMAND_ENTRIES: CommandEntry[] = [
  { readonly: false, usage: 'merge <subcommand> [<args>]', summary: '技能自动合并（扫描/待批准/重跑/报告/撤销）' },
  { readonly: true, usage: 'pending [--detail]', summary: '列出暂存的写入（--detail 显示参数）' },
  { readonly: false, usage: 'approve <id>', summary: '执行一条已批准的写入' },
  { readonly: false, usage: 'reject <id>', summary: '丢弃一条暂存写入，不执行' },
  { readonly: false, usage: 'release <id>', summary: '把卡在执行中的写入放回待批窗口（先确认效果再批准或驳回）' },
  { readonly: true, usage: 'doctor [--json]', summary: '只读自检：安装形态、冲突、环境、服务（--json 供脚本用）' },
  { readonly: false, usage: 'curator run|pause|resume|status|report|scope', summary: '立即运行一次自动整理，或暂停／恢复／查看状态' },
  { readonly: true, usage: 'mutations', summary: '列出技能改动记录' },
  { readonly: false, usage: 'restore', summary: '从最近的快照恢复技能' },
  { readonly: false, usage: 'skill restore <name>', summary: '按名字恢复一个已归档的技能' },
  { readonly: true, usage: 'skill history <name>', summary: '列出某个技能的内容版本（含时间、动作、字符数、哈希前缀）' },
  { readonly: false, usage: 'skill undo <name> [--to v<N>]', summary: '把某个技能的内容回退到某一版（默认上一版；只动内容，撤销本身也记为一版）' },
  { readonly: false, usage: 'skill pin <name>', summary: '钉住一个技能：免于删除、后台审查与生命周期整理（立即生效、随时可解钉；与 skill_manage 的 pin 动作同一语义，不走审批）' },
  { readonly: false, usage: 'skill unpin <name>', summary: '解钉一个技能：撤销上面的冻结（立即生效、不走审批）' },
  { readonly: false, usage: 'propose', summary: '为 body-oversize 技能写 keep 提议（不自动拆分；同一 reports store）' },
  { readonly: true, usage: 'skills health', summary: '技能库结构体检' },
  { readonly: false, usage: 'skills refresh', summary: '丢弃目录缓存并重新读取技能树' },
  { readonly: false, usage: 'learn [request]', summary: '向本会话发一条学习请求' },
  { readonly: false, usage: 'maintain [--timeout=<ms> | --facts]', summary: '起一次维护扫描并立即回 run id（后台跑；--facts 为 0 token 预览）' },
  { readonly: true, usage: 'maintain status [<id>]', summary: '看维护扫描：在飞的那次（含已跑多久）或某个 run 的终态' },
  { readonly: true, usage: 'maintain report [<id>]', summary: '读某个 run 的结果正文（省略 id 取本 home 最新一条；没有结果就明说，不装成空结果）' },
  { readonly: false, usage: 'maintain handoff [<id>]', summary: '把某次维护报告交给模型：注入指针与汇报协议，模型只汇报、等你确认后再动手' },
  { readonly: false, usage: 'maintain cancel [<id>]', summary: '停掉在飞的那次维护扫描（省略 id 仅当最新一条是本进程在跑的那次）' },
  { readonly: true, usage: 'params [--group <name>] [--json]', summary: '列出全部参数：分组、档位、生效时机、来源与当前值（--json 便于脚本处理）' },
  { readonly: false, usage: 'restructure <name> "<heading>" <to_file> [--plan <runId>]', summary: '把技能正文的一节移到 references 文件' },
  { readonly: false, usage: 'extract <source> <target> "<heading>" [--start <line>] [--end <line>] [--outcome extract|mixed] [--proposal <id>] [--owner-covers] [--apply]', summary: '预览把源技能的可复用部分提取到已有类级 owner；默认 plan，--apply 才写（多根一次事务）' },
  { readonly: true, usage: 'replay', summary: '比较不同会话与重启之间的计划结果（从活动记录回填）' },
]

/** The input-declaration hint (single line, ` | `-separated). */
export function renderHint(): string {
  return COMMAND_ENTRIES.map(entry => entry.usage).join(' | ')
}

/** The bare `/evolution` help body (one line per subcommand). */
export function renderHelpText(locale: HostLocale = 'zh'): string {
  // First line first: the platform's command row collapses to the output's FIRST LINE, and a list
  // whose first line is a subcommand reads like that subcommand was what ran.
  const header = HOST_COMMANDS['help.subcommands'][locale] ?? HOST_COMMANDS['help.subcommands'].en
  return [header.replace('{count}', String(COMMAND_ENTRIES.length)), '', ...COMMAND_ENTRIES
    .map(entry => `  ${entry.usage.padEnd(44)} ${(HOST_COMMANDS as Record<string, Partial<Record<HostLocale, string>>>)['summary.' + entryName(entry)]?.[locale] ?? entry.summary}`)]
    .join('\n')
}

/** Markdown command table fragment for README surfaces (T-WD2 pins it).
 * `|` inside a usage (curator run|pause|…) is escaped for the table cell. */
export function renderCommandTable(): string {
  const lines = COMMAND_ENTRIES.map(entry =>
    `| \`/evolution ${entry.usage.replace(/\|/g, '\\|')}\` | ${entry.summary} |`,
  )
  return lines.join('\n')
}

/**
 * The flags whose declared form takes a value, DERIVED from the usage text: a flag followed by
 * `=` or by a placeholder token (not another flag/bracket) is a value flag. Boolean flags stay
 * out. The parser imports this, so `--proposal p1` cannot be read as a bare boolean again.
 */
export function entryValueFlags(entry: CommandEntry): string[] {
  const found: string[] = []
  const tokens = entry.usage.split(/\s+/)
  for (let index = 0; index < tokens.length; index += 1) {
    const raw = tokens[index] ?? ''
    const token = raw.replace(/^\[+/, '').replace(/\]+$/, '')
    if (!token.startsWith('--')) continue
    const name = token.slice(2).split('=')[0] ?? ''
    if (name === '') continue
    if (token.includes('=')) {
      if (!found.includes(name)) found.push(name)
      continue
    }
    const next = (tokens[index + 1] ?? '').replace(/^\[+/, '')
    if (next !== '' && !next.startsWith('--') && next !== ']' && next !== '|') {
      if (!found.includes(name)) found.push(name)
    }
  }
  return found
}

/** Union of every usage's value flags (the parse table's ONE source). */
export const VALUE_FLAGS: readonly string[] = (() => {
  const names: string[] = []
  for (const entry of COMMAND_ENTRIES) for (const name of entryValueFlags(entry)) if (!names.includes(name)) names.push(name)
  return names
})()
