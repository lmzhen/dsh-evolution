/**
 * File-backed durable memory with Hermes-compatible semantics.
 * Stores are MEMORY.md and USER.md under $DSH_HOME/memories (~/.dsh/memories).
 */

import { basename, join } from 'node:path'
import { homedir } from 'node:os'
import { nodeEvolutionIo, transactIo, type EvolutionIoLike } from './io.ts'
import { scanMemoryThreats } from './threats.ts'
import { ENTRY_DELIMITER, DEFAULT_MEMORY_CHAR_LIMIT, DEFAULT_USER_CHAR_LIMIT, DEFAULT_CONSOLIDATION_FAILURES } from './constants.ts'

export { ENTRY_DELIMITER } from './constants.ts'

/**
 * Read-guard factor: a memory file larger than this multiple of its target's
 * char limit is treated as externally corrupted and skipped instead of being
 * read whole (aligned with claw `tools/memory.ts` size guard, which uses the
 * same 10× bound around a file that should never exceed the store limit).
 */
const READ_GUARD_FACTOR = 10

/**
 * Consolidation-failure backoff window (package-private, rc.42 audit P2-1):
 * only failures inside the window count toward `maxConsolidationFailures`.
 * The store cannot observe turn boundaries, so the model-facing "this turn"
 * phrasing is approximated with ten minutes — generous enough to cover one
 * turn's retry loop, short enough that a failure yesterday never makes today's
 * first refusal say "stop retrying".
 */
const FAILURE_WINDOW_MS = 10 * 60_000

/**
 * Recoverable-error preview bounds (B-line G5, Hermes `_previews` parity):
 * failed replace/remove/batch calls echo the current entries so the model can
 * self-recover without re-reading the store. Bounded to five entries of eighty
 * characters each; package-private because it is an error-message shape, not a
 * behavior switch.
 */
const ERROR_PREVIEW_ENTRIES = 5
const ERROR_PREVIEW_WIDTH = 80

