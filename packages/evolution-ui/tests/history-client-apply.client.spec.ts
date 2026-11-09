// @tier pre-tag
// @vitest-environment jsdom
/**
 * What the bundle registers, and that all of it comes back.
 *
 * The history bundle contributes one platform sidebar row and one keyed main
 * occupant that declares the workbench view child slot, plus one locale
 * namespace. The fake registry records those exact names so the removed
 * layout.page / sidebar.pages seats cannot creep back.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { apply, PANEL_ORDER } from '../src/panels/history/client/index.ts'
import { NS, en, zh } from '../src/panels/history/client/messages.ts'
import { WORKBENCH_ID } from '../src/panels/history/client/Workbench.ts'

interface SlotOptions {
  name: string
  id?: string
  key?: string
  order?: number
  label?: () => string
  inject?: () => unknown
  children?: Record<string, unknown>
}

function fakeSeams(options: { refuseLocale?: boolean } = {}): {
  ctx: unknown
  rows: SlotOptions[]
  pages: SlotOptions[]
  namespaces: string[]
  faces: unknown[]
  warnings: string[]
  dispose: () => void
} {
  const rows: SlotOptions[] = []
  const pages: SlotOptions[] = []
  const namespaces: string[] = []
  const faces: unknown[] = []
  const disposers: Array<() => void> = []
  const slots = {
    inject(_name: string, callback: () => Generator<unknown, void, unknown>): () => void {
      const mine: Array<() => void> = []
      for (const yielded of callback()) if (typeof yielded === 'function') mine.push(yielded as () => void)
      disposers.push(...mine)
      return () => { for (const dispose of mine.reverse()) dispose() }
    },
    register(options: SlotOptions, _component: unknown): () => void {
      if (options.name === 'sidebar.panellist') rows.push(options)
      else if (options.name === 'main') { pages.push(options); faces.push(options.inject?.()) }
      return () => {
        if (options.name === 'sidebar.panellist') rows.splice(rows.indexOf(options), 1)
        else if (options.name === 'main') pages.splice(pages.indexOf(options), 1)
      }
    },
  }
  const locale = {
    register(namespace: string): () => void {
      if (options.refuseLocale === true) throw new Error('namespace "' + namespace + '" is already registered')
      namespaces.push(namespace)
      return () => { namespaces.splice(namespaces.indexOf(namespace), 1) }
    },
    bind: () => (key: string) => key,
  }
  const warnings: string[] = []
  const ctx = {
    slots,
    locale,
    logger: { warn: (message: string) => { warnings.push(message) } },
    effect(effect: () => unknown): unknown { const dispose = effect(); if (typeof dispose === 'function') disposers.push(dispose as () => void); return dispose },
  }
  return {
    ctx,
    rows,
    pages,
    namespaces,
    faces,
    warnings,
    dispose: () => { for (const dispose of disposers.splice(0).reverse()) dispose() },
  }
}

afterEach(() => {
  document.querySelectorAll('style[data-plugin-css]').forEach((tag) => { tag.remove() })
})

describe('history client bundle: what it contributes, and what it takes back', () => {
  it('contributes one sidebar row, one keyed main occupant and one locale namespace', () => {
    const seams = fakeSeams()
    apply(seams.ctx as never)
    expect(seams.rows).toHaveLength(1)
    expect(seams.rows[0]?.name).toBe('sidebar.panellist')
    expect(seams.rows[0]?.id).toBe(WORKBENCH_ID)
    expect(seams.rows[0]?.order).toBe(PANEL_ORDER)
    expect(typeof seams.rows[0]?.label?.()).toBe('string')
    expect(seams.pages).toHaveLength(1)
    expect(seams.pages[0]?.name).toBe('main')
    expect(seams.pages[0]?.key).toBe(WORKBENCH_ID)
    expect(seams.pages[0]?.children).toEqual({ 'evolution.workbench.view': { kind: 'list', scope: 'root' } })
    expect(seams.namespaces).toEqual([NS])
    expect(document.querySelectorAll('style[data-plugin-css]')).toHaveLength(1)
  })

  it('hands the page its face as plain data and callbacks, never a service', () => {
    const seams = fakeSeams()
    apply(seams.ctx as never)
    const face = seams.faces[0] as { t: unknown; history: Record<string, unknown> }
    expect(Object.keys(face).sort()).toEqual(['diagnostics', 'hasView', 'history', 'loadTaskCounts', 'pending', 'store', 't'])
    expect(Object.keys(face.history).sort()).toEqual(['format', 'loadBody', 'loadDiff', 'loadSkills', 'loadVersions', 'markdownWords', 't', 'undo'])
  })

  it('T5-06/A61: a REFUSED dictionary registration is reported and the rest of the bundle still mounts', () => {
    const seams = fakeSeams({ refuseLocale: true })
    apply(seams.ctx as never)
    expect(seams.namespaces).toEqual([])
    expect(seams.rows).toHaveLength(1)
    expect(seams.pages).toHaveLength(1)
    expect(document.querySelectorAll('style[data-plugin-css]')).toHaveLength(1)
    expect(seams.warnings.some(line => line.includes(NS) && line.includes('falls back to the bundle'))).toBe(true)
    expect(seams.rows[0]?.label?.()).toBe(en['entry.label'])
    expect(seams.rows[0]?.label?.()).not.toBe(zh['entry.label'])
  })

  it('leaves nothing behind when the bundle is disposed', () => {
    const seams = fakeSeams()
    apply(seams.ctx as never)
    seams.dispose()
    expect(seams.rows).toEqual([])
    expect(seams.pages).toEqual([])
    expect(seams.namespaces).toEqual([])
    expect(document.querySelectorAll('style[data-plugin-css]')).toHaveLength(0)
  })
})
