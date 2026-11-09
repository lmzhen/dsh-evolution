import type { PreStepDecision } from '@deepseek-ai/dsh-evolution-core/platform'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed, UserMessage } from '@deepseek-ai/dsh-llm'
import type { ProjectionResult } from './projection.ts'
import { captureCatalog, renderCatalog, renderCatalogUpdate, restoreCatalog, type CatalogCapture } from './catalog-codec.ts'
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'evolution-skill-projection': {
      readonly kind: 'evolution-skill-projection'
      readonly entries: readonly CatalogEntry[]
      readonly hiddenNames: readonly string[]
      readonly digest: string
    } & ContextFormed
  }
}

import type { CatalogEntry } from './projection.ts'

/** @returns the first platform catalog message in the current decision. */
export function findCatalogMessage(decision: PreStepDecision): UserMessage | undefined {
  if (decision.kind !== 'enter') return undefined
  return decision.messages.find(message => message.source.kind === 'skill-catalog')
}

/**
 * Replace the current catalog message with projected entries, preserving its framing.
 * @param decision - current pre-step decision.
 * @param capture - platform catalog captured from the same decision.
 * @param entries - projected entries.
 * @returns a new decision; unchanged when no catalog message exists.
 */
export function applyCapturedProjection(decision: PreStepDecision, capture: CatalogCapture, entries: readonly CatalogEntry[]): PreStepDecision {
  if (decision.kind !== 'enter') return decision
  const index = decision.messages.findIndex(message => message.source.kind === 'skill-catalog')
  if (index < 0) return decision
  const messages = [...decision.messages]
  messages[index] = renderCatalog(capture, entries)
  return { ...decision, messages }
}

/**
 * Restore the exact captured platform catalog in the current decision.
 * @param decision - current pre-step decision.
 * @param capture - durable platform catalog capture.
 * @returns a new decision; unchanged when no catalog message exists.
 */
export function restoreCapturedProjection(decision: PreStepDecision, capture: CatalogCapture): PreStepDecision {
  if (decision.kind !== 'enter') return decision
  const withoutContext = decision.messages.filter(message => message.source.kind !== 'evolution-skill-projection')
  const index = withoutContext.findIndex(message => message.source.kind === 'skill-catalog')
  if (index < 0) return decision
  const messages = [...withoutContext]
  messages[index] = restoreCatalog(capture)
  return { ...decision, messages }
}

/**
 * Append a replacement catalog when the current decision has no catalog message.
 * @param decision - current pre-step decision.
 * @param sourceEntries - full platform entries for the stable digest.
 * @param result - projection result.
 * @returns decision with replacement catalog plus optional context.
 */
export function applyReplacementDecision(decision: PreStepDecision, sourceEntries: readonly CatalogEntry[], result: ProjectionResult, seen?: ReadonlySet<string> | undefined): PreStepDecision {
  if (decision.kind !== 'enter') return decision
  if (seen?.has(result.digest) === true) return decision
  const update = renderCatalogUpdate(sourceEntries, result.catalogEntries)
  const context = renderProjectionContext(result)
  const messages = context === undefined ? [...decision.messages, update] : [...decision.messages, update, context]
  return { ...decision, messages }
}

/**
 * Append a full replacement catalog without a current catalog message.
 * @param decision - current pre-step decision.
 * @param capture - durable platform capture.
 * @returns decision with a full replacement catalog.
 */
export function applyRestoreUpdate(decision: PreStepDecision, capture: CatalogCapture): PreStepDecision {
  if (decision.kind !== 'enter') return decision
  return { ...decision, messages: [...decision.messages, renderCatalogUpdate(capture.source.entries, capture.entries)] }
}

/** @returns captured current catalog or undefined when the shape is unknown. */
export function captureDecisionCatalog(decision: PreStepDecision): CatalogCapture | undefined {
  const message = findCatalogMessage(decision)
  return message === undefined ? undefined : captureCatalog(message)
}

/** @returns a model-visible projection context message, or undefined when empty. */
export function renderProjectionContext(result: ProjectionResult): UserMessage | undefined {
  if (result.context === '') return undefined
  return createUserMessage({
    content: [{ type: 'text', text: result.context }],
    source: { kind: 'evolution-skill-projection', entries: result.catalogEntries, hiddenNames: result.hiddenNames, digest: result.digest },
  })
}

/**
 * Apply the complete projection: replace the current catalog and append one context message.
 * @param decision - current pre-step decision.
 * @param capture - platform catalog captured from the same decision.
 * @param result - complete projection.
 * @returns new decision; unchanged when no catalog exists.
 */
export function applyProjectedDecision(decision: PreStepDecision, capture: CatalogCapture, result: ProjectionResult, seen?: ReadonlySet<string> | undefined): PreStepDecision {
  const withCatalog = applyCapturedProjection(decision, capture, result.catalogEntries)
  const context = renderProjectionContext(result)
  if (context === undefined || withCatalog.kind !== 'enter') return withCatalog
  const duplicate = withCatalog.messages.some(message => message.source.kind === 'evolution-skill-projection' && message.source.digest === result.digest) || seen?.has(result.digest) === true
  return duplicate ? withCatalog : { ...withCatalog, messages: [...withCatalog.messages, context] }
}
