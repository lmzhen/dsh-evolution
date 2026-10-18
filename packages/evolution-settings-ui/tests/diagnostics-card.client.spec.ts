// @tier pre-tag
// @vitest-environment jsdom
/**
 * G5/W7 S7: the diagnostics card RENDERED. It is read-only and renders the Host's ONE view:
 * loading says so, ready lists the facts (with their homes) and the runtime rows (with the frozen
 * status words), a failed read uses the shared FailureBlock + the command fallback, and Refresh is
 * the only thing that reads again.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import type { DiagnosticsView } from '../src/client/contracts.generated.ts'
import type { RouteAnswer } from '../src/client/route-client.generated.ts'
import { DiagnosticsCard } from '../src/client/DiagnosticsCard.ts'
import { FALLBACKS } from '../src/client/fallbacks.generated.ts'
import { formatText } from '../src/client/messages.ts'

const t = (key: string, values?: Readonly<Record<string, string | number>>): string => formatText(key as never, values)

const view: DiagnosticsView = {
  schemaVersion: 2,
  generatedAt: '2026-10-19T00:00:00.000Z',
  facts: [
    { key: 'platform-line', label: '平台兼容线', value: '0.2.1-rc.2（floor 0.2.1-rc.1）', home: 'README.md（兼容线声明）' },
  ],
  runtime: [
    { key: 'host-surface', label: 'Host 数据面', status: 'ok', detail: '已挂载 12/12；仅本机权限' },
    { key: 'runs', label: '运行登记', status: 'warn', detail: 'orphaned=1', remedy: '/evolution runs' },
  ],
}

const ok = (data: DiagnosticsView): RouteAnswer<DiagnosticsView> => ({ ok: true, data })

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('diagnostics card', () => {
  it('renders loading first, then the facts (with homes) and the runtime status words', async () => {
    let resolve: ((answer: RouteAnswer<DiagnosticsView>) => void) | undefined
    const api = { view: vi.fn(() => new Promise<RouteAnswer<DiagnosticsView>>((done) => { resolve = done })) }
    render(createElement(DiagnosticsCard, { t, api, fallback: FALLBACKS.diagnostics }))
    expect(screen.getByText('reading…')).toBeTruthy()
    await act(async () => { resolve?.(ok(view)) })
    await waitFor(() => { expect(screen.getByText('Facts')).toBeTruthy() })
    expect(screen.getByText('平台兼容线')).toBeTruthy()
    expect(screen.getByText('0.2.1-rc.2（floor 0.2.1-rc.1）')).toBeTruthy()
    expect(screen.getByText('source: README.md（兼容线声明）')).toBeTruthy()
    // The runtime status renders through the frozen status words, and a warn row carries its remedy.
    expect(screen.getByText('warn')).toBeTruthy()
    expect(screen.getByText('Next: /evolution runs')).toBeTruthy()
    expect(screen.getByText('view schema v2 · generated at 2026-10-19T00:00:00.000Z')).toBeTruthy()
  })

  it('renders a failed read as the shared failure block with the command fallback', async () => {
    const api = { view: vi.fn(async () => ({ ok: false as const, failure: { kind: 'unmounted' as const, status: 404 } })) }
    render(createElement(DiagnosticsCard, { t, api, fallback: FALLBACKS.diagnostics }))
    await waitFor(() => { expect(screen.getByText('This feature is not mounted.')).toBeTruthy() })
    expect(screen.getByText('Command fallback: /evolution doctor')).toBeTruthy()
  })

  it('reads once on mount and only again on an explicit refresh', async () => {
    const api = { view: vi.fn(async () => ok(view)) }
    render(createElement(DiagnosticsCard, { t, api, fallback: FALLBACKS.diagnostics }))
    await waitFor(() => { expect(api.view).toHaveBeenCalledTimes(1) })
    await act(async () => { fireEvent.click(screen.getByText('Refresh')) })
    await waitFor(() => { expect(api.view).toHaveBeenCalledTimes(2) })
  })
})
