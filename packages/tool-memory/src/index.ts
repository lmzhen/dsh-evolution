/**
 * Model-facing memory tool and runtime-context memory snapshot.
 * @module @deepseek-ai/dsh-tool-memory
 */

import type { Context } from '@deepseek-ai/cordis'
import { effectiveSessionPolicy, type ApprovalLike } from '@deepseek-ai/dsh-evolution-approval'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { PromptContext, PromptSection } from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-memory'
import { PARAM_NAMESPACES, clampedNumber, installParamSection, MEMORY_GUIDANCE_SECTION_ORDER, resolveExecOrigins } from '@deepseek-ai/dsh-evolution-core'

export const name = 'tool-memory'

/** Max characters of each echoed memory entry (single source for the Config default and the runtime slice). */
const DEFAULT_ENTRY_PREVIEW_CHARS = 200

/** G3/S3.2: the memory TOOL's user-tunable display knob (canonical id).
 * `memoryEnabled` stays a deployment switch on purpose: it decides whether the
 * tool and its prompt section are REGISTERED at all, so making it live would mean
 * dynamic registration with catalog-visible effects — a structural change this
 * batch deliberately does not make (registry tier E2). */
export interface ToolMemorySettings {
  /** Characters of one memory entry shown in a tool result preview. */
  entryPreviewChars: number
}

export const TOOL_MEMORY_SETTINGS_SCHEMA: z<ToolMemorySettings> = z.object({
  entryPreviewChars: z.number().min(1).default(DEFAULT_ENTRY_PREVIEW_CHARS),
})
export const inject = ['tools', 'memory']

/**
 * System-prompt memory guidance, aligned with Hermes `MEMORY_GUIDANCE`.
 * Reached by the model every turn, so it is the place to steer behavior: what
 * to save durably, what not to save, and how to phrase an entry. The tool
 * schema description (`MEMORY_TOOL_DESCRIPTION`) carries the complementary
 * operation-level guidance (add/replace/remove, batch, targets, when).
 */
export const MEMORY_GUIDANCE =
  'You have durable memory across sessions. Save stable user preferences, '
  + 'environment facts, conventions, and tool quirks with the `memory` tool. '
  + 'The most valuable memory is one that stops the user correcting or reminding '
  + 'you again, so user preferences and recurring corrections outrank procedural '
  + 'task details.\n'
  + 'Write entries as declarative facts, not instructions to yourself: '
  + '"User prefers concise responses" (good); "Always respond concisely" (bad). '
  + 'Imperative phrasing is re-read as a directive in later sessions and can '
  + 'override the user\u2019s current request.\n'
  + 'Do NOT save task progress, session outcomes, completed-work logs, PR/issue '
  + 'numbers, commit SHAs, or anything stale within a week — use the session '
  + 'query tool to recall past sessions instead. Reusable procedures belong in '
  + 'a skill, not memory.'

/**
 * Tool-schema description for `memory`, aligned with Hermes `MEMORY_SCHEMA`.
 * Carries the operation-level guidance: how to batch, when to save, the
 * priority order, the target semantics, and what to skip. Reached only when
 * the model is choosing/using the tool, so it complements the always-on
 * `MEMORY_GUIDANCE` system prompt.
 */
export const MEMORY_TOOL_DESCRIPTION =
  'Save durable facts to persistent memory that survive across sessions. '
  + 'Memory is injected into future turns, so keep entries compact and high-signal.\n\n'
  + 'HOW: make all changes in ONE call via an `operations` array (each item '
  + '{action, facts?|content?, old_text?}). The batch applies atomically and the char '
  + 'limit is checked on the final result — so one call can remove/replace stale '
  + 'entries to free room AND add new ones. Use bare action/content/old_text '
  + 'only for a single lone change.\n\n'
  + 'WHEN: save proactively when the user states a preference, correction, or '
  + 'personal detail, or you learn a stable fact about their environment, '
  + 'conventions, or workflow. Priority: user preferences & corrections > '
  + 'environment facts > procedures. The best memory stops the user repeating '
  + 'themselves.\n\n'
  + 'TARGETS: "user" = who the user is (name, role, preferences, style). '
  + '"memory" = your notes (environment, conventions, tool quirks, lessons).\n\n'
  + 'SKIP: trivial/obvious info, easily re-discovered facts, task progress, '
  + 'completed-work logs, temporary TODO state. To recall a past session use '
  + 'the session query tool, not memory. Reusable procedures belong in a skill, not '
  + 'memory.'

