import { dirname, join } from 'node:path'
import { DEFAULT_SKILL_LIMITS } from './limits.ts'
import { contentHash } from './mutations.ts'
import { parseFrontmatter } from './frontmatter.ts'
import { isPresent } from './probe.ts'
import { findOwnerCandidate, ownerCandidatesFromSummaries, type OwnerCandidate } from './owner-resolver.ts'
import { nearDuplicateSummaries } from './quality.ts'
import { planExtract, type ExtractPlanDraft } from './extract-plan.ts'
import { readExternalSupport } from './external-support.ts'
import type { SkillLibrary } from './skill-store.ts'
import type { SkillModel } from './skill-model.ts'

export type ExtractPlanLibrary = Pick<SkillLibrary, 'root' | 'read' | 'listSupportFiles'> & { readonly model: Pick<SkillModel, 'list'> }

export interface ExtractRequestItem {
  heading?: string
  start?: string
  end?: string
  to_skill?: string
  to_heading?: string
}

export interface ExtractRequestInput {
  source: string
  items: readonly ExtractRequestItem[]
  outcome?: 'extract' | 'mixed'
  ownerCovers?: boolean
}

export interface ExtractRequestPlan {
  ok: true
  plan: ExtractPlanDraft
  candidates: OwnerCandidate[]
  warnings?: string[]
}

