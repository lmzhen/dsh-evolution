/**
 * verify-graph-edges — P0′ 门禁：技能"参见边"的解析、悬空与扫描面检查。
 *
 * 三态退出码（家法：run-gates 把任何非零折成 FAIL）：
 *   0 = 有 skill 工具的面上 边>0 且悬空=0（观测期用 --report ⇒ 恒 0，只打印读数）
 *   1 = 悬空 / 自指 / 形态非法
 *   2 = CANNOT DECIDE（边=0、技能根缺失、快照不完整 ⇒ 不给数字）
 *
 * 扫描面 = 共享谓词 evolution-core/src/skill-discovery.ts（R21/R69：门禁与图谱同一实现）。
 * 读端 = evolution-core/src/frontmatter.ts 的 relatedSkillNames（与运行时同源），
 * import 失败时退回文本扫描并在读数里标 reader=text-fallback（R14：测量通道必须声明）。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const FAMILY_ROOT = resolve(HERE, '..')
const CORE_SRC = join(FAMILY_ROOT, 'evolution-core', 'src')

let importError = null
async function loadModule(name) {
  try { return await import(pathToFileURL(join(CORE_SRC, name)).href) } catch (error) {
    importError = String((error && error.code) || '') + ' ' + String((error && error.message) || error)
    return null
  }
}
const discovery = await loadModule('skill-discovery.ts')
const frontmatter = await loadModule('frontmatter.ts')
if (!discovery) {
  console.error('verify-graph-edges: 无法加载 evolution-core/src/skill-discovery.ts（扫描谓词缺失 ⇒ CANNOT DECIDE）')
  process.exit(2)
}

const FACES = [
  { face: 'desktop', root: join(process.env.USERPROFILE || '', '.dsh', 'skills'), hasSkillTool: true },
  { face: 'web', root: 'D:/dsh-homes/web/skills', hasSkillTool: false },
]

function parseArgs(argv) {
  const out = { report: false, selfTest: false, json: false, roots: null, planned: null }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--report') out.report = true
    else if (a === '--self-test') out.selfTest = true
    else if (a === '--json') out.json = true
    else if (a === '--roots' && argv[i + 1]) { out.roots = argv[i + 1].split(',').map((s) => s.trim()).filter(Boolean); i += 1 }
    else if (a === '--planned' && argv[i + 1]) { out.planned = argv[i + 1]; i += 1 }
  }
  return out
}

/** E16: the catalog shows a folded, trimmed, CAPPED description — that string is what every
 * request pays for. The cap is the platform's `catalogDescriptionMaxLength` (60 today). */
const CATALOG_DESCRIPTION_CAP = 60
function foldedDescription(text, describe, cap = CATALOG_DESCRIPTION_CAP) {
  const folded = String(describe(text) ?? '').replace(/\s+/g, ' ').trim()
  return Math.min(folded.length, cap)
}

/** E16 planned channel: the catalog rows a planned change WOULD add, in the row form the
 * platform publishes (`- \`name\`: description`), folded and capped exactly like the live ones. */
function plannedResidentChars(file) {
  let rows = []
  // A BOM is legal in a file a person wrote with an editor or PowerShell: strip it before parsing,
  // otherwise a perfectly good planned table silently reads as "no planned rows" (red on the ledger).
  try { rows = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) } catch { return null }
  if (!Array.isArray(rows)) return null
  let sum = 0
  for (const row of rows) {
    const name = String(row?.name ?? '')
    const line = '- `' + name + '`: ' + String(row?.description ?? '')
    sum += Math.min(line.replace(/\s+/g, ' ').trim().length, CATALOG_DESCRIPTION_CAP)
  }
  return sum
}

function makeReader() {
  if (frontmatter && typeof frontmatter.relatedSkillNames === 'function') {
    return {
      reader: 'src-import',
      declared: (c) => frontmatter.relatedSkillNames(c),
      describe: (c) => (typeof frontmatter.parseFrontmatter === 'function' ? frontmatter.parseFrontmatter(c)?.frontmatter?.description : ''),
    }
  }
  return { reader: 'unavailable', declared: () => [], describe: () => '' }
}

