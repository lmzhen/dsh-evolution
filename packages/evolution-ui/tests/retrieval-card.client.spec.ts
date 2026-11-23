// @tier pre-tag
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { RetrievalCard, type RetrievalOperations } from '../src/panels/settings/RetrievalCard.ts'
import { formatText } from '../src/panels/settings/messages.ts'

const t = (key: string, values?: Readonly<Record<string, string | number>>): string => formatText(key as never, values, 'zh')

const absent = { configured: false, writable: true }

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function operations(overrides: Partial<RetrievalOperations> = {}): RetrievalOperations {
  return {
    available: true,
    describe: vi.fn(async () => ({ ok: true as const, value: { SILICONFLOW_API_KEY: absent, BAMBOO_API_KEY: absent } })),
    set: vi.fn(async () => ({ ok: true as const, value: undefined })),
    unset: vi.fn(async () => ({ ok: true as const, value: undefined })),
    ...overrides,
  }
}

it('renders both optional key fields and the local-mode status', async () => {
  const ops = operations()
  render(createElement(RetrievalCard, { t, operations: ops }))
  await waitFor(() => { expect(screen.getByText('检索增强（可选）')).toBeTruthy() })
  expect(screen.getByText('SiliconFlow API Key')).toBeTruthy()
  expect(screen.getByText('StartLux 精排 API Key')).toBeTruthy()
  expect(screen.getByText('当前：向量和精排都用本地')).toBeTruthy()
  expect(screen.getAllByText('未设置').length).toBeGreaterThan(0)
})

it('writes only non-empty drafts through the credential remote and re-reads', async () => {
  const ops = operations()
  render(createElement(RetrievalCard, { t, operations: ops }))
  await waitFor(() => { expect(screen.getByText('检索增强（可选）')).toBeTruthy() })
  const input = screen.getByLabelText('SiliconFlow API Key') as HTMLInputElement
  fireEvent.change(input, { target: { value: ' sf-key ' } })
  fireEvent.click(screen.getByText('保存'))
  await waitFor(() => { expect(ops.set).toHaveBeenCalledWith('SILICONFLOW_API_KEY', ' sf-key ') })
  expect(ops.describe).toHaveBeenCalledTimes(2)
  await waitFor(() => { expect(screen.getByText('已保存')).toBeTruthy() })
})

it('shows configured state without ever putting the stored value into the draft', async () => {
  const ops = operations({
    describe: vi.fn(async () => ({
      ok: true as const,
      value: {
        SILICONFLOW_API_KEY: { configured: true, writable: true, source: 'env' },
        BAMBOO_API_KEY: { configured: false, writable: true },
      },
    })),
  })
  render(createElement(RetrievalCard, { t, operations: ops }))
  await waitFor(() => { expect(screen.getByText('当前：向量走云端，精排用本地')).toBeTruthy() })
  const input = screen.getByLabelText('SiliconFlow API Key') as HTMLInputElement
  expect(input.value).toBe('')
  expect(screen.getByText('来自环境变量')).toBeTruthy()
})

it('keeps the card usable but says so when the deployment has no writable credential store', async () => {
  const ops = operations({
    describe: vi.fn(async () => ({ ok: true as const, value: { SILICONFLOW_API_KEY: { configured: false, writable: false }, BAMBOO_API_KEY: { configured: false, writable: false } } })),
  })
  render(createElement(RetrievalCard, { t, operations: ops }))
  await waitFor(() => { expect(screen.getByText('当前环境不支持保存 Key；用环境变量配置仍然生效。')).toBeTruthy() })
})

it('surfaces a write refusal and does not claim a save', async () => {
  const ops = operations({ set: vi.fn(async () => ({ ok: false as const, message: 'credential/rejected: read only' })) })
  render(createElement(RetrievalCard, { t, operations: ops }))
  await waitFor(() => { expect(screen.getByText('检索增强（可选）')).toBeTruthy() })
  fireEvent.change(screen.getByLabelText('StartLux 精排 API Key'), { target: { value: 'bamboo-key' } })
  await act(async () => { fireEvent.click(screen.getByText('保存')) })
  await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('credential/rejected') })
  expect(screen.queryByText('已保存')).toBeNull()
})

it('hides Remove for a key that comes from the environment', async () => {
  const ops = operations({
    describe: vi.fn(async () => ({ ok: true as const, value: { SILICONFLOW_API_KEY: { configured: true, writable: true, source: 'env' }, BAMBOO_API_KEY: absent } })),
  })
  render(createElement(RetrievalCard, { t, operations: ops }))
  await waitFor(() => { expect(screen.getByText('来自环境变量')).toBeTruthy() })
  expect(screen.queryByText('删除 Key')).toBeNull()
})

it('reports removal as removal rather than as a save', async () => {
  const ops = operations({
    describe: vi.fn(async () => ({ ok: true as const, value: { SILICONFLOW_API_KEY: { configured: true, writable: true, source: 'file' }, BAMBOO_API_KEY: absent } })),
  })
  render(createElement(RetrievalCard, { t, operations: ops }))
  await waitFor(() => { expect(screen.getByText('删除 Key')).toBeTruthy() })
  await act(async () => { fireEvent.click(screen.getByText('删除 Key')) })
  await waitFor(() => { expect(screen.getByText('已删除 Key')).toBeTruthy() })
  expect(ops.unset).toHaveBeenCalledWith('SILICONFLOW_API_KEY')
  expect(screen.queryByText('已保存')).toBeNull()
})

it('separates a read failure from an unsupported credential store', async () => {
  const ops = operations({ describe: vi.fn(async () => ({ ok: false as const, message: 'transport rejected' })) })
  render(createElement(RetrievalCard, { t, operations: ops }))
  await waitFor(() => { expect(screen.getByText('读取 Key 状态失败')).toBeTruthy() })
  expect(screen.getByText('transport rejected')).toBeTruthy()
  expect(screen.queryByText('当前环境不支持保存 Key；用环境变量配置仍然生效。')).toBeNull()
})

it('renders the unavailable state once when the deployment has no credential remote', async () => {
  const unavailable = '当前环境不支持保存 Key；用环境变量配置仍然生效。'
  const ops: RetrievalOperations = {
    available: false,
    describe: vi.fn(async () => ({ ok: false as const, message: unavailable })),
    set: vi.fn(async () => ({ ok: false as const, message: unavailable })),
    unset: vi.fn(async () => ({ ok: false as const, message: unavailable })),
  }
  render(createElement(RetrievalCard, { t, operations: ops }))
  await waitFor(() => { expect(screen.getAllByText(unavailable)).toHaveLength(1) })
})
