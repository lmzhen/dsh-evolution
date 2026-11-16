/**
 * The settings half of the family's host platform boundary.
 *
 * The family only silences the platform's settings-file auto-reload for the
 * lifetime of its fiber; reads stay in each feature's own config seam.
 */
import type { Context, Fiber } from '@deepseek-ai/cordis'

export interface SettingsPort {
  configure?(options: { auto: boolean }, owner: unknown): () => void
  describe?(options?: { redactSecrets?: boolean }): Array<{ ns: string; value?: unknown; user?: Record<string, unknown> }>
}

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

