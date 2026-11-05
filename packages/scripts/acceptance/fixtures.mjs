/**
 * G0 acceptance fixtures for the merge surface.
 *
 * These fixtures write only acceptance-home data (skills, usage, merge state);
 * they never touch production code or the platform. The pending row is a
 * legitimate v3 row that the host migrates on startup, so approve/reject can be
 * exercised without depending on an LLM pair verdict.
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const MANAGED_MARKER = '.hermes-managed'

/** FNV-1a 32, matching packages/evolution-merge/src/contracts.ts rowIdOf. */
export function rowIdOf(a, b) {
  const key = a < b ? a + '\u0000' + b : b + '\u0000' + a
  let hash = 0x811c9dc5
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return { key, id: 'mr_' + hash.toString(36).padStart(7, '0') }
}

/** Write one managed skill with a stable, non-trivial body. */
export async function writeManagedSkill(home, name, body) {
  const dir = join(home, 'skills', name)
  await mkdir(dir, { recursive: true })
  const text = body ?? '---\nname: ' + name + '\ndescription: G0 acceptance fixture for merge pending/approve/reject.\nwhenToUse: Use only in the G0 acceptance profile.\nversion: 0.1.0\nauthor: Hermes\n---\n\n# ' + name + '\n\nAcceptance fixture for merge pending/approve/reject.\n'
  await writeFile(join(dir, 'SKILL.md'), text)
  await writeFile(join(dir, MANAGED_MARKER), '')
  const hash = createHash('sha256').update(text).digest('hex')
  const historyRoot = join(home, 'skills', '.history')
  await mkdir(join(historyRoot, 'blobs'), { recursive: true })
  await writeFile(join(historyRoot, 'blobs', hash), text)
  const versionDir = join(historyRoot, 'skills', name)
  await mkdir(versionDir, { recursive: true })
  const at = new Date().toISOString()
  await writeFile(join(versionDir, 'index.json'), JSON.stringify({
    version: 1,
    versions: [{
      unitId: 'g0-fixture:' + name,
      unitHead: { runId: 'g0-fixture', baseline: true, moves: [], sources: [{ skill: name }] },
      v: 1,
      at,
      action: 'create',
      hash,
      chars: text.length,
    }],
  }, null, 2) + '\n')
  const usagePath = join(home, 'skills', '.usage.json')
  let map = {}
  try { map = JSON.parse(await readFile(usagePath, 'utf8')) } catch {}
  if (map[name] === undefined) {
    map[name] = {
      created_by: null, use_count: 0, view_count: 0, patch_count: 0,
      last_used_at: null, last_viewed_at: null, last_patched_at: null,
      created_at: new Date().toISOString(), state: 'active', pinned: false, archived_at: null,
    }
    await writeFile(usagePath, JSON.stringify(map, null, 2) + '\n')
  }
}

/** Write both sides of a managed pair. */
export async function seedManagedPair(home, a, b) {
  await writeManagedSkill(home, a)
  await writeManagedSkill(home, b)
  return { a, b }
}

/**
 * Seed a legitimate v3 pending row. Fails instead of overwriting an existing
 * v4 state: callers must use a clean acceptance profile.
 */
export async function seedPendingMerge(home, { a, b, target = a, now = new Date().toISOString() }) {
  await seedManagedPair(home, a, b)
  const { key, id } = rowIdOf(a, b)
  const statePath = join(home, 'evolution', 'merge', 'merge-state.json')
  await mkdir(join(home, 'evolution', 'merge'), { recursive: true })
  let raw = null
  try { raw = await readFile(statePath, 'utf8') } catch {}
  if (raw !== null) {
    const parsed = JSON.parse(raw)
    if (parsed.schemaVersion !== 3) throw new Error('seedPendingMerge: existing state is schema ' + String(parsed.schemaVersion) + '; use a clean acceptance profile')
  }
  const row = {
    id,
    pairKey: key,
    a,
    b,
    target,
    decision: {
      shouldMerge: true,
      mode: 'merge-into-existing',
      target,
      sources: [target, target === a ? b : a],
      rationale: 'G0 acceptance fixture: pending row for real approve/reject.',
    },
    state: 'pending',
    attempts: 0,
    version: 1,
    createdAt: now,
    updatedAt: now,
    origin: 'agent',
  }
  const previous = raw === null ? [] : (JSON.parse(raw).rows ?? [])
  await writeFile(statePath, JSON.stringify({ schemaVersion: 3, rows: [...previous.filter(item => item.pairKey !== key), row] }, null, 2) + '\n')
  return { id, key, row }
}

/** Write an archived skill marker plus a real usage archived_at. */
export async function seedArchivedUsage(home, name, archivedAt, reason = 'G0 acceptance fixture archive') {
  const archiveDir = join(home, 'skills', '.archive', name)
  await mkdir(archiveDir, { recursive: true })
  await writeFile(join(archiveDir, '.archive-name'), name + '\n')
  await writeFile(join(archiveDir, '.archive-reason'), reason + '\n')
  const usagePath = join(home, 'skills', '.usage.json')
  let map = {}
  try { map = JSON.parse(await readFile(usagePath, 'utf8')) } catch {}
  map[name] = {
    created_by: null, use_count: 0, view_count: 0, patch_count: 0,
    last_used_at: null, last_viewed_at: null, last_patched_at: null,
    created_at: archivedAt, state: 'archived', pinned: false, archived_at: archivedAt,
  }
  await writeFile(usagePath, JSON.stringify(map, null, 2) + '\n')
  return { name, archivedAt }
}

function arg(name, fallback) {
  const index = process.argv.indexOf('--' + name)
  return index < 0 ? fallback : process.argv[index + 1]
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const home = arg('home')
  const a = arg('a', 'g0-merge-a')
  const b = arg('b', 'g0-merge-b')
  const target = arg('target', a)
  if (home === undefined) { console.error('usage: node fixtures.mjs --home <home> [--a name] [--b name] [--target name]'); process.exit(2) }
  const result = await seedPendingMerge(home, { a, b, target })
  console.log(JSON.stringify({ home, ...result }))
}
