// @tier pre-tag
import { describe, expect, it } from 'vitest'
import { registerSidebarPanel, type SidebarPanelSpec } from '../src/index.ts'
import { panelWorkspaceId } from '../src/workspace.ts'

function fakeContext(localeRefuses = false) {
  let injector: (() => Generator<() => void, void, void>) | undefined
  const rows: unknown[] = []
  const bodies: unknown[] = []
  const effects: string[] = []
  const ctx = {
    effect(fn: () => (() => void) | void, name: string) { effects.push(name); return fn() ?? (() => {}) },
    logger: { warn: () => {} },
    slots: {
      inject(_name: string, body: () => Generator<() => void, void, void>) { injector = body },
      register(options: unknown) { (options as { name: string }).name === 'main' ? bodies.push(options) : rows.push(options); return () => {} },
    },
    locale: {
      register() { if (localeRefuses) throw new Error('already registered'); return () => {} },
      bind() { return (key: string) => key === 'entry.label' ? 'seat-label' : 'seat:' + key },
    },
  }
  return { ctx, effects, rows, bodies, get injector() { return injector } }
}

const spec: SidebarPanelSpec<{ ok: boolean }> = {
  id: 'demo', order: 42, namespace: 'demo.ns',
  dictionaries: { zh: { 'entry.label': '演示' }, en: { 'entry.label': 'Demo' } },
  styles: { css: '.x{}', tagId: 'demo-css' },
  icon: () => null,
  component: (() => null) as never,
  body: () => ({ ok: true }),
}

describe('client kit panel lifecycle', () => {
  it('registers one row and one keyed main body under the same id', () => {
    const f = fakeContext()
    registerSidebarPanel(f.ctx as never, spec)
    expect(f.injector).toBeDefined()
    for (const dispose of f.injector!()) void dispose
    expect(f.rows).toMatchObject([{ name: 'sidebar.panellist', id: 'demo', order: 42 }])
    expect(f.bodies).toMatchObject([{ name: 'main', key: 'demo' }])
    expect((f.bodies[0] as { inject: () => unknown }).inject()).toEqual({ ok: true })
  })

  it('survives a refused locale registration with the bundle fallback', () => {
    const f = fakeContext(true)
    expect(() => registerSidebarPanel(f.ctx as never, spec)).not.toThrow()
    for (const dispose of f.injector!()) void dispose
    const row = f.rows[0] as { label: () => string }
    expect(row.label()).toBe('Demo')
  })

  it('resolves the current workspace through sessions + workspaces, and falls back to local scope', () => {
    const sessions = { list: { getSnapshot: () => ({ byId: { s1: { retainedBy: { mainView: 1 } }, s2: { retainedBy: { mainView: 0 } } } }) } }
    const workspaces = { list: { getSnapshot: () => ({ items: [{ workspaceId: 'w1', sessionIds: ['s1'] }, { workspaceId: 'w2', sessionIds: ['s2'] }] }) } }
    const ctx = { get: (name: string) => name === 'sessions' ? sessions : name === 'workspaces' ? workspaces : undefined }
    expect(panelWorkspaceId(ctx as never)).toBe('w1')
    expect(panelWorkspaceId({ get: () => undefined } as never)).toBeUndefined()
    expect(panelWorkspaceId({ get: (name: string) => name === 'sessions' ? sessions : undefined } as never)).toBeUndefined()
  })
})
