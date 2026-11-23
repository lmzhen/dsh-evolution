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
  expect(screen.getByText('硅基流动 API Key')).toBeTruthy()
  expect(screen.getByText('StartLux 判别 API Key')).toBeTruthy()
  expect(screen.getByText('当前：本地模式')).toBeTruthy()
  expect(screen.getAllByText('未设置').length).toBeGreaterThan(0)
})

it('writes only non-empty drafts through the credential remote and re-reads', async () => {
  const ops = operations()
  render(createElement(RetrievalCard, { t, operations: ops }))
  await waitFor(() => { expect(screen.getByText('检索增强（可选）')).toBeTruthy() })
  const input = screen.getByLabelText('硅基流动 API Key') as HTMLInputElement
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
        SILICONFLOW_API_KEY: { configured: true, writable: true, source: 'environment' },
        BAMBOO_API_KEY: { configured: false, writable: true },
      },
    })),
  })
  render(createElement(RetrievalCard, { t, operations: ops }))
  await waitFor(() => { expect(screen.getByText('当前：向量云端 · 判别本地')).toBeTruthy() })
  const input = screen.getByLabelText('硅基流动 API Key') as HTMLInputElement
  expect(input.value).toBe('')
  expect(screen.getByText('来源：环境变量')).toBeTruthy()
})

it('keeps the card usable but says so when the deployment has no writable credential store', async () => {
  const ops = operations({
    describe: vi.fn(async () => ({ ok: true as const, value: { SILICONFLOW_API_KEY: { configured: false, writable: false }, BAMBOO_API_KEY: { configured: false, writable: false } } })),
  })
  render(createElement(RetrievalCard, { t, operations: ops }))
  await waitFor(() => { expect(screen.getByText('当前部署未提供凭据服务，无法在此保存 Key；仍可使用环境变量。')).toBeTruthy() })
})

it('surfaces a write refusal and does not claim a save', async () => {
  const ops = operations({ set: vi.fn(async () => ({ ok: false as const, message: 'credential/rejected: read only' })) })
  render(createElement(RetrievalCard, { t, operations: ops }))
  await waitFor(() => { expect(screen.getByText('检索增强（可选）')).toBeTruthy() })
  fireEvent.change(screen.getByLabelText('StartLux 判别 API Key'), { target: { value: 'bamboo-key' } })
  await act(async () => { fireEvent.click(screen.getByText('保存')) })
  await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('credential/rejected') })
  expect(screen.queryByText('已保存')).toBeNull()
})
