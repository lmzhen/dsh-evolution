import { describe, expect, it, vi } from 'vitest'

// v43 audit (S2-3 / P1-10): the inventory asset is read LAZILY. The eager
// module-scope read meant one missing file broke the import of every package in
// the family (0.3.79 shipped a tarball without it). The mock below makes the
// asset unreadable for THIS spec file only; the import must still succeed and
// the first use must fail loud with a message naming the asset.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    default: actual,
    readFileSync: (path: unknown, ...rest: unknown[]) => {
      if (String(path).endsWith('persisted-write-inventory.json')) {
        throw Object.assign(new Error('ENOENT: injected asset failure'), { code: 'ENOENT' })
      }
      return (actual.readFileSync as (...args: unknown[]) => unknown)(path, ...rest)
    },
  }
})

describe('write inventory asset resilience (S2-3)', () => {
  it('an unshipped asset does not break the import; the first use fails loud', async () => {
    const mod = await import('../src/write-inventory.ts')
    // Import succeeded: the module is usable and its non-asset exports work.
    expect(mod.INSTANCE_KEYS.curator).toBe('evolution-curator')
    expect(typeof mod.persistedWriteSites).toBe('function')
    // The failure moved from import time to first use, with the asset named.
    expect(() => mod.persistedWriteSites()).toThrow(/persisted-write-inventory\.json is unreadable/)
    expect(() => mod.persistedWriteSites()).toThrow(/ENOENT: injected asset failure/)
  })
})
