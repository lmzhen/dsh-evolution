/**
 * Model-facing skill_manage tool over ctx.evolutionIo + ctx.skillUsage.
 *
 * Mutations pass through the evolution approval seam when it is mounted;
 * approved/staged background writes are replayed by the registered runner.
 * The skill library itself never hard-deletes: archive is the maximum
 * destructive action and every curator mutation is snapshot-reversible.
 * @module @deepseek-ai/dsh-tool-skill-manage
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-evolution-io'
import { evolutionIoAdapter, DEFAULT_SKILL_LIMITS, DSH_AUTHORING_STANDARDS, SkillLibrary, SKILLS_GUIDANCE, authoringFeedback, computeDedupGroups, parseFrontmatter, resolveOrigins, type WriteOrigin } from '@deepseek-ai/dsh-evolution-core'
import type {} from '@deepseek-ai/dsh-evolution-core'
import type {} from '@deepseek-ai/dsh-skill-usage'

export const name = 'tool-skill-manage'
export const inject = ['tools', 'skillUsage', 'evolutionIo']

export interface Config {
  /** Skill tree root; empty uses $DSH_HOME/skills. Align with skill-usage/catalog rows. */
  root?: string
  maxSkillNameLength?: number
  maxDescriptionLength?: number
  maxSkillContentChars?: number
  maxSkillFileBytes?: number
  /** When true, create/update refuse a description over the 60-char authoring bar (default: advisory feedback only). */
  descriptionStrict?: boolean
}

export const Config: z<Config> = z.object({
  root: z.string().default(''),
  maxSkillNameLength: z.number().default(DEFAULT_SKILL_LIMITS.maxNameLength),
  maxDescriptionLength: z.number().default(DEFAULT_SKILL_LIMITS.maxDescriptionLength),
  maxSkillContentChars: z.number().default(DEFAULT_SKILL_LIMITS.maxSkillContentChars),
  maxSkillFileBytes: z.number().default(DEFAULT_SKILL_LIMITS.maxSkillFileBytes),
  descriptionStrict: z.boolean().default(false),
})

interface ApprovalLike {
  request(input: { kind: 'skill'; summary: string; args: unknown; origin: 'foreground' | 'background_review'; sessionPolicy?: 'ask' | 'never' }): Promise<{ action: 'allow' | 'staged'; pendingId?: string; message: string }>
  registerRunner(kind: 'skill', runner: (args: unknown) => Promise<{ ok: boolean; message: string }>): () => void
}

interface ApprovalPolicyLike {
  overrideOf(session: unknown): 'ask' | 'never' | undefined
  config: { policy?: 'ask' | 'never' }
}

/**
 * The requesting session's effective approval policy, mirroring
 * `dsh-user-approval` (override ?? configured default). Returns undefined when
 * the approval service is not mounted or no session is available — callers
 * keep their previous behavior.
 */
function effectiveSessionPolicy(ctx: Context, session: unknown): 'ask' | 'never' | undefined {
  const approval = ctx.get('approval') as ApprovalPolicyLike | undefined
  if (!approval || session === undefined) return undefined
  return approval.overrideOf(session) ?? approval.config.policy ?? 'ask'
}

interface SkillWriteArgs {
  action?: string
  name?: string
  content?: string
  old_string?: string
  new_string?: string
  replace_all?: boolean
  file_path?: string
  file_content?: string
  absorbed_into?: string
  /** restructure: body sections (by exact `## heading`) moved to references/ (008 batch B). */
  restructure?: Array<{ heading?: string; to_file?: string }>
}

