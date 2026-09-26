/**
 * Skill content history: content-addressed blobs plus a per-skill version index.
 *
 * Why it exists: `.mutations.json` records before/after HASHES and calls every automated edit
 * "reviewable and replayable" — but a hash cannot be replayed. With no content store, the only way
 * back was a whole-tree snapshot (`.backups`, keep=5) or `.archive` (removed skills only), so
 * reverting one skill cost the collateral of every other change in that window. This module keeps
 * the content, keyed by skill and version.
 *
 * Invariants (design `dsh-evolution-skill-history-design.md` §1):
 *  - HISTORY IS HISTORY: the skill tree stays the single truth for "current content"; nothing here
 *    feeds a judgment — callers read back content and version NUMBERS only.
 *  - BEST-EFFORT, like the mutation audit: a failed history write warns and never fails the write
 *    that already landed.
 *  - Blobs are content-addressed, so identical bodies are stored once (across skills too).
 *  - Versions are numbered by `v` (max+1), NOT by the clock: a moved system clock must not reorder
 *    history (KiroCrew's `v<N>` choice, independently arrived at). Numbering and the index read-modify-write run
 *    under the INDEX's own io lock, so two writers of one skill cannot mint the same number.
 *  - The array's ORDER is append order, and the index is appended after the content lock is released, so two
 *    writers of ONE skill can interleave their appends. Each entry therefore carries `beforeHash` — the content
 *    it replaced, read under that writer's lock — and that link, not the position, is what `undo` follows
 *    ({@link orderVersions} rebuilds the content order for display when the chain is complete).
 *
 * NOT here: blob garbage collection. Trimming drops INDEX entries; orphan blobs stay until a
 * sweeper collects them, because a reference count would have to span every skill's index and that
 * belongs to the curator's whole-library pass, not to the write path.
 * @module @deepseek-ai/dsh-evolution-core/skill-history
 */

import { join } from 'node:path'
import { transactIo, type EvolutionIoLike } from './io.ts'
import { contentHash } from './mutations.ts'

/** Root-level history directory. Dot-prefixed so skill discovery skips it. */
export const HISTORY_DIR = '.history'

/** Versioned index shape, so a future field can migrate without guessing. */
export const HISTORY_INDEX_VERSION = 1

/** The action label for a predecessor the index had never seen (content found on disk before this
 * feature existed, or a hand-edited tree): it says "this is what was there", not what wrote it. */
export const BASELINE_ACTION = 'baseline'

/** One recorded version of one skill. */
export interface SkillVersion {
  /** Monotonic per skill; the identity, unlike {@link SkillVersion.at}. */
  v: number
  at: string
  /** The mutation that produced it (`create`/`update`/`patch`/…), or {@link BASELINE_ACTION}. */
  action: string
  /** sha256 of the stored content. */
  hash: string
  /** Content length in characters, so a listing needs no blob read. */
  chars: number
  /** The content this write REPLACED, as its hash — absent on a create, on a baseline, and on any
   * entry written before 0.10.0. The array's ORDER is append order, which two writers of one skill
   * can interleave (the index is appended after the content lock is released); this link is computed
   * from the bytes a write lock actually read, so it is the authoritative predecessor. */
  beforeHash?: string
}

/** One history write, carrying the content the caller already holds. */
export interface VersionRecordInput {
  skillName: string
  action: string
  /** Content before the mutation, or null when there was none (create/restore). */
  before: string | null
  /** Content after the mutation, or null when there is none (archive/remove_file). */
  after: string | null
  at: string
}

/** The version numbers one write produced; a side with no content contributes nothing. */
export interface RecordedVersions {
  beforeVersion?: number | undefined
  afterVersion?: number | undefined
}

/** The root-level history directory. */
export function historyRoot(root: string): string {
  return join(root, HISTORY_DIR)
}

/** Content-addressed blob path: identical bodies share one file, across skills too. */
export function blobPath(root: string, hash: string): string {
  return join(historyRoot(root), 'blobs', hash)
}

/** One skill's index file. */
export function historyIndexFile(root: string, name: string): string {
  return join(historyRoot(root), 'skills', name, 'index.json')
}

