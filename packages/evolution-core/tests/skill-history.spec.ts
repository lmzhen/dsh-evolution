/**
 * Skill content history (design \`dsh-evolution-skill-history-design.md\` batch A).
 *
 * Two layers are pinned here: the PURE versioning rules (nextHistoryIndex) and the io-backed
 * recorder over a real library (create/update/patch → versions that can be read back).
 */
import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_SKILL_LIMITS } from '../src/limits.ts'
import { nodeEvolutionIo, type EvolutionIoLike } from '../src/io.ts'
import { SkillLibrary } from '../src/skill-store.ts'
import { contentHash } from '../src/mutations.ts'
import {
  BASELINE_ACTION,
  contentRetentionFeedback,
  entryTarget,
  HISTORY_INDEX_VERSION,
  historyIndexFile,
  loadVersions,
  nextHistoryIndex,
  orderVersions,
  partitionVersions,
  parseHistoryIndex,
  readHistoryIndex,
  latestVersionAt,
  loadVersionContent,
  recordVersions,
  normalizeVersionSummary,
  RETENTION_FEEDBACK_MIN_CHARS,
  type SkillVersion,
  textDiffFacts,
  TEXT_DIFF_MAX_LINES,
  VERSION_SUMMARY_MAX_CHARS,
  versionActionKind,
  versionSummaryPrompt,
  versionTarget,
} from '../src/skill-history.ts'

const skill = (name: string, body = 'Body.'): string => `---\nname: ${name}\ndescription: history fixture\n---\n${body}\n`

/** A version entry as the index stores it, with a hash that stands in for real content. */
const entry = (v: number, hash: string, action = 'update'): SkillVersion => ({ v, at: `2026-09-27T00:00:0${v}Z`, action, hash, chars: 10 })

async function tempRoot(prefix: string): Promise<string> {
  return await mkdtemp(join(tmpdir(), prefix))
}

describe('skill-history: pure versioning rules', () => {
  it('heals a predecessor the index has never seen with ONE baseline entry', () => {
    const input = { skillName: 's', action: 'update', before: 'old', after: 'new', at: 'T' }
    const first = nextHistoryIndex([], input, 20)
    // 'old' was never recorded (a skill that predates the feature) => baseline, then the write.
    expect(first.versions.map(v => [v.v, v.action])).toEqual([[1, BASELINE_ACTION], [2, 'update']])
    expect(first.recorded).toEqual({ beforeVersion: 1, afterVersion: 2 })
    // The NEXT write's before-side is what the previous one produced, so the tail already
    // describes it and no second baseline appears (the library's real sequence).
    const again = nextHistoryIndex(first.versions, { ...input, before: 'new', after: 'newer' }, 20)
    expect(again.versions.map(v => v.v)).toEqual([1, 2, 3])
    expect(again.recorded).toEqual({ beforeVersion: 2, afterVersion: 3 })
  })

  it('records a baseline for content that came back WITHOUT a version (a whole-tree restore)', () => {
    // After `restoreLatestSnapshot` the live body can be an older state while the index tail is
    // newer. The next write's before-side is then a state no version describes — recording it as a
    // baseline is what makes "what was there before this mutation" answerable again.
    const restored = [entry(1, 'a'), entry(2, 'b')]
    const next = nextHistoryIndex(restored, { skillName: 's', action: 'update', before: 'a', after: 'c', at: 'T' }, 20)
    expect(next.versions.map(v => [v.v, v.action])).toEqual([[1, 'update'], [2, 'update'], [3, BASELINE_ACTION], [4, 'update']])
    expect(next.recorded).toEqual({ beforeVersion: 3, afterVersion: 4 })
  })

  it('mints NO version when the content is unchanged (no-op writes must not grow history)', () => {
    const input = { skillName: 's', action: 'update', before: 'same', after: 'same', at: 'T' }
    const result = nextHistoryIndex([entry(1, 'h1')], { ...input }, 20)
    // The baseline for 'same' is appended once, and the after-side is that same entry.
    expect(result.versions).toHaveLength(2)
    expect(result.recorded.afterVersion).toBe(result.recorded.beforeVersion)
  })

  it('trims to the retention count and numbers by max+1 (never by the clock)', () => {
    const input = { skillName: 's', action: 'update', before: null, after: 'x', at: 'T' }
    const grown = nextHistoryIndex([entry(1, 'a'), entry(2, 'b')], input, 2)
    // max+1 = 3 for the appended version, then trimmed to the newest 2.
    expect(grown.versions.map(v => v.v)).toEqual([2, 3])
    // keep is clamped to >= 1: a deployment cannot configure history away.
    const clamped = nextHistoryIndex(grown.versions, { ...input, after: 'y' }, 0)
    expect(clamped.versions.map(v => v.v)).toEqual([4])
    expect(clamped.versions).toHaveLength(1)
  })

  it('reads a malformed, foreign or newer index as EMPTY (never guesses)', () => {
    expect(parseHistoryIndex(null)).toEqual([])
    expect(parseHistoryIndex('{ not json')).toEqual([])
    expect(parseHistoryIndex(JSON.stringify({ version: HISTORY_INDEX_VERSION + 1, versions: [entry(1, 'a')] }))).toEqual([])
    expect(parseHistoryIndex(JSON.stringify({ version: HISTORY_INDEX_VERSION, versions: [{ v: 'x' }] }))).toEqual([])
    expect(parseHistoryIndex(JSON.stringify({ version: HISTORY_INDEX_VERSION, versions: [entry(1, 'a')] }))).toHaveLength(1)
  })
})