function evaluate(faces) {
  const { reader, declared, describe } = makeReader()
  // E16 planned channel: what a PLANNED change would add to the catalog (status=planned), so the
  // cost of P2a is on the same ledger as the live resident bytes instead of invisible.
  const plannedFile = parseArgs(process.argv.slice(2)).planned
  const plannedChars = plannedFile === null ? null : plannedResidentChars(plannedFile)
  const scan = faces.map((f) => ({ ...f, skills: discovery.discoverSkillFiles(f.root), missing: !existsSync(f.root) }))
  const known = new Set()
  for (const s of scan) for (const k of s.skills) known.add(k.name)
  let edges = 0, dangling = 0, selfRef = 0, declaring = 0, skills = 0, skippedFaces = 0, facesWithTool = 0
  const unresolved = []
  for (const s of scan) {
    if (s.hasSkillTool && !s.missing) facesWithTool += 1
    if (s.missing) { skippedFaces += 1; continue }
    skills += s.skills.length
    s.edges = 0
    s.dangling = 0
    s.residentChars = 0
    for (const sk of s.skills) {
      let names = []
      let text = ''
      try { text = readFileSync(sk.path, 'utf8'); names = declared(text) } catch { continue }
      s.residentChars += foldedDescription(text, describe)
      if (names.length) declaring += 1
      for (const n of names) {
        edges += 1
        s.edges += 1
        if (n === sk.name) { selfRef += 1; continue }
        if (!known.has(n)) { dangling += 1; s.dangling += 1; if (!unresolved.includes(n)) unresolved.push(n) }
      }
    }
  }
  let exit = 0
  let reason = 'ok'
  if (reader !== 'src-import') { exit = 2; reason = 'reader-unavailable' }
  else if (edges === 0 || skills === 0) { exit = 2; reason = 'no-edges' }
  else if (dangling > 0 || selfRef > 0) { exit = 1; reason = selfRef > 0 ? 'self-ref' : 'dangling' }
  else if (facesWithTool === 0) { exit = 2; reason = 'no-face-with-tool' }
  return { reader, importError, scan, skills, declaring, edges, dangling, selfRef, unresolved, skippedFaces, facesWithTool, exit, reason, channel: 'src', plannedChars }
}

function jsonOf(result) {
  const primary = result.scan.find((s) => s.hasSkillTool && !s.missing) || result.scan[0] || { root: '', skills: [], face: 'none' }
  const decided = result.reader === 'src-import'
  return {
    root: primary.root,
    recursive: false,
    maxDepth: 2,
    ignoredDirs: ['.archive', '.backups', '._*', '.history'],
    skills: result.skills,
    declaring: decided ? result.declaring : null,
    edges: decided ? result.edges : null,
    dangling: decided ? result.dangling : null,
    unresolved: decided ? result.unresolved : null,
    face: primary.face || 'none',
    reason: result.reason,
    detail: result.reader === 'src-import' ? undefined : 'cannot import evolution-core/src/frontmatter.ts: ' + String(result.importError),
    faceAggregate: 'all',
    exit: result.exit,
    reader: result.reader,
    channel: result.channel,
    faces: result.scan.map((s) => ({ face: s.face, root: s.root, hasSkillTool: s.hasSkillTool, skills: s.skills.length, edges: decided ? s.edges : null, dangling: decided ? s.dangling : null, residentChars: decided ? (s.residentChars ?? 0) : null })),
    residentChars: decided ? result.scan.reduce((sum, s) => sum + (s.residentChars ?? 0), 0) : null,
    residentStatus: decided ? { live: result.scan.reduce((sum, s) => sum + (s.residentChars ?? 0), 0), planned: result.plannedChars } : null,
    plannedChars: decided ? result.plannedChars : null,
  }
}

function humanLine(result) {
  const j = jsonOf(result)
  const na = (v) => (v === null || v === undefined ? 'n/a' : String(v))
  const parts = ['skills=' + j.skills, 'declaring=' + na(j.declaring), 'edges=' + na(j.edges), 'dangling=' + na(j.dangling), 'residentChars=' + na(j.residentChars), 'residentPlanned=' + na(j.plannedChars)]
  parts.push('self=' + result.selfRef, 'invisible=0', 'face=' + j.face, 'visibility=' + (result.facesWithTool ? 'model' : 'CANNOT DECIDE'))
  parts.push('roots=' + j.faces.length, 'depth=2', 'ignore=.archive,.backups,._*', 'reader=' + result.reader, 'exit=' + j.exit)
  return parts.join(' ') + (Array.isArray(j.unresolved) && j.unresolved.length ? ' unresolved=' + j.unresolved.join(',') : '') + (j.reason ? ' reason=' + j.reason : '')
}

