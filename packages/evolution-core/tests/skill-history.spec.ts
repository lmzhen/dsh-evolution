/**
 * Skill content history (design \`dsh-evolution-skill-history-design.md\` batch A).
 *
 * Two layers are pinned here: the PURE versioning rules (nextHistoryIndex) and the io-backed
 * recorder over a real library (create/update/patch → versions that can be read back).
 */
import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_SKILL_LIMITS } from '../src/limits.ts'
import { nodeEvolutionIo } from '../src/io.ts'
import { SkillLibrary } from '../src/skill-store.ts'
import { contentHash } from '../src/mutations.ts'
import {
  BASELINE_ACTION,
  contentRetentionFeedback,
  HISTORY_INDEX_VERSION,
  historyIndexFile,
  loadVersions,
  nextHistoryIndex,
  orderVersions,
  parseHistoryIndex,
  readHistoryIndex,
  loadVersionContent,
  recordVersions,
  RETENTION_FEEDBACK_MIN_CHARS,
  type SkillVersion,
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
