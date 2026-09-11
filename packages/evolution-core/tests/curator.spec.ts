import { expect, it } from 'vitest'
import { buildCuratorRunReport, computeLifecycleTransitions, computeScopeView, foldCuratorFields, lifecycleCandidate, parseCuratorNominations, renderCuratorReportMarkdown, type UsageRecord } from '@deepseek-ai/dsh-evolution-core'

it('V27 CUR-2: a run that was cut short carries its abort reason into the report and digest', () => {
  const report = buildCuratorRunReport({
    runId: 'r-1',
    startedAt: '2026-09-11T00:00:00.000Z',
    finishedAt: '2026-09-11T00:00:01.000Z',
    staleCandidates: [],
    llmNominations: [],
    archiveCandidates: ['stale-skill'],
    archived: [{ name: 'stale-skill', path: '.archive/stale-skill', reason: 'Lifecycle: reached archive threshold' }],
    // Only skill-attributable failures may live here.
    failed: [],
    aborted: 'evolution-curator was disposed mid-run — consolidation skipped; archives that landed above are still accounted',
    unattributed: ['some run-level error with no skill name'],
  })
  const digest = renderCuratorReportMarkdown(report)
  // The digest is what an operator reads: it must not present "Failed: 0" over a
  // run that stopped early, and the archive that DID land stays visible.
  expect(digest).toContain('- **Archived**: 1')
  expect(digest).toContain('- **Failed**: 0')
  expect(digest).toContain('- **Aborted**: evolution-curator was disposed mid-run')
  expect(digest).toContain('- **Unattributed errors**: 1')
  expect(digest).toContain('## Unattributed')
  expect(digest).toContain('some run-level error with no skill name')
  // A clean run keeps the previous shape: no aborted/unattributed keys at all.
  const clean = buildCuratorRunReport({
    runId: 'r-2',
    startedAt: 'x',
    finishedAt: 'y',
    staleCandidates: [],
    llmNominations: [],
    archiveCandidates: [],
    archived: [],
    failed: [],
  })
  expect('aborted' in clean).toBe(false)
  expect('unattributed' in clean).toBe(false)
  expect(renderCuratorReportMarkdown(clean)).not.toContain('Aborted')
})

it('curator transitions active -> stale -> archived by idle time', () => {
  const now = new Date('2026-08-01T00:00:00.000Z')
  const stale = new Date(now.getTime() - 40 * 86_400_000)
  const ancient = new Date(now.getTime() - 120 * 86_400_000)
  const usage = new Map()
  usage.set('fresh', { created_by: 'agent', created_at: now.toISOString(), use_count: 1, view_count: 0, patch_count: 0, last_used_at: now.toISOString(), last_viewed_at: null, last_patched_at: null, state: 'active', pinned: false, archived_at: null })
  usage.set('stale-skill', { created_by: 'agent', created_at: stale.toISOString(), use_count: 1, view_count: 0, patch_count: 0, last_used_at: stale.toISOString(), last_viewed_at: null, last_patched_at: null, state: 'active', pinned: false, archived_at: null })
  usage.set('old-skill', { created_by: 'agent', created_at: ancient.toISOString(), use_count: 1, view_count: 0, patch_count: 0, last_used_at: ancient.toISOString(), last_viewed_at: null, last_patched_at: null, state: 'active', pinned: false, archived_at: null })
  const result = computeLifecycleTransitions(usage, { staleAfterDays: 30, archiveAfterDays: 90 }, now)
  expect(result.markStale).toEqual(['stale-skill'])
  expect(result.archive).toEqual(['old-skill'])
})

