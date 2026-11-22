/**
 * The settings implementation half of the family's platform boundary.
 */
import type { Context, Fiber } from '@deepseek-ai/cordis'
import type { SettingsPort } from './contract/index.ts'

export type { SettingsPort } from './contract/index.ts'

interface SettingsServiceLike {
  configure(options: { auto: boolean }, owner: Fiber): () => void
  describe?(options?: { redactSecrets?: boolean }): Array<{ ns: string; value?: unknown; user?: Record<string, unknown> }>
}

/** Resolve the settings port; undefined means the host has no settings service. */
export function settingsPort(ctx: Context): SettingsPort | undefined {
  // platform-declaration anchor: settings is declared in core PLATFORM_SERVICE_PROBES.
  const service = ctx.get('settings') as SettingsServiceLike | undefined
  if (service === undefined) return undefined
  if (typeof service.configure !== 'function' && typeof service.describe !== 'function') return undefined
  return {
    ...(typeof service.configure === 'function' ? { configure: (options: { auto: boolean }, owner: unknown) => service.configure!(options, owner as Fiber) } : {}),
    ...(typeof service.describe === 'function' ? { describe: (options?: { redactSecrets?: boolean }) => service.describe!(options) } : {}),
  }
}
