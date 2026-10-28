import { createHash } from 'node:crypto'
import { applyReferenceRewrite, planReferenceRewrite, planRehoming, type ReferenceMove } from './reference-rewrite.ts'
import { selectSections, type SectionSelectionRequest } from './section-selection.ts'
import { externalRefs, supportRefs } from './support-refs.ts'
import { frontmatterBlock } from './frontmatter.ts'

const LF = String.fromCharCode(10)

/** Semantic outcome carried by a plan; the agent decides it, this module records it. */
export type ExtractOutcome = 'extract' | 'mixed' | 'owner-gap'

/** Owner coverage supplied by the owner resolver; a missing owner is owner-gap, not a guess. */
export interface OwnerDecision {
  mode: 'covered' | 'owner-gap'
  name?: string
  neededOwner?: string
  triggerCovers: boolean
  outcomeCovers: boolean
  reason: string
}

export type ExtractPartRequest = SectionSelectionRequest

export interface ExtractPart {
  heading: string
  anchor: { heading: string; start?: string; end?: string }
  sourceText: string
  movedText: string
  bytes: number
  sha256: string
}

export interface ExternalSupportFile {
  ref: string
  originalPath: string
  targetPath: string
  content: string
  sha256: string
  provenance: string
}

export interface SupportClosure {
  exclusive: Array<{ from: string; to: string }>
  shared: Array<{ from: string; to: string; provenance: string }>
  external: Array<{ from: string; to: string; provenance: string; originalPath: string; content?: string; sha256?: string }>
  unresolved: string[]
  dangling: string[]
}

export interface ExtractAnchors {
  sourceMdSha256: string
  targetMdSha256: string
}

export interface ExtractPlanDraft {
  source: string
  target: { name: string; exists: boolean }
  outcome: ExtractOutcome
  parts: ExtractPart[]
  residual: string
  pointer: string
  owner: OwnerDecision
  support: SupportClosure
  warnings: string[]
  /** Plan-time full-document hashes; the write adapter refuses when either drifts. */
  anchors?: ExtractAnchors
}

export interface PlanExtractInput {
  body: string
  sourceName: string
  targetName: string
  targetExists: boolean
  outcome: ExtractOutcome
  owner: OwnerDecision
  requests: readonly ExtractPartRequest[]
  sourceFiles: readonly string[]
  targetFiles: readonly string[]
  /** Bounded external files the caller read and resolved under its allowed root. */
  external?: readonly ExternalSupportFile[]
  /** Optional plan-time full-document hashes, threaded by the tool/CLI caller. */
  anchors?: ExtractAnchors
}

