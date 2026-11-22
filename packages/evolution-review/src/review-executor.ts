/**
 * Plugin-side review execution over the parent request prefix.
 *
 * This module deliberately has no AgentLoop child: it replays the parent
 * messages/tools, runs a bounded tool loop, and keeps every intermediate
 * message in memory. The caller owns ReviewRun persistence and audit.
 *
 * @module @deepseek-ai/dsh-evolution-review/review-executor
 */
import { BlockAssembler, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-evolution-platform/values'
import { recordReviewRead } from '@deepseek-ai/dsh-evolution-core'
import type { ContentBlock, ContextFormed, GenerateOptions, Message, RequestMessage, StreamChunk, ToolCallBlock, ToolCallId, ToolHistory, ToolSchema } from '@deepseek-ai/dsh-evolution-platform/contract'
import type { EpochHeader, SessionId } from '@deepseek-ai/dsh-evolution-platform/contract'
import type { ReviewToolChannel } from './review-tool-channel.ts'
import type { ReviewWriteLocks } from './review-write-locks.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'evolution-review': { kind: 'evolution-review' } & ContextFormed
  }
}

/** Minimal parent view required by the executor; a live Agent is structurally compatible. */
export interface ReviewParent {
  readonly id: SessionId
  readonly status: string
  readonly session: {
    readonly id: SessionId
    readonly seq: number
    requestHeader(): EpochHeader | undefined
    deriveMessages(): readonly Message[]
    toolHistory?(): ToolHistory | undefined
  }
}

/** Outcome of one tool call, shaped by the platform ToolBatchResult. */
export interface ReviewToolOutcome {
  readonly callId: ToolCallId
  readonly result: { readonly content: ContentBlock[]; readonly isError: boolean }
}

/** Tool execution port; the platform ToolsService.execute is structurally compatible. */
export interface ReviewToolPort {
  execute(input: {
    readonly calls: readonly ToolCallBlock[]
    readonly signal: AbortSignal
    readonly agent?: ReviewParent
  }): Promise<{ readonly results: readonly ReviewToolOutcome[] }>
}

/** LLM stream port; ctx.llm.stream can be adapted without changing its contract. */
export interface ReviewLlmPort {
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>
}


/** Structured completion report required by the aux review protocol. */
export interface ReviewReport {
  readonly summary: string
  readonly memoryChanged: boolean
  readonly skillsChanged: readonly string[]
  readonly unresolved: readonly string[]
}

/** The only terminal tool call in an aux review. */
export const REVIEW_DONE_TOOL_NAME = 'review_done'

/** Tool that lets the model wait for a resource lock before re-reading. */

/** Classify a skill-write tool error without importing the write service's enum. */
function skillErrorKind(text: string): 'stale' | 'busy' | 'unobserved' | 'ambiguous' | 'not-found' | undefined {
  if (/SKILL_STALE_VERSION/.test(text)) return 'stale'
  if (/SKILL_RESOURCE_BUSY|resource-busy/.test(text)) return 'busy'
  if (/SKILL_NOT_OBSERVED/.test(text)) return 'unobserved'
  if (/SKILL_AMBIGUOUS_EDIT/.test(text)) return 'ambiguous'
  if (/SKILL_NOT_FOUND/.test(text)) return 'not-found'
  return undefined
}

export const REVIEW_WAIT_TOOL_NAME = 'review_wait'

/** Extra instruction appended to aux prompts only; foreground prompts stay unchanged. */
export const AUX_COMPLETION_INSTRUCTION = 'When all durable changes for this review are complete, call review_done as the only tool call in your final batch. Do not call it while more edits remain. A precise no-op is still a completed review: always finish with review_done and an unchanged report instead of stopping without it. If a write is locked, call review_wait once, then re-read the target and retry; never reapply a stale patch.'


const REVIEW_WAIT_TOOL: ToolSchema = {
  name: REVIEW_WAIT_TOOL_NAME,
  description: 'Wait for a resource lock to clear. Call only after a write reports a lock/resource conflict; re-read after it returns.',
  parameters: {
    type: 'object',
    properties: {
      resource: { type: 'string' },
      timeoutMs: { type: 'number' },
    },
    required: ['resource', 'timeoutMs'],
  } as ToolSchema['parameters'],
}

