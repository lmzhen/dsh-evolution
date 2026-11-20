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
import type { Context } from '@deepseek-ai/cordis'
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
export function installSkillObservationListener(ctx: Context, root: string): SkillObservationStore {
  const store = new SkillObservationStore()
  ctx.effect(() => () => store.clear(), 'tool-skill-manage.skill-observations')
  ctx.on('fs/observed', (target, observation, actor) => {
    if (observation.kind !== 'present') return
    const owner = (actor as ObservationActor)?.agent?.session
    if (owner === undefined) return
    recordFsSkillObservation(store, owner, root, {
      hostPath: String(target.targetKey),
      version: String(observation.version),
    })
  })
  return store
}
