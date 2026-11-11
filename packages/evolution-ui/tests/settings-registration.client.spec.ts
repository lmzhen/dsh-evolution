// @tier pre-tag
// @vitest-environment jsdom
/**
 * The client half's settings surfaces.
 *
 * The family owns ONE top-level settings section (nav row + icon, addressed by the same id): its
 * page carries the eight parameter cards and the diagnostics card, and it writes through the
 * platform's own client settings seat (`state` + `mutate`) — never through a second seat of its
 * own. The Plugins page contributes the bundle's install scope only: `plugins.row.config` is not
 * registered and not even injected, so a row has no configuration entry to open.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { FAMILY_VERSION } from '../src/panels/settings/generated-about.ts'
import { apply, inject, SECTION_ID, SECTION_ORDER } from '../src/panels/settings/index.ts'
import { CLIENT_PARAM_SECTIONS } from '../src/panels/settings/generated-params.ts'
import { PRODUCT_BUNDLE } from '../src/panels/settings/generated-surface.ts'
import { formatText, NAMESPACE_TITLES, type MessageKey } from '../src/panels/settings/messages.ts'

/** The copy the page renders, resolved the way the registered translator resolves it. */
const t = (key: MessageKey, values?: Readonly<Record<string, string | number>>): string => formatText(key, values, 'zh')

interface Registration {
  options: Record<string, unknown>
  component: unknown
}

/** One namespace's form, in the pair the platform's `ConfigPageForm` supplies. */
function form(user: Record<string, unknown> = {}): {
  getSnapshot: () => Record<string, unknown>
  subscribe: (listener: () => void) => () => void
  set: (field: string, value: unknown) => Promise<boolean>
  unset: (field: string) => Promise<boolean>
  mutate: ReturnType<typeof vi.fn>
} {
  const state = { status: 'ready', value: { ...user }, base: undefined, user, revision: 7, writable: true }
  return {
    getSnapshot: () => state,
    subscribe: () => () => {},
    set: async () => true,
    unset: async () => true,
    mutate: vi.fn(async () => true),
  }
}

/** The platform settings seat, as `ctx.get('configForms')` reports it. */
function seat(forms: Readonly<Record<string, ReturnType<typeof form>>> = {}): { get: (namespace: string) => unknown } {
  return { get: (namespace: string) => forms[namespace] ?? form() }
}

