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