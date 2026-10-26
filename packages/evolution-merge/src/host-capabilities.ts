/**
 * The host's data-plane capability as ONE value shared by snapshot, doctor, HTTP and run preflight.
 * The probe is injected so the Cordis wiring stays in index.ts; a rejected probe is the same E-323
 * answer as an unavailable one, never an unhandled promise.
 * @module @deepseek-ai/dsh-evolution-merge
 */

/** The one unavailable answer the merge surface understands. */
export interface HostOnlyUnavailable {
  readonly code: 'E-323'
  readonly detail?: string
}

/** A host capability probe; undefined means the data plane is usable. */
export interface HostCapabilities {
  readonly hostOnly: () => Promise<HostOnlyUnavailable | undefined>
}

/**
 * Wrap one probe with the shared error normalization.
 * @param probe - the platform-specific availability check.
 * @returns the capability value consumed by snapshot and runtime.
 */
export function createHostCapabilities(probe: () => Promise<HostOnlyUnavailable | undefined>): HostCapabilities {
  return {
    hostOnly: async () => {
      try {
        return await probe()
      } catch (error) {
        return { code: 'E-323', detail: error instanceof Error ? error.message : String(error) }
      }
    },
  }
}
