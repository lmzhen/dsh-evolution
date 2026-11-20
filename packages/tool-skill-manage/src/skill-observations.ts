/**
 * The skill-domain listener for platform `fs/observed`.
 *
 * A successful platform read (generic `read`, `str_replace_editor view`, etc.)
 * emits one synchronous observation. This listener maps that host path to a
 * skill target and records the platform's opaque freshness token for the exact
 * reading session. It is deliberately limited to recording: no write behavior,
 * no lock, and no version reinterpretation live here.
 *
 * @module @deepseek-ai/dsh-tool-skill-manage/skill-observations
 */
import { readFileSync, statSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import { contentHash } from '@deepseek-ai/dsh-evolution-core'
import { SkillObservationStore, recordFsSkillObservation } from '@deepseek-ai/dsh-evolution-core/skills'
import type {} from '@deepseek-ai/dsh-fs'

/** Actor shape the platform carries on `fs/observed`. */
type ObservationActor = { agent?: { session?: object } } | undefined

/**
 * Register the listener for one tool-plugin context.
 * @param ctx - the plugin context; its effect owns the listener and the store.
 * @param root - absolute skills root captured at apply time.
 * @returns the store the future SkillWriteService reads; also cleared on dispose.
 */
export function installSkillObservationListener(ctx: Context, root: string, store: SkillObservationStore = new SkillObservationStore()): SkillObservationStore {
  ctx.effect(() => () => store.clear(), 'tool-skill-manage.skill-observations')
  ctx.on('fs/observed', (target, observation, actor) => {
    if (observation.kind !== 'present') return
    const owner = (actor as ObservationActor)?.agent?.session
    if (owner === undefined) return

    // The platform event carries its FsVersion, not content. Read the bytes only
    // when the platform version still matches before/after the read: if a writer
    // changed the file between the tool's read and this listener, no observation
    // is recorded (the next write must re-read), never a newer-content licence.
    const hostPath = String(target.targetKey)
    const version = String(observation.version)
    if (skillPlatformVersion(hostPath) !== version) return
    let content: string
    try {
      content = readFileSync(hostPath, 'utf8')
    } catch {
      return
    }
    if (skillPlatformVersion(hostPath) !== version) return
    recordFsSkillObservation(store, owner, root, {
      hostPath,
      version: contentHash(content),
    })
  })
  return store
}

/**
 * Platform `LocalFileSystem` version for one host path: the same
 * `dev:ino:size:mtimeNs:ctimeNs` tuple it emits on `fs/observed`.
 * @param hostPath - absolute host path.
 * @returns the opaque version, or undefined for non-regular/missing paths.
 */
export function skillPlatformVersion(hostPath: string): string | undefined {
  const info = statSync(hostPath, { bigint: true, throwIfNoEntry: false })
  if (info === undefined || !info.isFile()) return undefined
  return `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`
}
