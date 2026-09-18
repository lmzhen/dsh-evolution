import { describe, expect, it, vi } from 'vitest'
import {
  PARAM_NAMESPACES, installParamSection, paramSectionOverrides,
  type SettingsProviderLike,
} from '@deepseek-ai/dsh-evolution-core'

/**
 * G3/S3.1 guard for the family's settings plumbing. The precedence rule it pins
 * is the one the whole batch rests on: the USER layer wins only over keys the
 * user actually set, so the deployment carriers (policy snapshot, plugin row)
 * keep their existing meaning for everything else.
 */
interface FakeOptions {
  user?: Record<string, unknown> | undefined
  describeThrows?: boolean
  omitDescribe?: boolean
}

/** One captured registration, as the fake provider saw it. */
interface Registration {
  namespace: string
  base: unknown
  applies?: string | undefined
  validate?: ((value: unknown) => void) | undefined
}

function fakeProvider(options: FakeOptions = {}) {
  const watchers: ((next: unknown, prev: unknown) => void)[] = []
  const registrations: Registration[] = []
  const provider: SettingsProviderLike = {
    register: (namespace, _schema, registered) => {
      registrations.push({ namespace, base: registered.base, applies: registered.applies, validate: registered.validate })
      return {
        get: () => ({ ...(registered.base as Record<string, unknown>), ...options.user }),
        watch: (callback) => { watchers.push(callback); return () => {} },
      }
    },
  }
  if (options.omitDescribe !== true) {
    provider.describe = () => {
      if (options.describeThrows === true) throw new Error('describe unavailable')
      const user = options.user
      const entry: { ns: string; user?: Record<string, unknown> } = { ns: PARAM_NAMESPACES['evolution-review']! }
      if (user !== undefined) entry.user = user
      return [entry]
    }
  }
  return {
    provider, registrations,
    push: (user: Record<string, unknown> | undefined) => {
      options.user = user
      for (const callback of watchers) callback(undefined, undefined)
    },
  }
}

const BASE = { reviewSkillInterval: 10, reviewEnabled: true }

describe('family parameter sections (G3/S3.1)', () => {
  it('reads deployment values only while no provider is present', () => {
    const overrides = paramSectionOverrides(undefined, 'evolution-review', {}, BASE)
    expect(overrides.namespace).toBe('evolution-review')
    expect(overrides.get('reviewSkillInterval')).toBeUndefined()
    expect(overrides.resolved()).toEqual(BASE)
  })

  it('lets a user key win, and leaves unset keys to the deployment layer', () => {
    const { provider, registrations } = fakeProvider({ user: { reviewSkillInterval: 30 } })
    const overrides = paramSectionOverrides(provider, 'evolution-review', {}, BASE)
    expect(overrides.get('reviewSkillInterval')).toBe(30)
    expect(overrides.get('reviewEnabled'), 'an unset key stays undefined so the row/policy value wins').toBeUndefined()
    expect(overrides.resolved()).toEqual({ ...BASE, reviewSkillInterval: 30 })
    // The base handed to the platform is the plugin row's values, and the
    // section is registered live (a user edit must not need a restart).
    expect(registrations).toEqual([{ namespace: 'evolution-review', base: BASE, applies: 'live' }])
  })

  it('follows a later committed change through watch()', () => {
    const fake = fakeProvider({ user: { reviewSkillInterval: 30 } })
    const overrides = paramSectionOverrides(fake.provider, 'evolution-review', {}, BASE)
    fake.push({ reviewSkillInterval: 5 })
    expect(overrides.get('reviewSkillInterval')).toBe(5)
    fake.push(undefined)
    expect(overrides.get('reviewSkillInterval'), 'clearing the user layer restores the deployment value').toBeUndefined()
  })

  it('warns and falls back when the user layer cannot be read', () => {
    for (const options of [{ describeThrows: true }, { omitDescribe: true }] as FakeOptions[]) {
      const warn = vi.fn()
      const overrides = paramSectionOverrides(fakeProvider(options).provider, 'evolution-review', {}, BASE, { warn })
      expect(overrides.get('reviewSkillInterval')).toBeUndefined()
      expect(overrides.resolved()).toEqual(BASE)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0]?.[0])).toContain('no readable user layer')
    }
  })

  it('notifies onChange after every committed change and after attach', () => {
    const fake = fakeProvider()
    const onChange = vi.fn()
    const overrides = paramSectionOverrides(fake.provider, 'evolution-review', {}, BASE, { onChange })
    expect(onChange, 'the initial read is not a change').not.toHaveBeenCalled()
    fake.push({ reviewSkillInterval: 4 })
    expect(onChange).toHaveBeenCalledTimes(1)
    // Losing the user layer is also a committed change: consumers must rebuild.
    fake.push(undefined)
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(overrides.get('reviewSkillInterval')).toBeUndefined()
  })

  it('forwards the owner validate hook to the platform registration (G3/S3.3)', () => {
    const validate = vi.fn()
    const hooked = fakeProvider()
    paramSectionOverrides(hooked.provider, 'evolution-review', {}, BASE, { validate })
    expect(hooked.registrations[0]?.validate, 'the cross-field hook must ride the registration').toBe(validate)
    // Without a hook the registration keeps the platform's plain option set, so a
    // section that needs no cross-field rule is registered exactly as before.
    const plain = fakeProvider()
    paramSectionOverrides(plain.provider, 'evolution-review', {}, BASE)
    expect(plain.registrations[0]?.validate).toBeUndefined()
  })

  it('attaches through the optional service and follows it when it appears', () => {
    let injected: ((ctx: { settings: SettingsProviderLike }) => void) | undefined
    const host = { inject: (_names: string[], callback: (ctx: { settings: SettingsProviderLike }) => void) => { injected = callback } }
    const overrides = installParamSection(host, 'evolution-review', {}, BASE)
    expect(overrides.get('reviewSkillInterval'), 'before the service appears').toBeUndefined()
    injected?.({ settings: fakeProvider({ user: { reviewSkillInterval: 42 } }).provider })
    expect(overrides.get('reviewSkillInterval'), 'after the service appears').toBe(42)
  })
})