export type ExtractPlanResult =
  | { ok: true; plan: ExtractPlanDraft }
  | { ok: false; code: string; message: string }

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function computeSupport(
  parts: readonly ExtractPart[],
  residual: string,
  sourceName: string,
  sourceFiles: readonly string[],
  targetFiles: readonly string[],
  externalFiles: readonly ExternalSupportFile[],
): { support: SupportClosure; warnings: string[] } | { error: string } {
  const selectedText = parts.map(part => part.sourceText).join(LF + LF)
  const selectedRefs = unique(supportRefs(selectedText))
  const residualRefs = new Set(supportRefs(residual))
  const unresolved = selectedRefs.filter(ref => !sourceFiles.includes(ref))
  if (unresolved.length > 0) return { error: 'support-unresolved: ' + unresolved.join(', ') }
  const candidates = selectedRefs.filter(ref => sourceFiles.includes(ref))
  const rehome = planRehoming(candidates, targetFiles, sourceName)
  const moves: ReferenceMove[] = rehome.moves
  const byFrom = new Map(moves.map(move => [move.from, move.to]))
  const exclusive: Array<{ from: string; to: string }> = []
  const shared: Array<{ from: string; to: string; provenance: string }> = []
  for (const from of candidates) {
    const to = byFrom.get(from)
    if (to === undefined) continue
    if (residualRefs.has(from)) shared.push({ from, to, provenance: sourceName + ':' + from })
    else exclusive.push({ from, to })
  }
  const targetFilesWithMoves = unique([...targetFiles, ...moves.map(move => move.to)])
  const external = unique(externalRefs(selectedText))
  const suppliedRefs = new Set(externalFiles.map(file => file.ref))
  const missingExternal = external.filter(ref => !suppliedRefs.has(ref))
  const warnings: string[] = []
  if (missingExternal.length > 0) warnings.push('external-support-not-copied: ' + missingExternal.join(', '))
  const externalClosure: SupportClosure['external'] = []
  for (const file of externalFiles) {
    if (!external.includes(file.ref)) return { error: 'external-ref-not-selected: ' + file.ref }
    if (file.targetPath.startsWith('/') || file.targetPath.includes('..') || !/^(?:references|templates|scripts|assets)\//.test(file.targetPath)) {
      return { error: 'external-target-unsafe: ' + file.targetPath }
    }
    if (targetFilesWithMoves.includes(file.targetPath)) return { error: 'external-collision: ' + file.targetPath }
    externalClosure.push({
      from: file.ref,
      to: file.targetPath,
      provenance: file.provenance,
      originalPath: file.originalPath,
      content: file.content,
      sha256: file.sha256,
    })
  }
  const rewritten = new Map<string, string>()
  for (const part of parts) {
    const partRefs = supportRefs(part.sourceText)
    const rewrite = planReferenceRewrite({
      content: part.sourceText,
      files: sourceFiles,
      moves: moves.filter(move => partRefs.includes(move.from)),
      targetFiles: targetFilesWithMoves,
    })
    rewritten.set(part.heading, applyReferenceRewrite(part.sourceText, rewrite.edits))
    warnings.push(...rewrite.unresolved.map(ref => 'support-unresolved: ' + ref))
    warnings.push(...rewrite.residualDangling.map(ref => 'support-dangling: ' + ref))
  }
  for (const part of parts) {
    let text = rewritten.get(part.heading) ?? part.sourceText
    for (const file of externalClosure) text = text.split(file.from).join(file.to)
    part.movedText = text
  }
  const exclusiveSet = new Set(exclusive.map(entry => entry.from))
  const parentExclusive = supportRefs(residual).filter(ref => exclusiveSet.has(ref))
  if (parentExclusive.length > 0) return { error: 'support-exclusive-referenced-by-parent: ' + parentExclusive.join(', ') }
  const dangling = unique(warnings.filter(item => item.startsWith('support-dangling: ')).map(item => item.slice('support-dangling: '.length)))
  return {
    support: {
      exclusive,
      shared,
      external: externalClosure,
      unresolved: warnings.filter(item => item.startsWith('support-unresolved: ')),
      dangling,
    },
    warnings,
  }
}

/**
 * Build a pure extract plan. No IO, no writes: selection, residual, support
 * closure and the moved text are computed from the supplied bodies/file lists.
 * @param input - source body, target identity, owner decision and support lists.
 * @returns a plan, or a refusal with a stable code.
 */