it('quality-warned skills may turn stale earlier without early archive', () => {
  const now = new Date('2026-08-01T00:00:00.000Z')
  const idle = new Date(now.getTime() - 10 * 86_400_000)
  const usage = new Map()
  usage.set('warned-skill', { created_by: 'agent', created_at: idle.toISOString(), use_count: 1, view_count: 0, patch_count: 0, last_used_at: idle.toISOString(), last_viewed_at: null, last_patched_at: null, state: 'active', pinned: false, archived_at: null, quality_warn: true })
  const result = computeLifecycleTransitions(usage, { staleAfterDays: 30, archiveAfterDays: 90, qualityWarnStaleAfterDays: 7 }, now)
  expect(result.markStale).toEqual(['warned-skill'])
  expect(result.archive).toEqual([])
})

it('B-4 (v18): the FEEDBACK-owned warn pair reaches the union read (short window, no deferral)', () => {
  const now = new Date('2026-08-01T00:00:00.000Z')
  const idle = new Date(now.getTime() - 10 * 86_400_000)
  const usage = new Map()
  // Never used, never loaded, 10 days old — the young-skill deferral would
  // skip it at the 30-day base window; the feedback-owned warn must still put
  // it into the 7-day short window (that union is the feedback package's whole
  // advertised purpose, and nothing else in the family writes feedback_warn).
  usage.set('feedback-warned', { created_by: 'agent', created_at: idle.toISOString(), use_count: 0, view_count: 0, patch_count: 0, last_used_at: idle.toISOString(), last_viewed_at: null, last_patched_at: null, state: 'active', pinned: false, archived_at: null, feedback_warn: true })
  const result = computeLifecycleTransitions(usage, { staleAfterDays: 30, archiveAfterDays: 90, qualityWarnStaleAfterDays: 7 }, now)
  expect(result.markStale).toEqual(['feedback-warned'])
})

it('pinned and non-agent skills are untouched', () => {
  const now = new Date('2026-08-01T00:00:00.000Z')
  const old = new Date(now.getTime() - 200 * 86_400_000)
  const usage = new Map()
  usage.set('pinned', { created_by: 'agent', created_at: old.toISOString(), use_count: 1, view_count: 0, patch_count: 0, last_used_at: old.toISOString(), last_viewed_at: null, last_patched_at: null, state: 'active', pinned: true, archived_at: null })
  usage.set('manual', { created_by: null, created_at: old.toISOString(), use_count: 1, view_count: 0, patch_count: 0, last_used_at: old.toISOString(), last_viewed_at: null, last_patched_at: null, state: 'active', pinned: false, archived_at: null })
  const result = computeLifecycleTransitions(usage, { staleAfterDays: 30, archiveAfterDays: 90 }, now)
  expect(result.transitions.length).toBe(0)
})

it('suppressed names and bundled eligibility follow pruneBuiltins (F8)', () => {
  const now = new Date('2026-08-01T00:00:00.000Z')
  const old = new Date(now.getTime() - 200 * 86_400_000)
  const record = (createdBy: string | null) => ({ created_by: createdBy, created_at: old.toISOString(), use_count: 1, view_count: 0, patch_count: 0, last_used_at: old.toISOString(), last_viewed_at: null, last_patched_at: null, state: 'active', pinned: false, archived_at: null })
  const usage = new Map()
  usage.set('builtin-old', record(null))
  usage.set('suppressed-old', record(null))
  usage.set('plain-old', record(null))
  // Without pruneBuiltins, a bundled/unmanaged skill never enters the lifecycle.
  let result = computeLifecycleTransitions(usage, { staleAfterDays: 30, archiveAfterDays: 90 }, now)
  expect(result.archive).toEqual([])
  // With pruneBuiltins the bundled name becomes a candidate; hub-style names
  // only enter when marked bundled, and suppressed names stay untouched.
  result = computeLifecycleTransitions(usage, {
    staleAfterDays: 30, archiveAfterDays: 90, pruneBuiltins: true,
    bundledNames: new Set(['builtin-old']),
    suppressedNames: new Set(['suppressed-old']),
  }, now)
  expect(result.archive).toEqual(['builtin-old'])
})

