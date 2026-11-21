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
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-fs'
import { contentHash, sessionAudited, ToolDispatchNormalizer } from '@deepseek-ai/dsh-evolution-core'
import { parseFrontmatter, SkillObservationStore, skillHostIdentity, skillTargetFromHostPath } from '@deepseek-ai/dsh-evolution-core/skills'

/** Actor shape the platform carries on `fs/observed`. */
type ObservationActor = { agent?: { session?: object } } | undefined

/**
 * Register the listener for one tool-plugin context.
 * @param ctx - the plugin context; its effect owns the listener and the store.
 * @param root - absolute skills root captured at apply time.
 * @returns the store the future SkillWriteService reads; also cleared on dispose.
 */
interface SkillResultEventData {
  readonly isError?: unknown
  readonly message?: { readonly source?: { readonly callId?: unknown }; readonly content?: unknown }
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (typeof block === 'string') parts.push(block)
    else if (typeof block === 'object' && block !== null && typeof (block as { text?: unknown }).text === 'string') parts.push((block as { text: string }).text)
  }
  return parts.join('\n')
}

function recordSkillToolRead(store: SkillObservationStore, root: string, session: object, text: string): void {
  const base = /Base directory for this skill: ([^\n]+)/.exec(text)?.[1]?.trim()
  const instructions = /<skill_instructions>\n([\s\S]*?)\n<\/skill_instructions>/.exec(text)?.[1]
  if (base === undefined || instructions === undefined) return
  const path = join(base, 'SKILL.md')
  let markdown: string
  try {
    markdown = readFileSync(path, 'utf8')
  } catch {
    return
  }
  const parsed = parseFrontmatter(markdown)
  if (parsed === null || parsed.body.trim() !== instructions.trim()) return
  const target = skillTargetFromHostPath(root, path)
  const identityKey = skillHostIdentity(path)
  if (target === undefined || identityKey === undefined) return
  store.record(session, { ...target, identityKey }, { kind: 'present', version: contentHash(markdown) })
}

export function installSkillObservationListener(ctx: Context, root: string, store: SkillObservationStore = new SkillObservationStore()): SkillObservationStore {
  ctx.effect(() => () => store.clear(), 'tool-skill-manage.skill-observations')
  const dispatchBySession = new WeakMap<object, ToolDispatchNormalizer>()
  ctx.on('session/event', (session, event) => {
    if (!sessionAudited(ctx, String((session as { id?: unknown }).id ?? ''), false)) return
    let dispatches = dispatchBySession.get(session)
    if (dispatches === undefined) {
      dispatches = new ToolDispatchNormalizer()
      dispatchBySession.set(session, dispatches)
    }
    const scope = String((session as { id?: unknown }).id ?? '')
    dispatches.advance(event, scope)
    const signal = dispatches.settledSignalOf(event, scope)
    if (signal === null || signal.name !== 'skill' || signal.ok !== true) return
    const data = event.data as SkillResultEventData | undefined
    recordSkillToolRead(store, root, session, resultText(data?.message?.content))
  })
  ctx.on('fs/observed', (fsTarget, observation, actor) => {
    if (observation.kind !== 'present') return
    const owner = (actor as ObservationActor)?.agent?.session
    if (owner === undefined) return

    // The platform event carries its FsVersion, not content. Read the bytes only
    // when the platform version still matches before/after the read: if a writer
    // changed the file between the tool's read and this listener, no observation
    // is recorded (the next write must re-read), never a newer-content licence.
    const hostPath = String(fsTarget.targetKey)
    const version = String(observation.version)
    if (skillPlatformVersion(hostPath) !== version) return
    let content: string
    try {
      content = readFileSync(hostPath, 'utf8')
    } catch {
      return
    }
    if (skillPlatformVersion(hostPath) !== version) return
    const recorded = skillTargetFromHostPath(root, hostPath)
    if (recorded === undefined) return
    const identityKey = skillHostIdentity(hostPath)
    if (identityKey === undefined) return
    store.record(owner, { ...recorded, identityKey }, { kind: 'present', version: contentHash(content) })
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
