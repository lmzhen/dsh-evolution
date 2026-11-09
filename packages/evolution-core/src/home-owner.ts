import { join } from 'node:path'
import type { EvolutionIoLike } from './io.ts'

interface OwnerRecord { pid: number; startedAt: string }

const OWNER_FILE = '.evolution-owner.json'

function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (error) {
    return (error as { code?: unknown }).code === 'EPERM'
  }
}

/** Fail loud when another live process already owns this DSH home. Single-host contract. */
export async function assertHomeOwner(io: EvolutionIoLike, home: string): Promise<void> {
  const path = join(home, OWNER_FILE)
  const raw = await io.readText(path)
  if (raw !== null) {
    let record: OwnerRecord
    try {
      const parsed = JSON.parse(raw) as Partial<OwnerRecord>
      if (typeof parsed.pid !== 'number' || typeof parsed.startedAt !== 'string') throw new Error('bad owner record')
      record = { pid: parsed.pid, startedAt: parsed.startedAt }
    } catch {
      throw new Error('evolution home owner record is unreadable; refusing a second owner (' + path + ')')
    }
    if (record.pid === process.pid) return
    if (isAlive(record.pid)) {
      throw new Error('evolution home is owned by another live process (pid ' + String(record.pid) + '); this deployment is single-host only')
    }
  }
  await io.writeText(path, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() } satisfies OwnerRecord))
}
