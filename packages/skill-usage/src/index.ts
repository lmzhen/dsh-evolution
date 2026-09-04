/**
 * Skill usage telemetry service for the evolution family.
 * @module @deepseek-ai/dsh-skill-usage
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-evolution-io'
import type {} from '@deepseek-ai/dsh-session'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { evolutionIoAdapter, resolveSkillsRoot } from '@deepseek-ai/dsh-evolution-core'
import { appendEvolutionEvent, eventsFile } from '@deepseek-ai/dsh-evolution-core'
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

/** Cumulative library-wide usage totals (C observation-window event counts). */
function usageTotals(map: UsageMap): { skills: number; views: number; use: number; patches: number } {
  let views = 0
  let use = 0
  let patches = 0
  for (const record of map.values()) {
    views += record.view_count
    use += record.use_count
    patches += record.patch_count
  }
  return { skills: map.size, views, use, patches }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    skillUsage: SkillUsageRegistry
  }
}

export interface Config {
  root?: string
  /** Home for the evolution event timeline (`<eventsHome>/evolution/events.json`); defaults to DSH_HOME or ~/.dsh. */
  eventsHome?: string
}

export class SkillUsageRegistry extends Service {
  static inject = ['evolutionIo']
  static Config: Schema<Config> = z.object({
    root: z.string().default(''),
    eventsHome: z.string().default(''),
  })

  readonly root: string
  private readonly eventsHome: string
  private readonly io: EvolutionIoLike
  private chain: Promise<unknown> = Promise.resolve()

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'skillUsage')
    // `||` not `??`: schemastery's `default('')` yields '' which is NOT nullish,
    // so a config-driven '' must fall back to the real default path (P0-3).
    // 0.3.18 (S4.1, E-30): single root resolution shared with the other three
    // members that read the skills tree.
    this.root = resolveSkillsRoot(config)
    this.eventsHome = config.eventsHome || process.env.DSH_HOME || join(homedir(), '.dsh')
    this.io = evolutionIoAdapter(() => ctx.evolutionIo.provider())
    // A2 observation: `session/event` tool/call records are the read-side
    // signal, on the same bus seam evolution-review already listens to. This
    // makes the sidecar's view counters live; names without a usage record are
    // skipped so unrelated reads never mint entries (records are authored by
    // creation / patch / seed, never by observation).
    ctx.on('session/event', (_session, event) => {
      if (event.type !== 'tool/call') return
      // E-65: an external emitter can inject a malformed tool/call — `data`
      // absent, `name` missing, or `name` not a string. None of these is a
      // read this listener can attribute, so skip the event instead of
      // throwing; the review side reads the same payload via `data?.name`.
      const data = event.data as { name?: unknown; arguments?: string | Record<string, unknown> } | undefined
      const kind = typeof data?.name === 'string' ? READ_TOOL_KIND[data.name] : undefined
      if (!kind) return
      const name = skillNameFromToolCall(data?.arguments)
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
   *
   * Observation window (C): the FIRST observed read library-wide opens the
   * window — one `type:'usage'` event is appended to the evolution timeline
   * (best-effort; the usage sidecar stays the truth and never fails the read
   * path). Post-A2 deployments treat `view_count` as trustworthy only after
   * that anchor exists (curator gates churn on `usageObserved()`).
   */
  private observeRead(name: string): Promise<void> {
    return this.mutate(async (map) => {
      if (!map.has(name)) return
      const viewsBefore = usageTotals(map).views
      bumpView(map, name, new Date())
      if (viewsBefore === 0) {
        await this.appendUsageWindowEvent(map)
      }
    })
  }

  /**
   * Append the observation-window anchor event; best-effort, never fails the
   * observation.
   *
   * Lock-order contract (E-66): this acquires the evolution-events lock while
   * the caller holds the usage lock (usage → events one-way nesting — see
   * `mutate`). Never take the usage lock from inside a block that holds the
   * events lock; that reverse nesting is a deadlock.
   */
  private async appendUsageWindowEvent(map: UsageMap): Promise<void> {
    try {
      const at = new Date().toISOString()
      await appendEvolutionEvent(this.io, eventsFile(this.eventsHome), {
        type: 'usage',
        kind: 'skill',
        source: 'observation',
        note: 'observation window opened',
        counts: usageTotals(map),
        window: { opened: at },
      })
    } catch (error) {
      // Best-effort anchor: a failed timeline append must never surface in the
      // conversation that just read a skill. The anchor is NOT retried — it
      // fires exactly once (on the view 0→1 read), and once the sidecar's
      // view is ≥1 later reads never re-trigger it. The timeline may therefore
      // miss the anchor; the usage sidecar (and the curator's usageObserved()
      // gate, which reads it) stays the truth. The warn keeps the miss audible
      // outside the conversation.
      this.ctx.logger.warn(`dsh-skill-usage: failed to append observation-window anchor: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Serialize read-modify-write cycles so concurrent record calls never lose
   * updates, then run each cycle as ONE atomic transact (rc.50 P2-2): the map
   * is read from disk inside the lock, so a second process that shares
   * DSH_HOME cannot interleave its own RMW between our read and write.
   *
   * Lock-order contract (E-66): this holds the usage (`.usage.json`) lock. A
   * usage-locked `task` MAY acquire the evolution-events lock one-way
   * (usage → events, e.g. via `appendUsageWindowEvent`); it must NEVER acquire
   * it in the reverse direction. Two writers taking the two locks in opposite
   * order would deadlock, so the one-way order is a binding invariant.
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
   * 0.3.18 (E-70): create-path telemetry in ONE atomic RMW. The former
   * prepare→markAgentCreated pair ran two full transacts (doubled lock
   * traffic) and left a window where `created_by=null` was on disk between
   * them. `agentCreated` picks the authorship marking at the same commit
   * point where the record is created.
   */
  async ensureRecordCreated(name: string, agentCreated: boolean): Promise<void> {
    await this.mutate((map) => {
      if (agentCreated) markAgentCreated(map, name)
      else getRecord(map, name)
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