/**
 * The versions in CONTENT order (oldest first), rebuilt from the chain links, for display.
 *
 * The stored array is append order, which interleaves when two writers of one skill audit out of
 * order; the links say what actually replaced what. The rebuild runs only when it can account for
 * EVERY entry (exactly one start and a forward link for each step) — otherwise the stored order is
 * returned unchanged, because a partial reconstruction would be a worse answer than the honest one.
 * @param versions - the stored index, oldest first as recorded.
 * @returns the same entries, in content order when the chain is complete.
 */
export function orderVersions(versions: readonly SkillVersion[]): SkillVersion[] {
  if (versions.length < 2) return [...versions]
  const replaced = new Set<string>()
  for (const entry of versions) if (entry.beforeHash !== undefined) replaced.add(entry.beforeHash)
  // The NEWEST entry is the one no write replaced; every other entry is named as someone's predecessor.
  const ends = versions.filter(entry => !replaced.has(entry.hash))
  if (ends.length !== 1) return [...versions]
  const used = new Set<SkillVersion>()
  const backward: SkillVersion[] = []
  let cursor: SkillVersion | undefined = ends[0]
  while (cursor !== undefined && !used.has(cursor)) {
    used.add(cursor)
    backward.push(cursor)
    const before = cursor.beforeHash
    // A hash may repeat (an undo restores earlier content): take the newest entry not yet emitted.
    cursor = before === undefined ? undefined : [...versions].reverse().find(entry => !used.has(entry) && entry.hash === before)
  }
  return backward.length === versions.length ? backward.reverse() : [...versions]
}

/** Keep nothing less than one version, whatever the deployment asks for. */
function clampKeep(keep: number): number {
  return Number.isFinite(keep) ? Math.max(1, Math.floor(keep)) : 1
}

/** The next version number: max+1, never a timestamp. */
function nextVersion(versions: readonly SkillVersion[]): number {
  let max = 0
  for (const entry of versions) if (entry.v > max) max = entry.v
  return max + 1
}

/** The last entry carrying this hash, or undefined (a hash may repeat after an undo). */
function lastVersionOf(versions: readonly SkillVersion[], hash: string): number | undefined {
  for (let index = versions.length - 1; index >= 0; index -= 1) {
    const entry = versions[index]
    if (entry !== undefined && entry.hash === hash) return entry.v
  }
  return undefined
}

/** What one index file's bytes said. `absent` (no file yet) and `unreadable` (bytes that cannot be
 * understood: malformed JSON, a foreign shape, an entry this reader would have to drop, or a writer
 * NEWER than this reader) are DIFFERENT facts — the recorder must never replace the second with an
 * index derived from "nothing", so it preserves those bytes instead. */
export type HistoryIndexState =
  | { readonly kind: 'ok'; readonly versions: SkillVersion[] }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable' }

/** One entry as this reader accepts it, or null when the entry cannot be understood. */
function readVersionEntry(entry: unknown): SkillVersion | null {
  if (typeof entry !== 'object' || entry === null) return null
  const candidate = entry as SkillVersion
  if (typeof candidate.v !== 'number' || !Number.isInteger(candidate.v) || candidate.v <= 0) return null
  if (typeof candidate.hash !== 'string' || candidate.hash === '') return null
  if (typeof candidate.at !== 'string') return null
  if (typeof candidate.action !== 'string') return null
  if (typeof candidate.chars !== 'number') return null
  // The chain link is metadata: a garbled value drops the link, not the version it belongs to.
  return typeof candidate.beforeHash === 'string' && candidate.beforeHash !== ''
    ? { ...candidate, beforeHash: candidate.beforeHash }
    : { v: candidate.v, at: candidate.at, action: candidate.action, hash: candidate.hash, chars: candidate.chars }
}

/**
 * Read one index body for a RECORDER: "understood", "no file", or "cannot be understood".
 * A file whose shape is right but which carries an entry this reader would have to drop counts as
 * unreadable — dropping it silently would be the overwrite the audit posture forbids.
 * @param raw - the index file's bytes, or null when absent.
 * @returns the three-state answer.
 */
export function readHistoryIndex(raw: string | null): HistoryIndexState {
  if (raw === null) return { kind: 'absent' }
  if (raw.trim() === '') return { kind: 'unreadable' }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { kind: 'unreadable' }
  }
  if (typeof parsed !== 'object' || parsed === null) return { kind: 'unreadable' }
  const holder = parsed as { version?: unknown; versions?: unknown }
  if (typeof holder.version === 'number' && holder.version > HISTORY_INDEX_VERSION) return { kind: 'unreadable' }
  if (!Array.isArray(holder.versions)) return { kind: 'unreadable' }
  const versions: SkillVersion[] = []
  for (const entry of holder.versions) {
    const version = readVersionEntry(entry)
    if (version === null) return { kind: 'unreadable' }
    versions.push(version)
  }
  return { kind: 'ok', versions }
}