// 0.3.19 (W1.2): ApprovalLike is imported from evolution-approval (the one
// authoritative consumer shape) instead of this local view. 0.3.23 (G4.8,
// F-341): effectiveSessionPolicy is imported there too — the local copy is gone.

type MemoryAction = 'add' | 'replace' | 'remove'

interface MemoryOperationLike {
  action: MemoryAction
  facts?: string | undefined
  content?: string | undefined
  old_text?: string | undefined
}

interface MemoryWriteArgs {
  target: 'memory' | 'user'
  action?: MemoryAction | undefined
  facts?: string | undefined
  old_text?: string | undefined
  operations?: MemoryOperationLike[] | undefined
}

export interface Config {
  memoryEnabled?: boolean
  /** Maximum characters of each memory entry echoed back in tool results. */
  entryPreviewChars?: number
}

export const Config: z<Config> = z.object({
  memoryEnabled: z.boolean().default(true),
  // 0.3.18 (S4.6, T-13): lower bound 1 — `slice(0, negative)` returned the
  // entry TAIL (semantics inversion) instead of an empty/full preview.
  entryPreviewChars: z.number().min(1).default(DEFAULT_ENTRY_PREVIEW_CHARS),
})

export async function apply(ctx: Context, rawConfig: Config = {}): Promise<void> {
  // S1-B3: with the tool disabled, prior staged memory writes used to become
  // permanently unreachable — approve fell through to "No replay runner
  // registered" and released the claim back to `pending` with no way forward.
  // The flag gates only the MODEL-FACING surface (tool + prompt injection);
  // the trailing approval-runner inject below runs in BOTH modes, so a staged
  // write from a pre-disable session is either replayed or EXPLICITLY refused
  // — never orphaned in the pending view.
  const memoryDisabled = rawConfig.memoryEnabled === false
  // V6-06 (0.3.35): assembly-time clamp — a 0/negative/NaN/±Infinity value
  // falls back to the default instead of turning every echoed entry into a
  // tail slice (`slice(0, negative)` inverted the preview) or an empty string
  // (`slice(0, NaN)`). The schema `.min(1)` rejects 0/negative at load; this
  // clamp also covers NaN/±Infinity.
  const entryPreviewChars = clampedNumber(rawConfig.entryPreviewChars, DEFAULT_ENTRY_PREVIEW_CHARS, { min: 1 })
  // G3/S3.2: the user layer may override the preview length; read at USE time so
  // a committed change applies to the next tool result without a restart.
  const previewOverrides = installParamSection<ToolMemorySettings>(
    ctx,
    PARAM_NAMESPACES['tool-memory'] ?? 'tool-memory',
    TOOL_MEMORY_SETTINGS_SCHEMA,
    { entryPreviewChars },
    { warn: (message) => { ctx.logger.warn('tool-memory: ' + message) } },
  )
  const previewChars = (): number => previewOverrides.get('entryPreviewChars') ?? entryPreviewChars
  if (entryPreviewChars !== (rawConfig.entryPreviewChars ?? DEFAULT_ENTRY_PREVIEW_CHARS)) {
    ctx.logger.warn(`tool-memory: entryPreviewChars=${String(rawConfig.entryPreviewChars)} is invalid; falling back to the default ${DEFAULT_ENTRY_PREVIEW_CHARS}`)
  }
  // 0.3.18 (S4.3, E-67): systemPrompt is an OPTIONAL service (soft probe, the
  // M-7 doctrine — align with tool-skill-manage). A host without it still boots
  // and gets the working memory tool; only guidance/snapshot are skipped.
  // The mount-time renderContext() is also failure-tolerant: without a
  // registered memory provider the snapshot degrades to empty (self-corrects
  // at the first successful write through the applied-event listener).
  // P2-13 (v15): the REAL upstream types (a zero-arg `text` closure satisfies
  // PromptContext's `(ctx) => string`) — upstream signature drift now fails
  // `tsc` at the mirror. (The hand-written shape was { section({name,order,
  // text}): () => void; context({name,order,text}): () => void } | undefined.)
  const systemPrompt = ctx.get('systemPrompt') as {
    section(section: PromptSection): () => void
    context(context: PromptContext): () => void
  } | undefined
  let snapshotText = ''
  if (!memoryDisabled) {
    try {
      snapshotText = await ctx.memory.renderContext()
    } catch (error) {
      ctx.logger.warn(`tool-memory: memory provider not ready at mount; snapshot starts empty until the first write: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (systemPrompt && !memoryDisabled) {
    ctx.effect(() => systemPrompt.section({
      name: 'evolution:memory-guidance',
      order: MEMORY_GUIDANCE_SECTION_ORDER,
      text: MEMORY_GUIDANCE,
    }), 'tool-memory.memory-guidance')
    ctx.effect(() => systemPrompt.context({
      name: 'evolution:memory-snapshot',
      order: 150,
      text: () => snapshotText,
    }), 'tool-memory.memory-snapshot')
    // P2 fix: the snapshot refresh moved to the write sink (MemoryRegistry
    // emits evolution/memory-applied after ANY successful write). Bypass paths —
    // `/graph edit|delete memory:`, background review direct writes — refresh the
    // model-visible snapshot here, not only the foreground tool's own callback.
    const refreshSnapshot = async (): Promise<void> => {
      try {
        snapshotText = await ctx.memory.renderContext()
      } catch {
        // Snapshot refresh is best-effort; a stale snapshot self-corrects at the
        // next successful refresh (the write itself already landed).
      }
    }
    ctx.effect(() => ctx.on('evolution/memory-applied', () => { void refreshSnapshot() }), 'tool-memory.snapshot-refresh')
    // P2-07 (audit): cordis `inject` does not order sibling fibers — if the
    // memory PROVIDER row applies after this row, the mount-time render threw
    // (`memory: no provider registered`) and, with the write-sink listener as
    // the only refresher, the snapshot stayed EMPTY for the whole process
    // lifetime: pre-existing MEMORY.md/USER.md content never reached any
    // session until someone performed a memory write. Retry on a short
    // bounded interval until the first success, then stop; the effect
    // disposal clears the timer on plugin unload.
    if (snapshotText === '') {
      const retryTimer = setInterval(() => {
        void (async () => {
          try {
            snapshotText = await ctx.memory.renderContext()
            if (snapshotText !== '') clearInterval(retryTimer)
          } catch {
            // Provider still not registered — keep waiting within the bound.
          }
        })()
      }, 500)
      ctx.effect(() => () => { clearInterval(retryTimer) }, 'tool-memory.snapshot-retry')
      setTimeout(() => { clearInterval(retryTimer) }, 60_000).unref()
    }
  } else if (!memoryDisabled) {
    ctx.logger.warn('tool-memory: systemPrompt service not mounted; memory guidance and snapshot are not injected (the write tool still works)')
  }

  async function executeCore(normalized: MemoryWriteArgs): Promise<{
    ok: boolean
    message: string
    entries: string[]
    chars: number
    limit: number
  }> {
    // V24-20a (v24): element-level shape guard on the DIRECT entry. The
    // approval replay runner calls executeCore with the STORED staged args
    // and no tool schema in front of it, so `operations: [null]` used to
    // reach applyBatch and throw a bare TypeError. (The tool-execute path
    // rejects the same shape earlier, in its conflict pre-check.)
    if (normalized.operations?.some((op) => {
      const raw: unknown = op
      return raw === null || typeof raw !== 'object'
    })) {
      return { ok: false, message: 'Every entry of operations must be an object.', entries: [], chars: 0, limit: 0 }
    }
    // v30 TSM-03: field-level guards mirroring tool-skill-manage's scalar
    // guard. The approval replay runner executes STORED args with no schema:
    // a garbage STRING `target` (e.g. "memori") used to retarget the write
    // to USER.md silently (fileFor maps anything ≠ 'memory' to the user
    // profile), and non-string facts/old_text escaped as bare TypeErrors
    // from inside the store.
    // `unknown`-typed alias: the runtime value may violate the declared
    // union (the replay channel executes stored args without a schema), so
    // the comparison below must stay a REAL guard.
    const target: unknown = normalized.target
    if (target !== 'memory' && target !== 'user') {
      return { ok: false, message: `memory: "target" must be "memory" or "user" (got ${String(target)}); refusing the write.`, entries: [], chars: 0, limit: 0 }
    }
    for (const field of ['facts', 'old_text'] as const) {
      const value = (normalized as unknown as Record<string, unknown>)[field]
      if (value !== undefined && value !== null && typeof value !== 'string') {
        return { ok: false, message: `memory: "${field}" must be a string (got ${typeof value}); refusing the write.`, entries: [], chars: 0, limit: 0 }
      }
    }
    const result = normalized.operations
      ? await ctx.memory.applyBatch(normalized.target, normalized.operations)
      : await ctx.memory.applyBatch(normalized.target, [{ action: normalized.action ?? 'add', facts: normalized.facts, old_text: normalized.old_text }])
    // 0.3.18 (S4.2, E-20): the snapshot refresh happens ONLY in the
    // memory-applied listener (single sink — MemoryRegistry emits after every
    // successful write). A render here raced the listener's render and could
    // leave a stale snapshot in the prompt.
    return {
      ok: result.ok,
      message: result.message,
      entries: result.entries.map(entry => entry.slice(0, previewChars())),
      chars: result.chars,
      limit: result.limit,
    }
  }

  // PLAN-R2 P2-7 (2026-09-16): the store's per-action required-field contract,
  // mirrored field-for-field so this pre-check and the store's own rejection
  // cannot diverge. The effective judgment (memory-files normalizes
  // `facts ?? content`, then evolution-core's applyBatchCore enforces):
  // add needs non-blank facts; remove/replace need non-blank old_text;
  // replace additionally needs non-blank facts; an out-of-enum action is
  // rejected loud (V6-25). Rejections below reuse the store's exact message
  // text minus the on-disk entry preview (unknowable before the write).
  const requiredFieldRejection = (
    op: { action?: MemoryAction | undefined; facts?: string | undefined; content?: string | undefined; old_text?: string | undefined },
    position: number,
  ): string | null => {
    const body = (op.facts ?? op.content ?? '').trim()
    if (op.action === 'add') {
      return body ? null : `Operation ${position} (add): facts is required. No operations were applied.`
    }
    if (op.action !== 'remove' && op.action !== 'replace') {
      return `Operation ${position}: unknown action "${String(op.action)}" (expected add/remove/replace). No operations were applied.`
    }
    if (!(op.old_text ?? '').trim()) {
      return `Operation ${position} (${op.action}): old_text is required. No operations were applied.`
    }
    if (op.action === 'replace' && !body) {
      return `Operation ${position} (replace): facts is required.`
    }
    return null
  }

  // S1-B3: gated on memoryDisabled — a disabled tool must not appear in the
  // catalog. (The approval runner below registers in both modes.)
  if (!memoryDisabled) {
    ctx.tools.register(defineTool({
      name: 'memory',
      description: MEMORY_TOOL_DESCRIPTION,
      parameters: {
        target: { type: 'string', enum: ['memory', 'user'], required: true },
        action: { type: 'string', enum: ['add', 'replace', 'remove'] },
        facts: { type: 'string' },
        content: { type: 'string' },
        old_text: { type: 'string' },
        operations: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              action: { type: 'string', enum: ['add', 'replace', 'remove'], required: true },
              facts: { type: 'string' },
              content: { type: 'string' },
              old_text: { type: 'string' },
            },
          },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            message: { type: 'string', required: true },
            entries: { type: 'array', required: true, items: { type: 'string' } },
            chars: { type: 'integer', required: true },
            limit: { type: 'integer', required: true },
            pending_id: { type: 'string' },
          },
        },
        render: (_args, value) => [{ type: 'text', text: `${value.ok ? 'OK' : 'Error'}: ${value.message} (${value.chars}/${value.limit} chars)` }],
      },
      isConcurrencySafe: () => false,
      // F-06: `session` is optional in the exec contract too — the
      // defensive chaining below is only honest if the type says so.
      async execute(args, exec: { agent?: { session?: { id: string; header: { origin?: string }; events?: readonly unknown[] } } }) {
        // facts and content are the same field under two names; a differing pair
        // is ambiguous input, so fail loud instead of silently dropping one.
        const conflict = (a: { facts?: string; content?: string }): boolean => {
          if (a.facts === undefined || a.content === undefined) return false
          return a.facts !== a.content
        }
        // V24-20a (v24): element-level shape guard — `operations: [null]` used
        // to reach `conflict` and throw a bare TypeError (`a.facts` on null).
        // Same "schema is not a guarantee" posture as V8-09 (array container)
        // and D-1 (scalar fields); the approval staged-args replay path does
        // not pass the schema, so the guard is not redundant with it.
        if (Array.isArray(args.operations)) {
          for (const op of args.operations) {
            const raw: unknown = op
            if (raw === null || typeof raw !== 'object') {
              return { ok: false, message: 'Every entry of operations must be an object.', entries: [], chars: 0, limit: 0 }
            }
            if (conflict(op)) return { ok: false, message: 'Provide only one of facts or content per operation (same field); different values were given.', entries: [], chars: 0, limit: 0 }
          }
        } else if (conflict(args)) {
          return { ok: false, message: 'Provide only one of facts or content (same field); different values were given.', entries: [], chars: 0, limit: 0 }
        }
        // V7-07 (0.3.43): an EMPTY operations array is a no-op input — reject it
        // BEFORE the approval gate (a "memory 0 ops" approval record would be
        // staged and is meaningless to replay; the 0.3.37 V6-25 declaration
        // assumed this check existed).
        if (Array.isArray(args.operations) && args.operations.length === 0) {
          return { ok: false, message: 'No operations provided (the operations array is empty).', entries: [], chars: 0, limit: 0 }
        }
        // F-07: a NON-ARRAY `operations` payload (garbage that slipped
        // past the schema) used to fall into the single-operation branch, so the
        // model received an error about the WRONG shape (e.g. "facts required")
        // instead of the real one. Return a structured shape error before any
        // normalization/approval; an ABSENT operations field keeps the single-op
        // path (the documented bare action/content/old_text form).
        if (args.operations !== undefined && !Array.isArray(args.operations)) {
          return { ok: false, message: 'Invalid shape: operations must be an array of {action, content?, old_text?} objects (or omit operations for a single operation).', entries: [], chars: 0, limit: 0 }
        }
        const target = args.target === 'user' ? 'user' : 'memory'
        const normalized: MemoryWriteArgs = Array.isArray(args.operations)
          ? { target, operations: args.operations }
          : { target, action: args.action ?? 'add', facts: args.facts ?? args.content, old_text: args.old_text }
        // PLAN-R2 P2-7 (2026-09-16): existence pre-check of the per-action
        // required fields BEFORE the approval gate, on BOTH paths — each
        // operations[] element (store position = index + 1) and the normalized
        // single operation (position 1). The store's required-field rejection
        // (see requiredFieldRejection above) used to run only at EXECUTION, so
        // an approval-enabled deployment staged such a write first and the
        // approved replay then failed hard — V7-07 fixed the empty-operations
        // sibling of this; this closes the per-operation gap the same way.
        if (normalized.operations) {
          for (const [index, op] of normalized.operations.entries()) {
            const rejection = requiredFieldRejection(op, index + 1)
            if (rejection) return { ok: false, message: rejection, entries: [], chars: 0, limit: 0 }
          }
        } else {
          const rejection = requiredFieldRejection(normalized, 1)
          if (rejection) return { ok: false, message: rejection, entries: [], chars: 0, limit: 0 }
        }
        // F-329 parity for single operations (V4-15): only qualify the summary's
        // target when it differs from the default 'memory', so a lone add to the
        // default target reads "memory add" instead of the redundant "memory
        // memory add". The batch form already gets this through normalizeSummary
        // (evolution-approval, only for operations.length > 1) — apply the same
        // single-word rule here for the single-op summary.
        const targetLabel = target === 'memory' ? '' : `${target} `
        // Single-source origin resolution (S1-B1, on the rc.44 M2-2.3 table):
        // core's resolveExecOrigins reads the session header origin AND the v37
        // S2.2 review-channel session mark. This tool used to skip the mark
        // half, so an inject-mode review's memory writes resolved as
        // `foreground` — mislabeled in the approval queue and, under
        // `stageForeground: false`, executing without staging at all.
        const origin = resolveExecOrigins(exec).approval
        const sessionPolicy = effectiveSessionPolicy(ctx, exec.agent?.session)
        const approval = ctx.get('evolutionApproval') as ApprovalLike | undefined
        if (approval) {
          const decision = await approval.request({
            kind: 'memory',
            summary: `memory ${targetLabel}${Array.isArray(args.operations) ? `${args.operations.length} ops` : (args.action ?? 'add')}`,
            args: normalized,
            origin,
            // 0.3.20 (N-1): the session id rides along so the approval service can
            // DERIVE the platform override ('never' for unattended sessions); the
            // tool previously sent only the self-reported policy, which the
            // mounted platform approval service discards in favour of its own
            // derivation — leaving CI/cron writes stuck in staging.
            // F-06: full-depth optional chaining (see above).
            ...exec.agent?.session?.id ? { sessionId: exec.agent.session.id } : {},
            // V6-27 (0.3.40): the platform overrideOf resolves the policy from the
            // session's log view — the session OBJECT, not the id, is what it can probe.
            // F-06: full-depth optional chaining (see above).
            ...exec.agent?.session ? { session: exec.agent.session } : {},
            ...sessionPolicy !== undefined ? { sessionPolicy } : {},
          })
          if (decision.action === 'staged') {
            // 0.3.20 (N-1-followup): no `pending_id ?? ''` — absent stays absent
            // (mirrors the tool-skill-manage E-70 shape).
            return {
              ok: true,
              message: decision.message,
              entries: [],
              chars: 0,
              limit: 0,
              ...decision.pendingId !== undefined ? { pending_id: decision.pendingId } : {},
            }
          }
        }
        return await executeCore(normalized)
      },
    }))
  }

  ctx.inject(['evolutionApproval'], (approvalCtx) => {
    const approval = (approvalCtx as unknown as { evolutionApproval: ApprovalLike }).evolutionApproval
    // S1-B3: the runner exists in BOTH modes — replay when enabled, an explicit
    // refusal when disabled — so a staged write can never become an unresolvable
    // pending record ("No replay runner registered" bounce).
    const dispose = memoryDisabled
      ? approval.registerRunner('memory', () => Promise.resolve({
        ok: false,
        message: 'Refused: the memory tool is disabled (tool-memory memoryEnabled:false) — its replay runner cannot execute this staged write. Reject the record; re-stage after re-enabling the tool if the write is still wanted.',
      }))
      : approval.registerRunner('memory', args => executeCore(args as MemoryWriteArgs))
    approvalCtx.effect(() => dispose, memoryDisabled ? 'tool-memory.approval-runner-disabled' : 'tool-memory.approval-runner')
  })
}
