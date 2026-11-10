// @tier pre-tag
// @vitest-environment jsdom
/**
 * The client half registers per-row configuration on the platform Plugins page.
 * The page owns the form; this bundle must not register a top-level settings
 * section or a second settings seat.
 */
import { describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { createElement } from 'react'
import { FAMILY_VERSION } from '../src/panels/settings/generated-about.ts'
import { apply } from '../src/panels/settings/index.ts'
import { PRODUCT_BUNDLE, ROW_CONFIG_SURFACES } from '../src/panels/settings/generated-surface.ts'

interface Registration {
  options: Record<string, unknown>
  component: unknown
}

function shell(): { ctx: Parameters<typeof apply>[0]; registrations: Registration[]; warnings: string[] } {
  const registrations: Registration[] = []
  const warnings: string[] = []
  const ctx = {
    effect: (fn: () => unknown) => {
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    logger: { warn: (line: string) => { warnings.push(line) } },
    slots: {
      inject: (name: string, callback: () => Generator<unknown, void, unknown>) => {
        if (name !== 'plugins.row.config' && name !== 'plugins.detail.section') throw new Error('unexpected slot injection: ' + name)
        for (const _entry of callback()) { /* registrations are recorded by register() */ }
      },
      register: (options: Record<string, unknown>, component: unknown) => {
        if (options.name === 'plugins.detail.section' && options.id === undefined) throw new Error('plugins.detail.section requires id')
        if (options.name === 'plugins.detail.section' && options.key !== undefined) throw new Error('plugins.detail.section is a list slot, not keyed')
        registrations.push({ options, component })
        return () => {}
      },
    },
    locale: {
      register: () => () => {},
      bind: () => (key: string) => key,
      getLocale: () => ({ active: 'zh' }),
    },
  }
  return { ctx: ctx as unknown as Parameters<typeof apply>[0], registrations, warnings }
}

describe('the per-row config registration', () => {
  it('registers one row config per generated surface on the one product bundle', () => {
    const { ctx, registrations } = shell()
    apply(ctx)
    const rows = registrations.filter(entry => entry.options.name === 'plugins.row.config')
    expect(rows).toHaveLength(ROW_CONFIG_SURFACES.length)
    for (const surface of ROW_CONFIG_SURFACES) {
      const entry = rows.find(candidate => candidate.options.key === PRODUCT_BUNDLE + '#' + surface.rowId)
      expect(entry, surface.rowId).toBeDefined()
      expect(typeof entry?.component).toBe('function')
    }
  })

  it('does not register a top-level settings section or settings seat', () => {
    const { ctx, registrations } = shell()
    apply(ctx)
    expect(registrations.some(entry => entry.options.name === 'settings.section')).toBe(false)
    expect(registrations.some(entry => entry.options.name === 'settings.section.icon')).toBe(false)
    expect(registrations.filter(entry => entry.options.name === 'plugins.detail.section')).toHaveLength(1)
  })

  it('renders the family decision line in the package detail section and nowhere else', () => {
    const { ctx, registrations } = shell()
    apply(ctx)
    const detail = registrations.find(entry => entry.options.name === 'plugins.detail.section')
    expect(detail).toBeDefined()
    expect(detail?.options.id).toBe('evolution-diagnostics')
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ ok: false, error: { message: 'test' } }) }))
    const View = detail?.component as (props: unknown) => Parameters<typeof render>[0]
    const family = render(createElement(View as never, { subject: { kind: 'bundle', pkg: { name: PRODUCT_BUNDLE } } }))
    expect(family.container.textContent).toContain(FAMILY_VERSION)
    cleanup()
    const other = render(createElement(View as never, { subject: { kind: 'bundle', pkg: { name: '@example/other' } } }))
    expect(other.container.textContent).toBe('')
    cleanup()
    vi.unstubAllGlobals()
  })
})