function previewEntries(entries: string[]): string {
  if (entries.length === 0) return ''
  const shown = entries.slice(0, ERROR_PREVIEW_ENTRIES).map((entry) => {
    const text = entry.length > ERROR_PREVIEW_WIDTH ? `${entry.slice(0, ERROR_PREVIEW_WIDTH)}…` : entry
    return `- ${text}`
  })
  const more = entries.length > ERROR_PREVIEW_ENTRIES ? `\n  (+${entries.length - ERROR_PREVIEW_ENTRIES} more)` : ''
  return `\n\nCurrent entries (preview):\n${shown.join('\n')}${more}`
}

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
  private lastFailureAt = 0

  constructor(options: MemoryStoreOptions = {}) {
    this.io = options.io ?? nodeEvolutionIo()
    this.memoryLimit = options.memoryCharLimit ?? DEFAULT_MEMORY_CHAR_LIMIT
    this.userLimit = options.userCharLimit ?? DEFAULT_USER_CHAR_LIMIT
    this.addDatePrefix = options.addDatePrefix ?? false
    this.root = options.root ?? memoryRoot()
    this.maxFailures = options.maxConsolidationFailures ?? DEFAULT_CONSOLIDATION_FAILURES
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
    // Rolling-window decay (rc.42 audit P2-1): the backoff counter used to be
    // process-lifetime, so three failures EVER — across turns and sessions —
    // made every later failure say "stop retrying" even though the model had
    // moved on. The store cannot see turn boundaries, so "this turn" is
    // approximated with a window: failures older than it stop counting and
    // the counter restarts from one.
    if (Date.now() - this.lastFailureAt > FAILURE_WINDOW_MS) this.failureCount = 0
    this.lastFailureAt = Date.now()
    this.failureCount += 1
    const chars = entries.join(ENTRY_DELIMITER).length
    if (this.failureCount > this.maxFailures) {
      return {
        ok: false,
        message: `Memory consolidation failed ${this.failureCount} times this turn. Stop retrying memory calls and continue with the user's task.${previewEntries(entries)}`,
        entries, chars, limit: this.limitFor(target),
      }
    }
    return { ok: false, message: `${message}${previewEntries(entries)}`, entries, chars, limit: this.limitFor(target) }
  }

  /**
   * StorageHint percentage must clamp at 100 like the render header: a drifted
   * entry can push chars past the limit, and "Storage at 125%" contradicts the
   * clamped usage indicator.
   */
  private storageHint(target: MemoryTarget, chars: number): string {
    const limit = this.limitFor(target)
    if (limit <= 0) return ''
    const percent = Math.min(100, Math.floor((chars * 100) / limit))
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
    const unique = `${stamp}-${Math.random().toString(36).slice(2, 8)}`
    try {
      await this.io.copy(path, `${path}.bak.${unique}`)
      return `${path}.bak.${unique}`
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
    if (!facts.trim()) return { ok: false, message: 'Content cannot be empty.', entries: [], chars: 0, limit: this.limitFor(target) }
    const path = fileFor(this.root, target)
    // M-7 (v3 audit): the oversized read-guard must run BEFORE the transact —
    // inside it, node transact has already loaded the whole file, so the
    // "skipped for reading (never loaded)" contract only holds pre-lock.
    const refusal = await this.oversizedRefusal(target)
    if (refusal) return refusal
    let outcome: MemoryApplyResult | undefined
    await transactIo(this.io, path, async (current) => {
      const core = await this.addCore(target, facts, current ?? '')
      outcome = core.result
      // M-4 (v3 audit): a failure on a MISSING file must keep it missing —
      // returning '' would fabricate an empty file. `null` (DELETE) is safe
      // here: the file does not exist, so the remove is a no-op.
      return core.write ?? (current ?? null)
    })
    return outcome as MemoryApplyResult
  }

  /**
   * Single-entry add inside the transaction: shared checks (oversized,
   * drift, threat) and the content computation. `raw` is the locked view
   * (`current`) — never a second IO read. `write: null` means "no change".
   */
  private async addCore(target: MemoryTarget, facts: string, raw: string): Promise<{ result: MemoryApplyResult; write: string | null }> {
    const content = facts.trim()
    if (!content) return { result: this.failure(target, 'Content cannot be empty.', []), write: null }
    // The oversized guard runs pre-transact in add(); drift is derived from
    // the locked view below.
    const drift = this.driftFromRaw(target, raw)
    if (drift) {
      const backup = await this.backupFile(target)
      const suffix = backup ? ` A backup was saved to ${basename(backup)}.` : ''
      return { result: { ok: false, message: `External drift detected in memory file.${suffix} Resolve the drift before retrying.`, entries: [], chars: 0, limit: this.limitFor(target) }, write: null }
    }
    const threat = scanMemoryThreats(content)
    if (threat) return { result: { ok: false, message: threat, entries: [], chars: 0, limit: this.limitFor(target) }, write: null }

    const entries = [...new Set(normalizeEntries(raw))]
    if (entries.some(entry => stripDatePrefix(entry) === content)) {
      this.resetFailures()
      return { result: { ok: true, message: `Entry already exists (no duplicate added).${this.storageHint(target, entries.join(ENTRY_DELIMITER).length)}`, entries, chars: entries.join(ENTRY_DELIMITER).length, limit: this.limitFor(target) }, write: null }
    }
    const next = [...entries, this.addDatePrefix ? `## ${new Date().toISOString().slice(0, 10)}\n${content}` : content]
    const total = next.join(ENTRY_DELIMITER).length
    const addLimit = this.limitFor(target)
    if (addLimit > 0 && total > addLimit) {
      return { result: this.failure(target, `Adding this entry would exceed the ${addLimit} char limit. Consolidate or remove stale entries, then retry.`, entries), write: null }
    }
    this.resetFailures()
    return { result: { ok: true, message: `Entry added.${this.storageHint(target, total)}`, entries: next, chars: total, limit: this.limitFor(target) }, write: render(next) }
  }

  /** Canonical-form drift check derived from the locked view (same formula as `detectDrift`, no second read). */
  private driftFromRaw(target: MemoryTarget, raw: string): boolean {
    if (raw.trim() === '') return false
    const entries = normalizeEntries(raw)
    const limit = this.limitFor(target)
    if (limit > 0 && entries.some(entry => entry.length > limit)) return true
    return render(entries) !== raw
  }

  async applyBatch(target: MemoryTarget, operations: MemoryOperation[]): Promise<MemoryApplyResult> {
    if (operations.length === 0) return { ok: false, message: 'operations list is empty.', entries: [], chars: 0, limit: this.limitFor(target) }
    const path = fileFor(this.root, target)
    // M-7: oversized guard pre-lock (see add()).
    const refusal = await this.oversizedRefusal(target)
    if (refusal) return refusal
    let outcome: MemoryApplyResult | undefined
    await transactIo(this.io, path, async (current) => {
      const core = await this.applyBatchCore(target, operations, current ?? '')
      outcome = core.result
      // M-4: a failure on a MISSING file must keep it missing (null = DELETE,
      // and the remove is a no-op when nothing exists).
      return core.write ?? (current ?? null)
    })
    return outcome as MemoryApplyResult
  }

  /** Batch RMW inside the transaction. `write: null` = failure/no-op, disk untouched. */
  private async applyBatchCore(
    target: MemoryTarget,
    operations: MemoryOperation[],
    raw: string,
  ): Promise<{ result: MemoryApplyResult; write: string | null }> {
    // The oversized guard runs pre-transact in applyBatch(); drift is derived
    // from the locked view below.
    const drift = this.driftFromRaw(target, raw)
    if (drift) {
      const backup = await this.backupFile(target)
      const suffix = backup ? ` A backup was saved to ${basename(backup)}.` : ''
      return { result: { ok: false, message: `External drift detected in memory file.${suffix} Resolve the drift before retrying.`, entries: [], chars: 0, limit: this.limitFor(target) }, write: null }
    }
    const entries = [...new Set(normalizeEntries(raw))]
    const working = [...entries]
    for (const [index, op] of operations.entries()) {
      const position = index + 1
      if (op.action === 'add') {
        const body = (op.facts ?? '').trim()
        if (!body) return { result: { ok: false, message: `Operation ${position} (add): facts is required. No operations were applied.${previewEntries(entries)}`, entries, chars: entries.join(ENTRY_DELIMITER).length, limit: this.limitFor(target) }, write: null }
        const threat = scanMemoryThreats(body)
        if (threat) return { result: { ok: false, message: `Operation ${position}: ${threat}`, entries, chars: entries.join(ENTRY_DELIMITER).length, limit: this.limitFor(target) }, write: null }
        if (!working.some(entry => stripDatePrefix(entry) === body)) {
          working.push(this.addDatePrefix ? `## ${new Date().toISOString().slice(0, 10)}\n${body}` : body)
        }
        continue
      }
      const needle = (op.old_text ?? '').trim()
      if (!needle) return { result: { ok: false, message: `Operation ${position} (${op.action}): old_text is required. No operations were applied.${previewEntries(entries)}`, entries, chars: entries.join(ENTRY_DELIMITER).length, limit: this.limitFor(target) }, write: null }
      const matches = working.map((entry, matchIndex) => ({ entry, matchIndex })).filter(({ entry }) => entry.includes(needle))
      if (matches.length === 0) {
        return { result: this.failure(target, `Operation ${position}: no entry matching "${needle}" found. No operations were applied.`, entries), write: null }
      }
      if (new Set(matches.map(m => m.entry)).size > 1) {
        return { result: { ok: false, message: `Operation ${position}: "${needle}" matched multiple distinct entries. No operations were applied.${previewEntries(entries)}`, entries, chars: entries.join(ENTRY_DELIMITER).length, limit: this.limitFor(target) }, write: null }
      }
      const matchIndex = matches[0]?.matchIndex ?? -1
      if (op.action === 'remove') {
        working.splice(matchIndex, 1)
      } else {
        const body = (op.facts ?? '').trim()
        if (!body) return { result: { ok: false, message: `Operation ${position} (replace): facts is required.${previewEntries(entries)}`, entries, chars: entries.join(ENTRY_DELIMITER).length, limit: this.limitFor(target) }, write: null }
        const threat = scanMemoryThreats(body)
        if (threat) return { result: { ok: false, message: `Operation ${position}: ${threat}`, entries, chars: entries.join(ENTRY_DELIMITER).length, limit: this.limitFor(target) }, write: null }
        working[matchIndex] = body
      }
    }
    const total = working.join(ENTRY_DELIMITER).length
    const batchLimit = this.limitFor(target)
    if (batchLimit > 0 && total > batchLimit) {
      return { result: this.failure(target, `Batch result (${total} chars) exceeds the ${batchLimit} limit. Remove or shorten more entries in the same batch.`, entries), write: null }
    }
    this.resetFailures()
    return { result: { ok: true, message: `Applied ${operations.length} operation(s).${this.storageHint(target, total)}`, entries: working, chars: total, limit: this.limitFor(target) }, write: render(working) }
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

  /**
   * Detect on-disk drift: true when the file is not in the canonical
   * `render(normalizeEntries(raw))` form. This catches structural anomalies
   * the writer would quietly normalize away (empty/`§`-only entries, stray
   * blank lines, leading/trailing delimiters) that indicate the file was
   * edited outside MemoryStore. Purely single-canonical content reaches the
   * same serialization and returns false, so a normal write is never flagged.
   *
   * An absent, empty, or whitespace-only file is the "never written" state
   * (rc.42 audit P1-6): it parses to zero entries, so the canonical form
   * `'\n'` can never byte-match it and every write path was permanently
   * refused with "External drift detected" — including the repairs the model
   * would need to make. Such files are adopted instead of flagged.
   */
  async detectDrift(target: MemoryTarget): Promise<boolean> {
    // Oversized files are an external-modification signal by the read guard;
    // report drift so a write followed by a read never loads them.
    if (await this.oversizedFile(target)) return true
    const raw = await this.io.readText(fileFor(this.root, target))
    if (raw === null || raw.trim() === '') return false
    const entries = normalizeEntries(raw)
    const limit = this.limitFor(target)
    // Second drift signal (Hermes parity, `_detect_external_drift` signal #2):
    // one parsed entry larger than the store's whole-file limit means an
    // external writer appended free-form content — a tool-written entry can
    // never exceed the whole-store budget. Refusing (with backup) instead of
    // letting a flush truncate it. A zero/negative limit means "unbounded".
    if (limit > 0 && entries.some(entry => entry.length > limit)) return true
    // Canonicalize by normalizing (split + trim + drop empties) then re-rendering.
    // If the on-disk bytes differ from that canonical form, the file drifted.
    return render(entries) !== raw
  }
}
