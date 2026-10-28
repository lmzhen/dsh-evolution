// @tier fast
import { describe, expect, it } from 'vitest'
import { planExtract, type OwnerDecision } from '@deepseek-ai/dsh-evolution-core'

const NL = String.fromCharCode(10)
const BASE = [
  '# Demo',
  '',
  'Intro.',
  '',
  '## Details',
  '',
  'A reusable detail line.',
  '',
  '## Usage',
  '',
  'Use it with care.',
].join(NL)

const COVERED: OwnerDecision = {
  mode: 'covered',
  name: 'target',
  triggerCovers: true,
  outcomeCovers: true,
  reason: 'target covers the capability',
}

function plan(input: {
  body?: string
  requests: Array<{ heading: string; start?: string; end?: string }>
  owner?: OwnerDecision
  outcome?: 'extract' | 'mixed' | 'owner-gap'
  targetExists?: boolean
  sourceFiles?: string[]
  targetFiles?: string[]
}) {
  return planExtract({
    body: input.body ?? BASE,
    sourceName: 'source',
    targetName: 'target',
    targetExists: input.targetExists ?? true,
    outcome: input.outcome ?? 'extract',
    owner: input.owner ?? COVERED,
    requests: input.requests,
    sourceFiles: input.sourceFiles ?? [],
    targetFiles: input.targetFiles ?? [],
  })
}

describe('planExtract: part selection and residual', () => {
  it('moves a whole H2 and leaves a prose pointer', () => {
    const result = plan({ requests: [{ heading: 'Details' }] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.parts).toHaveLength(1)
    expect(result.plan.parts[0]?.anchor).toEqual({ heading: 'Details' })
    expect(result.plan.parts[0]?.sourceText).toContain('A reusable detail line.')
    expect(result.plan.residual).toContain('## Usage')
    expect(result.plan.residual).toContain('This capability now lives in target')
    expect(result.plan.residual).not.toContain('A reusable detail line.')
  })

  it('moves an exact sub-block and keeps the heading', () => {
    const body = [
      '# Demo',
      '',
      '## Details',
      '',
      'keep before',
      '',
      'move start',
      'move end',
      '',
      'keep after',
    ].join(NL)
    const result = plan({ body, requests: [{ heading: 'Details', start: 'move start', end: 'move end' }] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.parts[0]?.anchor).toEqual({ heading: 'Details', start: 'move start', end: 'move end' })
    expect(result.plan.parts[0]?.sourceText).toBe(['move start', 'move end'].join(NL))
    expect(result.plan.residual).toContain('## Details')
    expect(result.plan.residual).toContain('keep before')
    expect(result.plan.residual).toContain('keep after')
    expect(result.plan.residual).not.toContain('move start')
  })

  it('supports multiple non-overlapping parts', () => {
    const body = ['# Demo', '', '## A', 'a', '', '## B', 'b', '', '## C', 'c'].join(NL)
    const result = plan({ body, requests: [{ heading: 'A' }, { heading: 'B' }] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.parts.map(part => part.heading)).toEqual(['A', 'B'])
    expect(result.plan.residual).toContain('## C')
    expect(result.plan.residual).toContain('This capability now lives in target')
  })
})

describe('planExtract: refusals', () => {
  it('refuses a covered owner without a target', () => {
    const result = plan({ requests: [{ heading: 'Details' }], targetExists: false })
    expect(result).toEqual({ ok: false, code: 'target-missing', message: expect.any(String) })
  })

  it('returns owner-gap without a target write plan', () => {
    const result = plan({
      requests: [{ heading: 'Details' }],
      outcome: 'owner-gap',
      targetExists: false,
      owner: { mode: 'owner-gap', neededOwner: 'release-owner', triggerCovers: true, outcomeCovers: false, reason: 'no covering owner' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.outcome).toBe('owner-gap')
    expect(result.plan.owner.neededOwner).toBe('release-owner')
    expect(result.plan.support).toEqual({ exclusive: [], shared: [], external: [], unresolved: [], dangling: [] })
  })

  it('rejects an ambiguous heading', () => {
    const body = ['# Demo', '', '## Details', 'a', '', '## Details', 'b'].join(NL)
    const result = plan({ body, requests: [{ heading: 'Details' }] })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('heading-ambiguous')
  })

  it('rejects a missing start anchor', () => {
    const result = plan({ requests: [{ heading: 'Details', start: 'not present', end: 'Use it with care.' }] })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('part-anchor-not-found')
  })

  it('rejects unresolved support references', () => {
    const body = ['# Demo', '', '## Details', 'See references/absent.md.', '', '## Usage', 'Use it.'].join(NL)
    const result = plan({ body, requests: [{ heading: 'Details' }], sourceFiles: [] })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('support-unresolved')
  })
})

describe('planExtract: support closure', () => {
  const body = [
    '# Demo',
    '',
    '## Details',
    '',
    'See references/shared.md and references/exclusive.md for details',
    '',
    '## Usage',
    '',
    'See references/shared.md for details',
  ].join(NL)

  it('classifies shared vs exclusive and preserves the parent reference', () => {
    const result = plan({
      body,
      requests: [{ heading: 'Details' }],
      sourceFiles: ['references/shared.md', 'references/exclusive.md'],
      targetFiles: [],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.support.shared).toEqual([
      { from: 'references/shared.md', to: 'references/shared.md', provenance: 'source:references/shared.md' },
    ])
    expect(result.plan.support.exclusive).toEqual([{ from: 'references/exclusive.md', to: 'references/exclusive.md' }])
    expect(result.plan.support.dangling).toEqual([])
  })

  it('rewrites moved references to collision-free target paths', () => {
    const result = plan({
      body,
      requests: [{ heading: 'Details' }],
      sourceFiles: ['references/shared.md', 'references/exclusive.md'],
      targetFiles: ['references/shared.md', 'references/exclusive.md'],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.parts[0]?.movedText).toContain('references/source-shared.md')
    expect(result.plan.parts[0]?.movedText).toContain('references/source-exclusive.md')
    expect(result.plan.support.shared[0]?.to).toBe('references/source-shared.md')
  })
})

describe('planExtract: plan-time anchors', () => {
  it('threads the caller anchors into the plan', () => {
    const result = planExtract({
      body: BASE,
      sourceName: 'source',
      targetName: 'target',
      targetExists: true,
      outcome: 'extract',
      owner: COVERED,
      requests: [{ heading: 'Details' }],
      sourceFiles: [],
      targetFiles: [],
      anchors: { sourceMdSha256: 'source-hash', targetMdSha256: 'target-hash' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.anchors).toEqual({ sourceMdSha256: 'source-hash', targetMdSha256: 'target-hash' })
  })
})

it('warns about external references instead of silently treating them as relative support', () => {
  const body = ['# Demo', '', '## Details', '', 'See ../scripts/run.mjs and /scripts/tool.mjs.', '', '## Usage', '', 'Use it.'].join(NL)
  const result = planExtract({
    body,
    sourceName: 'source',
    targetName: 'target',
    targetExists: true,
    outcome: 'extract',
    owner: { mode: 'covered', name: 'target', triggerCovers: true, outcomeCovers: true, reason: 'explicit' },
    requests: [{ heading: 'Details' }],
    sourceFiles: [],
    targetFiles: [],
  })
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.plan.support.external).toEqual([])
  expect(result.plan.warnings.some(warning => warning.startsWith('external-support-not-copied: '))).toBe(true)
})
