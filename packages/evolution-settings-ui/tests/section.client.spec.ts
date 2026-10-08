// @vitest-environment jsdom
/**
 * The section's SLOT WIRING — the one thing the card's own spec cannot see.
 *
 * A keyed slot renders only the keys its section asks for, so a card that is registered but never named by a
 * `renderSlot` renders NOWHERE. 0.16.0 shipped exactly that (the pending card had a registration and no
 * `renderSlot` naming its key), and the card spec passed anyway because it mounts the component with a face
 * of its own. This spec drives the real `apply()` against a fake shell, collects what the bundle REGISTERS
 * and what the section ASKS the slot for, and requires the second to cover the first.
 *
 * The `.client.spec.ts` suffix is load-bearing: it keeps this file in the CLIENT tsconfig face (where `react`
 * resolves) and out of `tsconfig.host.json`, which includes the family's plain `tests` TypeScript files but
 * client-suffixed specs.
 */
import { describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { createElement } from 'react'
import { apply, SECTION_ID } from '../src/client/index.ts'
import { CARD_SLOT, PENDING_CARD_KEY } from '../src/client/seam.ts'

/**
 * `createElement` narrowed for the renderer: this package carries its own minimal ambient React surface, so
 * the element type the renderer wants is spelled here, once (same narrowing as the card's own spec).
 */
const h = createElement as unknown as (type: unknown, props: unknown) => Parameters<typeof render>[0]


interface Registration { name: string; key: string; id: string; component: unknown }

/** The keyed-entry filter the shell passes to `renderSlot` (only `entryKey` is used here). */
interface SlotFilter { entryKey?: unknown }

/** One string field off an untyped options bag, without leaning on `String(object)`. */
const field = (bag: Record<string, unknown>, name: string): string => {
  const value = bag[name]
  return typeof value === 'string' ? value : ''
}

/**
 * The shell, reduced to what `apply()` touches: the effect seat, the slot registry (`inject` runs the
 * generator its callback returns, exactly as the shell mounts each yielded registration), the settings scope
 * and the locale seat.
 */
function fakeShell(): { ctx: Parameters<typeof apply>[0]; registrations: Registration[] } {
  const registrations: Registration[] = []
  const ctx = {
    effect: (fn: () => unknown): (() => void) => {
      const dispose = fn()
      return typeof dispose === 'function' ? dispose as () => void : () => {}
    },
    locale: { register: () => () => {}, bind: () => (key: string) => key },
    settingsScope: {
      bind: () => ({
        set: async () => {},
        unset: async () => {},
        getSnapshot: () => ({ status: 'ready', value: {}, user: {}, writable: true }),
        subscribe: () => () => {},
      }),
    },
    slots: {
      inject: (_name: string, callback: () => Generator<unknown, void, unknown>): void => {
        for (const registration of callback()) void registration
      },
      register: (options: unknown, component: unknown): (() => void) => {
        const bag = (options ?? {}) as Record<string, unknown>
        registrations.push({ name: field(bag, 'name'), key: field(bag, 'key'), id: field(bag, 'id'), component })
        return () => {}
      },
    },
  }
  return { ctx: ctx as unknown as Parameters<typeof apply>[0], registrations }
}

describe('the evolution settings section', () => {
  it('asks the card slot for every key the bundle registers there', () => {
    const { ctx, registrations } = fakeShell()
    apply(ctx)
    const section = registrations.find(row => row.id === SECTION_ID)
    expect(section).toBeDefined()
    const cardKeys = registrations.filter(row => row.name === CARD_SLOT).map(row => row.key)
    expect(cardKeys.length).toBeGreaterThan(0)

    const asked: string[] = []
    const face = {
      t: (key: string): string => key,
      renderSlot: (name: string, _props?: unknown, filter?: SlotFilter): Parameters<typeof render>[0] | null => {
        if (name !== CARD_SLOT) return null
        const raw = (filter ?? {}).entryKey
        const text = typeof raw === 'string' ? raw : ''
        asked.push(text)
        return h('span', { 'data-slot-key': text })
      },
    }
    render(h(section?.component, face))
    for (const key of cardKeys) expect(asked).toContain(key)
    // The staged-write window is the only card here that waits on a decision, so it leads.
    expect(asked[0]).toBe(PENDING_CARD_KEY)
    expect(document.querySelector('[data-slot-key="' + PENDING_CARD_KEY + '"]')).not.toBeNull()
    cleanup()
  })
})
