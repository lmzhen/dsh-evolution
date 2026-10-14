// test-support/counting-io.ts (G5 step 4): the ONE counting-provider wrapper.
//
// Four specs assert the same invariant - "the read went through the mounted \`fs\` provider, not the
// node default" - and each carried its own copy of this wrapper (a spread of the base backend with
// every method incremented by hand). The SUBJECTS differ (catalog reads, skill-usage records,
// feedback evidence) and stay in their own packages; only the wrapper is shared, so the counter
// cannot drift between them.
export interface CountedIo<T> {
  /** the base backend with every function-valued member wrapped by the counter */
  provider: T
  /** how many wrapped calls happened so far */
  calls: () => number
  /** zero the counter (the specs cross the seam once as a self-check before the real assertion) */
  reset: () => void
}

export function countingIo<T extends object>(base: T): CountedIo<T> {
  let calls = 0
  const provider: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(base)) {
    provider[key] = typeof value === 'function'
      ? (...args: unknown[]) => {
        calls += 1
        return (value as (...rest: unknown[]) => unknown)(...args)
      }
      : value
  }
  return { provider: provider as T, calls: () => calls, reset: () => { calls = 0 } }
}
