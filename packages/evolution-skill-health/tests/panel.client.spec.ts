// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { act } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'
import { createElement } from 'react'
import { SkillHealthPanel } from '../src/client/Panel.ts'
import type { HealthFace } from '../src/client/Panel.ts'

const face = (proposalStatus: HealthFace['proposalStatus']): HealthFace => ({
  rows: [], truncated: false, proposalStatus, t: (key: string) => key,
})

async function renderFace(proposalStatus: HealthFace['proposalStatus']): Promise<string> {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => { root.render(createElement(SkillHealthPanel, face(proposalStatus))) })
  const text = host.textContent ?? ''
  act(() => { root.unmount() })
  host.remove()
  return text
}

describe('health proposal lane states', () => {
  it('says unavailable instead of "nothing to extract"', async () => {
    expect(await renderFace('unavailable')).toContain('proposal.unavailable')
  })

  it('says stale instead of "nothing to extract"', async () => {
    expect(await renderFace('stale')).toContain('proposal.stale')
  })

  it('does not print either note when the lane is available and empty', async () => {
    const text = await renderFace('available')
    expect(text).not.toContain('proposal.unavailable')
    expect(text).not.toContain('proposal.stale')
  })
})
