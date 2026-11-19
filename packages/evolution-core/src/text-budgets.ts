/**
 * Named text budgets: every character-based decision declares its axis, unit and
 * severity here, so business code never invents a measurement or a unit inline.
 *
 * A budget is not a language profile. Storage/display/context/quality are
 * different questions about the same string; the metric module answers all of
 * them, and this table decides which answer each gate uses.
 *
 * @module @deepseek-ai/dsh-evolution-core
 */

import {
  AUTHORING_DESCRIPTION_BAR,
  DEFAULT_SOFT_BODY_TOKENS,
  DEFAULT_MEMORY_TOKENS,
  DEFAULT_USER_TOKENS,
  DEFAULT_SUBSTANTIVE_MIN_AGENT_CHARS,
  DEFAULT_SUBSTANTIVE_MIN_USER_CHARS,
  MAX_DESCRIPTION_LENGTH,
  MAX_SKILL_CONTENT_CHARS,
  MAX_SKILL_FILE_BYTES,
  MAX_SKILL_NAME_LENGTH,
  MERGE_BODY_PREVIEW_BYTES,
  MEMORY_ENTRY_PREVIEW_GRAPHEMES,
  REVIEW_TEXT_PREVIEW_GRAPHEMES,
  TEXT_DIFF_MAX_GRAPHEMES,
  VERSION_BODY_PREVIEW_GRAPHEMES,
} from './constants.ts'
import { DEFAULT_SKILL_WRITE_SUMMARY_CHARS } from './skill-history.ts'
import { measureText, type TextUnit, type TokenEstimator } from './text-metrics.ts'
import { DRIFT_MAX_LINE_CHARS } from './drift-signals.ts'

/** What a budget protects. */
export type BudgetAxis = 'storage' | 'display' | 'context' | 'quality'

/** How a violation is handled; "report" never blocks a write. */
export type BudgetSeverity = 'hard' | 'soft' | 'report'

/** One named budget. */
export interface TextBudget {
  readonly id: string
  readonly axis: BudgetAxis
  readonly unit: TextUnit
  readonly limit: number
  readonly severity: BudgetSeverity
}

/** One measurement against one budget. */
export interface TextBudgetResult {
  readonly budget: TextBudget
  readonly value: number
  readonly over: boolean
  readonly remaining: number
}

/** The default soft body token budget. */
export const SOFT_BODY_TOKENS = DEFAULT_SOFT_BODY_TOKENS

/** The derived token budgets for the old character memory limits. */
export const MEMORY_TOKENS = DEFAULT_MEMORY_TOKENS
export const USER_TOKENS = DEFAULT_USER_TOKENS

/**
 * The family's named budgets.
 *
 * Context budgets are registered here before their wiring lands so the inventory
 * and doctor have one authority; P2 is what makes them stop being dormant.
 */
export const TEXT_BUDGETS = {
  skillBodyHard: { id: 'skill.body.hard', axis: 'storage', unit: 'codePoints', limit: MAX_SKILL_CONTENT_CHARS, severity: 'hard' },
  skillFileBytes: { id: 'skill.file.bytes', axis: 'storage', unit: 'utf8Bytes', limit: MAX_SKILL_FILE_BYTES, severity: 'hard' },
  skillName: { id: 'skill.name', axis: 'storage', unit: 'codePoints', limit: MAX_SKILL_NAME_LENGTH, severity: 'hard' },
  skillDescription: { id: 'skill.description.hard', axis: 'display', unit: 'graphemes', limit: MAX_DESCRIPTION_LENGTH, severity: 'hard' },
  skillDescriptionAuthoring: { id: 'skill.description.authoring', axis: 'display', unit: 'graphemes', limit: AUTHORING_DESCRIPTION_BAR, severity: 'soft' },
  skillSummary: { id: 'skill.summary', axis: 'display', unit: 'graphemes', limit: DEFAULT_SKILL_WRITE_SUMMARY_CHARS, severity: 'hard' },
  feedbackNote: { id: 'feedback.note', axis: 'display', unit: 'graphemes', limit: 20, severity: 'hard' },
  lineLength: { id: 'skill.line', axis: 'display', unit: 'graphemes', limit: DRIFT_MAX_LINE_CHARS, severity: 'soft' },
  substantiveUser: { id: 'review.substantive.user', axis: 'display', unit: 'graphemes', limit: DEFAULT_SUBSTANTIVE_MIN_USER_CHARS, severity: 'soft' },
  substantiveAgent: { id: 'review.substantive.agent', axis: 'display', unit: 'graphemes', limit: DEFAULT_SUBSTANTIVE_MIN_AGENT_CHARS, severity: 'soft' },
  retentionFeedback: { id: 'history.retention-feedback', axis: 'display', unit: 'graphemes', limit: 200, severity: 'report' },
  diffWindow: { id: 'history.diff-window', axis: 'display', unit: 'graphemes', limit: TEXT_DIFF_MAX_GRAPHEMES, severity: 'report' },
  reviewPreview: { id: 'history.review-preview', axis: 'display', unit: 'graphemes', limit: REVIEW_TEXT_PREVIEW_GRAPHEMES, severity: 'report' },
  memoryPreview: { id: 'memory.entry-preview', axis: 'display', unit: 'graphemes', limit: MEMORY_ENTRY_PREVIEW_GRAPHEMES, severity: 'report' },
  versionBodyPreview: { id: 'history.body-preview', axis: 'display', unit: 'graphemes', limit: VERSION_BODY_PREVIEW_GRAPHEMES, severity: 'report' },
  mergeBodyPreview: { id: 'merge.body-preview', axis: 'display', unit: 'utf8Bytes', limit: MERGE_BODY_PREVIEW_BYTES, severity: 'report' },
  bodySoft: { id: 'skill.body.soft', axis: 'context', unit: 'tokens', limit: SOFT_BODY_TOKENS, severity: 'soft' },
  memory: { id: 'memory.budget', axis: 'context', unit: 'tokens', limit: MEMORY_TOKENS, severity: 'hard' },
  user: { id: 'user.budget', axis: 'context', unit: 'tokens', limit: USER_TOKENS, severity: 'hard' },
} as const satisfies Readonly<Record<string, TextBudget>>

/**
 * Compare one string against one named budget.
 * @param text - the string to measure.
 * @param budget - the budget to apply.
 * @param estimator - optional token source for token budgets.
 * @returns the measured value and the remaining allowance (negative when over).
 */
export function compareTextBudget(
  text: string,
  budget: TextBudget,
  estimator?: TokenEstimator,
): TextBudgetResult {
  const metrics = measureText(text, estimator)
  const measured = budget.unit === 'tokens'
    ? metrics.tokens.value
    : budget.unit === 'utf8Bytes'
      ? metrics.utf8Bytes
      : budget.unit === 'codePoints'
        ? metrics.codePoints
        : metrics.graphemes
  return {
    budget,
    value: measured,
    over: measured > budget.limit,
    remaining: budget.limit - measured,
  }
}
