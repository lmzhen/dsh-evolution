// @tier fast
import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuthorityBusyError, AuthorityOrderError, AuthorityReentryError, HomeAuthority } from '../src/authority.ts'

/**
 * W9-authority acceptance: the properties the platform lock cannot provide by itself —
 * explicit nesting, scope order, "a failed release never masks a landed write", and the rule that
 * an undeclared re-entry fails loudly instead of hanging on the platform lock.
 */

const home = (): string => mkdtempSync(join(tmpdir(), 'authority-'))
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/** A lock primitive shaped like the platform's, with controllable failure timing. */
function fakeLock(options: { releaseError?: unknown; acquireError?: unknown } = {}) {
  const calls: string[] = []
  const lock = (async (_filename: string, operation: () => Promise<unknown>) => {
    calls.push('acquire')
    if (options.acquireError !== undefined) throw options.acquireError
    try {
      return await operation()
    } finally {
      if (options.releaseError !== undefined) throw options.releaseError
    }
  }) as unknown as NonNullable<ConstructorParameters<typeof HomeAuthority>[0]['lock']>
  return { lock, calls }
}

describe('HomeAuthority: nesting is explicit', () => {
  it('runs nested scopes inline without taking the lock twice', async () => {
    const { lock, calls } = fakeLock()
    const authority = new HomeAuthority({ home: home(), lock })
    const seen: string[] = []
    await authority.runExclusive('tree', async () => {
      seen.push('tree')
      await authority.runNested('state', async () => { seen.push('state') })
      expect(authority.assertHeld('tree')).toBe(true)
    })
    expect(seen).toEqual(['tree', 'state'])
    expect(calls).toEqual(['acquire'])
    expect(authority.holding).toBe(false)
  })

  it('refuses an undeclared re-entry instead of waiting on the platform lock', async () => {
    const authority = new HomeAuthority({ home: home(), lock: fakeLock().lock })
    await expect(authority.runExclusive('tree', async () => {
      await authority.runExclusive('tree', async () => {})
    })).rejects.toBeInstanceOf(AuthorityReentryError)
  })

  it('refuses runNested when nothing is held', async () => {
    const authority = new HomeAuthority({ home: home(), lock: fakeLock().lock })
    await expect(authority.runNested('state', async () => {})).rejects.toBeInstanceOf(AuthorityReentryError)
  })

  it('refuses tree inside state: that order deadlocks', async () => {
    const authority = new HomeAuthority({ home: home(), lock: fakeLock().lock })
    await expect(authority.runExclusive('state', async () => {
      await authority.runNested('tree', async () => {})
    })).rejects.toBeInstanceOf(AuthorityOrderError)
  })
})

describe('HomeAuthority: release failure never masks a landed write', () => {
  it('returns the body value and records the failure for repair', async () => {
    const { lock } = fakeLock({ releaseError: Object.assign(new Error('EBUSY: lock file held'), { code: 'EBUSY' }) })
    const authority = new HomeAuthority({ home: home(), lock })
    await expect(authority.runExclusive('tree', async () => 'committed')).resolves.toBe('committed')
    expect(authority.releaseFailure?.scope).toBe('tree')
    expect(authority.holding).toBe(false)
  })

  it('repairs a stale lock only when no live holder remains', async () => {
    const authority = new HomeAuthority({ home: home(), lock: fakeLock({ releaseError: new Error('EPERM: cannot unlink') }).lock })
    await authority.runExclusive('tree', async () => 'ok')
    await expect(authority.repair()).resolves.toBe('repaired')
    expect(authority.releaseFailure).toBeUndefined()
  })

  it('surfaces an acquisition failure as a busy error', async () => {
    const { lock } = fakeLock({ acquireError: new Error('atomic-write: timed out waiting for the writer lock at /x.lock') })
    const authority = new HomeAuthority({ home: home(), lock })
    await expect(authority.runExclusive('tree', async () => 'never')).rejects.toBeInstanceOf(AuthorityBusyError)
    expect(authority.releaseFailure).toBeUndefined()
  })
})

describe('HomeAuthority: concurrency', () => {
  it('serializes two concurrent calls on the real platform lock', async () => {
    const authority = new HomeAuthority({ home: home(), waitMs: 2_000 })
    const events: string[] = []
    await Promise.all([
      authority.runExclusive('tree', async () => { events.push('a-start'); await sleep(30); events.push('a-end') }),
      authority.runExclusive('tree', async () => { events.push('b') }),
    ])
    expect(events).toEqual(['a-start', 'a-end', 'b'])
  })

  it('serializes two separate instances on the same home', async () => {
    const dir = home()
    const first = new HomeAuthority({ home: dir, waitMs: 2_000 })
    const second = new HomeAuthority({ home: dir, waitMs: 2_000 })
    const events: string[] = []
    const a = first.runExclusive('tree', async () => { events.push('a-start'); await sleep(40); events.push('a-end') })
    await sleep(5)
    const b = second.runExclusive('tree', async () => { events.push('b') })
    await Promise.all([a, b])
    expect(events).toEqual(['a-start', 'a-end', 'b'])
  })
})