/** Build the one extract plan both the tool and CLI consume. */
export async function buildExtractPlanFromLibrary(
  library: ExtractPlanLibrary,
  input: ExtractRequestInput,
): Promise<ExtractRequestPlan | { ok: false; message: string }> {
  const source = input.source.trim()
  const raw = input.items
  if (source === '' || raw.length === 0) return { ok: false, message: 'extract 需要 name 与至少一个 extract 项。' }
  const requests: Array<{ heading: string; start?: string; end?: string }> = []
  let target = ''
  for (const item of raw) {
    if (item === null || typeof item !== 'object') return { ok: false, message: 'extract 的每一项都必须是对象。' }
    const heading = typeof item.heading === 'string' ? item.heading.trim().replace(/^#+\s*/, '') : ''
    const toSkill = typeof item.to_skill === 'string' ? item.to_skill.trim() : ''
    if (heading === '' || toSkill === '') return { ok: false, message: 'extract 的每一项都需要 heading 与 to_skill。' }
    if (target === '') target = toSkill
    if (target !== toSkill) return { ok: false, message: '一次 extract 只能有一个 to_skill；多目标请分多次调用。' }
    const toHeading = typeof item.to_heading === 'string' ? item.to_heading.trim().replace(/^#+\s*/, '') : undefined
    if (toHeading !== undefined && toHeading !== heading) {
      return { ok: false, message: 'to_heading 暂不支持改名；G3 要求 heading 与 to_heading 相同。' }
    }
    requests.push({
      heading,
      ...(typeof item.start === 'string' ? { start: item.start } : {}),
      ...(typeof item.end === 'string' ? { end: item.end } : {}),
    })
  }
  const sourceMd = await library.read(source)
  if (sourceMd === null) return { ok: false, message: '技能「' + source + '」不存在。' }
  if (source === target) return { ok: false, message: 'source 与 target 不能相同。' }
  const summaries = await library.model.list({ withContent: true, withFrontmatter: true })
  const lookup = ownerCandidatesFromSummaries(source, summaries)
  const candidateNames = lookup.candidates.map(candidate => candidate.name)
  const candidateHint = candidateNames.length === 0
    ? '当前没有可用 owner candidate（描述为空或被排除）。'
    : '候选 owner：' + candidateNames.slice(0, 8).join('、') + (candidateNames.length > 8 ? ' 等' : '') + '。'
  const targetMd = await library.read(target)
  if (targetMd === null) {
    const parsed = parseFrontmatter(sourceMd)
    if (parsed === null) return { ok: false, message: '技能「' + source + '」没有可读取的正文。' }
    const sourceProbe = await library.listSupportFiles(source)
    if (!isPresent(sourceProbe)) return { ok: false, message: '支撑文件列表不可读；拒绝在不确定的闭包上提取。' }
    const external = await readExternalSupport(parsed.body, join(library.root, source), dirname(library.root), [])
    if (!external.ok) return { ok: false, message: external.message }
    const plan = planExtract({
      body: parsed.body,
      sourceName: source,
      targetName: target,
      targetExists: false,
      outcome: 'owner-gap',
      owner: { mode: 'owner-gap', neededOwner: target, triggerCovers: true, outcomeCovers: false, reason: 'target missing; no auto create' },
      requests,
      sourceFiles: sourceProbe.value,
      targetFiles: [],
      external: external.files,
    })
    if (!plan.ok) return { ok: false, message: plan.message + candidateHint }
    return { ok: true, plan: plan.plan, candidates: lookup.candidates }
  }
  if (targetMd.length > DEFAULT_SKILL_LIMITS.maxSkillContentChars) return { ok: false, message: '目标技能「' + target + '」已超过 ' + DEFAULT_SKILL_LIMITS.maxSkillContentChars + ' 字符，拒绝继续提取。' }
  const candidate = findOwnerCandidate(lookup, target)
  if (candidate === undefined) return { ok: false, message: '目标「' + target + '」不是可用的 owner candidate（描述为空或已排除）；owner-gap，不自动 create。' + candidateHint }
  if (!candidate.managed) return { ok: false, message: '目标「' + target + '」不是家族 managed 技能；拒绝把可复用部分写进不受管目录。' }
  if (input.ownerCovers === false) {
    const parsed = parseFrontmatter(sourceMd)
    if (parsed === null) return { ok: false, message: '技能「' + source + '」没有可读取的正文。' }
    const sourceProbe = await library.listSupportFiles(source)
    if (!isPresent(sourceProbe)) return { ok: false, message: '支撑文件列表不可读；拒绝在不确定的闭包上提取。' }
    const external = await readExternalSupport(parsed.body, join(library.root, source), dirname(library.root), [])
    if (!external.ok) return { ok: false, message: external.message }
    const plan = planExtract({
      body: parsed.body,
      sourceName: source,
      targetName: target,
      targetExists: true,
      outcome: 'owner-gap',
      owner: { mode: 'owner-gap', neededOwner: target, triggerCovers: false, outcomeCovers: false, reason: 'agent judged the target does not cover this part' },
      requests,
      sourceFiles: sourceProbe.value,
      targetFiles: [],
      external: external.files,
    })
    if (!plan.ok) return { ok: false, message: plan.message + candidateHint }
    return { ok: true, plan: plan.plan, candidates: lookup.candidates }
  }
  const overlaps = nearDuplicateSummaries({
    candidate: { name: target, description: candidate.description },
    existing: summaries.filter(summary => summary.name !== source && summary.name !== target),
  })
  const overlapWarnings = overlaps.length === 0
    ? []
    : ['目标「' + target + '」描述与邻技能重叠：' + overlaps.map(match => match.name + ' (' + match.score.toFixed(2) + ')').join('、') + '；请确认 owner 覆盖，提取仍可继续。']
  if (candidate.protectionUnknown || candidate.protectedBy !== null) {
    return { ok: false, message: '目标「' + target + '」受保护（' + (candidate.protectedBy ?? '未知') + '），拒绝提取。' }
  }
  const parsed = parseFrontmatter(sourceMd)
  if (parsed === null) return { ok: false, message: '技能「' + source + '」没有可读取的正文。' }
  const sourceProbe = await library.listSupportFiles(source)
  const targetProbe = await library.listSupportFiles(target)
  if (!isPresent(sourceProbe) || !isPresent(targetProbe)) return { ok: false, message: '支撑文件列表不可读；拒绝在不确定的闭包上提取。' }
  const external = await readExternalSupport(parsed.body, join(library.root, source), dirname(library.root), targetProbe.value)
  if (!external.ok) return { ok: false, message: external.message }
  if (input.outcome !== undefined && input.outcome !== 'extract' && input.outcome !== 'mixed') {
    return { ok: false, message: 'outcome 只能是 extract 或 mixed；owner-gap 由缺失 target 的路径自动决定。' }
  }
  const outcome = input.outcome ?? (requests.some(request => request.start !== undefined || request.end !== undefined) ? 'mixed' : 'extract')
  const plan = planExtract({
    body: parsed.body,
    sourceName: source,
    targetName: target,
    targetExists: true,
    outcome,
    owner: { mode: 'covered', name: target, triggerCovers: true, outcomeCovers: true, reason: 'explicit target' },
    requests,
    sourceFiles: sourceProbe.value,
    targetFiles: targetProbe.value,
    external: external.files,
    anchors: { sourceMdSha256: contentHash(sourceMd), targetMdSha256: contentHash(targetMd) },
  })
  if (!plan.ok) return { ok: false, message: plan.message }
  const projectedChars = targetMd.length + plan.plan.parts.reduce((sum, part) => sum + part.movedText.length + 2, 0)
  if (projectedChars > DEFAULT_SKILL_LIMITS.maxSkillContentChars) {
    return { ok: false, message: '目标「' + target + '」投影后约 ' + projectedChars + ' 字符，超过 ' + DEFAULT_SKILL_LIMITS.maxSkillContentChars + ' 上限；拒绝提取。' }
  }
  return { ok: true, plan: plan.plan, candidates: lookup.candidates, ...(overlapWarnings.length === 0 ? {} : { warnings: overlapWarnings }) }
}
