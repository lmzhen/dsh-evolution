/**
 * Deterministic gate for a staged merge tree. No io, no model.
 *
 * block = commit must not proceed; warn = report only. The path and reference checks reuse
 * the skill-store's own `validateSupportPath` / `supportRefs`, so there is one whitelist.
 */
import {
  DEFAULT_SKILL_LIMITS,
  parseFrontmatter,
  scanContentThreats,
  supportRefs,
  validateFrontmatter,
  validateSupportPath,
  type SkillLimits,
} from '@deepseek-ai/dsh-evolution-core'

export interface StagedTree {
  readonly target: string
  readonly body: string
  readonly files: readonly { readonly path: string; readonly content: string }[]
}

export interface RuleFinding {
  readonly rule: string
  readonly path: string
  readonly severity: 'block' | 'warn'
  readonly message: string
}

const PLACEHOLDER = /\bTODO\b|\bxxx\b|\{\{[^}]*\}\}/i
const DESC_WARN_LENGTH = 60

export function validateStagedTree(tree: StagedTree, limits: SkillLimits = DEFAULT_SKILL_LIMITS): readonly RuleFinding[] {
  const findings: RuleFinding[] = []
  const block = (rule: string, path: string, message: string): void => { findings.push({ rule, path, severity: 'block', message }) }
  const warn = (rule: string, path: string, message: string): void => { findings.push({ rule, path, severity: 'warn', message }) }

  const parsed = parseFrontmatter(tree.body)
  if (parsed === null) block('frontmatter', 'SKILL.md', 'SKILL.md has no valid frontmatter')
  else {
    const invalid = validateFrontmatter(tree.body, tree.target, limits)
    if (invalid !== null) block('frontmatter', 'SKILL.md', invalid)
    const description = parsed.frontmatter.description ?? ''
    if (description.length > DESC_WARN_LENGTH) warn('desc-length', 'SKILL.md', 'description is longer than ' + String(DESC_WARN_LENGTH) + ' characters')
  }
  if (Buffer.byteLength(tree.body, 'utf8') > limits.maxSkillFileBytes) block('bytes', 'SKILL.md', 'SKILL.md exceeds maxSkillFileBytes')
  if (scanContentThreats(tree.body) !== null) block('threat', 'SKILL.md', 'SKILL.md tripped the content threat scanner')
  if (PLACEHOLDER.test(tree.body)) warn('placeholder', 'SKILL.md', 'SKILL.md contains a TODO/xxx/{{...}} placeholder')

  const paths = new Set<string>()
  for (const file of tree.files) {
    const badPath = validateSupportPath(file.path)
    if (badPath !== null) {
      block('path', file.path, badPath)
      continue
    }
    paths.add(file.path)
    if (Buffer.byteLength(file.content, 'utf8') > limits.maxSkillFileBytes) block('bytes', file.path, 'file exceeds maxSkillFileBytes')
    if (scanContentThreats(file.content) !== null) block('threat', file.path, 'file tripped the content threat scanner')
    if (PLACEHOLDER.test(file.content)) warn('placeholder', file.path, 'file contains a TODO/xxx/{{...}} placeholder')
  }
  for (const ref of supportRefs(tree.body)) {
    if (!paths.has(ref)) block('refs-pair', ref, 'body references a support file that is not staged')
  }
  return findings
}

export function hasBlockingFinding(findings: readonly RuleFinding[]): boolean {
  return findings.some(finding => finding.severity === 'block')
}
