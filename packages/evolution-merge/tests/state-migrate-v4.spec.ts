// @tier fast
import { describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { nodeEvolutionIo } from '@deepseek-ai/dsh-evolution-core'
import { tempRoot } from '../../test-support/temp-home.ts'
import { migrateMergeStateToV4 } from '../src/domain/state-migrate.ts'
import { readV4Readiness } from '../src/domain/schema4.ts'
import { migrationJournalPath, readStateReadiness } from '../src/domain/state-bootstrap.ts'

const statePath = (home: string): string => join(home, 'merge', 'merge-state.json')

describe('merge state v4 migration', () => {
  it('migrates a legacy v2 state through the v3 gate', async () => {
    const home = await tempRoot('dsh-merge-v2-')
    await mkdir(join(home, 'merge'), { recursive: true })
    await writeFile(statePath(home), JSON.stringify({ schemaVersion: 2, rows: [] }) + '\n')
    const result = await migrateMergeStateToV4(nodeEvolutionIo(), home)
    expect(result.ok).toBe(true)
    expect(await readV4Readiness(nodeEvolutionIo(), home)).toMatchObject({ ok: true, schema: 4 })
  })

  it('repairs a v3 state whose v2 migration journal is still pending', async () => {
    const home = await tempRoot('dsh-merge-v3-journal-')
    await mkdir(join(home, 'merge'), { recursive: true })
    const raw = JSON.stringify({ schemaVersion: 3, rows: [] }) + '\n'
    await writeFile(statePath(home), raw)
    const sha = createHash('sha256').update(raw).digest('hex')
    await writeFile(migrationJournalPath(home), JSON.stringify({
      version: 1, sourceSha256: sha, targetSha256: sha, rows: 0, quarantine: [], staging: [], backupPath: statePath(home), at: new Date().toISOString(),
    }, null, 2) + '\n')
    const result = await migrateMergeStateToV4(nodeEvolutionIo(), home)
    expect(result.ok).toBe(true)
    expect(await readV4Readiness(nodeEvolutionIo(), home)).toMatchObject({ ok: true, schema: 4 })
  })

  it('reports an unreadable state file instead of treating it as empty', async () => {
    const home = await tempRoot('dsh-merge-unreadable-')
    await mkdir(statePath(home), { recursive: true })
    const io = nodeEvolutionIo()
    expect(await readStateReadiness(io, home)).toMatchObject({ ok: false, code: 'merge-state-needs-repair' })
    expect(await readV4Readiness(io, home)).toMatchObject({ ok: false, code: 'merge-state-needs-repair' })
  })
})
