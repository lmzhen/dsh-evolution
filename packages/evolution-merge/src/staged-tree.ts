/**
 * Read the merged tree a child wrote into a staging run.
 *
 * The tree is the commit source: SKILL.md is the body, every other file is a support file.
 * A missing SKILL.md is unknown, never an empty merge; the caller then refuses commit.
 */
import { join } from 'node:path'
import {
  probeUnknown,
  type EvolutionIoLike,
  type Probe,
} from '@deepseek-ai/dsh-evolution-core'
import type { StagedTree } from './rules.ts'
import { readStaging, stagingRoot } from './staging.ts'

function safeRelative(path: string): boolean {
  if (path === '' || path.startsWith('/') || path.startsWith('\\') || path.includes('\0')) return false
  return path.replace(/\\/g, '/').split('/').every(part => part !== '' && part !== '.' && part !== '..')
}

async function walkFiles(io: EvolutionIoLike, root: string, rel = ''): Promise<string[]> {
  const abs = rel === '' ? root : join(root, ...rel.split('/'))
  try {
    const text = await io.readText(abs)
    if (text !== null) return [rel]
  } catch { /* a directory read throws; fall through to list */ }
  let entries: string[]
  try {
    entries = await io.list(abs)
  } catch {
    return []
  }
  const out: string[] = []
  for (const entry of entries) {
    if (entry === '' || entry === '.' || entry === '..') continue
    const child = rel === '' ? entry : rel + '/' + entry
    if (!safeRelative(child)) continue
    out.push(...await walkFiles(io, root, child))
  }
  return out
}

export async function readStagedTree(io: EvolutionIoLike, home: string, runId: string): Promise<Probe<StagedTree>> {
  const staging = await readStaging(io, home, runId)
  if (!staging || staging.kind === 'absent') return { kind: 'absent' }
  if (staging.kind === 'unknown') return probeUnknown(staging.reason)
  const target = staging.value.manifest.target
  const root = join(stagingRoot(home, runId), 'merged', target)
  let paths: string[]
  try {
    paths = await walkFiles(io, root)
  } catch (error) {
    return probeUnknown('cannot list merged tree: ' + (error instanceof Error ? error.message : String(error)))
  }
  if (!paths.includes('SKILL.md')) return probeUnknown('merged tree has no SKILL.md')
  const files: { path: string; content: string }[] = []
  for (const path of paths.sort()) {
    if (path === 'SKILL.md') continue
    try {
      const content = await io.readText(join(root, ...path.split('/')))
      if (content === null) return probeUnknown('merged file disappeared: ' + path)
      files.push({ path, content })
    } catch (error) {
      return probeUnknown('cannot read merged file ' + path + ': ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  const body = await io.readText(join(root, 'SKILL.md'))
  if (body === null) return probeUnknown('merged SKILL.md disappeared')
  return { kind: 'present', value: { target, body, files } }
}
