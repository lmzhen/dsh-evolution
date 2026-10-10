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
import { isPresent, isUnknown, probeText } from './probe.ts'
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
  /** One line saying what this write changed, when the deployment turned the summarizer on
   * (registry `skillVersionSummary`). Absent is a first-class state: the faces say so instead of
   * inventing a sentence, and a version recorded before the feature existed simply has none. */
  summary?: string
  /**
   * Which support file these bytes came from, RELATIVE to the skill directory (`references/foo.md`),
   * when this entry records a support-file write or remove. Absent is a first-class state: content
   * versions never carry it, and every entry recorded before this field existed has none — the bytes
   * in the blob store do not carry the name, so a legacy entry stays nameless rather than guessed.
   */
  path?: string
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
  /** The one-line summary of THIS write, or undefined when the deployment does not summarize. */
  summary?: string
  /** The support file this write touched, relative to the skill directory; undefined for content. */
  path?: string
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

/** Which artifact one recorded version holds.
 *
 * `content` is the skill's own SKILL.md body. `support` is a support file's bytes: a `write_file`
 * or `remove_file` mutation stores them in the SAME index as the body's versions, so a skill that
 * ever wrote a support file has two chains in one index. `other` is an entry whose action does not say
 * which artifact the bytes belong to — a `baseline` predecessor found on disk, or an action that
 * records no content of its own (`pin`/`unpin`/`archive` record only predecessors).
 *
 * The split is FAIL-CLOSED: an action this module does not know reads as `other` rather than being
 * assumed to be the body, so a caller that offers "restore this version" never advertises bytes the
 * index cannot vouch for. `tests/skill-history.spec.ts` pins every action the library can write, so a
 * new one cannot land unclassified. */
export type VersionTarget = 'content' | 'support' | 'other'

/** The actions that record a SUPPORT FILE's bytes (they share the skill's version index). */
const SUPPORT_ACTIONS: readonly string[] = ['write_file', 'remove_file']

/** The actions that record the skill's own SKILL.md body. */
const CONTENT_ACTIONS: readonly string[] = ['create', 'update', 'patch', 'consolidate', 'restructure', 'restore']

/**
 * Which artifact one recorded version holds, from the action that produced it.
 * @param action - the entry's action label.
 * @returns the artifact class; `other` when the label does not say.
 */
export function versionTarget(action: string): VersionTarget {
  if (SUPPORT_ACTIONS.includes(action)) return 'support'
  if (CONTENT_ACTIONS.includes(action)) return 'content'
  return 'other'
}

/**
 * Which artifact one INDEX ENTRY holds.
 *
 * {@link versionTarget} reads the ACTION, which is enough for the entries a write mints under its own
 * label and is NOT enough for a {@link BASELINE_ACTION}: a baseline minted for a support write holds
 * that FILE's previous bytes while its action says only "this is what was there". Two facts recover
 * the artifact:
 *
 *  - `path` is written exactly when the bytes come from a support file, on BOTH entries one support
 *    write can mint, so it decides on its own;
 *  - an entry recorded before `path` existed has none, and the link is the evidence left: a support
 *    write names the content it replaced through `beforeHash`, so a baseline that a support write
 *    names as its predecessor holds that file's bytes.
 *
 * The inference runs only for a baseline. Every other entry keeps the action's verdict, which is also
 * the fail-closed one for an action this module does not know.
 * @param entry - one entry of a skill's index.
 * @param index - the index the entry came from: the legacy link is only readable across the whole
 *   index. Omitting it answers from `path` and the action alone.
 * @returns the artifact class; `other` when nothing attributes the bytes.
 */
export function entryTarget(entry: SkillVersion, index: readonly SkillVersion[] = []): VersionTarget {
  if (entry.path !== undefined) return 'support'
  if (entry.action !== BASELINE_ACTION) return versionTarget(entry.action)
  const namedBySupportWrite = index.some(candidate =>
    SUPPORT_ACTIONS.includes(candidate.action) && candidate.beforeHash === entry.hash)
  return namedBySupportWrite ? 'support' : 'other'
}

