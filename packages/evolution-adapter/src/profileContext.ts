/**
 * The profile-context implementation half of the family's platform boundary.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ProfileContextPort } from '@deepseek-ai/dsh-evolution-platform-contract'

export type { ProfileContextPort } from '@deepseek-ai/dsh-evolution-platform-contract'

interface ProfileContextServiceLike {
  readonly name?: string
  readonly dir?: string
  readonly patchPath?: string
  readonly startedBundles?: readonly string[]
}

/** Resolve the profile-context port; undefined means no profile is mounted. */
export function profileContextPort(ctx: Context): ProfileContextPort | undefined {
  // platform-declaration anchor: profileContext is declared in core PLATFORM_SERVICE_PROBES.
  const service = ctx.get('profileContext') as ProfileContextServiceLike | undefined
  if (service === undefined || typeof service.dir !== 'string' || service.dir === '') return undefined
  return {
    name: typeof service.name === 'string' ? service.name : '',
    dir: service.dir,
    ...(typeof service.patchPath === 'string' && service.patchPath !== '' ? { patchPath: service.patchPath } : {}),
    ...(Array.isArray(service.startedBundles) ? { startedBundles: service.startedBundles } : {}),
  }
}
