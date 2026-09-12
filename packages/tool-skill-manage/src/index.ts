/**
 * Model-facing skill_manage tool over ctx.evolutionIo + ctx.skillUsage.
 *
 * Mutations pass through the evolution approval seam when it is mounted;
 * approved/staged background writes are replayed by the registered runner.
 * The skill library itself never hard-deletes: archive is the maximum
 * destructive action and every curator mutation is snapshot-reversible.
 *
 * 0.3.18 (E-70) — pin/unpin are deliberately OUTSIDE the approval seam:
 * pinning only lifts/restores the curator-lifecycle freeze and is fully
 * reversible by the same tool; routing it through `policy:'ask'` would let a
 * staged-then-stale request hold the library in a pinned state invisibly.
 * The tradeoff (no approval on a lifecycle-flag flip) is accepted and
 * documented in the README Safety model section.
 * @module @deepseek-ai/dsh-tool-skill-manage
 */

import type { Context } from '@deepseek-ai/cordis'
import { effectiveSessionPolicy, type ApprovalLike } from '@deepseek-ai/dsh-evolution-approval'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { PromptSection } from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-evolution-io'
import { clampedNumber, contentHash, evolutionIoAdapter, DEFAULT_SKILL_LIMITS, DSH_AUTHORING_STANDARDS, SkillLibrary, SKILLS_GUIDANCE, authoringFeedback, computeDedupGroups, parseFrontmatter, resolveOrigins, resolveSkillsRoot, type SkillLimits, type WriteOrigin } from '@deepseek-ai/dsh-evolution-core'
import type {} from '@deepseek-ai/dsh-evolution-core'
import type {} from '@deepseek-ai/dsh-skill-usage'

export const name = 'tool-skill-manage'
export const inject = ['tools', 'skillUsage', 'evolutionIo']

/** 0.3.18 (E-70): review output lists at most this many near-duplicate groups
 * (a cap, not a per-group limit) — the one named bound for the slice below. */
const MAX_DEDUP_GROUPS_IN_REVIEW = 3

export interface Config {
  /** Skill tree root; empty uses $DSH_HOME/skills. Align with skill-usage/catalog rows. */
  root?: string
  maxSkillNameLength?: number
  maxDescriptionLength?: number
  maxSkillContentChars?: number
  maxSkillFileBytes?: number
  /** When true, create/update refuse a description over the 60-char authoring bar (default: advisory feedback only). */
  descriptionStrict?: boolean
  /** V10-03 (P2-18): threat-scan exemption labels forwarded to the skill
   * write path (core `ScanOptions.excludeLabels`). Default empty — the
   * strict ANY-hit-blocks behavior is unchanged; deployments opt in per
   * label for known false-positive content. */
  threatExemptLabels?: string[]
}

export const Config: z<Config> = z.object({
  root: z.string().default(''),
  // 0.3.18 (S4.6, T-13): lower bound 1 — a 0/negative limit rejected every
  // write with a meaningless message instead of failing at configuration time.
  maxSkillNameLength: z.number().min(1).default(DEFAULT_SKILL_LIMITS.maxNameLength),
  maxDescriptionLength: z.number().min(1).default(DEFAULT_SKILL_LIMITS.maxDescriptionLength),
  maxSkillContentChars: z.number().min(1).default(DEFAULT_SKILL_LIMITS.maxSkillContentChars),
  maxSkillFileBytes: z.number().min(1).default(DEFAULT_SKILL_LIMITS.maxSkillFileBytes),
  descriptionStrict: z.boolean().default(false),
  // V10-03 (P2-18): default empty — the strict ANY-hit-blocks threat scan is
  // unchanged unless a deployment explicitly opts labels in.
  threatExemptLabels: z.array(z.string()).default([]),
})

// 0.3.19 (W1.2): ApprovalLike is imported from evolution-approval (the one
// authoritative consumer shape) instead of this local view. 0.3.23 (G4.8,
// F-341): effectiveSessionPolicy is imported there too — the local copy is gone.

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
  /** v23 (AP-3): stage-time content hash of the target skill, attached to
   * update/edit stagings so the replay can refuse a stale full-content
   * overwrite (memory carries old_text for the same purpose). Absent on
   * legacy records and on non-staging paths — the guard is opt-in. */
  staged_from_sha256?: string
}

