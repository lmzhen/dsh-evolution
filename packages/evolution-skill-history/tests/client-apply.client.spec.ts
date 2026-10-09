// @vitest-environment jsdom
/**
 * What the bundle registers, and that all of it comes back.
 *
 * Three contributions leave this plugin: one global panel row, one keyed body in the main column, and
 * one locale namespace — plus the stylesheet tag. Neither \`tsc\` nor the bundle build can see whether
 * they are wired correctly or whether a dispose leaves anything behind, and the platform asks a
 * registry contribution to prove exactly that (HMR safety).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { apply, PANEL_ORDER } from '../src/client/index.ts'
import { NS } from '../src/client/messages.ts'
import { PANEL_ID, type PanelBodyOptions, type PanelRowOptions } from '../src/client/seam.ts'

/** A slots registry and locale seat that record contributions and hand back real disposers. */
function fakeSeams(options: { refuseLocale?: boolean } = {}): {
  ctx: unknown
  rows: PanelRowOptions[]
  bodies: PanelBodyOptions[]
  namespaces: string[]
  faces: unknown[]
  warnings: string[]
  dispose: () => void
} {
  const rows: PanelRowOptions[] = []
  const bodies: PanelBodyOptions[] = []
  const namespaces: string[] = []
  const faces: unknown[] = []
  const disposers: Array<() => void> = []
  const slots = {
    // The platform walks the generator returned by the callback and keeps every yielded disposer.
    inject(_name: string, callback: () => Generator<unknown, void, unknown>): () => void {
      const mine: Array<() => void> = []
      for (const yielded of callback()) if (typeof yielded === 'function') mine.push(yielded as () => void)
      disposers.push(...mine)
      return () => { for (const dispose of mine.reverse()) dispose() }
    },
    register(options: PanelRowOptions | PanelBodyOptions, _component: unknown): () => void {
      if (options.name === 'sidebar.panellist') rows.push(options)
      else { bodies.push(options); faces.push(options.inject()) }
      return () => {
        if (options.name === 'sidebar.panellist') rows.splice(rows.indexOf(options), 1)
        else bodies.splice(bodies.indexOf(options), 1)
      }
    },
  }
  const locale = {
    register(namespace: string): () => void {
      // The platform refuses a second registration of one namespace+locale (locale/src/client/index.ts
      // throws); this flag replays that refusal.
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
    logger: { warn: (message: string) => { warnings.push(String(message)) } },
    // Eager: the effect body runs inside apply(), exactly like cordis — which is why a throw in it
    // used to take the rest of the registrations with it.
    effect(effect: () => unknown): unknown { const dispose = effect(); if (typeof dispose === 'function') disposers.push(dispose as () => void); return dispose },
  }
  return {
    ctx,
    rows,
    bodies,
    namespaces,
    faces,
    warnings,
    // The platform disposes the bundle's effects when the fiber goes: same shape here.
    dispose: () => { for (const dispose of disposers.splice(0).reverse()) dispose() },
  }
}

afterEach(() => {
  document.querySelectorAll('style[data-plugin-css]').forEach((tag) => { tag.remove() })
})

describe('skill-history client bundle: what it contributes, and what it takes back', () => {
  it('contributes one panel row, one keyed body and one locale namespace', () => {
    const seams = fakeSeams()
    apply(seams.ctx as never)
    expect(seams.rows).toHaveLength(1)
    expect(seams.rows[0]?.id).toBe(PANEL_ID)
    expect(seams.rows[0]?.order).toBe(PANEL_ORDER)
    // The lazy label: the sidebar re-reads it, so a language switch follows without re-registering.
    expect(typeof seams.rows[0]?.label()).toBe('string')
    expect(seams.bodies).toHaveLength(1)
    expect(seams.bodies[0]?.key).toBe(PANEL_ID)
    expect(seams.namespaces).toEqual([NS])
    expect(document.querySelectorAll('style[data-plugin-css]')).toHaveLength(1)
  })

  it('hands the body its face as plain data and callbacks, never a service', () => {
    const seams = fakeSeams()
    apply(seams.ctx as never)
    const face = seams.faces[0] as Record<string, unknown>
    expect(Object.keys(face).sort()).toEqual(['format', 'loadBody', 'loadDiff', 'loadSkills', 'loadVersions', 'markdownWords', 't', 'undo'])
    for (const name of ['loadSkills', 'loadVersions', 'loadDiff', 'loadBody', 'undo']) expect(typeof face[name]).toBe('function')
  })

  it('T5-06/A61: a REFUSED dictionary registration is reported and the rest of the bundle still mounts', () => {
    const seams = fakeSeams({ refuseLocale: true })
    // Before the guard this threw out of apply(): no row, no body, no stylesheet — the whole panel
    // disappeared because the seat refused one dictionary.
    apply(seams.ctx as never)
    expect(seams.namespaces).toEqual([])
    expect(seams.rows).toHaveLength(1)
    expect(seams.bodies).toHaveLength(1)
    expect(document.querySelectorAll('style[data-plugin-css]')).toHaveLength(1)
    // Reported, not swallowed: the failure names the namespace and says what the reader now sees.
    expect(seams.warnings.some(line => line.includes(NS) && line.includes('falls back to the bundle'))).toBe(true)
    // The label resolves through the bundle's own copy instead of the raw key name.
    expect(seams.rows[0]?.label()).not.toBe('entry.label')
    expect(seams.rows[0]?.label()).toBeTypeOf('string')
  })

  it('leaves nothing behind when the bundle is disposed', () => {
    const seams = fakeSeams()
    apply(seams.ctx as never)
    seams.dispose()
    expect(seams.rows).toEqual([])
    expect(seams.bodies).toEqual([])
    expect(seams.namespaces).toEqual([])
    expect(document.querySelectorAll('style[data-plugin-css]')).toHaveLength(0)
  })
})