function shell(options: { seat?: ReturnType<typeof seat> | undefined } = {}): {
  ctx: Parameters<typeof apply>[0]
  registrations: Registration[]
  warnings: string[]
} {
  const registrations: Registration[] = []
  const warnings: string[] = []
  const injected: string[] = []
  const settingsSeat = options.seat ?? seat()
  const ctx = {
    effect: (fn: () => unknown) => {
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    logger: { warn: (line: string) => { warnings.push(line) } },
    get: (name: string) => name === 'configForms' ? settingsSeat : undefined,
    slots: {
      inject: (name: string, callback: () => Generator<unknown, void, unknown>) => {
        injected.push(name)
        if (name !== 'settings.section' && name !== 'plugins.detail.section') throw new Error('unexpected slot injection: ' + name)
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
      bind: () => (key: string, values?: Readonly<Record<string, string | number>>) => formatText(key as MessageKey, values, 'zh'),
      getLocale: () => ({ active: 'zh' }),
    },
  }
  return { ctx: ctx as unknown as Parameters<typeof apply>[0], registrations, warnings }
}

/** The registered section page, rendered the way the settings shell renders it. */
function renderSection(options: { seat?: ReturnType<typeof seat> } = {}): ReturnType<typeof render> {
  const { ctx, registrations } = shell(options)
  apply(ctx)
  const entry = registrations.find(candidate => candidate.options.name === 'settings.section')
  if (entry === undefined) throw new Error('the bundle registered no settings section')
  const View = entry.component as (props: unknown) => Parameters<typeof render>[0]
  return render(createElement(View as never, { close: () => {} }))
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the settings section', () => {
  it('registers one section and one icon under the same id, and no per-row configuration', () => {
    const { ctx, registrations } = shell()
    apply(ctx)
    const sections = registrations.filter(entry => entry.options.name === 'settings.section')
    const icons = registrations.filter(entry => entry.options.name === 'settings.section.icon')
    expect(sections).toHaveLength(1)
    expect(icons).toHaveLength(1)
    // The icon is addressed by the section's own id: an unmatched id never renders.
    expect(sections[0]?.options.id).toBe(SECTION_ID)
    expect(icons[0]?.options.id).toBe(SECTION_ID)
    expect(sections[0]?.options.order).toBe(SECTION_ORDER)
    expect(sections[0]?.options.locale).toBe('evolution-settings')
    expect((sections[0]?.options.label as () => string)()).toBe(t('title'))
    expect(typeof sections[0]?.component).toBe('function')
    expect(typeof icons[0]?.component).toBe('function')
    // The row configuration entry is gone: not registered, and not even injected.
    expect(registrations.filter(entry => entry.options.name === 'plugins.row.config')).toEqual([])
  })

  it('reads the platform settings seat instead of requiring it (the skill-history panel ships in the same bundle)', () => {
    // A required `configForms` inject would leave this whole browser half pending in a deployment
    // that composes no settings shell, so the seat is read through `ctx.get` at render time.
    expect([...inject]).toEqual(['slots', 'locale'])
  })

  it('renders one card per parameter namespace plus the diagnostics card, inside the page', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ ok: false, error: { message: 'test' } }) }))
    let rendered: ReturnType<typeof render> | undefined
    await act(async () => { rendered = renderSection() })
    const container = rendered!.container
    const cards = container.querySelectorAll('[data-card="params"]')
    expect(cards).toHaveLength(CLIENT_PARAM_SECTIONS.length)
    expect(CLIENT_PARAM_SECTIONS.length).toBe(8)
    expect(container.querySelectorAll('[data-card="diagnostics"]')).toHaveLength(1)
    // Every namespace keeps its own card title in the page: the diagnostics card sits after them.
    for (const section of CLIENT_PARAM_SECTIONS) {
      const titleKey = NAMESPACE_TITLES[section.namespace] as MessageKey
      expect(titleKey).toBeDefined()
      expect(container.textContent).toContain(t(titleKey))
    }
    expect(container.textContent).toContain(t('diagTitle'))
  })

  it('writes through the seat: one revision-fenced op list per save', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ ok: false, error: { message: 'test' } }) }))
    const approval = form()
    let rendered: ReturnType<typeof render> | undefined
    await act(async () => { rendered = renderSection({ seat: seat({ 'evolution-approval': approval }) }) })
    const container = rendered!.container
    // The first card is the approval row (the write group leads); its first field is the switch.
    const head = container.querySelector('[data-card="params"] .evolution-param-head')
    expect(head).not.toBeNull()
    await act(async () => { fireEvent.click(head as Element) })
    const control = container.querySelector('[data-card="params"] input[type="checkbox"]')
    expect(control).not.toBeNull()
    // An untouched switch reads as off; clicking it stages a change to on.
    await act(async () => { fireEvent.click(control as Element) })
    const save = Array.from(container.querySelectorAll('button')).find(button => button.textContent === t('apply'))
    expect(save).toBeDefined()
    await act(async () => { fireEvent.click(save as Element) })
    await waitFor(() => { expect(approval.mutate).toHaveBeenCalled() })
    // ONE atomic save carrying the revision this render read — the platform form model.
    expect(approval.mutate).toHaveBeenCalledWith([{ op: 'set', path: ['enabled'], value: true }], 7)
  })
})

describe('the Plugins page contribution', () => {
  it('registers one install-scope section for the family bundle and nothing else', () => {
    const { ctx, registrations } = shell()
    apply(ctx)
    const details = registrations.filter(entry => entry.options.name === 'plugins.detail.section')
    expect(details).toHaveLength(1)
    expect(details[0]?.options.id).toBe('evolution-install-scope')
    expect(typeof details[0]?.component).toBe('function')
  })

  it('states the install scope (version + platform line) and points at the settings page', () => {
    const { ctx, registrations } = shell()
    apply(ctx)
    const detail = registrations.find(entry => entry.options.name === 'plugins.detail.section')
    expect(detail).toBeDefined()
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ ok: false, error: { message: 'test' } }) }))
    const View = detail?.component as (props: unknown) => Parameters<typeof render>[0]
    const family = render(createElement(View as never, { subject: { kind: 'bundle', pkg: { name: PRODUCT_BUNDLE } } }))
    expect(family.container.textContent).toContain(FAMILY_VERSION)
    expect(family.container.textContent).toContain(formatText('detailScope', { rows: CLIENT_PARAM_SECTIONS.length }, 'zh'))
    // Install scope only: the parameter cards and the diagnostics card live in the settings page.
    expect(family.container.querySelectorAll('[data-card]')).toHaveLength(0)
    cleanup()
    // The source-scope bundle is the same family.
    const source = render(createElement(View as never, { subject: { kind: 'bundle', pkg: { name: '@deepseek-ai/dsh-evolution-all' } } }))
    expect(source.container.textContent).toContain(FAMILY_VERSION)
    cleanup()
    const other = render(createElement(View as never, { subject: { kind: 'bundle', pkg: { name: '@example/other' } } }))
    expect(other.container.textContent).toBe('')
  })
})
