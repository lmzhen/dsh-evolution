// @tier fast
import type { ReactElement } from 'react'
import { expect, it } from 'vitest'
import { StateNotice } from '../src/notice.ts'

it('builds one semantic notice with tone, text and count', () => {
  const warning = StateNotice({ tone: 'warning', text: 'expired', count: 2 }) as ReactElement<Record<string, unknown>>
  expect(warning.props['data-role']).toBe('state-notice')
  expect(warning.props['data-tone']).toBe('warning')
  expect(warning.props.role).toBe('status')
  const [text, count] = warning.props.children as [ReactElement<{ children: string }>, ReactElement<{ children: string }>]
  expect(text.props.children).toBe('expired')
  expect(count.props.children).toBe('2')
  expect((StateNotice({ tone: 'error', text: 'failed' }) as ReactElement<Record<string, unknown>>).props.role).toBe('alert')
})