describe('skill-history: the library records what it writes', () => {
  it('create/update/patch each produce a version whose content reads back', async () => {
    const root = await tempRoot('dsh-skill-history-')
    const io = nodeEvolutionIo()
    const lib = new SkillLibrary(root, io, { ...DEFAULT_SKILL_LIMITS, versionKeep: 20 })
    try {
      await lib.create('hist-skill', skill('hist-skill', 'One.'))
      await lib.update('hist-skill', skill('hist-skill', 'Two.'))
      await lib.patch('hist-skill', 'Two.', 'Three.')
      const versions = await loadVersions(root, io, 'hist-skill')
      expect(versions.map(v => v.action)).toEqual(['create', 'update', 'patch'])
      expect(versions.map(v => v.v)).toEqual([1, 2, 3])
      // The content of each version is readable, in order — the whole point of the seam.
      expect(await loadVersionContent(root, io, 'hist-skill', 1)).toContain('One.')
      expect(await loadVersionContent(root, io, 'hist-skill', 2)).toContain('Two.')
      expect(await loadVersionContent(root, io, 'hist-skill', 3)).toContain('Three.')
      // The ledger points at the versions it produced.
      const ledger = await lib.listMutations()
      const update = ledger.find(record => record.action === 'update')
      expect(update?.afterVersion).toBe(2)
      expect(update?.beforeVersion).toBe(1)
      // Discovery never treats the history directory as a skill.
      expect((await lib.list()).map(summary => summary.name)).toEqual(['hist-skill'])
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })

  it('keeps history on disk when the tree is rolled back from a snapshot', async () => {
    const root = await tempRoot('dsh-skill-history-restore-')
    const io = nodeEvolutionIo()
    const lib = new SkillLibrary(root, io, { ...DEFAULT_SKILL_LIMITS, versionKeep: 20 })
    try {
      await lib.create('keep-skill', skill('keep-skill', 'One.'))
      await lib.snapshotAll('test')
      await lib.update('keep-skill', skill('keep-skill', 'Two.'))
      await lib.restoreLatestSnapshot()
      // Content rolled back, history did NOT: a rollback must not erase the versions it may need.
      expect(await lib.read('keep-skill')).toContain('One.')
      expect((await loadVersions(root, io, 'keep-skill')).length).toBeGreaterThanOrEqual(2)
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })

  it('retains only the newest N versions and drops the rest from the index', async () => {
    const root = await tempRoot('dsh-skill-history-keep-')
    const io = nodeEvolutionIo()
    const lib = new SkillLibrary(root, io, { ...DEFAULT_SKILL_LIMITS, versionKeep: 2 })
    try {
      await lib.create('trim-skill', skill('trim-skill', 'One.'))
      await lib.update('trim-skill', skill('trim-skill', 'Two.'))
      await lib.update('trim-skill', skill('trim-skill', 'Three.'))
      const versions = await loadVersions(root, io, 'trim-skill')
      expect(versions).toHaveLength(2)
      expect(versions.at(-1)?.chars ?? 0).toBeGreaterThan(0)
      expect(await loadVersionContent(root, io, 'trim-skill', 1)).toBeNull()
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })

  it('a failed history write never fails the mutation, and is not silent', async () => {
    const root = await tempRoot('dsh-skill-history-degrade-')
    const io = nodeEvolutionIo()
    const warns: string[] = []
    const originalWarn = console.warn
    console.warn = (message?: unknown) => { warns.push(String(message)) }
    // An io seam whose writes fail: the mutation must still land, with one warning.
    const brokenIo = { ...io, writeText: async () => { throw new Error('disk on fire') } }
    const lib = new SkillLibrary(root, brokenIo, { ...DEFAULT_SKILL_LIMITS, versionKeep: 20 })
    try {
      const created = await lib.create('degraded-skill', skill('degraded-skill'))
      expect(created.ok, created.message).toBe(true)
      await lib.update('degraded-skill', skill('degraded-skill', 'Two.'))
      await lib.update('degraded-skill', skill('degraded-skill', 'Three.'))
      // Warned once, not per write.
      expect(warns.filter(message => message.includes('content history not recorded'))).toHaveLength(1)
    } finally {
      console.warn = originalWarn
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })

  it('recordVersions writes the index under the history directory, versioned', async () => {
    const root = await tempRoot('dsh-skill-history-record-')
    const io = nodeEvolutionIo()
    try {
      const recorded = await recordVersions(root, io, { skillName: 'raw', action: 'create', before: null, after: 'body', at: 'T' }, 20)
      expect(recorded).toEqual({ afterVersion: 1 })
      const raw = await io.readText(historyIndexFile(root, 'raw'))
      expect(raw).toContain(`"version": ${HISTORY_INDEX_VERSION}`)
      expect(raw).toContain('"action": "create"')
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })
})

describe('skill-history: a support file\'s path (batch: record where the bytes came from)', () => {
  it('carries the path on BOTH entries one write_file can mint, and survives a re-serialization', async () => {
    const root = await tempRoot('dsh-skill-history-path-')
    const io = nodeEvolutionIo()
    try {
      // First support write: the file was never recorded, so a baseline is minted beside the after
      // entry — BOTH describe `references/notes.md` and both must carry its name.
      await recordVersions(root, io, {
        skillName: 'with-support', action: 'write_file', before: 'old notes', after: 'new notes', at: 'T1', path: 'references/notes.md',
      }, 20)
      const first = await loadVersions(root, io, 'with-support')
      expect(first.map(entry => entry.action)).toEqual([BASELINE_ACTION, 'write_file'])
      expect(first.map(entry => entry.path)).toEqual(['references/notes.md', 'references/notes.md'])
      // A second write re-serializes what the reader returned: a field this reader dropped would be
      // gone from every earlier entry after it.
      await recordVersions(root, io, {
        skillName: 'with-support', action: 'write_file', before: 'new notes', after: 'newer notes', at: 'T2', path: 'references/notes.md',
      }, 20)
      const second = await loadVersions(root, io, 'with-support')
      expect(second).toHaveLength(3)
      expect(second.every(entry => entry.path === 'references/notes.md')).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })

  it('leaves a legacy entry nameless instead of inventing a path, and keeps content entries nameless', async () => {
    const root = await tempRoot('dsh-skill-history-path-legacy-')
    const io = nodeEvolutionIo()
    try {
      await io.writeText(historyIndexFile(root, 'legacy'), JSON.stringify({
        version: HISTORY_INDEX_VERSION,
        versions: [{ v: 1, at: 'T1', action: 'write_file', hash: contentHash('bytes'), chars: 5 }],
      }))
      const read = await loadVersions(root, io, 'legacy')
      expect(read).toHaveLength(1)
      expect(read[0]!.path).toBeUndefined()
      // Rewriting the same content mints nothing, so the nameless entry stays exactly as it was.
      const again = await recordVersions(root, io, {
        skillName: 'legacy', action: 'update', before: null, after: 'body', at: 'T2',
      }, 20)
      expect(again).not.toBeNull()
      const after = await loadVersions(root, io, 'legacy')
      expect(after.find(entry => entry.action === 'update')?.path).toBeUndefined()
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })
})

describe('skill-history: when the content last changed (latestVersionAt)', () => {
  it('answers with the newest timestamp across both chains, whatever the stored order says', () => {
    const mixed: SkillVersion[] = [
      { v: 3, at: '2026-09-27T10:00:00Z', action: 'write_file', hash: 'c', chars: 1 },
      { v: 1, at: '2026-09-27T12:00:00Z', action: 'create', hash: 'a', chars: 1 },
      { v: 2, at: '2026-09-27T11:00:00Z', action: 'update', hash: 'b', chars: 1 },
    ]
    expect(latestVersionAt(mixed)).toBe('2026-09-27T12:00:00Z')
  })

  it('answers null for an index that holds nothing', () => {
    expect(latestVersionAt([])).toBeNull()
  })
})

describe('skill-history: the chain link survives interleaved writers (review P1)', () => {
  it('records the replaced content, and asks the WHOLE index before minting a baseline', () => {
    // The predecessor sits two entries back — the shape two writers of one skill produce when their
    // audits land out of order. A tail test would mint a bogus baseline here.
    const first = 'first body'
    const second = 'second body'
    const third = 'third body'
    const interleaved: SkillVersion[] = [
      { v: 1, at: 'T1', action: 'create', hash: contentHash(first), chars: first.length },
      { v: 2, at: 'T2', action: 'update', hash: contentHash(second), chars: second.length, beforeHash: contentHash(first) },
      { v: 3, at: 'T3', action: 'update', hash: contentHash(third), chars: third.length, beforeHash: contentHash(second) },
    ]
    const grown = nextHistoryIndex(interleaved, { skillName: 's', action: 'update', before: second, after: 'fourth body', at: 'T4' }, 20)
    // No baseline: a version with the predecessor's hash is already recorded.
    expect(grown.versions.filter(entry => entry.action === BASELINE_ACTION)).toEqual([])
    expect(grown.versions).toHaveLength(4)
    const written = grown.versions[3]!
    expect(written.action).toBe('update')
    expect(written.beforeHash).toBe(contentHash(second))
  })

  it('orderVersions rebuilds content order from the chain, and keeps the stored order when the chain is broken', () => {
    // An index whose APPEND order is wrong: v3 landed before v2 (two writers, audits out of order).
    const inverted: SkillVersion[] = [
      { v: 1, at: 'T1', action: 'create', hash: 'aaa', chars: 3 },
      { v: 3, at: 'T3', action: 'update', hash: 'ccc', chars: 3, beforeHash: 'bbb' },
      { v: 2, at: 'T2', action: 'update', hash: 'bbb', chars: 3, beforeHash: 'aaa' },
    ]
    expect(orderVersions(inverted).map(entry => entry.v)).toEqual([1, 2, 3])
    // A broken chain (an entry written before the link existed) is left exactly as stored.
    const broken: SkillVersion[] = [
      { v: 1, at: 'T1', action: 'create', hash: 'aaa', chars: 3 },
      { v: 2, at: 'T2', action: 'update', hash: 'bbb', chars: 3 },
    ]
    expect(orderVersions(broken).map(entry => entry.v)).toEqual([1, 2])
    expect(orderVersions([])).toEqual([])
  })

  it('reads an index nobody can understand as UNREADABLE, and a real one as ok', () => {
    expect(readHistoryIndex(null)).toEqual({ kind: 'absent' })
    expect(readHistoryIndex('   ')).toEqual({ kind: 'unreadable' })
    expect(readHistoryIndex('{not json')).toEqual({ kind: 'unreadable' })
    expect(readHistoryIndex('[1,2]')).toEqual({ kind: 'unreadable' })
    expect(readHistoryIndex(JSON.stringify({ version: HISTORY_INDEX_VERSION + 1, versions: [] }))).toEqual({ kind: 'unreadable' })
    // A well-formed file carrying an entry this reader would have to DROP counts as unreadable:
    // dropping it silently is the overwrite the audit posture forbids.
    expect(readHistoryIndex(JSON.stringify({ version: 1, versions: [{ v: 1 }] }))).toEqual({ kind: 'unreadable' })
    const ok = readHistoryIndex(JSON.stringify({ version: 1, versions: [{ v: 1, at: 'T', action: 'create', hash: 'aaa', chars: 3, beforeHash: 'zzz' }] }))
    expect(ok.kind).toBe('ok')
    expect(ok.kind === 'ok' ? ok.versions[0]?.beforeHash : null).toBe('zzz')
  })
})

describe('skill-history: an unreadable index is preserved, never overwritten (review P1)', () => {
  it('copies the bytes it cannot understand to .corrupt and starts a fresh index', async () => {
    const root = await tempRoot('dsh-skill-history-quarantine-')
    const io = nodeEvolutionIo()
    const index = historyIndexFile(root, 'legacy-skill')
    const corrupt = '{"version":1,"versions":[{"v":7,"at":"T","action":"update","hash":"deadbeef","chars":4}'
    await io.writeText(index, corrupt)
    try {
      const recorded = await recordVersions(root, io, { skillName: 'legacy-skill', action: 'update', before: 'old body', after: 'new body', at: 'T2' }, 20)
      // The replaced body becomes v1 (a baseline the quarantined index could no longer supply), the
      // write itself v2.
      expect(recorded?.beforeVersion).toBe(1)
      expect(recorded?.afterVersion).toBe(2)
      // The old bytes are still on disk, verbatim, under the quarantine name.
      expect(await io.readText(`${index}.corrupt`)).toBe(corrupt)
      // And the fresh index is readable and starts from this write.
      expect((await loadVersions(root, io, 'legacy-skill')).map(entry => entry.action)).toEqual(['baseline', 'update'])
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })

  it('REFUSES to record when the quarantine copy itself fails (the old bytes stay the only copy)', async () => {
    const root = await tempRoot('dsh-skill-history-quarantine-fail-')
    const base = nodeEvolutionIo()
    const index = historyIndexFile(root, 'legacy-skill')
    await base.writeText(index, '{not json')
    const io = {
      name: 'copy-fails',
      readText: (path: string) => base.readText(path),
      writeText: (path: string, content: string) => base.writeText(path, content),
      remove: (path: string) => base.remove(path),
      list: (path: string) => base.list(path),
      exists: (path: string) => base.exists(path),
      rename: (path: string, destination: string) => base.rename(path, destination),
      copy: async () => { throw new Error('quarantine write refused') },
    }
    try {
      await expect(recordVersions(root, io, { skillName: 'legacy-skill', action: 'update', before: 'a', after: 'b', at: 'T' }, 20)).rejects.toThrow('quarantine write refused')
      // Nothing replaced them: the unreadable bytes are exactly what was there.
      expect(await base.readText(index)).toBe('{not json')
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })
})

describe('skill-history: the retention line (design §4 item 3)', () => {
  const big = 'x'.repeat(RETENTION_FEEDBACK_MIN_CHARS)

  it('speaks only for a significant whole-body replacement', () => {
    // A 4x shrink of a body above the floor: the line names the share kept, in characters.
    const line = contentRetentionFeedback({ name: 's', action: 'update', before: big, after: 'x'.repeat(50) })
    expect(line).toContain('Content kept 25% of the previous body (50 of 200 characters)')
    expect(line).toContain('the replaced version is preserved')
    // Growth, an equal size and a small shrink are edits, not news.
    expect(contentRetentionFeedback({ name: 's', action: 'update', before: big, after: big + big })).toBeNull()
    expect(contentRetentionFeedback({ name: 's', action: 'update', before: big, after: big })).toBeNull()
    expect(contentRetentionFeedback({ name: 's', action: 'update', before: big, after: 'x'.repeat(150) })).toBeNull()
    // Below the floor the ratio is noise (a 40-character skill cut in half).
    expect(contentRetentionFeedback({ name: 's', action: 'update', before: 'x'.repeat(40), after: 'x' })).toBeNull()
  })

  it('is silent for every action that is not a whole-body replacement', () => {
    for (const action of ['create', 'patch', 'write_file', 'remove_file', 'archive', 'restore', 'restructure']) {
      expect(contentRetentionFeedback({ name: 's', action, before: big, after: 'x' })).toBeNull()
    }
    // A missing side is not a ratio either.
    expect(contentRetentionFeedback({ name: 's', action: 'update', before: null, after: 'x' })).toBeNull()
    expect(contentRetentionFeedback({ name: 's', action: 'update', before: big, after: null })).toBeNull()
  })

  it('reaches the message of a real shrinking update and never changes ok', async () => {
    const root = await tempRoot('dsh-skill-history-retention-')
    const io = nodeEvolutionIo()
    const lib = new SkillLibrary(root, io, { ...DEFAULT_SKILL_LIMITS, versionKeep: 20 })
    try {
      const body = Array.from({ length: 10 }, (_, index) => `## Section ${index}\n${'detail '.repeat(20)}`).join('\n')
      await lib.create('shrink-skill', skill('shrink-skill', body))
      const rewritten = await lib.update('shrink-skill', skill('shrink-skill', '## Section 0\nsummary only'))
      expect(rewritten.ok).toBe(true)
      expect(rewritten.message).toContain('Content kept')
      expect(rewritten.message).toContain('the replaced version is preserved')
      // The line is FEEDBACK: a huge shrink still writes, and the growth direction stays quiet.
      const grown = await lib.update('shrink-skill', skill('shrink-skill', body))
      expect(grown.ok).toBe(true)
      expect(grown.message).not.toContain('Content kept')
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })
})

describe('skill-history: which artifact a version holds (0.10.1)', () => {
  it('classifies by action, and is fail-closed for an action it does not know', () => {
    for (const action of ['create', 'update', 'patch', 'consolidate', 'restructure', 'restore']) {
      expect(versionTarget(action), action).toBe('content')
    }
    for (const action of ['write_file', 'remove_file']) expect(versionTarget(action), action).toBe('support')
    // A predecessor found on disk: the index does not say which file it holds.
    expect(versionTarget(BASELINE_ACTION)).toBe('other')
    // An action nobody registered reads as 'other', never as the body: a caller that offers
    // "restore this version" must not advertise bytes the index cannot vouch for.
    expect(versionTarget('invented-by-a-future-release')).toBe('other')
  })

  it('pins every action the library can write, so a new one cannot land unclassified', async () => {
    const source = await readFile(new URL('../src/skill-store.ts', import.meta.url), 'utf8')
    const found = new Set<string>()
    const shapes = [
      /action: '([a-z_]+)'/g,
      /auditAction: '([a-z_]+)'/g,
      /this\.audit\([^,]+, '([a-z_]+)'/g,
      /this\.audit\([^,]+, \w+ \? '([a-z_]+)' : '([a-z_]+)'/g,
    ]
    for (const shape of shapes) {
      for (const match of source.matchAll(shape)) {
        for (const group of match.slice(1)) if (group !== undefined) found.add(group)
      }
    }
    // Actions whose entries are predecessors or nothing at all (they never label a version):
    // pin/unpin record no content (both sides null), archive records only the body it removed.
    const nonLabelling = new Set(['pin', 'unpin', 'archive'])
    const unclassified = [...found].filter(action => versionTarget(action) === 'other' && !nonLabelling.has(action))
    expect(unclassified).toEqual([])
    expect(found.size).toBeGreaterThanOrEqual(8)
  })

  describe('skill-history: what a person reads about a version (0.13.0)', () => {
    it('classifies every action the library can write, and fails closed on an unknown one', async () => {
      for (const action of ['create', 'update', 'patch', 'edit', 'restore', 'delete', 'archive', 'consolidate', 'restructure', 'write_file', 'remove_file']) {
        expect(versionActionKind(action), action).not.toBe('other')
      }
      expect(versionActionKind(BASELINE_ACTION)).toBe('baseline')
      expect(versionActionKind('invented-by-a-future-release')).toBe('other')
      // The source scan the versionTarget pin uses, with the same exemption list: an action that never
      // LABELS a version (pin/unpin record no content at all) need not be classified.
      const source = await readFile(join(import.meta.dirname, '../src/skill-store.ts'), 'utf8')
      const found = new Set<string>()
      const shapes = [
        /action: '([a-z_]+)'/g,
        /auditAction: '([a-z_]+)'/g,
        /this\.audit\([^,]+, '([a-z_]+)'/g,
        /this\.audit\([^,]+, \w+ \? '([a-z_]+)' : '([a-z_]+)'/g,
      ]
      for (const shape of shapes) {
        for (const match of source.matchAll(shape)) {
          for (const group of match.slice(1)) if (group !== undefined) found.add(group)
        }
      }
      const nonLabelling = new Set(['pin', 'unpin'])
      expect([...found].filter(action => versionActionKind(action) === 'other' && !nonLabelling.has(action))).toEqual([])
    })

    it('reports a replacement as counts plus the one changed region', () => {
      const facts = textDiffFacts('a\nb\nc\nd\n', 'a\nB\nc\nd\n', 'SKILL.md')
      expect(facts.linesAdded).toBe(1)
      expect(facts.linesRemoved).toBe(1)
      expect(facts.truncated).toBe(false)
      expect(facts.hunks).toHaveLength(1)
      expect(facts.hunks[0]?.path).toBe('SKILL.md')
      expect(facts.hunks[0]?.oldText).toBe('b')
      expect(facts.hunks[0]?.newText).toBe('B')
    })

    it('says nothing changed for identical bodies, and windows a long region', () => {
      expect(textDiffFacts('same\n', 'same\n', 'SKILL.md')).toEqual({ linesAdded: 0, linesRemoved: 0, hunks: [], truncated: false })
      const before = Array.from({ length: TEXT_DIFF_MAX_LINES + 5 }, (_, i) => 'old ' + String(i)).join('\n')
      const after = Array.from({ length: TEXT_DIFF_MAX_LINES + 5 }, (_, i) => 'new ' + String(i)).join('\n')
      const facts = textDiffFacts(before, after, 'SKILL.md')
      expect(facts.truncated).toBe(true)
      expect(facts.hunks[0]?.newText.split('\n')).toHaveLength(TEXT_DIFF_MAX_LINES)
    })

    it('keeps a summary through the index in BOTH reader branches', () => {
    // The create-shaped entry carries no beforeHash — the branch whose explicit literal used to drop
    // every unknown field, and recordVersions re-serializes what the reader returned.
      const raw = JSON.stringify({ version: HISTORY_INDEX_VERSION, versions: [{ v: 1, at: 'T', action: 'create', hash: 'h1', chars: 3, summary: 'first body' }] })
      const state = readHistoryIndex(raw)
      expect(state.kind).toBe('ok')
      expect(state.kind === 'ok' ? state.versions[0]?.summary : undefined).toBe('first body')
      const linked = readHistoryIndex(JSON.stringify({ version: HISTORY_INDEX_VERSION, versions: [{ v: 2, at: 'T', action: 'patch', hash: 'h2', chars: 3, beforeHash: 'h1', summary: 'tightened the rule' }] }))
      expect(linked.kind === 'ok' ? linked.versions[0]?.summary : undefined).toBe('tightened the rule')
      // And it survives the writer: nextHistoryIndex puts it on the AFTER entry only.
      const grown = nextHistoryIndex([{ v: 1, at: 'T', action: 'create', hash: 'h1', chars: 3 }], { skillName: 's', action: 'patch', before: 'a\n', after: 'b\n', at: 'T2', summary: 'one line' }, 20)
      const after = grown.versions[grown.versions.length - 1]
      expect(after?.summary).toBe('one line')
      expect(grown.versions[0]?.summary).toBeUndefined()
    })

    it('reduces a model answer to one line, or to nothing', () => {
      expect(normalizeVersionSummary('  tighten the retention rule to 30 days.  ')).toBe('tighten the retention rule to 30 days')
      expect(normalizeVersionSummary('"quoted"\nsecond line')).toBe('quoted')
      expect(normalizeVersionSummary('   \n  ')).toBeUndefined()
      const long = normalizeVersionSummary('x'.repeat(VERSION_SUMMARY_MAX_CHARS + 20))
      expect(long?.length).toBe(VERSION_SUMMARY_MAX_CHARS)
      expect(long?.endsWith('\u2026')).toBe(true)
    })

    it('pins the summarizer prompt to the skill, the cap and both bodies', () => {
      const prompt = versionSummaryPrompt({ name: 'demo', action: 'patch', before: 'OLD BODY', after: 'NEW BODY' })
      expect(prompt).toContain('demo')
      expect(prompt).toContain('patch')
      expect(prompt).toContain(String(VERSION_SUMMARY_MAX_CHARS))
      expect(prompt).toContain('OLD BODY')
      expect(prompt).toContain('NEW BODY')
      const created = versionSummaryPrompt({ name: 'demo', action: 'create', before: null, after: 'NEW BODY' })
      expect(created).toContain('did not exist')
    })
  })

  it('splits the two chains, so the body keeps its content order when a support file shares the index', () => {
    const versions: SkillVersion[] = [
      { v: 1, at: 'T1', action: 'create', hash: 'h1', chars: 10 },
      { v: 2, at: 'T2', action: 'update', hash: 'h2', chars: 10, beforeHash: 'h1' },
      { v: 3, at: 'T3', action: 'write_file', hash: 'f1', chars: 9 },
      { v: 4, at: 'T4', action: 'write_file', hash: 'f2', chars: 9, beforeHash: 'f1' },
    ]
    // Two chains: no single end, so the whole-index rebuild falls back to the stored order (honest).
    expect(orderVersions(versions).map(entry => entry.v)).toEqual([1, 2, 3, 4])
    const groups = partitionVersions(versions)
    expect(groups.content.map(entry => entry.v)).toEqual([1, 2])
    expect(groups.support.map(entry => entry.v)).toEqual([3, 4])
    // Interleaved appends (v3 landed before v2) still rebuild inside each group.
    const interleaved = [versions[0]!, versions[2]!, versions[1]!, versions[3]!]
    expect(partitionVersions(interleaved).content.map(entry => entry.v)).toEqual([1, 2])
    expect(partitionVersions(interleaved).support.map(entry => entry.v)).toEqual([3, 4])
  })

  it('keeps a baseline predecessor in the BODY group, so its chain keeps its first link', () => {
    const versions: SkillVersion[] = [
      { v: 1, at: 'T1', action: BASELINE_ACTION, hash: 'b1', chars: 10 },
      { v: 2, at: 'T2', action: 'update', hash: 'b2', chars: 10, beforeHash: 'b1' },
      { v: 3, at: 'T3', action: 'write_file', hash: 'f1', chars: 9 },
    ]
    const groups = partitionVersions(versions)
    expect(groups.content.map(entry => entry.v)).toEqual([1, 2])
    expect(groups.support.map(entry => entry.v)).toEqual([3])
  })

  it('sends a support file\'s baseline to the support group, so no row offers to write those bytes over SKILL.md', () => {
    // The shape a support write mints when the file it overwrote had never been recorded: the
    // baseline carries the BASELINE label, so the action alone reads as a body version.
    const withPath: SkillVersion[] = [
      { v: 1, at: 'T1', action: 'create', hash: 'h1', chars: 10 },
      { v: 2, at: 'T2', action: BASELINE_ACTION, hash: 'old-notes', chars: 9, path: 'references/notes.md' },
      { v: 3, at: 'T2', action: 'write_file', hash: 'new-notes', chars: 9, beforeHash: 'old-notes', path: 'references/notes.md' },
    ]
    expect(entryTarget(withPath[1]!, withPath)).toBe('support')
    expect(partitionVersions(withPath).content.map(entry => entry.v)).toEqual([1])
    expect(partitionVersions(withPath).support.map(entry => entry.v)).toEqual([2, 3])
    // An entry recorded BEFORE the path existed has none: there the only evidence left is the link
    // the support write left behind, and it attributes the bytes just as well.
    // The path decides on its own, which is what keeps the verdict when the write that minted the
    // baseline is not in the index any more.
    expect(entryTarget(withPath[1]!, [withPath[0]!, withPath[1]!])).toBe('support')
    // An entry recorded BEFORE the path existed has none: there the only evidence left is the link
    // the support write left behind, and it attributes the bytes just as well.
    const legacy: SkillVersion[] = [
      { v: 1, at: 'T1', action: 'create', hash: 'h1', chars: 10 },
      { v: 2, at: 'T2', action: BASELINE_ACTION, hash: 'old-notes', chars: 9 },
      { v: 3, at: 'T2', action: 'write_file', hash: 'new-notes', chars: 9, beforeHash: 'old-notes' },
    ]
    expect(entryTarget(legacy[1]!, legacy)).toBe('support')
    expect(partitionVersions(legacy).support.map(entry => entry.v)).toEqual([2, 3])
    // Nothing names those bytes as a support file's: the body group keeps them, as it always did.
    expect(entryTarget(legacy[1]!, [legacy[0]!, legacy[1]!])).toBe('other')
    expect(partitionVersions([legacy[0]!, legacy[1]!]).content.map(entry => entry.v)).toEqual([1, 2])
  })

  it('PLAN S3.3 (audit 1-2): a failed index READ abandons the record, copies the bytes and never overwrites', async () => {
    const root = await tempRoot('dsh-history-unreadable-')
    const real = nodeEvolutionIo()
    const file = historyIndexFile(root, 'my-skill')
    // The bytes on disk are an index a NEWER reader wrote: unreadable here, and irreplaceable if lost.
    const unreadable = JSON.stringify({ version: HISTORY_INDEX_VERSION + 9, versions: [{ v: 1, at: '2026-01-01T00:00:00.000Z', action: 'update', hash: 'deadbeef', chars: 3 }] })
    const copies: string[] = []
    const io: EvolutionIoLike = {
      ...real,
      readText: async (path: string) => {
        // A read FAILURE (EIO), not a missing file: the distinction the old `.catch(() => null)` erased.
        if (path === file) throw Object.assign(new Error('EIO: injected read failure'), { code: 'EIO' })
        return await real.readText(path)
      },
      copy: async (_from: string, to: string) => { copies.push(to); await real.writeText(to, unreadable) },
    }
    await real.writeText(file, unreadable)
    const recorded = await recordVersions(root, io, { skillName: 'my-skill', action: 'update', before: null, after: 'Body v2', at: 'T1' }, 5)
    // The record is ABANDONED (the mutation stands), never derived from an empty read.
    expect(recorded).toBeNull()
    // The rescue copy was attempted...
    expect(copies).toEqual([`${file}.corrupt`])
    // ...and the bytes this reader could not understand are still exactly what they were.
    expect(await real.readText(file)).toBe(unreadable)
  })
})
