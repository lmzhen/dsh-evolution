/**
 * File-backed durable memory with Hermes-compatible semantics.
 * Stores are MEMORY.md and USER.md under $DSH_HOME/memories (~/.dsh/memories).
 */

import { basename, join } from 'node:path'
import { nodeEvolutionIo, transactIo, type EvolutionIoLike } from './io.ts'
import { evolutionRoot } from './state-store.ts'
import { makeSerialQueue } from './serial.ts'
import { scanMemoryThreats, type ScanOptions } from './threats.ts'
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
  // V9-05 (0.3.51): single resolver — evolutionRoot() holds the ONLY
  // DSH_HOME empty/whitespace fallback; the old bare `||` here resolved
  // `DSH_HOME=" "` to a CWD-relative " /memories" sidecar.
  return join(evolutionRoot(env), 'memories')
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

/** F-201: does `content` carry the on-disk entry delimiter or a trailing
 * `\n§` fragment that would combine with the render terminator into a real
 * delimiter boundary? Both split the fact into multiple entries on read-back
 * (and a delimiter-ending fact is permanent drift — `render(entries)!==raw`
 * bricks every later write). A leading/plain `§` is safe and round-trips. */
function hasEntryDelimiter(content: string): boolean {
  return content.includes(ENTRY_DELIMITER) || content.endsWith('\n§')
}

export interface MemoryStoreOptions {
  memoryCharLimit?: number
  userCharLimit?: number
  addDatePrefix?: boolean
  root?: string
  maxConsolidationFailures?: number
  io?: EvolutionIoLike
  /** V10-03 (P2-18): deployment-declared benign pattern labels (ScanOptions.
   * excludeLabels) applied to every threat check of this store (writes and
   * the renderContext filter). Default empty — the strict ANY-hit-blocks
   * policy is unchanged; deploy configs opt in. */
  threatExemptLabels?: readonly string[]
}

export type { EvolutionIoLike }

export class MemoryStore {
  readonly memoryLimit: number
  readonly userLimit: number
  readonly addDatePrefix: boolean
  readonly root: string
  private readonly maxFailures: number
  private readonly io: EvolutionIoLike
  /** V10-03 (P2-18): see MemoryStoreOptions.threatExemptLabels. */
  private readonly threatExemptLabels: readonly string[]
  /** V6-16 (0.3.37): same-process RMW serialization (the SkillLibrary queue) —
   * on a backend WITHOUT a transact lock two concurrent callers compute on the
   * same old content and the last rename wins, silently dropping one op's
   * update. The node backend's cross-process lock already serializes; this
   * chain covers the no-transact custom backends. */
  private readonly serial = makeSerialQueue()
  private failureCount = 0
  private lastFailureAt = 0

  constructor(options: MemoryStoreOptions = {}) {
    this.io = options.io ?? nodeEvolutionIo()
    this.memoryLimit = options.memoryCharLimit ?? DEFAULT_MEMORY_CHAR_LIMIT
    this.userLimit = options.userCharLimit ?? DEFAULT_USER_CHAR_LIMIT
    this.addDatePrefix = options.addDatePrefix ?? false
    this.root = options.root ?? memoryRoot()
    this.maxFailures = options.maxConsolidationFailures ?? DEFAULT_CONSOLIDATION_FAILURES
    this.threatExemptLabels = options.threatExemptLabels ?? []
  }

  /** V10-03 (P2-18): ScanOptions shared by every threat check of this store —
   * the constructor's exempt labels, empty by default (behavior unchanged). */
  private threatScanOptions(): ScanOptions {
    return this.threatExemptLabels.length > 0 ? { excludeLabels: this.threatExemptLabels } : {}
  }

  /** V10-03 (P2-18): the strict-scan write gate. A block message names the hit
   * label (scanMemoryThreats already embeds it) plus the self-heal hint. */
  private memoryThreatBlock(text: string): string | null {
    // A2-16 (v18): scanMemoryThreats already appends its exemption hint;
    // a store-side append duplicated the sentence (the old THREAT_EXEMPT_HINT
    // export was removed in v21 — see threats.ts THREAT_EXEMPTION_HINT).
    return scanMemoryThreats(text, undefined, this.threatScanOptions())
  }

  limitFor(target: MemoryTarget): number {
    return target === 'memory' ? this.memoryLimit : this.userLimit
  }

