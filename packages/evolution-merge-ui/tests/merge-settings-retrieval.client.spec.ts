// @tier fast
// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { MergeSettings } from '../src/client/MergeSettings.ts'
import { zh } from '../src/client/messages.ts'

afterEach(() => { cleanup() })

const t = (key: string): string => (zh as Readonly<Record<string, string>>)[key] ?? key

it('points the merge settings card at the retrieval enhancement settings without duplicating the key inputs', () => {
  const view = {
    approval: { mergeApproval: true, platformWrite: { capability: true, enabled: false } },
  } as unknown as Parameters<typeof MergeSettings>[0]['view']
  render(createElement(MergeSettings, { view, t }))
  expect(screen.getByText('检索增强（可选）在「设置 → 能力进化」里配置，也能看当前状态。')).toBeTruthy()
  expect(document.querySelector('input[type="password"]')).toBeNull()
})