it('referenced skill names are never auto-transitioned (F3)', () => {
  const now = new Date('2026-08-01T00:00:00.000Z')
  const old = new Date(now.getTime() - 200 * 86_400_000)
  const usage = new Map()
  usage.set('scheduled-skill', { created_by: 'agent', created_at: old.toISOString(), use_count: 1, view_count: 0, patch_count: 0, last_used_at: old.toISOString(), last_viewed_at: null, last_patched_at: null, state: 'active', pinned: false, archived_at: null })
  const result = computeLifecycleTransitions(usage, {
    staleAfterDays: 30,
    archiveAfterDays: 90,
    referencedSkillNames: new Set(['scheduled-skill']),
  }, now)
  expect(result.transitions.length).toBe(0)
  // Same lifecycle without the reference set: normal transitions apply.
  const active = computeLifecycleTransitions(usage, { staleAfterDays: 30, archiveAfterDays: 90 }, now)
  expect(active.archive).toEqual(['scheduled-skill'])
})

it('parseCuratorNominations reads both YAML sections defensively', () => {
  const text = [
    'consolidations:',
    '  - from: narrow-a',
    '    into: umbrella',
    '    reason: merge',
    '  - from: narrow-b',
    '    into: umbrella',
    'prunings:',
    '  - name: stale-skill',
    '    reason: obsolete',
    '  - name: invalid NAME',
  ].join('\n')
  const nominations = parseCuratorNominations(text)
  expect(nominations.consolidations).toEqual([
    { from: 'narrow-a', into: 'umbrella' },
    { from: 'narrow-b', into: 'umbrella' },
  ])
  expect(nominations.prunings).toEqual(['stale-skill'])
  expect(nominations.prunings).not.toContain('invalid NAME')
})

it('parseCuratorNominations reads the optional consolidation mode (009-II)', () => {
  const text = [
    'consolidations:',
    '  - from: demo-a',
    '    mode: reference',
    '    into: umbrella',
    '    reason: session detail',
    '  - from: demo-b',
    '    into: umbrella',
    '    reason: regular',
  ].join('\n')
  const nominations = parseCuratorNominations(text)
  expect(nominations.consolidations).toEqual([
    { from: 'demo-a', into: 'umbrella', mode: 'reference' },
    { from: 'demo-b', into: 'umbrella' },
  ])
})

it('computeScopeView classifies managed/watched/exempted/protected like the transition gates', () => {
  const now = new Date('2026-08-01T00:00:00.000Z')
  const age = new Date(now.getTime() - 200 * 86_400_000)
  const record = (over: Partial<UsageRecord> = {}): UsageRecord => ({
    created_by: 'agent', created_at: age.toISOString(), use_count: 1, view_count: 0, patch_count: 0,
    last_used_at: age.toISOString(), last_viewed_at: null, last_patched_at: null,
    state: 'active', pinned: false, archived_at: null, ...over,
  })
  const usage = new Map<string, UsageRecord>()
  usage.set('in-candidate', record())
  usage.set('watched-stale', record({ state: 'stale' }))
  usage.set('watched-quality', record({ quality_warn: true }))
  usage.set('excluded', record({ created_by: null })) // unmanaged
  usage.set('referenced', record())
  usage.set('pinned-skill', record({ pinned: true }))
  const config = {
    staleAfterDays: 30, archiveAfterDays: 90,
    excludeSkillNames: new Set(['excluded']),
    referencedSkillNames: new Set(['referenced']),
  }
  const view = computeScopeView(usage, config)
  expect(view.managed).toEqual(['in-candidate', 'watched-quality', 'watched-stale'])
  expect(view.watched).toEqual(['watched-quality', 'watched-stale'])
  expect(view.qualityWarned).toEqual(['watched-quality'])
  expect(view.exempted).toEqual(['excluded', 'referenced'])
  expect(view.protected).toEqual(['pinned-skill'])
  // Parity: the transition engine never touches anything the view classifies
  // as exempted or protected (same shared gate by construction).
  const transitions = computeLifecycleTransitions(usage, config, now)
  const touched = [...transitions.markStale, ...transitions.archive, ...transitions.reactivate]
  expect(touched.filter(name => ['excluded', 'referenced', 'pinned-skill'].includes(name))).toEqual([])
})

