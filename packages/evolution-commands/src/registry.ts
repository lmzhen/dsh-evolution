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
export interface CommandEntry {
  /** The subcommand as typed after `/evolution`. Variants use `|` (curator run|pause). */
  usage: string
  /** One-line purpose rendered in the help output. */
  summary: string
}

export const COMMAND_ENTRIES: CommandEntry[] = [
  { usage: 'pending [--detail]', summary: '列出暂存的写入（--detail 显示参数）' },
  { usage: 'approve <id>', summary: '执行一条已批准的写入' },
  { usage: 'reject <id>', summary: '丢弃一条暂存写入，不执行' },
  { usage: 'release <id>', summary: '把卡在执行中的写入放回待批窗口（先确认效果再批准 or reject)' },
  { usage: 'doctor [--json]', summary: '只读自检：安装形态、冲突、环境、服务（--json 供脚本用）' },
  { usage: 'curator run|pause|resume|status|report|scope', summary: '立即运行一次自动整理，或暂停／恢复／查看状态' },
  { usage: 'mutations', summary: '列出技能改动记录' },
  { usage: 'restore', summary: '从最近的快照恢复技能' },
  { usage: 'consolidate <target> <sources...> [--plan <runId>]', summary: '把若干技能合并进一个总括技能' },
  { usage: 'skill restore <name>', summary: '按名字恢复一个已归档的技能' },
  { usage: 'skills health', summary: '技能库结构体检' },
  { usage: 'skills refresh', summary: '丢弃目录缓存并重新读取技能树' },
  { usage: 'learn [request]', summary: '向本会话发一条学习请求' },
  { usage: 'maintain [--timeout=<ms> | --facts]', summary: '运行一次维护扫描（--facts 为 0 token 预览）' },
  { usage: 'policy set <id> <value> [--expect <revision>]', summary: '通过设置服务写入一个你可改的参数 (E3 only; E1/E2 stay in cordis.yml)' },
  { usage: 'params [--group <name>] [--json]', summary: '列出全部参数：分组、档位、生效时机、来源与当前值（--json feeds scripts)' },
  { usage: 'preset install [--base <name>[,<name>...]]', summary: '按指定基础生成自进化 Agent 预设到用户 root (bases from the agent package\'s bases.json)' },
  { usage: 'restructure <name> "<heading>" <to_file> [--plan <runId>]', summary: '把技能正文的一节移到 references 文件' },
  { usage: 'replay', summary: '比较不同会话与重启之间的计划结果（从活动记录回填）' },
]

/** The input-declaration hint (single line, ` | `-separated). */
export function renderHint(): string {
  return COMMAND_ENTRIES.map(entry => entry.usage).join(' | ')
}

/** The bare `/evolution` help body (one line per subcommand). */
export function renderHelpText(): string {
  return COMMAND_ENTRIES
    .map(entry => `  ${entry.usage.padEnd(44)} ${entry.summary}`)
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
