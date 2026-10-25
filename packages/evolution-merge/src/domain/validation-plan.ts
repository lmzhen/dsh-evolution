/** Immutable post-stage validation plan: Q09/support/threat/revision facts. */
import { createHash } from 'node:crypto'
import { scanContentThreats, supportRefs } from '@deepseek-ai/dsh-evolution-core'
import type { SkillCard } from '../skill-card.ts'
import type { MergeLimitsSnapshot } from './merge-limits.ts'
import type { StagedTree, RuleFinding } from '../rules.ts'

export interface StagedFile { readonly path: string; readonly content: string; readonly digest: string; readonly bytes: number }
export interface ValidationPlan {
  readonly planVersion: 1
  readonly stageDigest: string
  readonly target: string
  readonly body: string
  readonly files: readonly StagedFile[]
  readonly supportFiles: readonly { readonly path: string; readonly digest: string; readonly source: string }[]
  readonly manifestFiles: readonly string[]
  readonly q09: { readonly forwardRefs: readonly string[]; readonly reverseRefs: readonly string[]; readonly orphanFiles: readonly string[] }
  readonly supportConflicts: readonly { readonly path: string; readonly sources: readonly string[] }[]
  readonly threat: { readonly body: boolean; readonly files: readonly string[] }
  readonly sourceRevisions: Readonly<Record<string, string>>
  readonly targetRevision: string | null
  readonly limitsDigest: string
  readonly promptVersion?: string
  readonly promptHash?: string
  readonly revision: string
  readonly findings: readonly RuleFinding[]
}
function digest(value: string): string { return createHash('sha256').update(value).digest('hex') }
export function buildValidationPlan(input: {
  readonly tree: StagedTree
  readonly target: string
  readonly limits: MergeLimitsSnapshot
  readonly cards?: readonly SkillCard[]
  readonly sourceRevisions?: Readonly<Record<string, string>>
  readonly targetRevision?: string | null
  readonly manifestFiles?: readonly string[]
  readonly existingSupport?: readonly string[]
  readonly supportFiles?: readonly { readonly path: string; readonly content: string; readonly source: string }[]
  readonly supportSources?: readonly { readonly path: string; readonly content: string; readonly source: string }[]
  readonly promptVersion?: string
  readonly promptHash?: string
}): ValidationPlan {
  const files = input.tree.files.map(file => ({ path: file.path, content: file.content, digest: digest(file.content), bytes: Buffer.byteLength(file.content, 'utf8') }))
  const manifestFiles = [...new Set(input.manifestFiles ?? files.map(file => file.path))].sort()
  const supportFiles = (input.supportFiles ?? files.map(file => ({ path: file.path, content: file.content, source: 'staged' }))).map(file => ({ path: file.path, digest: digest(file.content), source: file.source })).sort((a, b) => a.path.localeCompare(b.path))
  const refs = new Set(supportRefs(input.tree.body))
  const staged = new Set(files.map(file => file.path))
  const manifest = new Set(manifestFiles)
  const forwardRefs = [...refs].filter(ref => !staged.has(ref)).sort()
  const reverseRefs = files.map(file => file.path).filter(path => !refs.has(path) && manifest.has(path)).sort()
  const existing = new Set(input.existingSupport ?? [])
  const orphanFiles = [...existing].filter(path => !staged.has(path)).sort()
  const byPath = new Map<string, { contents: Set<string>; sources: string[] }>()
  for (const file of input.supportSources ?? []) {
    const entry = byPath.get(file.path) ?? { contents: new Set<string>(), sources: [] }
    entry.contents.add(file.content)
    entry.sources.push(file.source)
    byPath.set(file.path, entry)
  }
  const supportConflicts = [...byPath.entries()].filter(([, value]) => value.contents.size > 1).map(([path, value]) => ({ path, sources: value.sources }))
  const sourceThreatFiles = (input.cards ?? []).flatMap(card => (card.files ?? []).filter(file => scanContentThreats(file.content) !== null).map(file => card.name + '/' + file.path))
  const threat = { body: scanContentThreats(input.tree.body) !== null || (input.cards ?? []).some(card => scanContentThreats(card.body) !== null), files: [...files.filter(file => scanContentThreats(file.content) !== null).map(file => file.path), ...sourceThreatFiles] }
  const sourceRevisions = input.sourceRevisions ?? Object.fromEntries((input.cards ?? []).map(card => [card.name, digest(card.body)]))
  const revision = digest(JSON.stringify({ target: input.target, body: digest(input.tree.body), files: files.map(file => [file.path, file.digest]), q09: { forwardRefs, reverseRefs, orphanFiles }, supportConflicts, threat, sourceRevisions, targetRevision: input.targetRevision ?? null }))
  const findings: RuleFinding[] = []
  const stageDigest = digest(JSON.stringify(files.map(file => [file.path, file.digest])))
  if (forwardRefs.length > 0) findings.push({ rule: 'q09-forward', path: forwardRefs.join(','), severity: 'block', message: 'body references unstaged support' })
  if (reverseRefs.length > 0) findings.push({ rule: 'q09-reverse', path: reverseRefs.join(','), severity: 'block', message: 'staged manifest file is not referenced by body' })
  if (orphanFiles.length > 0) findings.push({ rule: 'q09-orphan', path: orphanFiles.join(','), severity: 'block', message: 'target tree support is not declared by plan' })
  if (supportConflicts.length > 0) findings.push({ rule: 'support-conflict', path: supportConflicts.map(item => item.path).join(','), severity: 'block', message: 'same support path has different contents' })
  if (threat.body) findings.push({ rule: 'threat', path: 'SKILL.md', severity: 'block', message: 'body tripped content threat scanner' })
  for (const path of threat.files) findings.push({ rule: 'threat', path, severity: 'block', message: 'support file tripped content threat scanner' })
  if (Buffer.byteLength(input.tree.body, 'utf8') > input.limits.skillLimits.maxSkillFileBytes) findings.push({ rule: 'limit', path: 'SKILL.md', severity: 'block', message: 'body exceeds maxSkillFileBytes' })
  for (const file of files) if (file.bytes > input.limits.skillLimits.maxSkillFileBytes) findings.push({ rule: 'limit', path: file.path, severity: 'block', message: 'file exceeds maxSkillFileBytes' })
  return { planVersion: 1, stageDigest, target: input.target, body: input.tree.body, files, supportFiles, manifestFiles, q09: { forwardRefs, reverseRefs, orphanFiles }, supportConflicts, threat, sourceRevisions, targetRevision: input.targetRevision ?? null, limitsDigest: input.limits.limitsDigest, ...(input.promptVersion === undefined ? {} : { promptVersion: input.promptVersion }), ...(input.promptHash === undefined ? {} : { promptHash: input.promptHash }), revision, findings }
}
