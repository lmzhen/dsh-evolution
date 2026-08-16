import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { randomBytes } from 'node:crypto'

export type PendingKind = 'memory' | 'skill' | 'skill_batch'

export interface PendingRecord {
  id: string
  kind: PendingKind
  summary: string
  args: unknown
  createdAt: string
  status: 'pending' | 'approved' | 'rejected'
  resolvedAt?: string
}

function root(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.DSH_HOME ?? join(homedir(), '.dsh'), 'evolution')
}

function file(env: NodeJS.ProcessEnv = process.env): string {
  return join(root(env), 'pending.json')
}

export class PendingStore {
  private records: PendingRecord[] = []
  private readonly path: string

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.path = file(env)
    this.loadSync()
  }

  private loadSync(): void {
    // Deliberate sync read at startup: this small store must be ready before
    // the first tool call. All later mutations are async and atomic.
    try {

      const raw = readFileSync(this.path, 'utf8')
      const parsed = JSON.parse(raw) as PendingRecord[]
      this.records = Array.isArray(parsed) ? parsed : []
    } catch {
      this.records = []
    }
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
    await writeFile(tmp, JSON.stringify(this.records, null, 2), 'utf8')
    await rename(tmp, this.path)
  }

  list(status: 'pending' | 'approved' | 'rejected' = 'pending'): PendingRecord[] {
    return this.records.filter(record => record.status === status)
  }

  async stage(kind: PendingKind, summary: string, args: unknown): Promise<PendingRecord> {
    const record: PendingRecord = {
      id: randomBytes(8).toString('hex'),
      kind,
      summary,
      args,
      createdAt: new Date().toISOString(),
      status: 'pending',
    }
    this.records.push(record)
    await this.save()
    return record
  }

  async resolve(id: string, status: 'approved' | 'rejected'): Promise<PendingRecord | null> {
    const record = this.records.find(item => item.id === id && item.status === 'pending')
    if (!record) return null
    record.status = status
    record.resolvedAt = new Date().toISOString()
    await this.save()
    return record
  }

  async remove(id: string): Promise<void> {
    this.records = this.records.filter(item => item.id !== id)
    await this.save()
  }

  async clear(): Promise<void> {
    this.records = []
    try {
      await unlink(this.path)
    } catch {
      // Missing file is already clear.
    }
  }
}
