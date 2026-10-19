// @tier pre-tag
// @vitest-environment jsdom
/**
 * G5/W7 S7: the diagnostics card RENDERED. It is read-only and renders the Host's ONE view:
 * loading says so, a ready view leads with a plain-language summary and groups the facts
 * (environment) and runtime rows (status word + detail + remedy), a failed read uses the shared
 * FailureBlock + the command fallback, and Refresh is the only thing that reads again.
 *
 * The technical material (schema version, check time, per-fact source paths) sits behind the
 * `Technical details` disclosure so the default reading path carries no raw identifiers.
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
  it('renders loading first, then a summary plus the grouped environment and runtime readings', async () => {
    let resolve: ((answer: RouteAnswer<DiagnosticsView>) => void) | undefined
    const api = { view: vi.fn(() => new Promise<RouteAnswer<DiagnosticsView>>((done) => { resolve = done })) }
    render(createElement(DiagnosticsCard, { t, api, fallback: FALLBACKS.diagnostics }))
    expect(screen.getByText('reading…')).toBeTruthy()
    await act(async () => { resolve?.(ok(view)) })
    await waitFor(() => { expect(screen.getByText('Environment')).toBeTruthy() })
    // The card leads with the plain-language verdict, not with the raw view envelope.
    expect(screen.getByText('1 need attention')).toBeTruthy()
    // Facts: label above value, grouped under Environment.
    // The label appears twice by design: once in the reading, once in the source list behind details.
    expect(screen.getAllByText('平台兼容线')).toHaveLength(2)
    expect(screen.getByText('0.2.1-rc.2（floor 0.2.1-rc.1）')).toBeTruthy()
    // Runtime: frozen status words and a warn row's remedy.
    expect(screen.getByText('Runtime status')).toBeTruthy()
    expect(screen.getByText('needs attention')).toBeTruthy()
    expect(screen.getByText('Suggested: /evolution runs')).toBeTruthy()
    // The raw identifiers live behind the one disclosure: schema + source paths + check time.
    expect(screen.getByText('Technical details')).toBeTruthy()
    expect(screen.getByText('data version v2')).toBeTruthy()
    expect(screen.getByText('README.md（兼容线声明）')).toBeTruthy()
    expect(screen.getByText(/^Checked: /)).toBeTruthy()
  })

  it('renders an all-healthy summary when every runtime row is ok', async () => {
    const healthy: DiagnosticsView = {
      ...view,
      runtime: [{ key: 'host-surface', label: 'Host 数据面', status: 'ok', detail: '已挂载 12/12' }],
    }
    const api = { view: vi.fn(async () => ok(healthy)) }
    render(createElement(DiagnosticsCard, { t, api, fallback: FALLBACKS.diagnostics }))
    await waitFor(() => { expect(screen.getByText('All healthy')).toBeTruthy() })
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
