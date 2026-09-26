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
 *    history (KiroCrew's `v<N>` choice, independently arrived at).
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
  beforeVersion?: number
  afterVersion?: number
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

/**
 * Parse one index body. Malformed content, a foreign shape, or a version NEWER than this reader all
 * read as empty — the audit posture: never overwrite what cannot be understood, and never guess.
 * @param raw - the index file's bytes, or null when absent.
 * @returns the versions, oldest first.
 */
export function parseHistoryIndex(raw: string | null): SkillVersion[] {
  if (raw === null) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (typeof parsed !== 'object' || parsed === null) return []
  const holder = parsed as { version?: unknown; versions?: unknown }
  if (typeof holder.version === 'number' && holder.version > HISTORY_INDEX_VERSION) return []
  if (!Array.isArray(holder.versions)) return []
  return holder.versions.filter((entry): entry is SkillVersion => {
    if (typeof entry !== 'object' || entry === null) return false
    const candidate = entry as SkillVersion
    return typeof candidate.v === 'number' && Number.isInteger(candidate.v) && candidate.v > 0
      && typeof candidate.hash === 'string' && candidate.hash !== ''
      && typeof candidate.at === 'string'
      && typeof candidate.action === 'string'
      && typeof candidate.chars === 'number'
  })
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
  if (beforeHash !== null) {
    const tail = grown[grown.length - 1]
    if (tail?.hash !== beforeHash) {
      grown.push({ v: nextVersion(grown), at: input.at, action: BASELINE_ACTION, hash: beforeHash, chars: input.before?.length ?? 0 })
    }
  }
  if (afterHash !== null) {
    const tail = grown[grown.length - 1]
    if (tail?.hash !== afterHash) {
      grown.push({ v: nextVersion(grown), at: input.at, action: input.action, hash: afterHash, chars: input.after?.length ?? 0 })
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
export async function readVersion(root: string, io: EvolutionIoLike, name: string, v: number): Promise<string | null> {
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
  let recorded: RecordedVersions = {}
  await transactIo(io, file, (current) => {
    const { versions, recorded: numbers } = nextHistoryIndex(parseHistoryIndex(current), input, keep)
    recorded = numbers
    return JSON.stringify({ version: HISTORY_INDEX_VERSION, versions }, null, 2)
  })
  return recorded
}