/**
 * Parse one index body for a READER. Malformed content, a foreign shape, or a version NEWER than this
 * reader all read as empty — the audit posture: never guess. A recorder must use
 * {@link readHistoryIndex} instead, because it has to PRESERVE bytes it cannot understand.
 * @param raw - the index file's bytes, or null when absent.
 * @returns the versions, oldest first.
 */
export function parseHistoryIndex(raw: string | null): SkillVersion[] {
  const state = readHistoryIndex(raw)
  return state.kind === 'ok' ? state.versions : []
}

/**
 * The index after this write, and the version numbers it produced. Pure, so the versioning rules
 * are testable without io.
 *
 * Two rules matter here: a predecessor the index has never seen gets a BASELINE entry (so the state
 * before this mutation is recoverable even for a skill that predates the feature), and re-writing
 * identical content mints NO new version (the library's no-op updates must not grow history).
 * @param versions - the current index, oldest first.
 * @param input - the write being recorded.
 * @param keep - how many versions to retain per skill.
 * @returns the trimmed index and the recorded numbers.
 */
export function nextHistoryIndex(
  versions: readonly SkillVersion[],
  input: VersionRecordInput,
  keep: number,
): { versions: SkillVersion[]; recorded: RecordedVersions } {
  const beforeHash = input.before === null ? null : contentHash(input.before)
  const afterHash = input.after === null ? null : contentHash(input.after)
  const grown: SkillVersion[] = [...versions]
  // "Is the predecessor already recorded?" is asked of the WHOLE index, not of its tail: two writers
  // of one skill append after releasing the content lock, so their entries can interleave — a tail
  // test would mint a bogus baseline for a predecessor that sits two entries back.
  if (beforeHash !== null && !grown.some(entry => entry.hash === beforeHash)) {
    grown.push({ v: nextVersion(grown), at: input.at, action: BASELINE_ACTION, hash: beforeHash, chars: input.before?.length ?? 0 })
  }
  if (afterHash !== null) {
    const tail = grown[grown.length - 1]
    if (tail?.hash !== afterHash) {
      grown.push({
        v: nextVersion(grown),
        at: input.at,
        action: input.action,
        hash: afterHash,
        chars: input.after?.length ?? 0,
        // The authoritative predecessor link: what THIS write replaced, read under the write lock.
        ...beforeHash === null ? {} : { beforeHash },
      })
    }
  }
  const trimmed = grown.slice(Math.max(0, grown.length - clampKeep(keep)))
  const recorded: RecordedVersions = {}
  if (beforeHash !== null) {
    const v = lastVersionOf(trimmed, beforeHash)
    if (v !== undefined) recorded.beforeVersion = v
  }
  if (afterHash !== null) {
    const v = lastVersionOf(trimmed, afterHash)
    if (v !== undefined) recorded.afterVersion = v
  }
  return { versions: trimmed, recorded }
}


/** Shrink level at which the retention line speaks: a body that keeps less than this share of the
 * previous one is a rewrite, not an edit. */
export const RETENTION_FEEDBACK_KEEP_RATIO = 0.5

/** Floor on the REPLACED body: below this a ratio is noise (a 40-character skill cut in half is not
 * news), so the line stays off for small skills. */
export const RETENTION_FEEDBACK_MIN_CHARS = 200

/** What {@link contentRetentionFeedback} reads: the one write it describes. */
export interface RetentionFeedbackInput {
  /** The skill's name, for the sentence. */
  readonly name: string
  /** The action that produced the write; only a whole-body replacement is described. */
  readonly action: string
  /** The replaced body, or null when the skill had none (create / restore). */
  readonly before: string | null
  /** The body now on disk, or null when it was removed (archive / remove_file). */
  readonly after: string | null
}

/**
 * The anti-overwrite feedback line (design §4, item 3): says how much of the previous body a
 * replacement kept, so a destructive rewrite is visible in the same message that reports the write.
 *
 * Computed where the replaced bytes are still in hand — the write path's own in-lock read — instead of
 * re-reading the file from a caller (that second read would race the writers this library serializes).
 * It is FEEDBACK, never a gate: no ratio refuses a write, and the function owns no configuration
 * (a toggle nobody reads would be configuration that does nothing).
 *
 * @param input - the write being described.
 * @returns the line, or null when the write is not a significant whole-body replacement.
 */
