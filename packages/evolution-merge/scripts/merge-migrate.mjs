#!/usr/bin/env node
/**
 * One-time merge state migration: v1/v2 -> v3 -> v4, with a home-level lock.
 *
 * The runtime used to do v2->v3 on mount and v3->v4 on the first write. That left the old
 * readers in the hot path and gave an operator no backup/dry-run/restore story. This CLI is
 * the explicit entry: it reuses the SAME domain migrations (ensureMergeStateReady and
 * normalizePairLedger), so it cannot drift from the runtime.
 *
 * Usage:
 *   merge-migrate --home <dir> [--dry-run] [--apply] [--restore <backup-dir>] [--json]
 *
 * Stop every host that has this home open before --apply/--restore: the lock only serializes
 * this CLI, not a mounted plugin.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const value = (flag) => {
  const index = argv.indexOf(flag)
  return index >= 0 ? argv[index + 1] : undefined
}
const homeArg = value('--home')
if (homeArg === undefined || homeArg === '') {
  console.error('usage: merge-migrate --home <dir> [--dry-run] [--apply] [--restore <backup-dir>] [--json]')
  process.exit(2)
}
const home = resolve(homeArg)
const dryRun = argv.includes('--dry-run') || (!argv.includes('--apply') && !argv.includes('--restore'))
const apply = argv.includes('--apply')
const restore = value('--restore')
const asJson = argv.includes('--json')
const lockDir = join(home, 'merge', '.migrate-lock')
const LOCK_TTL_MS = 60 * 60 * 1000

function pidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

function acquireLock() {
  mkdirSync(join(home, 'merge'), { recursive: true })
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      mkdirSync(lockDir)
      writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({ pid: process.pid, at: new Date().toISOString() }) + '\n')
      return
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      let owner = null
      try { owner = JSON.parse(readFileSync(join(lockDir, 'owner.json'), 'utf8')) } catch { /* stale/incomplete */ }
      const age = Date.now() - statSync(lockDir).mtimeMs
      if (owner !== null && pidAlive(owner.pid) && age < LOCK_TTL_MS) {
        const failure = { ok: false, code: 'migration-locked', message: 'another process owns ' + lockDir + ' (pid ' + String(owner.pid) + ')' }
        if (asJson) console.log(JSON.stringify(failure, null, 2))
        else console.error('merge-migrate: ' + failure.message)
        process.exit(3)
      }
      rmSync(lockDir, { recursive: true, force: true })
    }
  }
  throw new Error('could not acquire ' + lockDir)
}

if (restore !== undefined && restore !== '') {
  if (dryRun && !apply) {
    const report = { ok: true, dryRun: true, restore }
    if (asJson) console.log(JSON.stringify(report, null, 2))
    else console.log('DRY RUN: would restore ' + restore + ' into ' + home + ' (stop the host first)')
    process.exit(0)
  }
  const result = spawnSync(process.execPath, [join(scriptDir, 'merge-restore.mjs'), '--home', home, '--backup', restore], { stdio: 'inherit' })
  process.exit(result.status ?? 1)
}

const core = await import('@deepseek-ai/dsh-evolution-core')
const io = core.nodeEvolutionIo()
const { readStateReadiness } = await import('../lib/types/domain/state-bootstrap.js')
const { migrateMergeStateToV4 } = await import('../lib/types/domain/state-migrate.js')
const { readV4Readiness } = await import('../lib/types/domain/schema4.js')

async function inspect() {
  let raw = null
  try { raw = await io.readText(join(home, 'merge', 'merge-state.json')) } catch { /* unreadable is reported below */ }
  let schema = null
  let rows = 0
  try {
    const parsed = raw === null ? null : JSON.parse(raw)
    schema = parsed?.schemaVersion ?? null
    rows = Array.isArray(parsed?.rows) ? parsed.rows.length : 0
  } catch { /* malformed is a blocker */ }
  const v4 = await readV4Readiness(io, home)
  const v3 = await readStateReadiness(io, home)
  return {
    home,
    state: { present: raw !== null, schema, rows },
    v4: v4.ok ? { ok: true, rows: v4.state.rows.length } : { ok: false, code: v4.code, message: v4.message },
    v3: v3.ok ? { ok: true, rows: v3.state.rows.length } : { ok: false, code: v3.code, message: v3.message },
  }
}

if (dryRun && !apply) {
  const report = { ok: true, dryRun: true, ...await inspect() }
  if (asJson) console.log(JSON.stringify(report, null, 2))
  else console.log('DRY RUN ' + JSON.stringify(report.state) + ' v4=' + JSON.stringify(report.v4) + ' v3=' + JSON.stringify(report.v3))
  process.exit(0)
}

acquireLock()
let exitCode = 0
try {
  const before = await inspect()
  if (before.state.schema === 4 && before.v4.ok) {
    const report = { ok: true, applied: false, reason: 'already-v4', before }
    if (asJson) console.log(JSON.stringify(report, null, 2))
    else console.log('MIGRATE OK already v4 rows=' + String(before.v4.rows))
  } else {
    const backupDir = value('--backup') ?? join(home, 'merge', '.backup', 'pre-migrate-' + new Date().toISOString().replace(/[:.]/g, '-'))
    const quiesce = join(home, 'merge', '.migrate-quiesce.json')
    writeFileSync(quiesce, JSON.stringify({ stopped: true, at: new Date().toISOString() }) + '\n')
    try {
      const backedUp = spawnSync(process.execPath, [join(scriptDir, 'merge-backup.mjs'), '--home', home, '--out', backupDir, '--quiesce', quiesce], { stdio: 'inherit' })
      if (backedUp.status !== 0) throw new Error('backup failed with exit ' + String(backedUp.status))
    } finally {
      rmSync(quiesce, { force: true })
    }
    const migration = await migrateMergeStateToV4(io, home)
    if (!migration.ok) throw new Error(migration.code + ': ' + migration.message)
    const after = await inspect()
    if (!after.v4.ok) throw new Error(after.v4.code + ': ' + after.v4.message)
    const report = { ok: true, applied: true, migrated: migration.migrated, backupRef: migration.backupRef, backupDir, before, after }
    if (asJson) console.log(JSON.stringify(report, null, 2))
    else console.log('MIGRATE OK v2/v3 -> v4 rows=' + String(after.v4.rows) + ' backup=' + backupDir + (migration.backupRef === undefined ? '' : ' pre1b=' + migration.backupRef))
  }
} catch (error) {
  const failure = { ok: false, code: 'migration-failed', message: error instanceof Error ? error.message : String(error) }
  if (asJson) console.log(JSON.stringify(failure, null, 2))
  else console.error('merge-migrate: ' + failure.message)
  exitCode = 1
} finally {
  rmSync(lockDir, { recursive: true, force: true })
}
process.exit(exitCode)