export function apply(ctx: Context, rawConfig: Config = {}): void {
  // Hermes SKILLS_GUIDANCE parity: when the system-prompt service is mounted,
  // register the skills guidance section exactly when THIS tool mounts (i.e.
  // when `skill_manage` is actually available to the model — the DSH analogue
  // of Hermes' `if "skill_manage" in agent.valid_tool_names` condition).
  // systemPrompt is an OPTIONAL service (a host without it must still boot),
  // so it is read via the soft `ctx.get` probe — unlike `approval`, a hard
  // dependency declared in `inject`. The two styles are deliberate per
  // dependency strength (M-7).
  const systemPrompt = ctx.get('systemPrompt') as { section(section: { name: string; order: number; text: string }): () => void } | undefined
  if (systemPrompt) {
    ctx.effect(() => systemPrompt.section({ name: 'evolution-skills-guidance', order: 900, text: SKILLS_GUIDANCE }), 'tool-skill-manage.skills-guidance')
  }
  const io = evolutionIoAdapter(() => ctx.evolutionIo.provider())
  const library = new SkillLibrary(rawConfig.root || undefined, io, {
    maxNameLength: rawConfig.maxSkillNameLength ?? DEFAULT_SKILL_LIMITS.maxNameLength,
    maxDescriptionLength: rawConfig.maxDescriptionLength ?? DEFAULT_SKILL_LIMITS.maxDescriptionLength,
    maxSkillContentChars: rawConfig.maxSkillContentChars ?? DEFAULT_SKILL_LIMITS.maxSkillContentChars,
    maxSkillFileBytes: rawConfig.maxSkillFileBytes ?? DEFAULT_SKILL_LIMITS.maxSkillFileBytes,
  }, (event) => { ctx.emit('evolution/skill-mutated', event) })

  async function executeCore(args: SkillWriteArgs, origin: WriteOrigin = 'foreground'): Promise<{ ok: boolean; message: string; skills: string[]; pending_id?: string }> {
    const action = args.action
    const name = args.name ?? ''
    if (action === 'review') return { ok: true, message: await buildSkillReviewText(), skills: [] }
    if (action === 'skip') return { ok: true, message: 'Skipped; no skill changes this pass.', skills: [] }
    if (action === 'list') {
      const list = await library.list()
      return { ok: true, message: `Listed ${list.length} skills.`, skills: list.map(s => s.name) }
    }
    let feedbackLines: string[] = []
    // P0 authoring feedback: every create/update reports the description
    // against the 60-char authoring bar; the strict mode refuses a violation
    // up front (default off — advisory only, matching the platform limit).
    if ((action === 'create' || action === 'edit' || action === 'update') && args.content) {
      const parsed = parseFrontmatter(args.content)
      if (parsed) {
        const feedback = authoringFeedback(parsed.frontmatter)
        feedbackLines = feedback.lines
        if (rawConfig.descriptionStrict === true && feedback.over60) {
          return { ok: false, message: `Authoring check: description ${feedback.descriptionChars}/60 characters exceeds the strict bar; tighten it to <=60 or set descriptionStrict=false.`, skills: [] }
        }
      }
    }
    let result
    if (action === 'create') result = await library.create(name, args.content ?? '', origin)
    else if (action === 'edit' || action === 'update') result = await library.update(name, args.content ?? '', origin)
    else if (action === 'patch') result = await library.patch(name, args.old_string ?? '', args.new_string ?? '', args.file_path ?? '', args.replace_all === true, origin)
    else if (action === 'delete') result = await library.archive(name, args.absorbed_into ? { absorbedInto: args.absorbed_into } : {})
    else if (action === 'write_file') result = await library.writeSupportFile(name, args.file_path ?? '', args.file_content ?? '', origin)
    else if (action === 'remove_file') result = await library.removeSupportFile(name, args.file_path ?? '', origin)
    else if (action === 'restructure') {
      result = await library.restructure(name, (args.restructure ?? []).map(move => ({
        heading: move.heading ?? '',
        toFile: move.to_file ?? '',
      })), origin)
    }
    else if (action === 'pin') result = await library.setPinned(name, true, origin)
    else if (action === 'unpin') result = await library.setPinned(name, false, origin)
    else result = { ok: false, message: `Unknown action "${action}".` }

    if (result.ok) {
      // Lifecycle scope: curator only manages usage records created by the
      // background review pipeline. Keep the native runner aligned with the
      // legacy facade here, or review-created skills silently escape the
      // stale/archive lifecycle. Read-only actions (list/review/skip) must
      // never bump counters or emit mutation events.
      const mutating = action !== 'list' && action !== 'review' && action !== 'skip' && action !== 'pin' && action !== 'unpin'
      // Any non-foreground writer (review channel OR delegated subagent) is an
      // agent-authored skill and must enter the lifecycle as such.
      if (name && action === 'create') {
        // Authorship, not a content patch (rc.44 M3-3.3): the record must
        // EXIST from birth (created_at anchors now, quality surfaces read it)
        // but patch_count stays 0. Agent-authored creations additionally mark
        // created_by so the curator owns them.
        await ctx.skillUsage.ensureRecord(name)
        if (origin !== 'foreground') await ctx.skillUsage.markAgentCreated(name)
      }
      if (name && action === 'delete') await ctx.skillUsage.markArchived(name)
      // Create is authorship, not a content patch (rc.44 M3-3.3): it must not
      // inflate patch_count (and through it the mutation-maturity factor).
      else if (name && mutating && action !== 'create') await ctx.skillUsage.record(name, 'patch')
      // The mutation event is emitted by SkillLibrary itself (decision C):
      // every write path — tool, curator, graph, restore — now covers the
      // catalog invalidation from a single sink.
    }
    return {
      ok: result.ok,
      message: result.ok && feedbackLines.length > 0
        ? `${result.message}\n\nAuthoring check:\n${feedbackLines.map(line => `- ${line}`).join('\n')}`
        : result.message,
      skills: [],
    }
  }

  async function buildSkillReviewText(): Promise<string> {
    const list = await library.list()
    const report = await ctx.skillUsage.report()
    const lines = list.map((summary) => {
      const record = report.get(summary.name)
      const quality = record?.quality_score !== undefined
        ? ` quality:${record.quality_score.toFixed(2)}${record.quality_warn ? '⚠' : ''}`
        : ''
      return `- ${summary.name} | ${record?.state ?? 'active'} | use:${record?.use_count ?? 0} view:${record?.view_count ?? 0} patch:${record?.patch_count ?? 0}${quality}${summary.protectedBy ? ` [${summary.protectedBy}]` : ''}`
    })
    const groups = computeDedupGroups({ contents: new Map(await Promise.all(list.map(async summary => [summary.name, (await library.read(summary.name)) ?? ''] as const))) })
    const dedupLines = groups.slice(0, 3).map(group => `- ${group.join(' ~ ')}`)
    const warned = list
      .filter(summary => report.get(summary.name)?.quality_warn === true)
      .map(summary => summary.name)
    // Aggregate quality guidance: one line for the whole library instead of
    // per-turn injection — the 60-char catalog contract and prefix-cache
    // stability of the per-turn prompt stay untouched.
    const warningLine = warned.length === 0
      ? ''
      : `\nWarning skills (${warned.length}): ${warned.join(', ')} — low quality; consider consolidating them before authoring new skills.`
    const header = list.length === 0
      ? 'No skills yet. Create one with action=create, or it is safe to author a new class-level umbrella.'
      : `Skills: ${list.length} total. Below each name: state, use/view/patch counts, quality (0-1, ⚠ = low) and protection.${groups.length > 0 ? `\n\nNear-duplicate groups (${groups.length}):` : ''}`
    return [header, '', ...lines, ...dedupLines, warningLine].join('\n')
  }

  ctx.tools.register(defineTool({
    name: 'skill_manage',
    description:
      'Manage reusable skills. review returns the library review text (state/usage/quality per skill); list returns names only; create/edit take full SKILL.md content; patch applies old_string -> new_string; delete archives to .archive; pin protects a skill from deletion, background review, and the lifecycle (pin/unpin are never allowed from a background review — foreground and delegated subagents may). '
      + 'Protected bundled/hub skills reject any mutation; pinned skills reject deletion and are read-only to the background review.'
      + 'Prefer patching an umbrella over creating narrow skills. '
      + 'restructure moves entire body sections (by their exact "## heading" line, via restructure: [{heading, to_file: "references/<topic>.md"}]) into a references/ file and replaces each with a pointer line — the skill name and directory never change.'
      + 'Created/edited SKILL.md MUST start with YAML frontmatter (a name/description block), or creation is rejected. ' + DSH_AUTHORING_STANDARDS,
    parameters: {
      action: { type: 'string', required: true, enum: ['review', 'list', 'create', 'edit', 'update', 'patch', 'delete', 'write_file', 'remove_file', 'restructure', 'skip', 'pin', 'unpin'] },
      name: { type: 'string' },
      content: { type: 'string' },
      old_string: { type: 'string' },
      new_string: { type: 'string' },
      replace_all: { type: 'boolean' },
      file_path: { type: 'string' },
      file_content: { type: 'string' },
      absorbed_into: { type: 'string' },
      restructure: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { heading: { type: 'string' }, to_file: { type: 'string' } } } },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
          skills: { type: 'array', required: true, items: { type: 'string' } },
          pending_id: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `${value.ok ? 'OK' : 'Error'}: ${value.message}` }],
    },
    isConcurrencySafe: () => false,
    async execute(args: SkillWriteArgs, exec: { agent?: { session: { header: { origin?: string }; events?: readonly unknown[] } } }) {
      // Single-source origin table (rc.44 M2-2.3): the APPROVAL surface treats
      // every delegated subagent as the review channel, while the LIBRARY
      // surface keeps the Hermes distinction - a delegated subagent write is
      // agent-authored ('subagent', pinned guard does not block it) and only
      // the review fork is 'background_review'.
      const origins = resolveOrigins(exec.agent?.session.header.origin)
      const reviewOrigin = origins.approval
      const libraryOrigin: WriteOrigin = origins.library
      const sessionPolicy = effectiveSessionPolicy(ctx, exec.agent?.session)
      const approval = ctx.get('evolutionApproval') as ApprovalLike | undefined
      if (approval && args.action !== 'list' && args.action !== 'review' && args.action !== 'skip' && args.action !== 'pin' && args.action !== 'unpin') {
        const decision = await approval.request({
          kind: 'skill',
          summary: `skill ${args.action ?? '?'} ${args.name ?? ''}`.trim(),
          // M-2 (v3 audit): staged args carry BOTH surfaces — the approval
          // origin (review channel for any subagent) AND the library origin
          // (a delegated subagent stays 'subagent'), so replay preserves the
          // pinned-guard distinction instead of folding subagent to review.
          args: { operation: args, origin: reviewOrigin, libraryOrigin },
          origin: reviewOrigin,
          ...sessionPolicy !== undefined ? { sessionPolicy } : {},
        })
        if (decision.action === 'staged') {
          return { ok: true, message: decision.message, skills: [], pending_id: decision.pendingId ?? '' }
        }
      }
      return await executeCore(args, libraryOrigin)
    },
  }))

  ctx.inject(['evolutionApproval'], (approvalCtx) => {
    const approval = (approvalCtx as unknown as { evolutionApproval: ApprovalLike }).evolutionApproval
    const dispose = approval.registerRunner('skill', (args) => {
      const wrapped = (args ?? {}) as { operation?: SkillWriteArgs; origin?: 'foreground' | 'background_review'; libraryOrigin?: 'foreground' | 'subagent' | 'background_review' }
      return executeCore(wrapped.operation ?? {}, wrapped.libraryOrigin ?? wrapped.origin ?? 'background_review')
    })
    approvalCtx.effect(() => dispose, 'tool-skill-manage.approval-runner')
  })
}

