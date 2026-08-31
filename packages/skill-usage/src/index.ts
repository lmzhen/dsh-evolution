/**
 * Skill usage telemetry service for the evolution family.
 * @module @deepseek-ai/dsh-skill-usage
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-evolution-io'
import type {} from '@deepseek-ai/dsh-session'
import { evolutionIoAdapter,  skillsRoot } from '@deepseek-ai/dsh-evolution-core'
import { bumpPatch, bumpUse, bumpView, getRecord, loadUsage, markAgentCreated, mutateUsage, type UsageMap } from '@deepseek-ai/dsh-evolution-core'
import type { EvolutionIoLike } from '@deepseek-ai/dsh-evolution-core'

/**
 * Read tool names -> usage kind. The single declarative classification table
 * for read-side observation (A2): any tool listed here records a `view` when
 * its call arguments name a skill.
 */
const READ_TOOL_KIND: Record<string, 'view'> = {
  skill: 'view',
  skill_load: 'view',
}

/**
 * Skill name from a tool/call arguments payload (A2, mirrors
 * evolution-review's collectReadSkillNames): JSON strings are re-parsed and
 * `name` wins over `skill`. Empty when unparseable or anonymous.
 */
function skillNameFromToolCall(raw: unknown): string {
  let parsed: Record<string, unknown> = {}
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw) as Record<string, unknown> } catch { return '' }
  } else if (raw && typeof raw === 'object') {
    parsed = raw as Record<string, unknown>
  }
  return typeof parsed.name === 'string' ? parsed.name : typeof parsed.skill === 'string' ? parsed.skill : ''
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    skillUsage: SkillUsageRegistry
  }
}

export interface Config {
  root?: string
}

export class SkillUsageRegistry extends Service {
  static inject = ['evolutionIo']
  static Config: Schema<Config> = z.object({
    root: z.string().default(''),
  })

  readonly root: string
  private readonly io: EvolutionIoLike
  private chain: Promise<unknown> = Promise.resolve()

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'skillUsage')
    // `||` not `??`: schemastery's `default('')` yields '' which is NOT nullish,
    // so a config-driven '' must fall back to the real default path (P0-3).
    this.root = config.root || skillsRoot()
    this.io = evolutionIoAdapter(() => ctx.evolutionIo.provider())
    // A2 observation: `session/event` tool/call records are the read-side
    // signal, on the same bus seam evolution-review already listens to. This
    // makes the sidecar's view counters live; names without a usage record are
    // skipped so unrelated reads never mint entries (records are authored by
    // creation / patch / seed, never by observation).
    ctx.on('session/event', (_session, event) => {
      if (event.type !== 'tool/call') return
      const kind = READ_TOOL_KIND[event.data.name]
      if (!kind) return
      const name = skillNameFromToolCall(
        (event.data as unknown as { arguments?: string | Record<string, unknown> }).arguments,
      )
      if (!name) return
      void this.observeRead(name).catch(() => {
        // Observation is best-effort: a telemetry write failure must never
        // surface in the conversation that just read a skill.
      })
    })
  }

  /**
   * Read-side telemetry (A2): bump the view counter for an EXISTING record
   * only. Creation-free by design — otherwise an arbitrary read mints a
   * record, and "patched many times, reads zero" (the write-ghost signal)
   * stays computable only while records exist from authorship paths.
   */
  private observeRead(name: string): Promise<void> {
    return this.mutate((map) => {
      if (!map.has(name)) return
      bumpView(map, name, new Date())
    })
  }

  /**
   * Serialize read-modify-write cycles so concurrent record calls never lose
   * updates, then run each cycle as ONE atomic transact (rc.50 P2-2): the map
   * is read from disk inside the lock, so a second process that shares
   * DSH_HOME cannot interleave its own RMW between our read and write.
   */
  private mutate<T>(task: (map: UsageMap) => T | Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      let outcome = undefined as T | undefined
      await mutateUsage(this.root, this.io, async (map) => {
        outcome = await task(map)
      })
      return outcome as T
    })
    this.chain = run.then(() => undefined, () => undefined)
    return run
  }

  async record(name: string, kind: 'use' | 'view' | 'patch', at = new Date()): Promise<void> {
    await this.mutate((map) => {
      if (kind === 'use') bumpUse(map, name, at)
      else if (kind === 'view') bumpView(map, name, at)
      else bumpPatch(map, name, at)
    })
  }

  /** Read-only snapshot of the sidecar (no disk write — reading never mutates). */
  async report(): Promise<UsageMap> {
    const run = this.chain.then(async () => new Map(await loadUsage(this.root, this.io)))
    this.chain = run.then(() => undefined, () => undefined)
    return run
  }

  async markAgentCreated(name: string): Promise<void> {
    await this.mutate((map) => {
      markAgentCreated(map, name)
    })
  }

  /**
   * Ensure a usage record exists for `name` without bumping any counter
   * (rc.46 M3-3.3 companion): skill creation is authorship — the record must
   * exist from birth (created_at anchors now) but `patch_count` stays 0 so
   * mutation maturity is not inflated by mere creation.
   */
  async ensureRecord(name: string): Promise<void> {
    await this.mutate((map) => {
      getRecord(map, name)
    })
  }

  /**
   * Mark a skill's usage record as archived (delete / curator archive paths).
   * Unlike `record('patch')` this never bumps the patch counter — archiving is
   * a state transition, not a content mutation.
   */
  async markArchived(name: string, at = new Date()): Promise<void> {
    await this.mutate((map) => {
      const record = map.get(name)
      if (record) {
        record.state = 'archived'
        record.archived_at = at.toISOString()
      }
    })
  }

  /**
   * Barrier for external writers: every mutate reads the sidecar fresh from
   * disk (rc.50 P2-2 transact), so a curator direct-write is visible on the
   * next call without a cache flush; this waits for queued work to drain.
   */
  async invalidate(): Promise<void> {
    await this.chain
  }

  /** Write feedback-derived quality onto the usage sidecar; curator reads it. */
  async setQuality(name: string, score: number, warn: boolean): Promise<void> {
    await this.mutate((map) => {
      const record = map.get(name)
      if (!record) return
      record.quality_score = score
      record.quality_warn = warn
    })
  }
}

export default SkillUsageRegistry