const REVIEW_DONE_TOOL: ToolSchema = {
  name: REVIEW_DONE_TOOL_NAME,
  description: 'Signal that this review is complete. Call it alone, only after all memory/skill edits for this review are finished.',
  parameters: {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      memoryChanged: { type: 'boolean' },
      skillsChanged: { type: 'array', items: { type: 'string' } },
      unresolved: { type: 'array', items: { type: 'string' } },
    },
    required: ['summary', 'memoryChanged', 'skillsChanged', 'unresolved'],
  } as ToolSchema['parameters'],
}

export function parseReviewReport(raw: string): ReviewReport | undefined {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return undefined
    const value = parsed as Record<string, unknown>
    if (typeof value.summary !== 'string' || typeof value.memoryChanged !== 'boolean') return undefined
    if (!Array.isArray(value.skillsChanged) || !value.skillsChanged.every(item => typeof item === 'string')) return undefined
    if (!Array.isArray(value.unresolved) || !value.unresolved.every(item => typeof item === 'string')) return undefined
    return { summary: value.summary, memoryChanged: value.memoryChanged, skillsChanged: value.skillsChanged, unresolved: value.unresolved }
  } catch { return undefined }
}


function parseWaitRequest(raw: string): { resource?: string; timeoutMs: number } {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed !== null && typeof parsed === 'object') {
      const value = parsed as { resource?: unknown; timeoutMs?: unknown }
      const timeoutMs = typeof value.timeoutMs === 'number' && Number.isFinite(value.timeoutMs) ? Math.max(1, Math.min(value.timeoutMs, 60_000)) : 1_000
      return { ...(typeof value.resource === 'string' ? { resource: value.resource } : {}), timeoutMs }
    }
  } catch { /* fall through to the bounded default */ }
  return { timeoutMs: 1_000 }
}

async function waitForReview(timeoutMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new Error('review_wait aborted')
  await new Promise<void>(resolve => setTimeout(resolve, timeoutMs))
  signal.throwIfAborted()
}

function writeResource(call: ToolCallBlock): string | undefined {
  if (call.name !== 'skill_manage' && call.name !== 'memory') return undefined
  try {
    const parsed: unknown = JSON.parse(call.arguments)
    if (parsed !== null && typeof parsed === 'object') {
      const value = parsed as { name?: unknown; target?: unknown }
      const name = typeof value.name === 'string' ? value.name : undefined
      const target = typeof value.target === 'string' ? value.target : undefined
      if (call.name === 'skill_manage') return 'skill:' + (name ?? '<unnamed>')
      return 'memory:' + (target ?? 'default')
    }
  } catch { /* malformed args are the tool's problem */ }
  return call.name === 'skill_manage' ? 'skill:<unnamed>' : 'memory:default'
}

export class ReviewModelError extends Error {
  constructor(message: string, readonly code: 'timeout' | 'cancelled' | 'transport') { super(message); this.name = 'ReviewModelError' }
}

async function* streamReviewModel(llm: ReviewLlmPort, options: GenerateOptions, signal: AbortSignal): AsyncIterable<StreamChunk> {
  try { yield* llm.stream(options) } catch (error) {
    const code = signal.aborted ? 'cancelled' : (error as { name?: unknown }).name === 'TimeoutError' ? 'timeout' : 'transport'
    throw new ReviewModelError(error instanceof Error ? error.message : String(error), code)
  }
}

export class ReviewPartialFailure extends Error {
  constructor(message: string, readonly actions: readonly ReviewAction[] = []) { super(message); this.name = 'ReviewPartialFailure' }
}

export interface ReviewAction {
  readonly type: 'tool' | 'skill' | 'memory'
  readonly action: string
  readonly target: string
  readonly status: 'ok' | 'staged' | 'error'
  readonly errorKind?: 'stale' | 'busy' | 'unobserved' | 'ambiguous' | 'not-found' | undefined
}

