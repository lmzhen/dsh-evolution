/**
 * The profile-context half of the family's host platform boundary.
 *
 * A bare library mount has no profile; a profile launcher publishes the
 * directory, patch path and started bundles this port exposes.
 */
import type { Context } from '@deepseek-ai/cordis'

export interface ProfileContextPort {
  readonly name: string
  readonly dir: string
  readonly patchPath?: string
  readonly startedBundles?: readonly string[]
}

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
