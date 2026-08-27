/**
 * File-backed durable memory with Hermes-compatible semantics.
 * Stores are MEMORY.md and USER.md under $DSH_HOME/memories (~/.dsh/memories).
 */

import { basename, join } from 'node:path'
import { homedir } from 'node:os'
import { nodeEvolutionIo, type EvolutionIoLike } from './io.ts'
import { scanMemoryThreats } from './threats.ts'
import { ENTRY_DELIMITER } from './constants.ts'

export { ENTRY_DELIMITER } from './constants.ts'

/**
 * Read-guard factor: a memory file larger than this multiple of its target's
 * char limit is treated as externally corrupted and skipped instead of being
 * read whole (aligned with claw `tools/memory.ts` size guard, which uses the
 * same 10× bound around a file that should never exceed the store limit).
 */
const READ_GUARD_FACTOR = 10

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

  /**
   * Read-guard probe: `{ size, limit }` when the on-disk file exceeds
   * `limit * READ_GUARD_FACTOR` bytes, `null` when it is absent, unknown
   * (backend without a size probe), under the bound, or the target has no
   * limit configured.
   */
  private async oversizedFile(target: MemoryTarget): Promise<{ size: number; limit: number } | null> {
    const size = await this.io.size?.(fileFor(this.root, target))
    if (size === null || size === undefined) return null
    const limit = this.limitFor(target)
    if (limit <= 0) return null
    return size > limit * READ_GUARD_FACTOR ? { size, limit } : null
  }

  async read(target: MemoryTarget): Promise<string[]> {
    // Oversized files are skipped whole (claw alignment); a later write to the
    // same target is refused via `oversizedRefusal` instead of overwriting.
    if (await this.oversizedFile(target)) return []
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

  /** Percent-based storage hint appended to success message once the target is ≥80% full. */
  private storageHint(target: MemoryTarget, chars: number): string {
    const limit = this.limitFor(target)
    if (limit <= 0) return ''
    const percent = Math.floor((chars * 100) / limit)
    return percent >= 80 ? ` ⚠️ Storage at ${percent}% (${chars}/${limit} chars).` : ''
  }

  /**
   * Best-effort raw-copy backup of the on-disk file to `<file>.bak.<stamp>`
   * before a refusal, so an externally modified (or oversized) file stays
   * recoverable. Copies bytes instead of reading them so a pathologically
   * large file is never loaded just to back it up. Failure to back up does
   * not change the refusal semantics.
   */
  private async backupFile(target: MemoryTarget): Promise<string | null> {
    const path = fileFor(this.root, target)
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
    try {
      await this.io.copy(path, `${path}.bak.${stamp}`)
      return `${path}.bak.${stamp}`
    } catch {
      return null
    }
  }

  /**
   * Read-guard refusal for write paths. Returns the refusal result when the
   * target file is oversized, `null` otherwise. The file is skipped for
   * reading (never loaded), backed up by raw copy, and the model is told to
   * fix it manually — mirroring the drift refusal so corrupted state is never
   * silently overwritten.
   */
  private async oversizedRefusal(target: MemoryTarget): Promise<MemoryApplyResult | null> {
    const oversized = await this.oversizedFile(target)
    if (!oversized) return null
    const backup = await this.backupFile(target)
    const suffix = backup ? ` A backup was saved to ${basename(backup)}.` : ''
    return {
      ok: false,
      message: `Memory file is ${oversized.size} bytes (limit ${oversized.limit * READ_GUARD_FACTOR}) — skipping read.${suffix} Fix the file manually, then retry.`,
      entries: [], chars: 0, limit: this.limitFor(target),
    }
  }

  async add(target: MemoryTarget, facts: string): Promise<MemoryApplyResult> {
    const refusal = await this.oversizedRefusal(target)
    if (refusal) return refusal
    const content = facts.trim()
    if (!content) return { ok: false, message: 'Content cannot be empty.', entries: [], chars: 0, limit: this.limitFor(target) }
    const threat = scanMemoryThreats(content)
    if (threat) return { ok: false, message: threat, entries: [], chars: 0, limit: this.limitFor(target) }

    const entries = await this.read(target)
    if (entries.some(entry => stripDatePrefix(entry) === content)) {
      this.resetFailures()
      return {
        ok: true, message: `Entry already exists (no duplicate added).${this.storageHint(target, entries.join(ENTRY_DELIMITER).length)}`, entries,
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
    return { ok: true, message: `Entry added.${this.storageHint(target, total)}`, entries: next, chars: total, limit: this.limitFor(target) }
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
    const refusal = await this.oversizedRefusal(target)
    if (refusal) return refusal
    const content = action === 'replace' ? (facts ?? '').trim() : ''
    if (action === 'replace' && !content) return { ok: false, message: 'facts is required for replace; use remove to delete.', entries: [], chars: 0, limit: this.limitFor(target) }
    if (action === 'replace') {
      const threat = scanMemoryThreats(content)
      if (threat) return { ok: false, message: threat, entries: [], chars: 0, limit: this.limitFor(target) }
    }

    if (await this.detectDrift(target)) {
      const backup = await this.backupFile(target)
      const suffix = backup ? ` A backup was saved to ${basename(backup)}.` : ''
      return { ok: false, message: `External drift detected in memory file.${suffix} Resolve the drift before retrying.`, entries: [], chars: 0, limit: this.limitFor(target) }
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
    return { ok: true, message: `Entry ${action === 'remove' ? 'removed' : 'replaced'}.${this.storageHint(target, total)}`, entries: next, chars: total, limit: this.limitFor(target) }
  }


  async applyBatch(target: MemoryTarget, operations: MemoryOperation[]): Promise<MemoryApplyResult> {
    if (operations.length === 0) {
      return { ok: false, message: 'operations list is empty.', entries: [], chars: 0, limit: this.limitFor(target) }
    }
    const refusal = await this.oversizedRefusal(target)
    if (refusal) return refusal
    if (await this.detectDrift(target)) {
      const backup = await this.backupFile(target)
      const suffix = backup ? ` A backup was saved to ${basename(backup)}.` : ''
      return { ok: false, message: `External drift detected in memory file.${suffix} Resolve the drift before retrying.`, entries: [], chars: 0, limit: this.limitFor(target) }
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
    return { ok: true, message: `Applied ${operations.length} operation(s).${this.storageHint(target, total)}`, entries: working, chars: total, limit: this.limitFor(target) }
  }

  async renderContext(): Promise<string> {
    const memory = await this.read('memory')
    const user = await this.read('user')
    const parts: string[] = []
    for (const [target, label, entries] of [['memory', 'Memory', memory], ['user', 'User Profile', user]] as const) {
      // An oversized file read as empty; probe once more here so the injected
      // context states the skip instead of silently dropping the block.
      const oversized = entries.length === 0 ? await this.oversizedFile(target) : null
      if (oversized) {
        parts.push(`## ${label} — file skipped: ${oversized.size} bytes (limit ${oversized.limit * READ_GUARD_FACTOR}); not read`)
        continue
      }
      const safe = entries.filter(entry => !scanMemoryThreats(entry))
      if (safe.length > 0) {
        const body = safe.join(ENTRY_DELIMITER)
        const limit = this.limitFor(target)
        // Usage indicator aligned with Hermes `_render_block`: floor percentage clamped at 100.
        const pct = limit > 0 ? Math.min(100, Math.floor((body.length * 100) / limit)) : 0
        const note = safe.length === entries.length ? '' : ` (${entries.length - safe.length} threat-matched entries filtered)`
        parts.push(`## ${label} (${safe.length} entries) [${pct}% — ${body.length}/${limit} chars]${note}\n${body}`)
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
    // Oversized files are an external-modification signal by the read guard;
    // report drift so a write followed by a read never loads them.
    if (await this.oversizedFile(target)) return true
    const raw = await this.io.readText(fileFor(this.root, target))
    if (raw === null) return false
    const entries = normalizeEntries(raw)
    // Second drift signal (Hermes parity, `_detect_external_drift` signal #2):
    // one parsed entry larger than the store's whole-file limit means an
    // external writer appended free-form content — a tool-written entry can
    // never exceed the whole-store budget. Refusing (with backup) instead of
    // letting a flush truncate it.
    if (entries.some(entry => entry.length > this.limitFor(target))) return true
    // Canonicalize by normalizing (split + trim + drop empties) then re-rendering.
    // If the on-disk bytes differ from that canonical form, the file drifted.
    return render(entries) !== raw
  }
}