export interface ReviewUsage {
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly cacheReadTokens?: number
}

export interface ReviewExecutionResult {
  readonly finalText: string
  readonly actions: readonly ReviewAction[]
  readonly usage?: ReviewUsage
  readonly requests: number
  readonly toolCalls: number
  readonly waitCount: number
  readonly done: boolean
  readonly hitRoundLimit: boolean
  readonly report?: ReviewReport
  readonly partialReason?: string
}


export interface RunReviewInput {
  readonly parent: ReviewParent
  readonly llm: ReviewLlmPort
  readonly tools: ReviewToolPort
  /** Optional native/PTC transport; when present it owns visible tools and execution. */
  readonly channel?: ReviewToolChannel
  /** Optional process-local write lock registry for recoverable resource-busy results. */
  readonly writeLocks?: ReviewWriteLocks
  readonly owner?: string
  readonly instruction: string
  readonly toolAllow: ReadonlySet<string>
  readonly signal: AbortSignal
  readonly maxRounds?: number
  readonly maxToolCalls?: number
  readonly markReview: () => void
  readonly clearReview: () => void
}

function toolTarget(name: string, raw: string): string {
  if (raw === '') return name
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed !== null && typeof parsed === 'object' && 'name' in parsed) {
      const value = (parsed as { readonly name?: unknown }).name
      if (typeof value === 'string') return value
    }
  } catch {
    // Malformed model arguments are the tool's problem; the action still records the tool name.
  }
  return name
}

function actionType(name: string): ReviewAction['type'] {
  if (name === 'memory') return 'memory'
  if (name === 'skill_manage') return 'skill'
  return 'tool'
}

/**
 * Execute one review in the parent's request prefix without creating a child.
 *
 * @param input - parent view, LLM/tool ports, allowlist, cancellation, and review mark hooks.
 * @returns final text, action ledger, usage, and request/tool counts.
 * @throws ReviewToolNotAllowedError when the model requests a tool outside the parent-visible allowlist.
 * @throws Error when the parent Session grows during review or the model returns no header.
 */