it('lifecycleCandidate mirrors the transition gate for a bundled-prune mix', () => {
  const now = new Date('2026-08-01T00:00:00.000Z')
  const old = new Date(now.getTime() - 200 * 86_400_000)
  const record: UsageRecord = { created_by: null, created_at: old.toISOString(), use_count: 0, view_count: 0, patch_count: 0, last_used_at: old.toISOString(), last_viewed_at: null, last_patched_at: null, state: 'active', pinned: false, archived_at: null }
  const config = { staleAfterDays: 30, archiveAfterDays: 90, pruneBuiltins: true, bundledNames: new Set(['b']) }
  // Non-agent, non-bundled: not a candidate; bundled with pruneBuiltins: candidate.
  expect(lifecycleCandidate('manual', record, config, false)).toBe(false)
  expect(lifecycleCandidate('b', record, config, true)).toBe(true)
})

it('V6-35: lenient parse warns on a mode after into and on a name inside consolidations (0.3.36)', () => {
  // `mode:` after `into:` has no preceding open entry (the prompt says mode
  // goes BEFORE into) — the intent (demote) silently degraded to append.
  const afterInto = [
    'consolidations:',
    '  - from: demo-a',
    '    into: umbrella',
    '    mode: reference',
  ].join('\n')
  const parsed = parseCuratorNominations(afterInto)
  expect(parsed.consolidations).toEqual([{ from: 'demo-a', into: 'umbrella' }])
  expect(parsed.warnings.some(w => w.includes('mode: reference ignored'))).toBe(true)
  // A `- name:` inside the consolidations section flips the parse to prunings.
  const flipped = [
    'consolidations:',
    '  - from: demo-b',
    '    into: umbrella',
    '  - name: late-stale',
    '  - name: later-stale',
  ].join('\n')
  const parsedFlip = parseCuratorNominations(flipped)
  expect(parsedFlip.prunings).toEqual(['late-stale', 'later-stale'])
  expect(parsedFlip.warnings.some(w => w.includes('flips the parse to prunings'))).toBe(true)
  // The canonical shape stays silent.
  const canonical = [
    'consolidations:',
    '  - from: demo-c',
    '    mode: reference',
    '    into: umbrella',
    'prunings:',
    '  - name: stale-one',
  ].join('\n')
  expect(parseCuratorNominations(canonical).warnings).toEqual([])
})

it('V6-36: a protected builtin lands in the protected bucket of the scope view (0.3.36)', () => {
  const now = new Date('2026-08-01T00:00:00.000Z')
  const age = new Date(now.getTime() - 200 * 86_400_000)
  const record: UsageRecord = {
    created_by: 'agent', created_at: age.toISOString(), use_count: 1, view_count: 0, patch_count: 0,
    last_used_at: age.toISOString(), last_viewed_at: null, last_patched_at: null,
    state: 'active', pinned: false, archived_at: null,
  }
  const usage = new Map<string, UsageRecord>([['plan', record]])
  const view = computeScopeView(usage, { staleAfterDays: 30, archiveAfterDays: 90 })
  expect(view.managed).toEqual([])
  expect(view.protected).toEqual(['plan'])
})

