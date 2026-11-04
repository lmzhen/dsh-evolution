// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SkillHealthPanel } from '../src/client/Panel.ts'
import type { HealthFace } from '../src/client/Panel.ts'

const face = (proposalStatus: HealthFace['proposalStatus']): HealthFace => ({
  rows: [], truncated: false, proposalStatus, t: (key: string) => key,
})

describe('health proposal lane states', () => {
  it('says unavailable instead of "nothing to extract"', () => {
    const html = renderToStaticMarkup(createElement(SkillHealthPanel, face('unavailable')))
    expect(html).toContain('proposal.unavailable')
  })

  it('says stale instead of "nothing to extract"', () => {
    const html = renderToStaticMarkup(createElement(SkillHealthPanel, face('stale')))
    expect(html).toContain('proposal.stale')
  })

  it('does not print either note when the lane is available and empty', () => {
    const html = renderToStaticMarkup(createElement(SkillHealthPanel, face('available')))
    expect(html).not.toContain('proposal.unavailable')
    expect(html).not.toContain('proposal.stale')
  })
})
