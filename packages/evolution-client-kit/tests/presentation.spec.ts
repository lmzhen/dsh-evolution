// @tier fast
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { expect, it } from 'vitest'
import { ActionMenu, DecisionFrame, DisclosureGroup, EmptyState, FilterChip, StatusChip, TaskBanner, TimeText } from '../src/index.ts'

type Props = Record<string, unknown>
const element = (node: ReactNode): ReactElement<Props> => node as ReactElement<Props>
function walk(node: ReactNode): ReactElement<Props>[] {
  if (!isValidElement(node)) return []
  const self = element(node)
  const children = Children.toArray((self.props as { children?: ReactNode }).children)
  return [self, ...children.flatMap(walk)]
}
const roles = (node: ReactNode, role: string): ReactElement<Props>[] => walk(node).filter(child => child.props['data-role'] === role)

it('renders one primary decision at most and keeps facts/details in order', () => {
  const frame = DecisionFrame({
    decision: {
      title: 'm16 + m17',
      summary: '两个技能内容重复',
      facts: [{ label: '建议保留', value: 'm16' }, { label: '影响范围', value: 'm17 归档' }],
      primary: { id: 'approve', label: '批准合并', onSelect: () => {} },
      secondary: [{ id: 'reject', label: '拒绝', onSelect: () => {} }],
      details: '完整理由',
    },
  })
  expect(roles(frame, 'decision-primary')).toHaveLength(1)
  expect(roles(frame, 'decision-secondary')).toHaveLength(1)
  expect(roles(frame, 'decision-fact')).toHaveLength(2)
  expect(roles(frame, 'decision-details')).toHaveLength(1)
  expect(roles(frame, 'decision-primary')[0]?.props.disabled).toBe(false)
})

it('keeps TaskBanner read-only and exposes count as status', () => {
  const banner = element(TaskBanner({ count: 2, text: '2 条建议待处理' }))
  expect(banner.props.role).toBe('status')
  expect(walk(banner).filter(child => child.type === 'button')).toHaveLength(0)
  expect(roles(banner, 'task-banner-count')[0]?.props.children).toBe('2')
})

it('exposes filter state and a single empty-state primary', () => {
  const chip = element(FilterChip({ label: '警告', count: 2, active: true, onClick: () => {} }))
  expect(chip.props['aria-pressed']).toBe('true')
  expect(chip.props['data-active']).toBe('true')
  const empty = EmptyState({
    title: '没有待处理的写入',
    description: '新的写入会出现在这里',
    primary: { id: 'history', label: '查看技能历史', onSelect: () => {} },
    secondary: { id: 'refresh', label: '刷新', onSelect: () => {} },
  })
  expect(roles(empty, 'empty-primary')).toHaveLength(1)
  expect(roles(empty, 'empty-secondary')).toHaveLength(1)
})

it('adds compact/centered empty-state markers without changing the default', () => {
  expect(element(EmptyState({ title: '空' })).props['data-variant']).toBeUndefined()
  expect(element(EmptyState({ title: '空', variant: 'compact' })).props['data-variant']).toBe('compact')
  expect(element(EmptyState({ title: '空', variant: 'centered' })).props['data-variant']).toBe('centered')
})

it('uses native details for normal items and exposes status tone', () => {
  const group = element(DisclosureGroup({ summary: '其他 6 项正常', count: 6, children: '检查项' }))
  expect(group.type).toBe('details')
  expect(group.props.open).toBeUndefined()
  expect(element(StatusChip({ label: '正常', tone: 'ok' })).props['data-tone']).toBe('ok')
})

it('renders the action menu fallback and the shared time text', () => {
  const menu = ActionMenu({ actions: [{ id: 'copy', label: '复制命令', onSelect: () => {} }], label: '更多', primitives: undefined })
  expect(roles(menu, 'action-menu-fallback')).toHaveLength(1)
  expect(roles(menu, 'action-menu-fallback')[0]?.props.role).toBe('menu')
  expect(TimeText({ value: '2026-11-05T05:00:00.000Z', seconds: false })).toBeTruthy()
  expect(element(TimeText({ value: null })).props.children).toBe('—')
})