function selfTest() {
  const fails = []
  const assert = (ok, msg) => { if (!ok) fails.push(msg) }
  assert(discovery.isSkillName('good-name'), 'kebab-case 接受')
  assert(!discovery.isSkillName('Bad_Name'), 'Bad_Name 必须不被接受（名字文法）')
  assert(!discovery.isSkillName('._x'), '._x 必须不被接受（点前缀）')
  assert(discovery.isPotentialSkillPath('good-name/SKILL.md'), 'depth 2 的 SKILL.md 是候选路径')
  assert(!discovery.isPotentialSkillPath('.backups/snap/good-name/SKILL.md'), 'depth 3 不是候选路径')
  const dir = join(tmpdir(), 'vge-selftest-' + String(process.pid))
  rmSync(dir, { recursive: true, force: true })
  for (const p of ['live-skill/SKILL.md', 'Bad_Name/SKILL.md', '._x/SKILL.md', '.backups/snap/live-skill/SKILL.md', '.archive/old-skill/SKILL.md']) {
    const f = join(dir, p)
    mkdirSync(dirname(f), { recursive: true })
    writeFileSync(f, '---\nname: x\ndescription: d\n---\nbody\n')
  }
  const found = discovery.discoverSkillFiles(dir).map((s) => s.name)
  // ④ F-archive-copy（R88）：忽略目录里的边既不计入也不算悬空；且不是一刀切忽略。
  const dir2 = join(tmpdir(), 'vge-archive-copy-' + String(process.pid))
  rmSync(dir2, { recursive: true, force: true })
  const mk = (p, body) => { const f = join(dir2, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, body) }
  mk('live-a/SKILL.md', '---\nname: live-a\ndescription: d\nmetadata:\n  hermes:\n    related_skills: [live-b]\n---\nbody\n')
  mk('live-b/SKILL.md', '---\nname: live-b\ndescription: d\n---\nbody\n')
  mk('.archive/old-b/SKILL.md', '---\nname: old-b\ndescription: d\nmetadata:\n  hermes:\n    related_skills: [live-a]\n---\nbody\n')
  mk('.backups/snap/c/SKILL.md', '---\nname: c\ndescription: d\nmetadata:\n  hermes:\n    related_skills: [live-a]\n---\nbody\n')
  let s2 = discovery.discoverSkillFiles(dir2).map((x) => x.name)
  assert(s2.length === 2 && s2[0] === 'live-a' && s2[1] === 'live-b', 'F-archive-copy 第一向：忽略目录不进扫描面（scanned==2）')
  mk('old-b/SKILL.md', '---\nname: old-b\ndescription: d\n---\nbody\n')
  mk('copy-of-archive/old-b/SKILL.md', '---\nname: old-b\ndescription: d\n---\nbody\n')
  s2 = discovery.discoverSkillFiles(dir2).map((x) => x.name)
  assert(s2.length === 3 && s2.includes('old-b'), 'F-archive-copy 第二向：2 段复制必须被发现（证明不是一刀切忽略）')
  rmSync(dir2, { recursive: true, force: true })
  assert(found.length === 1 && found[0] === 'live-skill', '扫描面只认 live-skill（Bad_Name/._x/.backups/.archive 都不算）')
  rmSync(dir, { recursive: true, force: true })
  const zh = '中文语料'
  assert(Buffer.byteLength(zh, 'utf8') !== zh.length, '中文语料下 bytes != chars')
  assert(!(zh.length === Buffer.byteLength(zh, 'utf8')), '反例：写成 s.length === size 必须失败')
  assert(Buffer.byteLength('x', 'utf8') === 1, '字节断言基线')
  // R86/R100/R105：入口必须有输出 —— 空输出 + exit 0 是「绿而无判」，exit 码本身不能证明跑过。
  const emptyRun = humanLine(evaluate([]))
  assert(emptyRun.length > 0, '输出必须非空（空输出 + exit 0 ⇒ 红）')
  assert(emptyRun.includes('face=') && emptyRun.includes('exit='), '人类行必须含 face= 与 exit=')
  assert(emptyRun.includes('reason='), '人类行必须含 reason=')
  // E16：目录常驻账的计量口径（折叠空白＋trim，再按该面上限截断）本身要有判据。
  assert(foldedDescription('x', () => '  a  b\nc  ', 60) === 5, 'E16：折叠空白＋trim 后计数（a b c = 5）')
  assert(foldedDescription('x', () => 'y'.repeat(100), 60) === 60, 'E16：超过上限必须截断到上限')
  if (fails.length) { console.error('SELF-TEST FAILED:\n  ' + fails.join('\n  ')); return 1 }
  console.log('SELF-TEST OK (10 fixtures)')
  return 0
}

const args = parseArgs(process.argv.slice(2))
if (args.selfTest) process.exit(selfTest())
const faces = args.roots ? args.roots.map((r) => ({ face: r, root: r, hasSkillTool: true })) : FACES
const result = evaluate(faces)
if (args.json) console.log(JSON.stringify(jsonOf(result), null, 2))
else console.log(humanLine(result))
process.exit(args.report ? 0 : result.exit)