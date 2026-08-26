/**
 * File-backed durable memory with Hermes-compatible semantics.
 * Stores are MEMORY.md and USER.md under $DSH_HOME/memories (~/.dsh/memories).
 */

import { join } from 'node:path'
import { homedir } from 'node:os'
import { nodeEvolutionIo, type EvolutionIoLike } from './io.ts'
import { scanMemoryThreats } from './threats.ts'
import { ENTRY_DELIMITER } from './constants.ts'

export { ENTRY_DELIMITER } from './constants.ts'

export type MemoryTarget = 'memory' | 'user'

export interface MemoryOperation {
  action: 'add' | 'replace' | 'remove'
  facts?: string | undefined
  old_text?: string | undefined
}

export interface MemoryApplyResult {
  ok: boolean
  message: string
  entries: string[]
  chars: number
  limit: number
}

export function memoryRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.DSH_HOME ?? join(homedir(), '.dsh'), 'memories')
}

function fileFor(root: string, target: MemoryTarget): string {
  return join(root, target === 'memory' ? 'MEMORY.md' : 'USER.md')
}

function normalizeEntries(raw: string): string[] {
  return raw.split(ENTRY_DELIMITER).map(entry => entry.trim()).filter(Boolean)
}

function render(entries: string[]): string {
  return entries.join(ENTRY_DELIMITER) + '\n'
}