/** The versions of one skill, split by the artifact they hold. */
export interface VersionGroups {
  /** The body's versions, plus predecessors no evidence attributes to a support file. */
  readonly content: SkillVersion[]
  /** Support-file versions: real history, but not restorable over SKILL.md. */
  readonly support: SkillVersion[]
}

/**
 * Split one index into the skill body's chain and the support files' versions.
 *
 * Both share ONE index, so a skill that ever wrote a support file has two chains and
 * {@link orderVersions} cannot account for every entry (it falls back to the stored order). Splitting
 * first lets each group rebuild its own order, and keeps the body's chain intact by leaving every
 * entry whose artifact nothing attributes in it — a `baseline` predecessor is usually the body's
 * first link, and only the support-file baselines {@link entryTarget} recovers leave it.
 * @param versions - the stored index, oldest first as recorded.
 * @returns the two groups, each in content order when its chain is complete.
 */
export function partitionVersions(versions: readonly SkillVersion[]): VersionGroups {
  const content: SkillVersion[] = []
  const support: SkillVersion[] = []
  for (const entry of versions) {
    if (entryTarget(entry, versions) === 'support') support.push(entry)
    else content.push(entry)
  }
  return { content: orderVersions(content), support: orderVersions(support) }
}

/**
 * When this skill's content last changed: the newest `at` across BOTH chains, or null when the index
 * holds nothing.
 *
 * The stored array is APPEND order and two writers of one skill can interleave, so the answer is the
 * maximum timestamp rather than the tail. Every `at` this family writes is the same ISO-8601 UTC
 * form, so comparing the strings is comparing the instants.
 * @param versions - every entry the index holds, in any order.
 * @returns the newest timestamp, or null when there is none to report.
 */
