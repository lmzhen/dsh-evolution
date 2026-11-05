// @tier fast
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { StateNotice } from '../src/notice.ts'

it('renders tone, text and count as one semantic notice', () => {
  const html = renderToStaticMarkup(createElement(StateNotice, { tone: 'warning', text: 'expired', count: 2 }))
  expect(html).toContain('data-role="state-notice"')
  expect(html).toContain('data-tone="warning"')
  expect(html).toContain('role="status"')
  expect(html).toContain('expired')
  expect(html).toContain('>2<')
  expect(renderToStaticMarkup(createElement(StateNotice, { tone: 'error', text: 'failed' }))).toContain('role="alert"')
})