function stripDatePrefix(entry: string): string {
  return entry.replace(/^## \d{4}-\d{2}-\d{2}\n/, '')
}

export interface MemoryStoreOptions {
  memoryCharLimit?: number
  userCharLimit?: number
  addDatePrefix?: boolean
  root?: string
  maxConsolidationFailures?: number
  io?: EvolutionIoLike
}

export type { EvolutionIoLike }

export class MemoryStore {
  readonly memoryLimit: number
  readonly userLimit: number
  readonly addDatePrefix: boolean
  readonly root: string
  private readonly maxFailures: number
  private readonly io: EvolutionIoLike
  private failureCount = 0

  constructor(options: MemoryStoreOptions = {}) {
    this.io = options.io ?? nodeEvolutionIo()
    this.memoryLimit = options.memoryCharLimit ?? 2200
    this.userLimit = options.userCharLimit ?? 1375
    this.addDatePrefix = options.addDatePrefix ?? false
    this.root = options.root ?? memoryRoot()
    this.maxFailures = options.maxConsolidationFailures ?? 3
  }

  limitFor(target: MemoryTarget): number {
    return target === 'memory' ? this.memoryLimit : this.userLimit
  }

  async read(target: MemoryTarget): Promise<string[]> {
    const raw = await this.io.readText(fileFor(this.root, target))
    return raw === null ? [] : [...new Set(normalizeEntries(raw))]
  }

  async write(target: MemoryTarget, entries: string[]): Promise<void> {
    await this.io.writeText(fileFor(this.root, target), render(entries))
  }

  resetFailures(): void {
    this.failureCount = 0
  }

  private failure(target: MemoryTarget, message: string, entries: string[]): MemoryApplyResult {
    this.failureCount += 1
    const chars = entries.join(ENTRY_DELIMITER).length
    if (this.failureCount > this.maxFailures) {
      return {
        ok: false,
        message: `Memory consolidation failed ${this.failureCount} times this turn. Stop retrying memory calls and continue with the user's task.`,
        entries, chars, limit: this.limitFor(target),
      }
    }
    return { ok: false, message, entries, chars, limit: this.limitFor(target) }
  }

  async add(target: MemoryTarget, facts: string): Promise<MemoryApplyResult> {
    const content = facts.trim()
    if (!content) return { ok: false, message: 'Content cannot be empty.', entries: [], chars: 0, limit: this.limitFor(target) }
    const threat = scanMemoryThreats(content)
    if (threat) return { ok: false, message: threat, entries: [], chars: 0, limit: this.limitFor(target) }

    const entries = await this.read(target)
    if (entries.some(entry => stripDatePrefix(entry) === content)) {
      this.resetFailures()
      return {
        ok: true, message: 'Entry already exists (no duplicate added).', entries,
        chars: entries.join(ENTRY_DELIMITER).length, limit: this.limitFor(target),
      }
    }
    const next = [...entries, this.addDatePrefix ? `## ${new Date().toISOString().slice(0, 10)}\n${content}` : content]
    const total = next.join(ENTRY_DELIMITER).length
    if (total > this.limitFor(target)) {
      return this.failure(target, `Adding this entry would exceed the ${this.limitFor(target)} char limit. Consolidate or remove stale entries, then retry.`, entries)
    }
    await this.write(target, next)
    this.resetFailures()
    return { ok: true, message: 'Entry added.', entries: next, chars: total, limit: this.limitFor(target) }
  }

  async replace(target: MemoryTarget, oldText: string, facts: string): Promise<MemoryApplyResult> {
    return this.mutate(target, oldText, 'replace', facts)
  }

  async remove(target: MemoryTarget, oldText: string): Promise<MemoryApplyResult> {
    return this.mutate(target, oldText, 'remove', undefined)
  }

  private async mutate(target: MemoryTarget, oldText: string, action: 'replace' | 'remove', facts?: string): Promise<MemoryApplyResult> {
    const needle = oldText.trim()
    if (!needle) return { ok: false, message: 'old_text cannot be empty.', entries: [], chars: 0, limit: this.limitFor(target) }
    const content = action === 'replace' ? (facts ?? '').trim() : ''
    if (action === 'replace' && !content) return { ok: false, message: 'facts is required for replace; use remove to delete.', entries: [], chars: 0, limit: this.limitFor(target) }
    if (action === 'replace') {
      const threat = scanMemoryThreats(content)
      if (threat) return { ok: false, message: threat, entries: [], chars: 0, limit: this.limitFor(target) }
    }

    if (await this.detectDrift(target)) {
      return { ok: false, message: 'External drift detected in memory file. Resolve the drift before retrying.', entries: [], chars: 0, limit: this.limitFor(target) }
    }
    const entries = await this.read(target)
    const matches = entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.includes(needle))
    if (matches.length === 0) return this.failure(target, `No entry matching "${needle}" found.`, entries)
    if (new Set(matches.map(m => m.entry)).size > 1) {
      return {
        ok: false,
        message: `Multiple distinct entries matched "${needle}". Be more specific.`,
        entries, chars: entries.join(ENTRY_DELIMITER).length, limit: this.limitFor(target),
      }
    }
    const index = matches[0]?.index ?? -1
    const next = [...entries]
    if (action === 'remove') next.splice(index, 1)
    else next[index] = content
    const total = next.join(ENTRY_DELIMITER).length
    if (total > this.limitFor(target)) return this.failure(target, `Resulting memory would exceed the ${this.limitFor(target)} char limit.`, entries)
    await this.write(target, next)
    this.resetFailures()
    return { ok: true, message: `Entry ${action === 'remove' ? 'removed' : 'replaced'}.`, entries: next, chars: total, limit: this.limitFor(target) }
  }


  async applyBatch(target: MemoryTarget, operations: MemoryOperation[]): Promise<MemoryApplyResult> {
    if (operations.length === 0) {
      return { ok: false, message: 'operations list is empty.', entries: [], chars: 0, limit: this.limitFor(target) }
    }
    if (await this.detectDrift(target)) {
      return { ok: false, message: 'External drift detected in memory file. Resolve the drift before retrying.', entries: [], chars: 0, limit: this.limitFor(target) }
    }
    const entries = await this.read(target)
    const working = [...entries]
    for (const [index, op] of operations.entries()) {
      const position = index + 1
      if (op.action === 'add') {
        const body = (op.facts ?? '').trim()
        if (!body) return { ok: false, message: `Operation ${position} (add): facts is required. No operations were applied.`, entries, chars: entries.join(ENTRY_DELIMITER).length, limit: this.limitFor(target) }
        const threat = scanMemoryThreats(body)
        if (threat) return { ok: false, message: `Operation ${position}: ${threat}`, entries, chars: entries.join(ENTRY_DELIMITER).length, limit: this.limitFor(target) }
        if (!working.some(entry => stripDatePrefix(entry) === body)) {
          working.push(this.addDatePrefix ? `## ${new Date().toISOString().slice(0, 10)}\n${body}` : body)
        }
        continue
      }
      const needle = (op.old_text ?? '').trim()
      if (!needle) return { ok: false, message: `Operation ${position} (${op.action}): old_text is required. No operations were applied.`, entries, chars: entries.join(ENTRY_DELIMITER).length, limit: this.limitFor(target) }
      const matches = working.map((entry, matchIndex) => ({ entry, matchIndex })).filter(({ entry }) => entry.includes(needle))
      if (matches.length === 0) {
        return this.failure(target, `Operation ${position}: no entry matching "${needle}" found. No operations were applied.`, entries)
      }
      if (new Set(matches.map(m => m.entry)).size > 1) {
        return { ok: false, message: `Operation ${position}: "${needle}" matched multiple distinct entries. No operations were applied.`, entries, chars: entries.join(ENTRY_DELIMITER).length, limit: this.limitFor(target) }
      }
      const matchIndex = matches[0]?.matchIndex ?? -1
      if (op.action === 'remove') {
        working.splice(matchIndex, 1)
      } else {
        const body = (op.facts ?? '').trim()
        if (!body) return { ok: false, message: `Operation ${position} (replace): facts is required.`, entries, chars: entries.join(ENTRY_DELIMITER).length, limit: this.limitFor(target) }
        const threat = scanMemoryThreats(body)
        if (threat) return { ok: false, message: `Operation ${position}: ${threat}`, entries, chars: entries.join(ENTRY_DELIMITER).length, limit: this.limitFor(target) }
        working[matchIndex] = body
      }
    }
    const total = working.join(ENTRY_DELIMITER).length
    if (total > this.limitFor(target)) {
      return this.failure(target, `Batch result (${total} chars) exceeds the ${this.limitFor(target)} limit. Remove or shorten more entries in the same batch.`, entries)
    }
    await this.write(target, working)
    this.resetFailures()
    return { ok: true, message: `Applied ${operations.length} operation(s).`, entries: working, chars: total, limit: this.limitFor(target) }
  }

  async renderContext(): Promise<string> {
    const memory = await this.read('memory')
    const user = await this.read('user')
    const parts: string[] = []
    for (const [target, entries] of [['Memory', memory], ['User Profile', user]] as const) {
      const safe = entries.filter(entry => !scanMemoryThreats(entry))
      if (safe.length > 0) {
        const body = safe.join(ENTRY_DELIMITER)
        const note = safe.length === entries.length ? '' : ` (${entries.length - safe.length} threat-matched entries filtered)`
        parts.push(`## ${target} (${safe.length} entries)${note}\n${body}`)
      }
    }
    return parts.join('\n\n')
  }

  async snapshot(): Promise<{ memory: string[]; user: string[] }> {
    const [memory, user] = await Promise.all([this.read('memory'), this.read('user')])
    return { memory, user }
  }

  async restoreSnapshot(snapshot: { memory: string[]; user: string[] }): Promise<void> {
    await this.write('memory', snapshot.memory)
    await this.write('user', snapshot.user)
  }

  /**
   * Detect on-disk drift: true when the file is not in the canonical
   * `render(normalizeEntries(raw))` form. This catches structural anomalies
   * the writer would quietly normalize away (empty/`§`-only entries, stray
   * blank lines, leading/trailing delimiters) that indicate the file was
   * edited outside MemoryStore. Purely single-canonical content reaches the
   * same serialization and returns false, so a normal write is never flagged.
   */
  async detectDrift(target: MemoryTarget): Promise<boolean> {
    const raw = await this.io.readText(fileFor(this.root, target))
    if (raw === null) return false
    // Canonicalize by normalizing (split + trim + drop empties) then re-rendering.
    // If the on-disk bytes differ from that canonical form, the file drifted.
    return render(normalizeEntries(raw)) !== raw
  }
}