export function contentRetentionFeedback(input: RetentionFeedbackInput): string | null {
  // Only a whole-body replacement has a retention ratio: a patch touches an anchor, a support-file
  // write replaces a different artifact, and a create/archive has no pair of bodies to compare.
  if (input.action !== 'update') return null
  const before = input.before
  const after = input.after
  if (before === null || after === null) return null
  if (before.length < RETENTION_FEEDBACK_MIN_CHARS) return null
  if (after.length >= before.length * RETENTION_FEEDBACK_KEEP_RATIO) return null
  const kept = Math.round(after.length / before.length * 100)
  return `Content kept ${kept}% of the previous body (${after.length} of ${before.length} characters); the replaced version is preserved in this skill's history.`
}

/**
 * Read one skill's versions, oldest first.
 * @param root - the skills root.
 * @param io - the io seam.
 * @param name - the skill name.
 * @returns the versions; an absent or unreadable index reads as empty (never a throw).
 */
export async function loadVersions(root: string, io: EvolutionIoLike, name: string): Promise<SkillVersion[]> {
  const raw = await io.readText(historyIndexFile(root, name)).catch(() => null)
  return parseHistoryIndex(raw)
}

/**
 * One version's content.
 * @param root - the skills root.
 * @param io - the io seam.
 * @param name - the skill name.
 * @param v - the version number.
 * @returns the content, or null when the version or its blob cannot be read (never '').
 */
export async function loadVersionContent(root: string, io: EvolutionIoLike, name: string, v: number): Promise<string | null> {
  const versions = await loadVersions(root, io, name)
  const entry = versions.find(candidate => candidate.v === v)
  if (entry === undefined) return null
  return await io.readText(blobPath(root, entry.hash)).catch(() => null)
}

/**
 * Record the content one mutation produced, best-effort.
 *
 * Blobs are written FIRST: the index must never reference content that is not on disk, and a failed
 * blob write aborts the whole record (the caller warns; the mutation itself stands).
 * @param root - the skills root.
 * @param io - the io seam.
 * @param input - the write being recorded.
 * @param keep - how many versions to retain per skill.
 * @returns the version numbers, or null when there was no content to record.
 */
export async function recordVersions(
  root: string,
  io: EvolutionIoLike,
  input: VersionRecordInput,
  keep: number,
): Promise<RecordedVersions | null> {
  if (input.before === null && input.after === null) return null
  for (const side of [input.before, input.after]) {
    if (side === null) continue
    const hash = contentHash(side)
    const path = blobPath(root, hash)
    // Immutable + content-addressed: a second write of the same bytes is the same file, so the
    // existence probe is an optimisation, not a correctness requirement.
    if (!await io.exists(path).catch(() => false)) await io.writeText(path, side)
  }
  const file = historyIndexFile(root, input.skillName)
  // Bytes this reader cannot understand are PRESERVED before a fresh index replaces them (the same
  // posture as the activity sidecar's quarantine): deriving an index from "nothing" over a corrupt or
  // newer-reader file would drop every version it lists and orphan their blobs. If the copy itself
  // fails, the record is abandoned — the mutation stands, the old bytes stay recoverable.
  const probe = readHistoryIndex(await io.readText(file).catch(() => null))
  if (probe.kind === 'unreadable') {
    const quarantine = `${file}.corrupt`
    await io.copy(file, quarantine)
    console.warn(`skill-store: ${file} could not be understood (malformed, foreign, or written by a newer reader); its bytes were copied to ${quarantine} and a fresh index starts from this write`)
  }
  const recorded: RecordedVersions = {}
  await transactIo(io, file, (current) => {
    const state = readHistoryIndex(current)
    // A race that turned the file unreadable between the probe and this read falls back to the probe's
    // answer (an empty index): the copy above already preserved whatever the probe saw.
    const { versions, recorded: numbers } = nextHistoryIndex(state.kind === 'ok' ? state.versions : [], input, keep)
    recorded.beforeVersion = numbers.beforeVersion
    recorded.afterVersion = numbers.afterVersion
    return JSON.stringify({ version: HISTORY_INDEX_VERSION, versions }, null, 2)
  })
  return recorded
}