/** v30 REV-02: read the protected-skill list off the (optional) policy
 * snapshot through an `unknown` boundary — the Context augmentation types the
 * getter non-optionally, but at runtime the row can be absent. */
function policySnapshotOf(source: unknown): { protectedSkillNames?: readonly string[] } | undefined {
  return (source as { get?(): { protectedSkillNames?: readonly string[] } } | undefined)?.get?.()
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
  // P2-13 (v16): the REAL upstream type (family-completes the v15 batch —
  // tool-memory was migrated, this call site was missed).
  const systemPrompt = ctx.get('systemPrompt') as { section(section: PromptSection): () => void } | undefined
  if (systemPrompt) {
    ctx.effect(() => systemPrompt.section({ name: 'evolution-skills-guidance', order: 900, text: SKILLS_GUIDANCE }), 'tool-skill-manage.skills-guidance')
  }
  const io = evolutionIoAdapter(() => ctx.evolutionIo.provider())
  // V6-06 (0.3.35): the numeric limits go through the assembly-time clamp so a
  // 0/negative/NaN/±Infinity value falls back to the package default instead
  // of silently disabling the limit (`limit > NaN` is always false). The
  // schema `.min(1)` rejects 0/negative at load; this clamp also covers
  // NaN/±Infinity. Warn once when a user-supplied value had to be corrected.
  const numericClamped: string[] = []
  const limit = (name: string, value: number | undefined, fallback: number): number => {
    const result = clampedNumber(value, fallback, { min: 1 })
    if (value !== undefined && result !== value) numericClamped.push(name)
    return result
  }
  // V10-03 (P2-18): forward the threat-exemption allowlist as the library's
  // 6th constructor argument (`threatExemptLabels` → core
  // `ScanOptions.excludeLabels`). The core-side constructor option landed in
  // the same change window (plan batch 3a.3). No behavioral fork: absent
  // config stays `[]` (strict scan).
  const libraryOptions: SkillLimits = {
    maxNameLength: limit('maxSkillNameLength', rawConfig.maxSkillNameLength, DEFAULT_SKILL_LIMITS.maxNameLength),
    maxDescriptionLength: limit('maxDescriptionLength', rawConfig.maxDescriptionLength, DEFAULT_SKILL_LIMITS.maxDescriptionLength),
    maxSkillContentChars: limit('maxSkillContentChars', rawConfig.maxSkillContentChars, DEFAULT_SKILL_LIMITS.maxSkillContentChars),
    maxSkillFileBytes: limit('maxSkillFileBytes', rawConfig.maxSkillFileBytes, DEFAULT_SKILL_LIMITS.maxSkillFileBytes),
  }
  const library = new SkillLibrary(resolveSkillsRoot(rawConfig), io, libraryOptions, (event) => { ctx.emit('evolution/skill-mutated', event) }, undefined, [...(rawConfig.threatExemptLabels ?? [])])
  // V7-12 (0.3.43): the warn must run AFTER the limit() calls above — the
  // former position evaluated the always-empty array before any limit ran,
  // so an invalid config value was never surfaced.
  if (numericClamped.length > 0) {
    ctx.logger.warn(`tool-skill-manage: ${numericClamped.join(', ')} provided an invalid value; falling back to the default`)
  }

  async function executeCore(args: SkillWriteArgs, origin: WriteOrigin = 'foreground'): Promise<{ ok: boolean; message: string; skills: string[] }> {
    const action = args.action
    const name = args.name ?? ''
    if (action === 'review') {
      // v31 TSM-05: the tree scan fails loud on a transient read error
      // (REG-01 posture) — the tool surface owes the model a structured
      // refusal, not a raw errno throw.
      try {
        return { ok: true, message: await buildSkillReviewText(), skills: [] }
      } catch (error) {
        return { ok: false, message: `skill_manage review: skill tree scan failed (${error instanceof Error ? error.message : String(error)}).`, skills: [] }
      }
    }
    if (action === 'list') {
      try {
        const list = await library.list()
        return { ok: true, message: `Listed ${list.length} skills.`, skills: list.map(s => s.name) }
      } catch (error) {
        return { ok: false, message: `skill_manage list: skill tree scan failed (${error instanceof Error ? error.message : String(error)}).`, skills: [] }
      }
    }
    // v20 (D-1, V8-09 sibling): the schema does not strictly guarantee scalar
    // shapes (the F-07 class of garbage that slipped past the schema), and a
    // non-string scalar used to escape as a bare TypeError from SkillLibrary
    // (`name.trim()` / `md.includes(...)`). Family posture: a STRUCTURED
    // refusal, same as the restructure array guard below. Absent/undefined
    // stays legal — the branches below already default it.
    const scalarArgs = args as Record<string, unknown>
    for (const field of ['name', 'content', 'old_string', 'new_string', 'file_path', 'file_content', 'absorbed_into'] as const) {
      const value = scalarArgs[field]
      if (value !== undefined && value !== null && typeof value !== 'string') {
        return { ok: false, message: `skill_manage: "${field}" must be a string (got ${typeof value}); refusing the write.`, skills: [] }
      }
    }
    // v30 REV-02: the immutable policy's protected list is enforced at plan
    // validation, but the replay channel executes STORED plans — one accepted
    // under an older policy must not land on a skill the CURRENT policy
    // protects. Foreground (operator) writes are deliberately not gated by
    // this list. Soft probe: deployments without the policy row keep the
    // previous behavior.
    if (origin !== 'foreground') {
      // v30 REV-02: the runtime value CAN be undefined (policy row not
      // mounted) even though the Context augmentation types the getter
      // non-optionally — the unknown-boundary helper keeps that guard honest
      // for both the compiler and the linter.
      const protectedNames = policySnapshotOf(ctx.get('evolutionPolicy'))?.protectedSkillNames
      if (protectedNames?.includes(name)) {
        return { ok: false, message: `skill_manage: "${name}" is protected by the current policy (protectedSkillNames); replayed/autonomous writes are refused.`, skills: [] }
      }
    }
    // V27 G5.1 (v27 T-2): the tool schema can only require `action` (every other
    // argument is action-specific), so an omitted argument used to surface as a
    // downstream empty-string message. Name the missing arguments here, per
    // action, before anything is read or written. An EMPTY string still reaches
    // the library: its messages carry the more specific remedy (e.g. an empty
    // patch anchor points at `update`).
    const REQUIRED_ARGS: Record<string, readonly string[]> = {
      create: ['name', 'content'],
      edit: ['name', 'content'],
      update: ['name', 'content'],
      patch: ['name', 'old_string', 'new_string'],
      delete: ['name'],
      write_file: ['name', 'file_path', 'file_content'],
      remove_file: ['name', 'file_path'],
      restructure: ['name'],
      pin: ['name'],
      unpin: ['name'],
    }
    // `action` is optional on the queued/staged args shape, so the index needs
    // a narrowing first (an unknown action is refused by its own branch below).
    // v29 TSM-01: the guard must be an OWN-property check — a plain-object
    // index resolves inherited members (`constructor`, `toString`, …) to
    // truthy functions, `?? []` never fired, and `.filter` threw a bare
    // TypeError. Reachable through the approval replay runner, which executes
    // STORED args with no schema in front of it.
    const requiredArgs: readonly string[] =
      action === undefined || typeof action !== 'string' || !Object.hasOwn(REQUIRED_ARGS, action)
        ? []
        : REQUIRED_ARGS[action] ?? []
    const missing = requiredArgs.filter((field: string) => scalarArgs[field] === undefined || scalarArgs[field] === null)
    if (missing.length > 0) {
      return { ok: false, message: `skill_manage ${action} requires ${missing.join(', ')}; the tool description lists the arguments per action.`, skills: [] }
    }
    let feedbackLines: string[] = []
    // v23 (AP-3): replay staleness guard for full-content updates. A staged
    // update/edit carries the sha256 of the skill as it existed at STAGING
    // time; if the live content has changed since, the full-content overwrite
    // would silently roll back the intermediate edit (memory replays carry
    // old_text for exactly this scenario). Refusing lets approve release the
    // record back to pending — fail-safe, like the memory path. Records
    // without the hash (legacy, or staggers that do not attach it) keep the
    // previous last-writer-wins behavior.
    if ((action === 'edit' || action === 'update') && typeof args.staged_from_sha256 === 'string' && args.staged_from_sha256 !== '') {
      const currentContent = await library.read(name).catch(() => null)
      const actual = contentHash(currentContent ?? '')
      if (currentContent === null || actual !== args.staged_from_sha256) {
        return {
          ok: false,
          message: `Skill "${name}" changed after this write was staged (content ${currentContent === null ? 'no longer exists' : 'hash mismatch'}); refusing to replay the stale snapshot. Re-apply the edit to stage a fresh copy.`,
          skills: [],
        }
      }
    }
    // v30 REV-03: the same anchor for support-file writes/removes — the
    // staged sha covers the file's CURRENT bytes (or their absence) at
    // staging; a mismatch refuses the replay instead of last-writer-wins
    // overwriting whatever changed since. An unreadable target cannot be
    // verified and refuses the same way (the write itself would fail too).
    if ((action === 'write_file' || action === 'remove_file') && typeof args.staged_from_sha256 === 'string' && args.staged_from_sha256 !== '') {
      const currentBytes = await library.readSupportFile(name, args.file_path ?? '').catch(() => undefined)
      const actual = currentBytes === undefined || currentBytes === null ? 'absent' : contentHash(currentBytes)
      if (currentBytes === undefined || actual !== args.staged_from_sha256) {
        return {
          ok: false,
          message: `Support file "${args.file_path ?? ''}" of "${name}" changed after this write was staged (or its state could not be verified); refusing to replay the stale snapshot. Re-stage the file operation.`,
          skills: [],
        }
      }
    }
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
      // V8-09 (0.3.47): `args.restructure` is an ARRAY — a non-array payload
      // (garbage that slipped past the schema) used to throw a bare `.map`
      // TypeError; the family posture is a structured refusal instead.
      // v20 (D-1): the move fields get the same treatment — a non-string
      // `heading`/`to_file` used to flow past `?? ''` (only nullish defaults)
      // into the library's string ops.
      // V24-20a (v24): ELEMENT-level guard — `restructure: [null]` used to
      // throw reading `.heading` of null inside the map (the staged-args
      // replay channel bypasses the tool schema, so the container guard alone
      // did not close the family's "schema is not a guarantee" posture).
      const moves = Array.isArray(args.restructure) ? args.restructure : []
      if (moves.some((move) => {
        const raw: unknown = move
        return raw === null || typeof raw !== 'object'
      })) {
        result = { ok: false, message: 'Every entry of restructure must be an object with heading and to_file.' }
      } else {
        result = await library.restructure(name, moves.map(move => ({
          heading: typeof move.heading === 'string' ? move.heading : '',
          toFile: typeof move.to_file === 'string' ? move.to_file : '',
        })), origin)
      }
    }
    else if (action === 'pin') result = await library.setPinned(name, true, origin)
    else if (action === 'unpin') result = await library.setPinned(name, false, origin)
    else result = { ok: false, message: `Unknown action "${action}".` }

    if (result.ok) {
      // 0.3.11: the write point auto-quoted unquoted YAML-unsafe frontmatter
      // values (catalog-loadability) — surface it so the model can learn.
      if (result.normalizedFrontmatterFields && result.normalizedFrontmatterFields.length > 0) {
        feedbackLines.push(`frontmatter auto-quoted (YAML compatibility): ${result.normalizedFrontmatterFields.join(', ')}`)
      }
      // Lifecycle scope: curator only manages usage records created by the
      // background review pipeline. Keep the native runner aligned with the
      // legacy facade here, or review-created skills silently escape the
      // stale/archive lifecycle. Read-only actions (list/review) must
      // never bump counters or emit mutation events.
      const mutating = action !== 'list' && action !== 'review' && action !== 'pin' && action !== 'unpin'
      // Any non-foreground writer (review channel OR delegated subagent) is an
      // agent-authored skill and must enter the lifecycle as such.
      if (name && action === 'create') {
        // Authorship, not a content patch (rc.44 M3-3.3): the record must
        // EXIST from birth (created_at anchors now, quality surfaces read it)
        // but patch_count stays 0. Agent-authored creations additionally mark
        // created_by so the curator owns them. 0.3.18 (E-70): both in one
        // atomic transact — no null window between ensure and mark.
        await ctx.skillUsage.ensureRecordCreated(name, origin !== 'foreground')
      }
      if (name && action === 'delete') await ctx.skillUsage.markArchived(name)
      // Create is authorship, not a content patch (rc.44 M3-3.3): it must not
      // inflate patch_count (and through it the mutation-maturity factor).
      // 0.3.18 (E-68): a no-op patch (old===new) must not count either.
      else if (name && mutating && action !== 'create' && result.noop !== true) await ctx.skillUsage.record(name, 'patch')
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
    // P1-1 (v15): the warn surface reads the UNION of the curator six-factor
    // pair and the feedback pair (field ownership on `UsageRecord` in core) —
    // negative feedback lands in feedback_warn and must show up here.
    const warnedFlag = (name: string): boolean => {
      const record = report.get(name)
      return record?.quality_warn === true || record?.feedback_warn === true
    }
    const lines = list.map((summary) => {
      const record = report.get(summary.name)
      // P3 (v16): the ⚠ marker reads the union flag directly — a skill warned
      // ONLY by feedback (curator not yet run, no quality_score) lands in the
      // aggregate "Warning skills" line and must carry the ⚠ too.
      const warned = warnedFlag(summary.name)
      const quality = record?.quality_score !== undefined
        ? ` quality:${record.quality_score.toFixed(2)}${warned ? '⚠' : ''}`
        : warned
          ? ' quality:⚠'
          : ''
      // A1-17 (v18): a failed marker probe is shown as `protection:unknown`
      // rather than omitted — the model must not read a listing as unprotected.
      const protection = summary.protectionUnknown ? ' [protection:unknown]' : summary.protectedBy ? ` [${summary.protectedBy}]` : ''
      return `- ${summary.name} | ${record?.state ?? 'active'} | use:${record?.use_count ?? 0} view:${record?.view_count ?? 0} patch:${record?.patch_count ?? 0}${quality}${protection}`
    })
    // v29 TSM-02: the read fan-out is bounded and per-read caught — the exact
    // INS-04 hardening `/graph` already has. Unbounded `Promise.all` over the
    // whole library hit EMFILE on large trees, and ONE unreadable SKILL.md
    // (read() re-throws everything but EISDIR) killed the whole `review`
    // action; an unreadable skill now contributes no content (no dedup edges).
    const contents = new Map<string, string>()
    for (let offset = 0; offset < list.length; offset += 16) {
      await Promise.all(list.slice(offset, offset + 16).map(async (summary) => {
        const body = await library.read(summary.name).catch(() => null)
        contents.set(summary.name, body ?? '')
      }))
    }
    const groups = computeDedupGroups({ contents })
    const dedupLines = groups.slice(0, MAX_DEDUP_GROUPS_IN_REVIEW).map(group => `- ${group.join(' ~ ')}`)
    const warned = list
      .filter(summary => warnedFlag(summary.name))
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
      'Manage reusable skills. review returns the library review text (state/usage/quality per skill); list returns names only; create/edit/update take full SKILL.md content (edit is an alias of update); patch applies old_string -> new_string; delete archives to .archive (absorbed_into names an umbrella skill); write_file/remove_file add or remove one support file under references/ or scripts/; pin protects a skill from deletion, background review, and the lifecycle (pin/unpin are never allowed from a background review — foreground and delegated subagents may). '
      // V27 G5.1 (v27 T-2): the two fields the model could not discover —
      // `file_path` picks WHICH file a patch/write_file/remove_file targets
      // (absent = SKILL.md), and `replace_all` decides first-occurrence-only
      // versus every occurrence. Both are real behavior; a description that
      // omits them left the model guessing.
      + 'Per-action arguments: patch needs name + old_string + new_string and patches SKILL.md unless file_path names a support file (e.g. "references/topic.md"); patch replaces the FIRST occurrence only unless replace_all=true, and the result message reports how many anchors the file carried. write_file needs name + file_path + file_content; remove_file needs name + file_path; create/edit/update need name + content; delete needs name. A rejected patch names the reason and the remedy (missing anchor, stale snapshot, frontmatter that cannot be auto-quoted, byte/char limit). '
      + 'Protected bundled/hub skills reject any mutation; pinned skills reject deletion and are read-only to the background review.'
      + 'Prefer patching an umbrella over creating narrow skills. '
      + 'restructure moves entire body sections (by their exact "## heading" line, via restructure: [{heading, to_file: "references/<topic>.md"}]) into a references/ file and replaces each with a pointer line — the skill name and directory never change.'
      + 'Created/edited SKILL.md MUST start with YAML frontmatter (a name/description block), or creation is rejected. ' + DSH_AUTHORING_STANDARDS,
    parameters: {
      action: { type: 'string', required: true, enum: ['review', 'list', 'create', 'edit', 'update', 'patch', 'delete', 'write_file', 'remove_file', 'restructure', 'pin', 'unpin'] },
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
    // F-06: `session` is optional in the exec contract too — the
    // defensive chaining below is only honest if the type says so.
    async execute(args: SkillWriteArgs, exec: {
      agent?: { session?: { id: string; header: { origin?: string }; events?: readonly unknown[] } }
    }) {
      // Single-source origin table (rc.44 M2-2.3): the APPROVAL surface treats
      // every delegated subagent as the review channel, while the LIBRARY
      // surface keeps the Hermes distinction - a delegated subagent write is
      // agent-authored ('subagent', pinned guard does not block it) and only
      // the review fork is 'background_review'.
      // F-06: the optional chain previously protected only one level
      // (`exec.agent?.session.header.origin`) — an execution without a session
      // object would TypeError here. Full-depth chaining matches the exec
      // contract (agent and session are both optional); same fix as tool-memory.
      const origins = resolveOrigins(exec.agent?.session?.header.origin)
      const reviewOrigin = origins.approval
      const libraryOrigin: WriteOrigin = origins.library
      const sessionPolicy = effectiveSessionPolicy(ctx, exec.agent?.session)
      const approval = ctx.get('evolutionApproval') as ApprovalLike | undefined
      if (approval && args.action !== 'list' && args.action !== 'review' && args.action !== 'pin' && args.action !== 'unpin') {
        // v23 (AP-3): full-content updates carry the stage-time content hash so
        // the replay (executeCore staleness guard) can refuse a stale overwrite.
        // A missing current skill stays unhashed — the replay surfaces "not
        // found" naturally.
        if ((args.action === 'update' || args.action === 'edit') && typeof args.name === 'string' && args.name !== '') {
          const stageCurrent = await library.read(args.name).catch(() => null)
          if (stageCurrent !== null) (args as { staged_from_sha256?: string }).staged_from_sha256 = contentHash(stageCurrent)
        }
        // v30 REV-03: the anchor extends to support-file writes/removes —
        // the staged sha covers the file's current bytes, or the sentinel
        // 'absent' when the file does not exist yet (create-on-write). An
        // unreadable target stays unanchored (documented residual).
        if ((args.action === 'write_file' || args.action === 'remove_file') && typeof args.name === 'string' && args.name !== '' && typeof args.file_path === 'string' && args.file_path !== '') {
          const stageFile = await library.readSupportFile(args.name, args.file_path).catch(() => undefined)
          if (stageFile !== undefined) (args as { staged_from_sha256?: string }).staged_from_sha256 = stageFile === null ? 'absent' : contentHash(stageFile)
        }
        const decision = await approval.request({
          kind: 'skill',
          summary: `skill ${args.action ?? '?'} ${args.name ?? ''}`.trim(),
          // M-2 (v3 audit): staged args carry BOTH surfaces — the approval
          // origin (review channel for any subagent) AND the library origin
          // (a delegated subagent stays 'subagent'), so replay preserves the
          // pinned-guard distinction instead of folding subagent to review.
          args: { operation: args, origin: reviewOrigin, libraryOrigin },
          origin: reviewOrigin,
          // 0.3.20 (N-1): session id rides along so the approval service can
          // derive the platform override (see tool-memory for the rationale).
          // F-06: full-depth optional chaining (see above).
          ...exec.agent?.session?.id ? { sessionId: exec.agent.session.id } : {},
          // V6-27 (0.3.40): the platform overrideOf reads session.events — the
          // session OBJECT, not the id, is what it can probe.
          // F-06: full-depth optional chaining (see above).
          ...exec.agent?.session ? { session: exec.agent.session } : {},
          ...sessionPolicy !== undefined ? { sessionPolicy } : {},
        })
        if (decision.action === 'staged') {
          // 0.3.18 (E-70): no `pending_id ?? ''` — an absent id must stay absent.
          return {
            ok: true,
            message: decision.message,
            skills: [],
            ...decision.pendingId !== undefined ? { pending_id: decision.pendingId } : {},
          }
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