  /** P2-1 (v18): the generated date prefix participates in duplicate detection
   * only when THIS store writes it. With addDatePrefix=false a fact's own
   * leading `## YYYY-MM-DD\n` is content, not a generated prefix. */
  private dedupeKey(entry: string): string {
    return this.addDatePrefix ? stripDatePrefix(entry) : entry
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

  // 0.3.16 (S1.10, D-2): `write()` was a bare public write path bypassing
  // transact/threat-scan/drift checks, with ZERO callers in the family —
  // removed. Memory mutations go through `applyBatch` only.

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
   * Best-effort raw-copy backup of the on-disk file to `<file>.bak` before a
   * refusal, so an externally modified (or oversized) file stays recoverable.
   * Copies bytes instead of reading them so a pathologically large file is
   * never loaded just to back it up. Failure to back up does not change the
   * refusal semantics. V8-23⑫ (0.3.49): ONE fixed backup name per target —
   * a fresh refusal overwrites it (the previous timestamped names accumulated
   * per drift incident with no retention policy). V9-08 (0.3.51) declares the
   * two failure shapes: (1) the pre-copy remove of the previous `.bak` fails —
   * harmless, because the copy contract is overwrite (`cp force`);
   * (2) the copy itself fails (disk/backend) — returns `null` and the refusal
   * message simply carries no backup suffix; the refusal semantics and the
   * on-disk file are untouched either way.
   */
  private async backupFile(target: MemoryTarget): Promise<string | null> {
    const path = fileFor(this.root, target)
    const backup = `${path}.bak`
    // P3-13 (v14): stage the copy under a transient name and only then replace
    // the fixed `.bak`, so a FAILED copy leaves the previous backup intact —
    // the old shape removed `.bak` first and lost the last good generation.
    const staging = `${backup}.${process.pid}.${Date.now().toString(36)}.tmp`
    try {
      await this.io.remove(staging).catch(() => {})
      await this.io.copy(path, staging)
      await this.io.rename(staging, backup)
      return backup
    } catch {
      await this.io.remove(staging).catch(() => {})
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

  /**
   * The ONE memory write skeleton (V27 G2.5): oversized read-guard pre-transact,
   * one transaction over the target path, and the C-01 structured refusal when a
   * backend never invokes the task. `addChained` and `applyBatchChained` supply
   * only their own in-transaction core, so the two write paths cannot drift in
   * their guard order, their missing-file handling or their error text.
   *
   * @param target - memory target being written
   * @param core - the in-transaction read-modify-write for the locked body
   * @returns the core's result, or the oversized / contract-violation refusal
   */
  private async chainedWrite(
    target: MemoryTarget,
    core: (raw: string) => Promise<{ result: MemoryApplyResult; write: string | null }>,
  ): Promise<MemoryApplyResult> {
    // M-7 (v3 audit): the oversized read-guard must run BEFORE the transact —
    // inside it, node transact has already loaded the whole file, so the
    // "skipped for reading (never loaded)" contract only holds pre-lock.
    const refusal = await this.oversizedRefusal(target)
    if (refusal) return refusal
    let outcome: MemoryApplyResult | undefined
    await transactIo(this.io, fileFor(this.root, target), async (current) => {
      const step = await core(current ?? '')
      outcome = step.result
      // M-4 (v3 audit): a failure on a MISSING file must keep it missing —
      // returning '' would fabricate an empty file. `null` (DELETE) is safe
      // here: the file does not exist, so the remove is a no-op.
      return step.write ?? (current ?? null)
    })
    // C-01: a transact backend that violates the contract (never invokes the
    // task) leaves `outcome` undefined — the old `undefined as
    // MemoryApplyResult` cast handed callers an object whose `.ok` dereference
    // raised a raw TypeError. Structured refusal instead, mirroring
    // skill-store's V6-19 guard.
    return outcome ?? {
      ok: false,
      message: 'internal error: the memory transaction did not invoke the task; no write was performed',
      entries: [], chars: 0, limit: this.limitFor(target),
    }
  }

  async add(target: MemoryTarget, facts: string): Promise<MemoryApplyResult> {
    return await this.serial(() => this.addChained(target, facts))
  }

  private async addChained(target: MemoryTarget, facts: string): Promise<MemoryApplyResult> {
    if (!facts.trim()) return { ok: false, message: 'Content cannot be empty.', entries: [], chars: 0, limit: this.limitFor(target) }
    return await this.chainedWrite(target, async raw => await this.addCore(target, facts, raw))
  }

  /**
   * Single-entry add inside the transaction: shared checks (oversized,
   * drift, threat) and the content computation. `raw` is the locked view
   * (`current`) — never a second IO read. `write: null` means "no change".
   */
  private async addCore(target: MemoryTarget, facts: string, raw: string): Promise<{ result: MemoryApplyResult; write: string | null }> {
    const content = facts.trim()
    // P3 (v15): structured rejection, NOT `this.failure()` — failure() feeds
    // the consolidation-failure backoff counter, and an empty-facts validation
    // error is not a write failure (same discipline as applyBatchCore's
    // inline empty-facts rejection). Unreachable via the public entries
    // (addChained pre-trims), kept as a defence against future callers.
    if (!content) return { result: { ok: false, message: 'Content cannot be empty.', entries: [], chars: 0, limit: this.limitFor(target) }, write: null }
    // The oversized guard runs pre-transact in add(); drift is derived from
    // the locked view below.
    const refusal = await this.driftRefusal(target, raw)
    if (refusal) return { result: refusal, write: null }
    const threat = this.memoryThreatBlock(content)
    if (threat) return { result: { ok: false, message: threat, entries: [], chars: 0, limit: this.limitFor(target) }, write: null }
    // V8-02 (0.3.47): the delimiter guard must inspect the FINAL on-disk entry
    // — with addDatePrefix the prefix+content seam can SYNTHESIZE `\n§\n`
    // (`§\nfoo` passes the pre-prefix check but becomes `## date\n§\nfoo`).
    // C-03: the prefix is computed ONCE — the delimiter check and the
    // appended entry below must see the same string (a midnight rollover
    // between two computations made the checked string ≠ the written string).
    const prefixed = this.addDatePrefix ? `## ${new Date().toISOString().slice(0, 10)}\n${content}` : content
    if (hasEntryDelimiter(prefixed)) {
      // F-201: a fact carrying the delimiter (or ending in `\n§`) would split
      // into multiple entries on read-back, and a delimiter-ending fact is
      // permanent drift. Refuse up front with the position so the model can
      // rewrite it as separate facts. V4-49: no batch-style `Operation N`
      // prefix here — this is a single add, and addCore's other rejections
      // (drift/threat/limit) are likewise prefix-free.
      return { result: { ok: false, message: 'Fact contains the entry delimiter (§) and would split into multiple entries; rewrite it as separate facts.', entries: [], chars: 0, limit: this.limitFor(target) }, write: null }
    }

    const entries = [...new Set(normalizeEntries(raw))]
    // P2-1 (v18): only strip the generated date prefix when THIS store writes
    // one (see dedupeKey). With addDatePrefix=false a user fact may
    // legitimately start with `## YYYY-MM-DD\n`; stripping it made
    // `add('alpha')` a false duplicate of a stored `## 2020-01-01\nalpha`.
    if (entries.some(entry => this.dedupeKey(entry) === content)) {
      this.resetFailures()
      return { result: { ok: true, message: `Entry already exists (no duplicate added).${this.storageHint(target, entries.join(ENTRY_DELIMITER).length)}`, entries, chars: entries.join(ENTRY_DELIMITER).length, limit: this.limitFor(target) }, write: null }
    }
    const next = [...entries, prefixed]
    const total = next.join(ENTRY_DELIMITER).length
    const addLimit = this.limitFor(target)
    if (addLimit > 0 && total > addLimit) {
      return { result: this.failure(target, `Adding this entry would exceed the ${addLimit} char limit. Consolidate or remove stale entries, then retry.`, entries), write: null }
    }
    this.resetFailures()
    return { result: { ok: true, message: `Entry added.${this.storageHint(target, total)}`, entries: next, chars: total, limit: this.limitFor(target) }, write: render(next) }
  }

  /**
   * The single drift predicate. `raw` is in canonical form when it byte-matches
   * `render(normalizeEntries(raw))`; anything else means it was edited outside
   * MemoryStore (empty/`§`-only entries, stray blank lines, leading or trailing
   * delimiters — structural anomalies the writer would quietly normalize away).
   * Both write paths derive this from their locked view and `detectDrift` from
   * a fresh read, so a write and a later read can never disagree about the same
   * bytes.
   *
   * An absent, empty, or whitespace-only body is the "never written" state
   * (rc.42 audit P1-6): it parses to zero entries, and the canonical form
   * `'\n'` can never byte-match it, so flagging it would permanently refuse
   * every write path — including the repairs the model would need to make.
   * Such files are adopted instead of flagged.
   *
   * @param target - memory target whose char limit bounds one parsed entry
   * @param raw - on-disk body, or `null` when the file does not exist
   * @returns whether these bytes count as externally drifted
   */
  private drifted(target: MemoryTarget, raw: string | null): boolean {
    if (raw === null || raw.trim() === '') return false
    const entries = normalizeEntries(raw)
    const limit = this.limitFor(target)
    // Second drift signal (Hermes parity, `_detect_external_drift` signal #2):
    // one parsed entry larger than the store's whole-file limit means an
    // external writer appended free-form content — a tool-written entry can
    // never exceed the whole-store budget. Refusing (with backup) instead of
    // letting a flush truncate it. A zero/negative limit means "unbounded".
    if (limit > 0 && entries.some(entry => entry.length > limit)) return true
    return render(entries) !== raw
  }

  /**
   * Drift refusal for a body already read under the write lock, or `null` when
   * the body is canonical. Both write paths return this unchanged, so their
   * refusals stay byte-identical and each carries the same backup.
   *
   * @param target - memory target that owns the drifted file
   * @param raw - locked file body
   * @returns the refusal to hand back, or `null` to continue writing
   */
  private async driftRefusal(target: MemoryTarget, raw: string): Promise<MemoryApplyResult | null> {
    if (!this.drifted(target, raw)) return null
    const backup = await this.backupFile(target)
    const suffix = backup ? ` A backup was saved to ${basename(backup)}.` : ''
    return { ok: false, message: `External drift detected in memory file.${suffix} Resolve the drift before retrying.`, entries: [], chars: 0, limit: this.limitFor(target) }
  }

  async applyBatch(target: MemoryTarget, operations: MemoryOperation[]): Promise<MemoryApplyResult> {
    return await this.serial(() => this.applyBatchChained(target, operations))
  }

  private async applyBatchChained(target: MemoryTarget, operations: MemoryOperation[]): Promise<MemoryApplyResult> {
    if (operations.length === 0) return { ok: false, message: 'operations list is empty.', entries: [], chars: 0, limit: this.limitFor(target) }
    return await this.chainedWrite(target, async raw => await this.applyBatchCore(target, operations, raw))
  }

  /** Batch RMW inside the transaction. `write: null` = failure/no-op, disk untouched. */
  private async applyBatchCore(
    target: MemoryTarget,
    operations: MemoryOperation[],
    raw: string,
  ): Promise<{ result: MemoryApplyResult; write: string | null }> {
    // The oversized guard runs pre-transact in applyBatch(); drift is derived
    // from the locked view below.
    const refusal = await this.driftRefusal(target, raw)
    if (refusal) return { result: refusal, write: null }
    const entries = [...new Set(normalizeEntries(raw))]
    const working = [...entries]
    // C-02: one date prefix per batch — the replace branch gains the
    // same addDatePrefix treatment as add, and every op in the batch shares a
    // single computation (no midnight seam between ops).
    const datePrefix = this.addDatePrefix ? `## ${new Date().toISOString().slice(0, 10)}\n` : ''
    for (const [index, op] of operations.entries()) {
      const position = index + 1
      if (op.action === 'add') {
        const body = (op.facts ?? '').trim()
        if (!body) return { result: { ok: false, message: `Operation ${position} (add): facts is required. No operations were applied.${previewEntries(entries)}`, entries, chars: entries.join(ENTRY_DELIMITER).length, limit: this.limitFor(target) }, write: null }
        const threat = this.memoryThreatBlock(body)
        if (threat) return { result: { ok: false, message: `Operation ${position}: ${threat}${previewEntries(entries)}`, entries, chars: entries.join(ENTRY_DELIMITER).length, limit: this.limitFor(target) }, write: null }
        // V8-02 (0.3.47): same post-prefix inspection as addCore — the
        // `## date\n${body}` seam must not synthesize the delimiter.
        const entryBody = `${datePrefix}${body}`
        if (hasEntryDelimiter(entryBody)) {
          return { result: { ok: false, message: `Operation ${position} (add): Fact contains the entry delimiter (§) and would split into multiple entries; rewrite it as separate facts.${previewEntries(entries)}`, entries, chars: entries.join(ENTRY_DELIMITER).length, limit: this.limitFor(target) }, write: null }
        }
        if (!working.some(entry => this.dedupeKey(entry) === body)) {
          working.push(entryBody)
        }
        continue
      }
      // V6-25 (0.3.37): an enum-outside action (e.g. 'Add'/'upsert') used to
      // silently fall into the REPLACE branch — a semantic drift that passed
      // as ok:true. Fail loud on the contract violation instead. The action is
      // inspected through unknown (the caller's type can lie).
      const rawAction: unknown = op.action
      if (rawAction !== 'remove' && rawAction !== 'replace') {
        return { result: { ok: false, message: `Operation ${position}: unknown action "${String(rawAction)}" (expected add/remove/replace). No operations were applied.${previewEntries(entries)}`, entries, chars: entries.join(ENTRY_DELIMITER).length, limit: this.limitFor(target) }, write: null }
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
        const threat = this.memoryThreatBlock(body)
        if (threat) return { result: { ok: false, message: `Operation ${position}: ${threat}${previewEntries(entries)}`, entries, chars: entries.join(ENTRY_DELIMITER).length, limit: this.limitFor(target) }, write: null }
        // C-02: the replaced entry carries the date prefix like an
        // added one, and the delimiter guard inspects the FINAL on-disk entry
        // (the V8-02 seam rule — a leading-§ body would synthesize `\n§\n`).
        const entryBody = `${datePrefix}${body}`
        if (hasEntryDelimiter(entryBody)) {
          return { result: { ok: false, message: `Operation ${position} (replace): Fact contains the entry delimiter (§) and would split into multiple entries; rewrite it as separate facts.${previewEntries(entries)}`, entries, chars: entries.join(ENTRY_DELIMITER).length, limit: this.limitFor(target) }, write: null }
        }
        working[matchIndex] = entryBody
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
      // V10-03 (P2-18): the same exempt labels apply on render — an entry the
      // deployment allowed into the store must not silently vanish from the
      // injected context.
      const safe = entries.filter(entry => !scanMemoryThreats(entry, undefined, this.threatScanOptions()))
      if (safe.length > 0) {
        const body = safe.join(ENTRY_DELIMITER)
        const limit = this.limitFor(target)
        const note = safe.length === entries.length ? '' : ` (${entries.length - safe.length} threat-matched entries filtered)`
        // Usage indicator aligned with Hermes `_render_block`: floor percentage clamped at 100.
        // C-04: with no limit (limit <= 0) the whole usage segment is
        // omitted — the old form rendered a bogus "[0% — N/0 chars]".
        const usage = limit > 0
          ? ` [${Math.min(100, Math.floor((body.length * 100) / limit))}% — ${body.length}/${limit} chars]`
          : ''
        parts.push(`## ${label} (${safe.length} entries)${usage}${note}\n${body}`)
      } else if (entries.length > 0) {
        // P3-14 (v14): every entry was threat-matched. The block used to
        // vanish with no trace, so the model (and an operator reading the
        // transcript) could not tell "no memories" from "all filtered" — the
        // oversized branch above already states its skip explicitly.
        parts.push(`## ${label} — ${entries.length} entries withheld by the security scan; none injected`)
      }
    }
    return parts.join('\n\n')
  }

  /**
   * Detect on-disk drift for a caller that holds no locked view: `true` when the
   * file is not in canonical form, or when its size trips the read guard. The
   * write paths apply the same predicate (`drifted`) to the body they read under
   * the lock, so a write and a follow-up read agree about the same bytes.
   *
   * @param target - memory target to inspect
   * @returns whether the file on disk counts as externally drifted
   */
  async detectDrift(target: MemoryTarget): Promise<boolean> {
    // Oversized files are an external-modification signal by the read guard;
    // report drift so a write followed by a read never loads them.
    if (await this.oversizedFile(target)) return true
    return this.drifted(target, await this.io.readText(fileFor(this.root, target)))
  }
}
