// @tier fast
// @vitest-environment happy-dom
import { createElement } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { SkillHealthPanel, type HealthRow } from '../src/client/Panel.ts'

afterEach(cleanup)

const row = (name: string, verdict: HealthRow['verdict']): HealthRow => ({ name, verdict, findings: [] })

it('filters the queue by a clicked stat while the counts stay whole', () => {
  const view = render(createElement(SkillHealthPanel, {
    rows: [row('ok-skill', 'healthy'), row('warn-skill', 'warn')],
    truncated: false, loaded: true, t: (key: string) => key,
  }))
  const stats = [...view.container.querySelectorAll('[data-role="stat"]')] as HTMLElement[]
  expect(stats).toHaveLength(5)
  const warn = stats.find(item => item.getAttribute('data-tone') === 'warn')!
  fireEvent.click(warn)
  const rows = [...view.container.querySelectorAll('[data-role="skill-row"]')]
  expect(rows).toHaveLength(1)
  expect(rows[0]?.getAttribute('data-tone')).toBe('warn')
  // Counts are computed from the full row set, not the filtered view.
  expect(warn.querySelector('[data-role="stat-value"]')?.textContent).toBe('1')
  fireEvent.click(warn)
  expect(view.container.querySelectorAll('[data-role="skill-row"]')).toHaveLength(2)
})
