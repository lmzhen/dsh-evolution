import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve } from 'node:path'
import { externalRefs } from './support-refs.ts'
import type { ExternalSupportFile } from './extract-plan.ts'

const MAX_FILE_BYTES = 1024 * 1024
const MAX_TOTAL_BYTES = 4 * 1024 * 1024

function targetPathFor(ref: string): string {
  let value = ref.replace(/^\/+/, '')
  while (value.startsWith('../')) value = value.slice(3)
  const support = value.match(/(?:^|\/)(references|templates|scripts|assets)\/(.+)$/)
  if (support !== null) return support[1] + '/' + support[2]
  return 'references/' + basename(value)
}

function annotate(content: string, originalPath: string): string {
  const note = 'external source: ' + originalPath
  const extension = originalPath.slice(originalPath.lastIndexOf('.')).toLowerCase()
  if (extension === '.md') return '<!-- ' + note + ' -->' + String.fromCharCode(10) + String.fromCharCode(10) + content
  const prefix = extension === '.py' || extension === '.sh' || extension === '.rb' ? '# ' : '// '
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs' || extension === '.ts' || extension === '.tsx' || extension === '.py' || extension === '.sh' || extension === '.rb') {
    if (content.startsWith('#!')) {
      const end = content.indexOf(String.fromCharCode(10))
      if (end >= 0) return content.slice(0, end + 1) + prefix + note + String.fromCharCode(10) + content.slice(end + 1)
    }
    return prefix + note + String.fromCharCode(10) + content
  }
  return content
}

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Read and annotate external support files under one explicit root. The caller owns
 * the root choice; this module only enforces containment, target-path safety, size
 * limits and determinism.
 * @param body - selected source markdown body.
 * @param sourceDir - source skill directory.
 * @param allowedRoot - canonical root external files must stay under.
 * @param targetFiles - existing target support paths.
 * @returns resolved external entries, or a refusal.
 */
export async function readExternalSupport(
  body: string,
  sourceDir: string,
  allowedRoot: string,
  targetFiles: readonly string[],
): Promise<{ ok: true; files: ExternalSupportFile[] } | { ok: false; message: string }> {
  const refs = externalRefs(body)
  if (refs.length === 0) return { ok: true, files: [] }
  let root: string
  try {
    root = await realpath(allowedRoot)
  } catch {
    return { ok: false, message: 'external support 根目录不可读：' + allowedRoot }
  }
  const files: ExternalSupportFile[] = []
  const targets = new Set(targetFiles)
  let total = 0
  for (const ref of refs) {
    const candidate = isAbsolute(ref) ? resolve(ref) : resolve(sourceDir, ref)
    let canonical: string
    try {
      canonical = await realpath(candidate)
    } catch {
      return { ok: false, message: 'external support 文件不存在：' + ref }
    }
    if (!inside(root, canonical)) return { ok: false, message: 'external support 越界：' + ref }
    const info = await stat(canonical)
    if (!info.isFile()) return { ok: false, message: 'external support 不是普通文件：' + ref }
    if (info.size > MAX_FILE_BYTES) return { ok: false, message: 'external support 超过单文件上限：' + ref }
    total += info.size
    if (total > MAX_TOTAL_BYTES) return { ok: false, message: 'external support 超过总上限：' + ref }
    const targetPath = targetPathFor(ref)
    if (targets.has(targetPath)) return { ok: false, message: 'external support 目标冲突：' + targetPath }
    targets.add(targetPath)
    const raw = await readFile(canonical, 'utf8')
    const annotated = annotate(raw, canonical)
    files.push({
      ref,
      originalPath: canonical,
      targetPath,
      content: annotated,
      sha256: createHash('sha256').update(annotated).digest('hex'),
      provenance: 'external:' + canonical,
    })
  }
  return { ok: true, files }
}
