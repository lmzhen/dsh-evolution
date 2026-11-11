// @tier pre-tag
// @vitest-environment jsdom
/**
 * G5/W7 S7: the diagnostics card RENDERED. It is read-only and renders the Host's ONE view:
 * loading says so, a ready view leads with a plain-language runtime summary, a failed read uses the
 * shared FailureBlock + the command fallback, and Refresh is the only thing that reads again.
 *
 * The view's documentation facts are a CLI/JSON concern: the settings face carries the runtime
 * window only (0.27.2 real-machine feedback — a settings page is not a spec sheet). The fixture
 * still carries facts so the test proves they are deliberately not rendered.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import type { DiagnosticsView } from '@lmzhen/dsh-evolution-client-kit/generated/contracts'
import type { RouteAnswer } from '@lmzhen/dsh-evolution-client-kit/generated/route-client'
import { DiagnosticsCard } from '../src/panels/settings/DiagnosticsCard.ts'
import { FALLBACKS } from '@lmzhen/dsh-evolution-client-kit/generated/fallbacks'
import { formatText } from '../src/panels/settings/messages.ts'

const t = (key: string, values?: Readonly<Record<string, string | number>>): string => formatText(key as never, values, 'zh')

/** The card starts collapsed; open it before asserting its body. */
const renderCard = (props: Parameters<typeof DiagnosticsCard>[0]): ReturnType<typeof render> => {
  const result = render(createElement(DiagnosticsCard, props))
  const head = document.querySelector('.evolution-param-head')
  if (head !== null) fireEvent.click(head)
  return result
}

const view: DiagnosticsView = {
  schemaVersion: 2,
  generatedAt: '2026-10-19T00:00:00.000Z',
  facts: [
    { key: 'platform-line', label: '兼容版本', value: '0.2.1-rc.3（最低兼容 0.2.1-rc.2）', home: 'README.md（兼容版本声明）' },
  ],
  runtime: [
    { key: 'host-surface', label: '数据连接', status: 'ok', detail: '已就绪 12/12；仅限本机访问（按平台设置）' },
    { key: 'runs', label: '运行记录', status: 'warn', detail: '正在运行 2 个，遗留 1 个', remedy: '/evolution runs' },
  ],
}