it('P1-1 (v15): feedback_warn ALONE applies the short quality-warn stale window', () => {
  // The v15 audit graded the feedback->lifecycle channel P1-dead: scoreTree
  // overwrites quality_warn before this engine reads it, so the feedback
  // package's advertised purpose (negative feedback accelerates stale)
  // never fired. The engine now reads the UNION of both warn flags — here
  // with quality_warn ABSENT and feedback_warn set (the post-fix steady
  // state while a curator run has not yet recomputed anything).
  const now = new Date('2026-08-01T00:00:00.000Z')
  const idle = new Date(now.getTime() - 10 * 86_400_000)
  const usage = new Map()
  usage.set('disliked-skill', { created_by: 'agent', created_at: idle.toISOString(), use_count: 1, view_count: 0, patch_count: 0, last_used_at: idle.toISOString(), last_viewed_at: null, last_patched_at: null, state: 'active', pinned: false, archived_at: null, feedback_warn: true })
  const result = computeLifecycleTransitions(usage, { staleAfterDays: 30, archiveAfterDays: 90, qualityWarnStaleAfterDays: 7 }, now)
  expect(result.markStale).toEqual(['disliked-skill'])
  expect(result.transitions[0]?.reason).toContain('feedback-warn stale 7d')
})

it('P3 (v17): both warn flags true attributes to feedback (tie-break, documented)', () => {
  const now = new Date('2026-08-01T00:00:00.000Z')
  const idle = new Date(now.getTime() - 10 * 86_400_000)
  const usage = new Map()
  usage.set('both-warned', { created_by: 'agent', created_at: idle.toISOString(), use_count: 1, view_count: 0, patch_count: 0, last_used_at: idle.toISOString(), last_viewed_at: null, last_patched_at: null, state: 'active', pinned: false, archived_at: null, quality_warn: true, feedback_warn: true })
  const result = computeLifecycleTransitions(usage, { staleAfterDays: 30, archiveAfterDays: 90, qualityWarnStaleAfterDays: 7 }, now)
  expect(result.markStale).toEqual(['both-warned'])
  expect(result.transitions[0]?.reason).toContain('feedback-warn stale 7d')
})

it('P1-1 (v15): foldCuratorFields never overwrites the feedback-owned pair', () => {
  // Field-ownership contract (UsageRecord): scoreTree's recomputed meta pair
  // refreshes quality_* tree-wide, but feedback_* belongs to the feedback
  // channel and must survive a curator run intact — that is what keeps the
  // decision input alive between the feedback write and the next run.
  const disk = new Map([['x', { created_by: 'agent', created_at: '2026-01-01T00:00:00.000Z', use_count: 1, view_count: 0, patch_count: 0, last_used_at: null, last_viewed_at: null, last_patched_at: null, state: 'active', pinned: false, archived_at: null, feedback_score: -1, feedback_warn: true } as UsageRecord]])
  const curated = new Map([['x', { created_by: 'agent', created_at: '2026-01-01T00:00:00.000Z', use_count: 1, view_count: 0, patch_count: 0, last_used_at: null, last_viewed_at: null, last_patched_at: null, state: 'active', pinned: false, archived_at: null, quality_score: 0.9, quality_warn: false } as UsageRecord]])
  foldCuratorFields(disk, curated)
  const record = disk.get('x')!
  expect(record.quality_score).toBe(0.9)
  expect(record.quality_warn).toBe(false)
  expect(record.feedback_score).toBe(-1)
  expect(record.feedback_warn).toBe(true)
})

it('P1-1 (v15): the scope view warns on the union (predicts the engine)', () => {
  const now = new Date('2026-08-01T00:00:00.000Z')
  const recent = new Date(now.getTime() - 2 * 86_400_000)
  const usage = new Map()
  usage.set('fb-skill', { created_by: 'agent', created_at: recent.toISOString(), use_count: 1, view_count: 0, patch_count: 0, last_used_at: recent.toISOString(), last_viewed_at: null, last_patched_at: null, state: 'active', pinned: false, archived_at: null, feedback_warn: true })
  const view = computeScopeView(usage, { staleAfterDays: 30, archiveAfterDays: 90 })
  expect(view.qualityWarned).toContain('fb-skill')
})
