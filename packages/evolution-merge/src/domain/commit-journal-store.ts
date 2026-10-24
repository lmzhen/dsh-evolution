/** Durable commit journal: <home>/merge/journals/<run>.json. */
import { join } from 'node:path'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'
import type { CommitJournal } from './commit-journal.ts'

export function journalPath(home: string, runId: string): string {
  return join(home, 'merge', 'journals', runId.replace(/[^A-Za-z0-9_-]+/g, '_') + '.json')
}

export async function writeJournal(io: EvolutionIoLike, home: string, journal: CommitJournal): Promise<string> {
  const path = journalPath(home, journal.runId)
  const content = JSON.stringify(journal, null, 2)
  if (io.transact !== undefined) await io.transact(path, () => content)
  else await io.writeText(path, content)
  return path
}

export async function readJournal(io: EvolutionIoLike, home: string, runId: string): Promise<CommitJournal | null> {
  const raw = await io.readText(journalPath(home, runId))
  if (raw === null) return null
  try { return JSON.parse(raw) as CommitJournal } catch { return null }
}