export function planExtract(input: PlanExtractInput): ExtractPlanResult {
  if (input.outcome === 'owner-gap') {
    if (input.owner.mode !== 'owner-gap') return { ok: false, code: 'owner-gap-mismatch', message: 'outcome owner-gap requires an owner-gap decision' }
    if (input.owner.neededOwner === undefined || input.owner.neededOwner.trim() === '') {
      return { ok: false, code: 'owner-gap-needed-owner', message: 'owner-gap requires neededOwner' }
    }
  } else {
    if (input.owner.mode !== 'covered' || !input.owner.triggerCovers || !input.owner.outcomeCovers) {
      return { ok: false, code: 'owner-not-covered', message: 'extract/mixed requires a covering owner' }
    }
    if (!input.targetExists) return { ok: false, code: 'target-missing', message: 'covered owner target does not exist' }
  }
  const selection = selectSections(input.body, input.requests)
  if (!selection.ok) return { ok: false, code: selection.code, message: selection.message }
  if (selection.sections.length === 0) return { ok: false, code: 'part-empty', message: 'at least one part is required' }
  const parts: ExtractPart[] = selection.sections.map(section => ({
    heading: section.heading,
    anchor: {
      heading: section.heading,
      ...(section.anchorStart === undefined ? {} : { start: section.anchorStart }),
      ...(section.anchorEnd === undefined ? {} : { end: section.anchorEnd }),
    },
    sourceText: section.text,
    movedText: section.text,
    bytes: Buffer.byteLength(section.text, 'utf8'),
    sha256: sha256(section.text),
  }))
  const ownerName = input.owner.mode === 'covered' ? (input.owner.name ?? input.targetName) : (input.owner.neededOwner ?? input.targetName)
  const pointer = 'This capability now lives in ' + ownerName + '; project-specific facts stay here.'
  const ordered = [...selection.sections].sort((a, b) => a.start - b.start)
  const first = ordered[0]
  if (first === undefined) return { ok: false, code: 'part-empty', message: 'at least one part is required' }
  const byStart = new Map(ordered.map(section => [section.start, section]))
  const lines = input.body.split(LF)
  const rebuilt: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const section = byStart.get(index)
    if (section !== undefined) {
      if (index === first.start) rebuilt.push(pointer)
      index = section.end - 1
    } else {
      rebuilt.push(lines[index] ?? '')
    }
  }
  const residual = rebuilt.join(LF)
  if (residual.trim().length === 0) return { ok: false, code: 'parent-empty', message: 'parent residual is empty' }
  const substantive = residual.split(LF).filter(line => line.trim() !== '' && line !== pointer && !line.trimStart().startsWith('#'))
  if (substantive.length === 0) return { ok: false, code: 'parent-hollow-heading', message: 'parent residual has no substantive content' }
  if (input.outcome === 'owner-gap') {
    return {
      ok: true,
      plan: {
        source: input.sourceName,
        target: { name: input.targetName, exists: input.targetExists },
        outcome: input.outcome,
        parts,
        residual,
        pointer,
        owner: input.owner,
        support: { exclusive: [], shared: [], external: [], unresolved: [], dangling: [] },
        warnings: [],
        ...(input.anchors === undefined ? {} : { anchors: input.anchors }),
      },
    }
  }
  const supportResult = computeSupport(parts, residual, input.sourceName, input.sourceFiles, input.targetFiles, input.external ?? [])
  if ('error' in supportResult) {
    const code = supportResult.error.split(':')[0] ?? 'support-invalid'
    return { ok: false, code, message: supportResult.error }
  }
  if (supportResult.support.dangling.length > 0) {
    return { ok: false, code: 'support-dangling', message: 'support-dangling: ' + supportResult.support.dangling.join(', ') }
  }
  return {
    ok: true,
    plan: {
      source: input.sourceName,
      target: { name: input.targetName, exists: input.targetExists },
      outcome: input.outcome,
      parts,
      residual,
      pointer,
      owner: input.owner,
      support: supportResult.support,
      warnings: unique(supportResult.warnings),
      ...(input.anchors === undefined ? {} : { anchors: input.anchors }),
    },
  }
}

export interface ExtractProjection {
  sourceAfter: string
  targetAfter: string
}

/**
 * Project one plan onto the current source/target SKILL.md bytes.
 *
 * This is the one place that composes frontmatter + residual + target additions;
 * preview and the write adapter both call it so they cannot advertise different
 * bytes. Pure: no IO.
 * @param plan - plan from planExtract.
 * @param sourceMd - current source SKILL.md.
 * @param targetMd - current target SKILL.md.
 * @returns both next documents, or the refusal that makes projection impossible.
 */
export function projectExtractBodies(plan: ExtractPlanDraft, sourceMd: string, targetMd: string): { ok: true; projection: ExtractProjection } | { ok: false; message: string } {
  const sourceBlock = frontmatterBlock(sourceMd)
  const targetBlock = frontmatterBlock(targetMd)
  if (!sourceBlock) return { ok: false, message: 'source 没有有效 frontmatter' }
  if (!targetBlock) return { ok: false, message: 'target 没有有效 frontmatter' }
  const sourceHeader = sourceBlock.lines.slice(0, sourceBlock.end + 1).join(LF)
  const targetNormalized = targetMd.replace(/\r\n/g, LF)
  const targetLines = targetNormalized.split(LF)
  for (const part of plan.parts) {
    if (targetLines.some(line => line.trim() === '## ' + part.heading)) return { ok: false, message: 'target 已有同名 heading「' + part.heading + '」。' }
  }
  const additions = plan.parts.map(part => part.movedText).join(LF + LF)
  const targetRaw = targetNormalized.trimEnd() + LF + LF + additions + LF
  const targetAfter = targetBlock.nl === '\r\n' ? targetRaw.replace(/\n/g, '\r\n') : targetRaw
  const sourceRaw = (sourceHeader + plan.residual).replace(/\r\n/g, LF)
  const sourceAfter = sourceBlock.nl === '\r\n' ? sourceRaw.replace(/\n/g, '\r\n') : sourceRaw
  return { ok: true, projection: { sourceAfter, targetAfter } }
}