const ok = (data: DiagnosticsView): RouteAnswer<DiagnosticsView> => ({ ok: true, data })

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('diagnostics card', () => {
  it('renders loading first, then a summary plus the runtime rows — and never the view facts', async () => {
    let resolve: ((answer: RouteAnswer<DiagnosticsView>) => void) | undefined
    const api = { view: vi.fn(() => new Promise<RouteAnswer<DiagnosticsView>>((done) => { resolve = done })) }
    renderCard({ t, api, fallback: FALLBACKS.diagnostics })
    expect(screen.getByText('正在读取…')).toBeTruthy()
    await act(async () => { resolve?.(ok(view)) })
    await waitFor(() => { expect(screen.getByText('运行状态')).toBeTruthy() })
    // The card leads with the plain-language verdict and the top row when collapsed.
    expect(screen.getByText('1 项需要注意')).toBeTruthy()
    expect(document.querySelector('[data-role="diag-focus"]')?.textContent).toBe('运行记录')
    // Runtime rows: frozen status words, detail lines and a warn row's remedy.
    expect(screen.getByText('注意')).toBeTruthy()
    expect(screen.getByText('正在运行 2 个，遗留 1 个')).toBeTruthy()
    expect(screen.getByText('建议：/evolution runs')).toBeTruthy()
    expect(document.querySelector('[data-action="diag-copy-remedy"]')).toBeTruthy()
    // The documentation facts (labels, values, homes) stay off the settings face.
    expect(screen.queryByText('Environment')).toBeNull()
    expect(screen.queryByText('兼容版本')).toBeNull()
    expect(screen.queryByText('0.2.1-rc.3（floor 0.2.1-rc.2）')).toBeNull()
    expect(screen.queryByText('README.md（兼容线声明）')).toBeNull()
    expect(screen.queryByText('Technical details')).toBeNull()
  })

  it('renders an all-healthy summary when every runtime row is ok', async () => {
    const healthy: DiagnosticsView = {
      ...view,
      runtime: [{ key: 'host-surface', label: '数据连接', status: 'ok', detail: '已就绪 12/12' }],
    }
    const api = { view: vi.fn(async () => ok(healthy)) }
    renderCard({ t, api, fallback: FALLBACKS.diagnostics })
    await waitFor(() => { expect(screen.getByText('运行正常')).toBeTruthy() })
  })

  it('says so when the view carries no runtime row', async () => {
    const api = { view: vi.fn(async () => ok({ ...view, runtime: [] })) }
    renderCard({ t, api, fallback: FALLBACKS.diagnostics })
    await waitFor(() => { expect(screen.getByText('没有可显示的运行状态')).toBeTruthy() })
  })

  it('renders a failed read as the shared failure block with the command fallback', async () => {
    const api = { view: vi.fn(async () => ({ ok: false as const, failure: { kind: 'unmounted' as const, status: 404 } })) }
    renderCard({ t, api, fallback: FALLBACKS.diagnostics })
    await waitFor(() => { expect(screen.getByText('这个功能没有启用。')).toBeTruthy() })
    expect(screen.getByText('可以改用命令：/evolution doctor')).toBeTruthy()
  })

  it('renders a rejected read as a failure instead of staying in loading', async () => {
    const api = { view: vi.fn(async () => { throw new Error('diagnostics transport rejected') }) }
    renderCard({ t, api, fallback: FALLBACKS.diagnostics })
    await waitFor(() => { expect(screen.getByText('读取失败，可以手动重试。')).toBeTruthy() })
    expect(screen.queryByText('正在读取…')).toBeNull()
  })

  it('offers the retry its failure sentence promises, and re-reads when asked', async () => {
    const api = {
      view: vi.fn()
        .mockRejectedValueOnce(new Error('diagnostics transport rejected'))
        .mockResolvedValueOnce(ok(view)),
    }
    renderCard({ t, api, fallback: FALLBACKS.diagnostics })
    await waitFor(() => { expect(screen.getByText('读取失败，可以手动重试。')).toBeTruthy() })
    const retry = document.querySelector('[data-action="diag-retry"]')
    // The sentence promised a manual retry; a failure state without the control was a dead end.
    expect(retry).toBeTruthy()
    await act(async () => { fireEvent.click(retry as Element) })
    await waitFor(() => { expect(screen.getByText('运行状态')).toBeTruthy() })
    expect(api.view).toHaveBeenCalledTimes(2)
  })

  it('a failed refresh keeps the last ready view instead of replacing it with an error page', async () => {
    const api = {
      view: vi.fn()
        .mockResolvedValueOnce(ok(view))
        .mockResolvedValueOnce({ ok: false as const, failure: { kind: 'unmounted' as const, status: 404 } }),
    }
    renderCard({ t, api, fallback: FALLBACKS.diagnostics })
    await waitFor(() => { expect(screen.getByText('运行状态')).toBeTruthy() })
    await act(async () => { fireEvent.click(screen.getByText('刷新')) })
    await waitFor(() => { expect(screen.getByText('这个功能没有启用。')).toBeTruthy() })
    expect(screen.getByText('运行状态')).toBeTruthy()
    expect(screen.getAllByText('运行记录').length).toBeGreaterThan(0)
  })

  it('reads once on mount and only again on an explicit refresh', async () => {
    const api = { view: vi.fn(async () => ok(view)) }
    renderCard({ t, api, fallback: FALLBACKS.diagnostics })
    await waitFor(() => { expect(api.view).toHaveBeenCalledTimes(1) })
    await act(async () => { fireEvent.click(screen.getByText('刷新')) })
    await waitFor(() => { expect(api.view).toHaveBeenCalledTimes(2) })
  })
})