export async function runReview(input: RunReviewInput): Promise<ReviewExecutionResult> {
  const { parent, llm, tools, instruction, toolAllow, signal, markReview, clearReview } = input
  if (parent.status !== 'idle') throw new Error('review requires an idle parent')
  const header = parent.session.requestHeader()
  if (header === undefined) throw new Error('review requires the parent request header')
  const beforeSeq = parent.session.seq
  // PTC keeps the parent's full tool catalog; replaying its tool history keeps
  // the request prefix byte-identical to the parent for provider prefix caching.
  // Native adds synthetic completion tools, so its catalog intentionally differs.
  const toolHistory = input.channel?.mode === 'ptc' ? parent.session.toolHistory?.() : undefined
  const messages: RequestMessage[] = [
    ...parent.session.deriveMessages(),
    createUserMessage({
      content: [{ type: 'text', text: instruction }],
      source: { kind: 'evolution-review' },
    }),
  ]
  const maxRounds = input.maxRounds ?? 4
  const maxToolCalls = input.maxToolCalls ?? 50
  const actions: ReviewAction[] = []
  let finalText = ''
  let usage: ReviewUsage | undefined
  let requests = 0
  let toolCalls = 0
  let done = false
  let hitRoundLimit = false
  let partialReason: string | undefined
  let report: ReviewReport | undefined
  let waitCount = 0
  markReview()
  try {
    for (let round = 0; round < maxRounds; round += 1) {
      signal.throwIfAborted()
      const assembler = new BlockAssembler()
      const stream = streamReviewModel(llm, {
        provider: header.config.provider,
        model: header.config.model,
        ...(header.config.reasoningEffort === undefined ? {} : { reasoningEffort: header.config.reasoningEffort }),
        ...(header.config.temperature === undefined ? {} : { temperature: header.config.temperature }),
        ...(header.config.maxTokens === undefined ? {} : { maxTokens: header.config.maxTokens }),
        messages,
        tools: [
          ...(input.channel?.visibleTools ?? header.tools ?? []),
          ...(input.channel?.mode === 'ptc' ? [] : [REVIEW_WAIT_TOOL, REVIEW_DONE_TOOL]),
        ] as ToolSchema[],
        ...(toolHistory === undefined ? {} : { toolHistory }),
        signal,
      }, signal)
      requests += 1
      for await (const chunk of stream) {
        assembler.push(chunk)
        if (chunk.type === 'usage') {
          usage = {
            inputTokens: chunk.usage.inputTokens,
            outputTokens: chunk.usage.outputTokens,
            ...(chunk.usage.cacheReadTokens === undefined ? {} : { cacheReadTokens: chunk.usage.cacheReadTokens }),
          }
        }
      }
      signal.throwIfAborted()
      const assistant = assembler.message({ provider: header.config.provider, model: header.config.model })
      const text = assistant.content.filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
        .map(block => block.text).join('')
      if (text !== '') finalText = text
      const calls = assistant.content.filter((block): block is ToolCallBlock => block.type === 'tool-call')
      if (calls.length === 0) break
      const waitCalls = input.channel?.mode === 'ptc' ? [] : calls.filter(call => call.name === REVIEW_WAIT_TOOL_NAME)
      if (waitCalls.length > 0) {
        if (calls.length !== 1) { partialReason = 'review_wait must be the only tool call in its batch'; break }
        toolCalls += 1
        waitCount += 1
        const parsed = parseWaitRequest(waitCalls[0]!.arguments)
        const released = parsed.resource !== undefined && input.writeLocks !== undefined
          ? await input.writeLocks.wait(parsed.resource, parsed.timeoutMs, signal)
          : await waitForReview(parsed.timeoutMs, signal)
        actions.push({ type: 'tool', action: REVIEW_WAIT_TOOL_NAME, target: parsed.resource ?? 'resource', status: released === false ? 'error' : 'ok' })
        messages.push(assistant)
        messages.push(createToolResultMessage({ callId: waitCalls[0]!.id, content: [{ type: 'text', text: released === false ? 'review_wait timed out' : 'review_wait released' }], isError: released === false }))
        if (released === false) { partialReason = 'lock-wait-exhausted'; break }
        if (toolCalls >= maxToolCalls) { partialReason = 'max tool calls reached before review_done'; break }
        continue
      }
      const doneCalls = input.channel?.mode === 'ptc' ? [] : calls.filter(call => call.name === REVIEW_DONE_TOOL_NAME)
      if (doneCalls.length > 0) {
        toolCalls += calls.length
        if (calls.length !== 1) {
          partialReason = 'review_done must be the only tool call in its batch'
          break
        }
        const parsed = parseReviewReport(doneCalls[0]!.arguments)
        if (parsed === undefined) {
          partialReason = 'review_done report is invalid'
          break
        }
        report = parsed
        done = true
        actions.push({ type: 'tool', action: REVIEW_DONE_TOOL_NAME, target: 'review', status: 'ok' })
        break
      }
      messages.push(assistant)
      const allowedNames = input.channel === undefined ? toolAllow : new Set(input.channel.visibleTools.map(tool => tool.name))
      const allowedCalls = calls.filter(call => allowedNames.has(call.name))
      const releases: (() => void)[] = []
      const held = new Set<string>()
      const busy = new Map<string, string>()
      const runnable: ToolCallBlock[] = []
      for (const call of allowedCalls) {
        const resource = writeResource(call)
        if (resource === undefined || input.writeLocks === undefined) { runnable.push(call); continue }
        if (held.has(resource)) { runnable.push(call); continue }
        const release = input.writeLocks.tryAcquire(resource, input.owner ?? 'review')
        if (release === undefined) { busy.set(call.id, resource); continue }
        held.add(resource)
        releases.push(release)
        runnable.push(call)
      }
      let batch: { results: readonly ReviewToolOutcome[] }
      try {
        batch = runnable.length === 0
          ? { results: [] as ReviewToolOutcome[] }
          : input.channel === undefined
            ? await tools.execute({ calls: runnable, signal, agent: parent })
            : await input.channel.execute(runnable, signal)
      } finally {
        for (const release of releases) release()
      }
      const channelCompletion = input.channel?.completion?.()
      if (channelCompletion?.done === true && channelCompletion.report !== undefined) {
        report = channelCompletion.report
        done = true
        toolCalls += calls.length
        if (channelCompletion.waitCount !== undefined) waitCount = channelCompletion.waitCount
        actions.push({ type: 'tool', action: REVIEW_DONE_TOOL_NAME, target: 'review', status: 'ok' })
        break
      }
      const byCall = new Map(batch.results.map(item => [item.callId, item]))
      const allowedLabel = [...allowedNames].sort().join(', ')
      for (const call of calls) {
        const item = byCall.get(call.id)
        const busyResource = busy.get(call.id)
        if (busyResource !== undefined) {
          actions.push({ type: actionType(call.name), action: call.name, target: toolTarget(call.name, call.arguments), status: 'error', errorKind: 'busy' })
          messages.push(createToolResultMessage({
            callId: call.id,
            content: [{ type: 'text', text: 'resource-busy: ' + busyResource + '; call review_wait, then re-read the target and retry' }] as ContentBlock[],
            isError: true,
          }))
          continue
        }
        if (item === undefined) {
          if (allowedNames.has(call.name)) throw new Error('review tool result has no matching call')
          actions.push({
            type: actionType(call.name),
            action: call.name,
            target: toolTarget(call.name, call.arguments),
            status: 'error',
          })
          messages.push(createToolResultMessage({
            callId: call.id,
            content: [{ type: 'text', text: `review tool not allowed: ${call.name}; PTC is unavailable in auxiliary review. Use these parent-visible tools directly: ${allowedLabel}` }] as ContentBlock[],
            isError: true,
          }))
          continue
        }
        const errorText = item.result.isError ? item.result.content.map(block => block.type === 'text' ? block.text : '').join('\n') : ''
        const errorKind = item.result.isError ? skillErrorKind(errorText) : undefined
        actions.push({
          type: actionType(call.name),
          action: call.name,
          target: toolTarget(call.name, call.arguments),
          status: item.result.isError ? 'error' : item.result.content.some(block => block.type === 'text' && /staged id:|已暂存|pending_id/.test(block.text)) ? 'staged' : 'ok',
          ...(errorKind === undefined ? {} : { errorKind }),
        })
        if (call.name === 'skill' && item.result.isError !== true) {
          try {
            const parsed: unknown = JSON.parse(call.arguments)
            if (parsed !== null && typeof parsed === 'object' && typeof (parsed as { name?: unknown }).name === 'string') {
              recordReviewRead((parsed as { name: string }).name)
            }
          } catch {
            // Malformed args are the tool's problem; no read evidence is inferred.
          }
        }
        messages.push(createToolResultMessage({
          callId: item.callId,
          content: item.result.content,
          isError: item.result.isError,
        }))
      }
      toolCalls += calls.length
      if (toolCalls >= maxToolCalls) { partialReason = 'max tool calls reached before review_done'; break }
      if (round === maxRounds - 1) hitRoundLimit = true
      if (parent.session.seq !== beforeSeq) throw new ReviewPartialFailure('review tool mutated the parent Session', actions)
    }
  } finally {
    clearReview()
  }
  if (parent.session.seq !== beforeSeq) throw new ReviewPartialFailure('review mutated the parent Session', actions)
  if (!done && partialReason === undefined) partialReason = 'missing review_done'
  if (hitRoundLimit) partialReason = 'max review rounds reached before review_done'
  return {
    finalText,
    actions,
    ...(usage === undefined ? {} : { usage }),
    requests,
    toolCalls,
    done,
    hitRoundLimit,
    waitCount,
    ...(report === undefined ? {} : { report }),
    ...(partialReason === undefined ? {} : { partialReason }),
  }
}
