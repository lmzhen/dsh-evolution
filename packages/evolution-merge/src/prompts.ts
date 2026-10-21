/**
 * Round-1/round-2 prompt builders. B draft body, with only the file-tool ->
 * merge_stage substitution and the fresh-mode bridge sentence.
 */
import type { MergeDecision, MergeRow } from './contracts.ts'
import type { SkillCard } from './skill-card.ts'

export const MERGE_PROMPT_VERSION = 'merge-b/v1'
export const STANDBY_PROMPT = 'You are a merge worker. Wait for instructions.'

function sourcePath(name: string): string { return 'sources/' + name }
function mergedPath(target: string): string { return 'merged/' + target }

function wireDecision(decision: MergeDecision): Record<string, unknown> {
  return {
    shouldMerge: decision.shouldMerge,
    mode: decision.mode,
    target: decision.target,
    sources: decision.sources,
    rationale: decision.rationale,
    confidence: decision.confidence,
    a_summary: decision.aSummary,
    b_summary: decision.bSummary,
  }
}

export function buildRound1Prompt(candidate: { readonly a: string; readonly b: string }, cards: readonly SkillCard[]): string {
  void cards
  return [
    '你是技能合并决策 agent。第 1 轮只做判断，不要写文件、不要修改任何源目录。',
    '',
    '在当前工作目录下用 merge_stage 的 list/read 完整阅读两个源技能：',
    '- A: ' + sourcePath(candidate.a) + '（name=' + candidate.a + '）',
    '- B: ' + sourcePath(candidate.b) + '（name=' + candidate.b + '）',
    '包含 SKILL.md 与 references/templates/scripts 等支撑文件。',
    '',
    '判断规则：',
    '1) 两者是否语义等价/互补到值得合并，而不是词面相似；',
    '2) 合并后是否更容易发现和使用，而不是变成更大的巨技能；',
    '3) 若合并会破坏触发面/生命周期/可发现性，应输出 keep。',
    '',
    '只输出一个 JSON（不要 markdown 围栏）：',
    '{"should_merge":true|false,"mode":"merge-into-existing|create-umbrella|keep","target":"kebab-case","sources":["源技能名"],"rationale":"<=150字","confidence":0.0,"a_summary":"A 的一句话摘要","b_summary":"B 的一句话摘要"}',
  ].join('\n')
}

export function buildRound2Prompt(row: MergeRow, decision: MergeDecision, mode: 'continue' | 'fresh' = 'continue'): string {
  const decisionJson = JSON.stringify(wireDecision(decision))
  const head = [
    '现在执行第 2 轮：把两个技能融合成一个完整、可用的技能，直接在当前工作目录的 ' + mergedPath(decision.target) + '/ 下写文件。',
    '不要修改 ' + sourcePath(row.a) + ' 或 ' + sourcePath(row.b) + '（只读源副本）；不要访问工作目录以外的路径。',
    '',
  ]
  const body = [
    '决策结果：' + decisionJson,
    '目标技能名：' + decision.target,
    '',
    '工作方式：',
    '- 用 merge_stage 的 list/read/write/copy 创建 ' + mergedPath(decision.target) + '/SKILL.md 与需要的 references/templates/scripts；',
    '- 可以复制源文件作为草稿基础，然后逐段修改；可以多轮读写；',
    '- 保留两源独特内容，不编造事实，不留下 TODO/占位符；',
    '- SKILL.md 以合法 YAML frontmatter 开头，name 等于目标名，description 不超过 60 字符；',
    '- 正文与支撑文件的引用必须成对，路径只允许 references/templates/scripts/assets 下的相对路径。',
    '',
    '完成后只输出一个 JSON（不要 markdown 围栏）：',
    '{"target":"' + decision.target + '","files":["SKILL.md","references/..."],"changelog":["一条变更"],"notes":"可选的一句话"}',
  ]
  return (mode === 'fresh' ? ['基于已持久化的 decision。', ...head, ...body] : [...head, ...body]).join('\n')
}

export function buildStandbyPrompt(): string { return STANDBY_PROMPT }