export function latestVersionAt(versions: readonly SkillVersion[]): string | null {
  let newest: string | null = null
  for (const entry of versions) {
    if (newest === null || entry.at > newest) newest = entry.at
  }
  return newest
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
  // `summary` is metadata too, and BOTH branches must carry it: the explicit literal below is the
  // one a create (which has no beforeHash) takes, and recordVersions re-serializes whatever this
  // reader returned — a field dropped here is dropped for good on the next write.
  // EVERY optional field is folded into this one object on purpose: the two returns below then differ
  // only by the chain link, so a field added here cannot be forgotten by one of them (a field this
  // reader drops is dropped for good on the next write).
  const summary = typeof candidate.summary === 'string' && candidate.summary !== '' ? candidate.summary : undefined
  const path = typeof candidate.path === 'string' && candidate.path !== '' ? candidate.path : undefined
  const base: SkillVersion = {
    v: candidate.v,
    at: candidate.at,
    action: candidate.action,
    hash: candidate.hash,
    chars: candidate.chars,
    ...summary === undefined ? {} : { summary },
    ...path === undefined ? {} : { path },
  }
  return typeof candidate.beforeHash === 'string' && candidate.beforeHash !== ''
    ? { ...base, beforeHash: candidate.beforeHash }
    : base
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
  // A support write names its file once and BOTH entries it can mint carry it: the baseline is that
  // same file's previous bytes and the after-entry is this write's. A content write passes none.
  const pathField = input.path === undefined ? {} : { path: input.path }
  // "Is the predecessor already recorded?" is asked of the WHOLE index, not of its tail: two writers
  // of one skill append after releasing the content lock, so their entries can interleave — a tail
  // test would mint a bogus baseline for a predecessor that sits two entries back.
  if (beforeHash !== null && !grown.some(entry => entry.hash === beforeHash)) {
    grown.push({
      v: nextVersion(grown),
      at: input.at,
      action: BASELINE_ACTION,
      hash: beforeHash,
      chars: input.before?.length ?? 0,
      ...pathField,
    })
  }
  // A REMOVAL has no "after" bytes, so nothing below would mint an entry — and when the removed bytes
  // were already indexed by the file's own write, the whole mutation left NO trace: the reader could not
  // tell the file was deleted, and the `support-remove` vocabulary stayed unreachable (E2, 2026-09-30).
  // The entry carries the bytes that were removed, labeled with the write that removed them, so a face
  // can say "these bytes are gone" and undoing it puts them back.
  const removalHash = afterHash === null ? beforeHash : null
  if (afterHash !== null) {
    const tail = grown[grown.length - 1]
    if (tail?.hash !== afterHash) {
      grown.push({
        v: nextVersion(grown),
        at: input.at,
        action: input.action,
        hash: afterHash,
        chars: input.after?.length ?? 0,
        ...pathField,
        // The summary describes THIS write, so it rides the after-entry only: the baseline minted
        // above is the state BEFORE it and has nothing to summarize.
        ...input.summary === undefined ? {} : { summary: input.summary },
        // The authoritative predecessor link: what THIS write replaced, read under the write lock.
        ...beforeHash === null ? {} : { beforeHash },
      })
    }
  }
  if (removalHash !== null) {
    const tail = grown[grown.length - 1]
    // A baseline of the same bytes may sit right above (a removal of a file the index never saw): that
    // entry says "we first saw these bytes", this one says "and then they were removed", and the second
    // is what the face needs. Self-reference is deliberately omitted: the entry's own hash IS the
    // removed content, so a `beforeHash` link would point at itself.
    if (tail?.hash !== removalHash || tail.action !== input.action) {
      grown.push({
        v: nextVersion(grown),
        at: input.at,
        action: input.action,
        hash: removalHash,
        chars: input.before?.length ?? 0,
        ...pathField,
        ...input.summary === undefined ? {} : { summary: input.summary },
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
  const file = historyIndexFile(root, name)
  // N36 (group-5 sweep): three-state. A failed read is not "this skill has no history" — the bytes may
  // be there and unreadable, and serving that as empty is what made a broken store look empty. This read
  // surface has no unknown state (its consumers are the panel and the diff), so the degradation is NAMED
  // and the answer stays empty; the WRITE path (recordVersions below) refuses outright.
  const probe = await probeText(io, file)
  if (isUnknown(probe)) {
    console.warn(`skill-store: ${file} could not be read (${probe.reason}); reporting no versions for "${name}" — the bytes are untouched`)
    return []
  }
  return parseHistoryIndex(isPresent(probe) ? probe.value : null)
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
  // N36: a blob that cannot be READ is not a blob that is not there — the answer is `null` either way
  // (this face has no unknown state), but the reason is named instead of swallowed.
  const probe = await probeText(io, blobPath(root, entry.hash))
  if (isUnknown(probe)) {
    console.warn(`skill-store: version ${v} of "${name}" could not be read (${probe.reason}); reporting no content`)
    return null
  }
  return isPresent(probe) ? probe.value : null
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
    // existence probe is an optimisation, not a correctness requirement. N36: a probe that FAILS is not
    // "not there" — both answers lead to the same write here, so the degradation is named rather than
    // swallowed (a backend whose stat fails will fail the write too, which the caller reports).
    let blobPresent: boolean
    try {
      blobPresent = await io.exists(path)
    } catch (error) {
      blobPresent = false
      console.warn(`skill-store: could not check whether the history blob ${path} exists (${error instanceof Error ? error.message : String(error)}); writing it — content-addressed bytes are the same file`)
    }
    if (!blobPresent) await io.writeText(path, side)
  }
  const file = historyIndexFile(root, input.skillName)
  // Bytes this reader cannot understand are PRESERVED before a fresh index replaces them (the same
  // posture as the activity sidecar's quarantine): deriving an index from "nothing" over a corrupt or
  // newer-reader file would drop every version it lists and orphan their blobs. If the copy itself
  // fails, the record is abandoned — the mutation stands, the old bytes stay recoverable.
  // PLAN S3.2/S3.3 (audit 1-2, P1): the probe is a THREE-state read. "Could not read" is not "no
  // index": serving a failed read as absent skipped the rescue copy below and then let the
  // in-lock read derive a fresh index from nothing over bytes this reader never saw. On a failed
  // read the record is ABANDONED (the mutation stands, the bytes stay, a rescue copy is attempted
  // out of band because copying needs no parsing).
  const fileProbe = await probeText(io, file)
  if (isUnknown(fileProbe)) {
    const quarantine = `${file}.corrupt`
    try {
      await io.copy(file, quarantine)
    } catch {
      // Best-effort: the copy is a convenience, the abandoned record is the guarantee.
    }
    console.warn(`skill-store: ${file} could not be read (${fileProbe.reason}); its bytes were copied to ${quarantine} where possible and the version record for this write was abandoned — the mutation stands and the file is untouched`)
    return null
  }
  const probe = readHistoryIndex(isPresent(fileProbe) ? fileProbe.value : null)
  if (probe.kind === 'unreadable') {
    const quarantine = `${file}.corrupt`
    await io.copy(file, quarantine)
    console.warn(`skill-store: ${file} could not be understood (malformed, foreign, or written by a newer reader); its bytes were copied to ${quarantine} and a fresh index starts from this write`)
  }
  const recorded: RecordedVersions = {}
  let raceRefused: boolean = false
  await transactIo(io, file, (current) => {
    const state = readHistoryIndex(current)
    // The old comment here claimed the probe's copy covered a race. It only did when the probe had
    // ALREADY seen the bytes as unreadable; a file that turned unreadable in between had no copy, and
    // deriving the index from `[]` dropped every version it listed (and orphaned their blobs).
    // Returning `current` unchanged is a byte-identical no-op, so the bytes survive and this record
    // is abandoned below. Only an UNREADABLE state refuses: an ABSENT file is a skill with no
    // history yet, and refusing there would abandon every first record (the index must be created).
    if (state.kind === 'unreadable' && probe.kind !== 'unreadable') {
      raceRefused = true
      return current
    }
    const { versions, recorded: numbers } = nextHistoryIndex(state.kind === 'ok' ? state.versions : [], input, keep)
    recorded.beforeVersion = numbers.beforeVersion
    recorded.afterVersion = numbers.afterVersion
    return JSON.stringify({ version: HISTORY_INDEX_VERSION, versions }, null, 2)
  })
  // v46 lint: `raceRefused` is set inside the transact task (the analyzer sees only the literal
  // initializer), and the refusal is the S3.1 case this branch exists for.
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- set inside the transact task
  if (raceRefused) {
    const quarantine = `${file}.corrupt`
    try {
      await io.copy(file, quarantine)
    } catch {
      // Best-effort rescue copy; the refusal above is what protects the bytes.
    }
    console.warn(`skill-store: ${file} became unreadable between the probe and the locked read; its bytes were copied to ${quarantine} where possible and the version record for this write was abandoned — nothing was overwritten`)
    return null
  }
  return recorded
}
// ─── Faces of one version (0.13.0) ──────────────────────────────────────────
// Everything a PERSON reads about a version is derived here, once: the faces (the browser panel and
// the slash commands) translate facts into their own words and never re-derive, so the two cannot
// drift. No sentence lives in this module — the words belong to the locale dictionary (panel) and to
// the command surface (English).

/** What kind of change one recorded version carries, as a CLOSED set. */
export type VersionActionKind =
  | 'baseline' | 'create' | 'patch' | 'update' | 'restore' | 'delete' | 'archive'
  | 'consolidate' | 'restructure' | 'support-write' | 'support-remove' | 'other'

/**
 * Classify one version action for display. Fail-closed like {@link versionTarget}: an action this
 * module does not know reads as `other` rather than being guessed, and `tests/skill-history.spec.ts`
 * pins every action the library can write, so a new one cannot land unclassified.
 * @param action - the entry’s action label.
 * @returns the kind the faces switch on.
 */
export function versionActionKind(action: string): VersionActionKind {
  switch (action) {
    case BASELINE_ACTION: return 'baseline'
    case 'create': return 'create'
    case 'patch': case 'edit': return 'patch'
    case 'update': return 'update'
    case 'restore': return 'restore'
    // The body a delete or an archive REMOVED is what the entry holds, so it labels itself.
    case 'delete': return 'delete'
    case 'archive': return 'archive'
    case 'consolidate': return 'consolidate'
    case 'restructure': return 'restructure'
    case 'write_file': return 'support-write'
    case 'remove_file': return 'support-remove'
    default: return 'other'
  }
}

/** One changed region between two bodies — the shape the platform’s diff card eats. */
export interface TextDiffHunk {
  readonly path: string
  readonly oldText: string
  readonly newText: string
}

/** What one whole-body replacement changed, as facts. */
export interface TextDiffFacts {
  readonly linesAdded: number
  readonly linesRemoved: number
  readonly hunks: readonly TextDiffHunk[]
  /** True when a changed region was longer than the window, so its text is a prefix. */
  readonly truncated: boolean
}

/** Lines one changed region may carry before it is windowed and flagged. */
export const TEXT_DIFF_MAX_LINES = 40

/** Characters one windowed side may carry, so a single enormous line cannot travel whole. */
export const TEXT_DIFF_MAX_CHARS = 4_000

/**
 * The facts of one whole-body replacement: how many lines the changed region gained and lost, and
 * that region itself as one hunk.
 *
 * The algorithm is the honest one for "what did this edit touch": common leading and trailing lines
 * are trimmed away and what remains is ONE contiguous region. It is not a minimal edit script — a
 * body edited in two distant places reports their span as one region — and that limitation is the
 * reason the faces show the region as context rather than as a line-by-line proof.
 * @param before - the body the write replaced.
 * @param after - the body the write stored.
 * @param path - the path the hunk names (the platform’s diff card requires one).
 * @param maxLines - the window a region’s text is capped to.
 * @returns the counts, the windowed hunk, and whether the window cut anything.
 */
export function textDiffFacts(before: string, after: string, path: string, maxLines: number = TEXT_DIFF_MAX_LINES): TextDiffFacts {
  // An EMPTY body is zero lines, not one blank line: otherwise every first version reports a removal
  // that never happened (`before: ''` was being counted as one line).
  const oldLines = before === '' ? [] : before.split('\n')
  const newLines = after === '' ? [] : after.split('\n')
  let head = 0
  while (head < oldLines.length && head < newLines.length && oldLines[head] === newLines[head]) head += 1
  let tail = 0
  while (tail < oldLines.length - head && tail < newLines.length - head
    && oldLines[oldLines.length - 1 - tail] === newLines[newLines.length - 1 - tail]) tail += 1
  const oldRegion = oldLines.slice(head, oldLines.length - tail)
  const newRegion = newLines.slice(head, newLines.length - tail)
  if (oldRegion.length === 0 && newRegion.length === 0) {
    return { linesAdded: 0, linesRemoved: 0, hunks: [], truncated: false }
  }
  // The window is bounded by BOTH lines and characters: a single 100 KB line is one line and would
  // otherwise travel whole, which is exactly what the request-side body cap exists to prevent.
  const window = (lines: readonly string[]): { text: string; cut: boolean } => {
    const byLines = lines.slice(0, maxLines)
    const joined = byLines.join('\n')
    if (joined.length <= TEXT_DIFF_MAX_CHARS) return { text: joined, cut: lines.length > maxLines }
    return { text: joined.slice(0, TEXT_DIFF_MAX_CHARS), cut: true }
  }
  const oldWindow = window(oldRegion)
  const newWindow = window(newRegion)
  return {
    linesAdded: newRegion.length,
    linesRemoved: oldRegion.length,
    hunks: [{ path, oldText: oldWindow.text, newText: newWindow.text }],
    truncated: oldWindow.cut || newWindow.cut,
  }
}

/** Characters one generated summary may carry. */
export const VERSION_SUMMARY_MAX_CHARS = 80

/**
 * The fixed prompt the optional per-write summarizer runs (registry `skillVersionSummary`).
 *
 * Model-visible, so it is written from the model’s perspective and pinned: the tests assert that it
 * carries the skill name, the character cap and both bodies, because a silent change to a prompt is a
 * silent change to what every recorded version says.
 * @param input - the skill, the action, and the two bodies (null when absent).
 * @returns the prompt text.
 */
export function versionSummaryPrompt(input: { name: string; action: string; before: string | null; after: string | null }): string {
  return [
    'You are writing ONE line that tells a reader what this single edit to the agent skill',
    '"' + input.name + '" changed. The edit action was "' + input.action + '".',
    'Rules: at most ' + String(VERSION_SUMMARY_MAX_CHARS) + ' characters; the same language as the body;',
    'name the decision, number or section that moved (for example "keeps 30 days instead of 90 days");',
    'never say merely that something changed; no preamble, quotes, markdown or trailing period.',
    '',
    'Body BEFORE the edit:',
    input.before ?? '(the skill did not exist before this edit)',
    '',
    'Body AFTER the edit:',
    input.after ?? '(the skill does not exist after this edit)',
  ].join('\n')
}

/**
 * Reduce a model answer to the one line the index stores.
 * @param raw - the model’s answer, whatever shape it came in.
 * @param maxChars - the character cap.
 * @returns the one line, or undefined when there is nothing usable (callers store no summary).
 */
export function normalizeVersionSummary(raw: string, maxChars: number = VERSION_SUMMARY_MAX_CHARS): string | undefined {
  const firstLine = raw.split('\n').map(line => line.trim()).find(line => line !== '')
  if (firstLine === undefined) return undefined
  const stripped = firstLine.replace(/^["'`*•s]+/u, '').replace(/["'`*s]+$/u, '').replace(/[。.]$/u, '').trim()
  if (stripped === '') return undefined
  return stripped.length > maxChars ? stripped.slice(0, maxChars - 1) + '…' : stripped
}
/** A relative age, in the shape the platform’s own `relativeTime(at, now)` returns. */
export interface RelativeAge {
  readonly unit: 'now' | 'minutes' | 'hours' | 'days' | 'months' | 'years'
  readonly n: number
}

/**
 * How long ago an ISO timestamp was, as a bucket plus a count — never as a sentence.
 *
 * The shape deliberately mirrors the platform’s `relativeTime` (`ui-primitives`), so a face that later
 * may import the platform helper swaps one call and keeps its dictionary; the WORDS live in the
 * faces (the panel’s locale dictionary, the command surface’s English), which is why this module
 * returns numbers.
 * @param at - an ISO timestamp, or any string `Date.parse` understands.
 * @param nowMs - the reference instant.
 * @returns the bucket and its count; an unparsable timestamp reads as `now` with 0.
 */
export function elapsedSince(at: string, nowMs: number): RelativeAge {
  const then = Date.parse(at)
  if (Number.isNaN(then)) return { unit: 'now', n: 0 }
  const minutes = Math.floor(Math.max(0, nowMs - then) / 60_000)
  if (minutes < 1) return { unit: 'now', n: 0 }
  if (minutes < 60) return { unit: 'minutes', n: minutes }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return { unit: 'hours', n: hours }
  const days = Math.floor(hours / 24)
  if (days < 30) return { unit: 'days', n: days }
  const months = Math.floor(days / 30)
  if (months < 12) return { unit: 'months', n: months }
  // A year is never "0 years ago": 360 days reads as months by the platform's own helper, and here as
  // the first year, which is the honest bucket for "older than eleven months".
  return { unit: 'years', n: Math.max(1, Math.floor(days / 365)) }
}


