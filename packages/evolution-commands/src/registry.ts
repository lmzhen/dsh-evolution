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

/** C7 shape, DERIVED: the subcommand name is the first token of `usage` (variants use `|`). */
export function entryName(entry: CommandEntry): string {
  return entry.usage.split(' ')[0].split('|')[0]
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
  { readonly: true, usage: 'pending [--detail]', summary: '列出暂存的写入（--detail 显示参数）' },
  { readonly: false, usage: 'approve <id>', summary: '执行一条已批准的写入' },
  { readonly: false, usage: 'reject <id>', summary: '丢弃一条暂存写入，不执行' },
  { readonly: false, usage: 'release <id>', summary: '把卡在执行中的写入放回待批窗口（先确认效果再批准 or reject)' },
  { readonly: true, usage: 'doctor [--json]', summary: '只读自检：安装形态、冲突、环境、服务（--json 供脚本用）' },
  { readonly: false, usage: 'curator run|pause|resume|status|report|scope', summary: '立即运行一次自动整理，或暂停／恢复／查看状态' },
  { readonly: true, usage: 'mutations', summary: '列出技能改动记录' },
  { readonly: false, usage: 'restore', summary: '从最近的快照恢复技能' },
  { readonly: false, usage: 'consolidate <target> <sources...> [--plan <runId>]', summary: '把若干技能合并进一个总括技能' },
  { readonly: false, usage: 'skill restore <name>', summary: '按名字恢复一个已归档的技能' },
  { readonly: true, usage: 'skill history <name>', summary: '列出某个技能的内容版本（含时间、动作、字符数、哈希前缀）' },
  { readonly: false, usage: 'skill undo <name> [--to v<N>]', summary: '把某个技能的内容回退到某一版（默认上一版；只动内容，撤销本身也记为一版）' },
  { readonly: false, usage: 'skill pin <name>', summary: '钉住一个技能：免于删除、后台审查与生命周期整理（立即生效、随时可解钉；与 skill_manage 的 pin 动作同一语义，不走审批）' },
  { readonly: false, usage: 'skill unpin <name>', summary: '解钉一个技能：撤销上面的冻结（立即生效、不走审批）' },
  { readonly: true, usage: 'skills health', summary: '技能库结构体检' },
  { readonly: false, usage: 'skills refresh', summary: '丢弃目录缓存并重新读取技能树' },
  { readonly: false, usage: 'learn [request]', summary: '向本会话发一条学习请求' },
  { readonly: false, usage: 'maintain [--timeout=<ms> | --facts]', summary: '起一次维护扫描并立即回 run id（后台跑；--facts 为 0 token 预览）' },
  { readonly: true, usage: 'maintain status [<id>]', summary: '看维护扫描：在飞的那次（含已跑多久）或某个 run 的终态' },
  { readonly: true, usage: 'maintain report [<id>]', summary: '读某个 run 的结果正文（省略 id 取本 home 最新一条；没有结果就明说，不装成空结果）' },
  { readonly: false, usage: 'maintain handoff [<id>]', summary: '把某次维护报告交给模型：注入指针与汇报协议，模型只汇报、等你确认后再动手' },
  { readonly: false, usage: 'maintain cancel [<id>]', summary: '停掉在飞的那次维护扫描（省略 id 仅当最新一条是本进程在跑的那次）' },
  { readonly: false, usage: 'migrate', summary: '把旧设置文档里家族的旧分区迁进现在的行（幂等；已迁移过就报「已一致」）' },
  { readonly: false, usage: 'policy set <id> <value> [--expect <revision>]', summary: '通过设置服务写入一个你可改的参数 (E3 only; E1/E2 stay in cordis.yml)' },
  { readonly: true, usage: 'params [--group <name>] [--json]', summary: '列出全部参数：分组、档位、生效时机、来源与当前值（--json feeds scripts)' },
  { readonly: false, usage: 'preset install [--base <name>[,<name>...]]', summary: '把自进化 Agent 预设**行**写进当前 profile 的 patch 层（`profiles/<p>/cordis.patch.yml`；bases 来自 agent 包的 bases.json）' },
  { readonly: false, usage: 'restructure <name> "<heading>" <to_file> [--plan <runId>]', summary: '把技能正文的一节移到 references 文件' },
  { readonly: true, usage: 'replay', summary: '比较不同会话与重启之间的计划结果（从活动记录回填）' },
]

/** The input-declaration hint (single line, ` | `-separated). */
export function renderHint(): string {
  return COMMAND_ENTRIES.map(entry => entry.usage).join(' | ')
}

/** The bare `/evolution` help body (one line per subcommand). */
export function renderHelpText(): string {
  // First line first: the platform's command row collapses to the output's FIRST LINE, and a list
  // whose first line is a subcommand reads like that subcommand was what ran.
  return [`/evolution subcommands (${COMMAND_ENTRIES.length}):`, '', ...COMMAND_ENTRIES
    .map(entry => `  ${entry.usage.padEnd(44)} ${entry.summary}`)]
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
