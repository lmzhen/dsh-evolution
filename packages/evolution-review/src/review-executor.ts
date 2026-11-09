/**
 * Plugin-side review execution over the parent request prefix.
 *
 * This module deliberately has no AgentLoop child: it replays the parent
 * messages/tools, runs a bounded tool loop, and keeps every intermediate
 * message in memory. The caller owns ReviewRun persistence and audit.
 *
 * @module @deepseek-ai/dsh-evolution-review/review-executor
 */
import {
  BlockAssembler,
  createToolResultMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-evolution-core/platform'
import type {
  ContentBlock,
  ContextFormed,
  GenerateOptions,
  Message,
  RequestMessage,
  StreamChunk,
  ToolCallBlock,
  ToolCallId,
  ToolHistory,
  ToolSchema,
} from '@deepseek-ai/dsh-evolution-core/platform'
import type { EpochHeader, SessionId } from '@deepseek-ai/dsh-evolution-core/platform'

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
    toolHistory(): ToolHistory | undefined
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

export interface ReviewAction {
  readonly type: 'tool' | 'skill' | 'memory'
  readonly action: string
  readonly target: string
  readonly status: 'ok' | 'error'
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
}


export interface RunReviewInput {
  readonly parent: ReviewParent
  readonly llm: ReviewLlmPort
  readonly tools: ReviewToolPort
  readonly instruction: string
  readonly toolAllow: ReadonlySet<string>
  readonly signal: AbortSignal
  readonly maxRounds?: number
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
  const messages: RequestMessage[] = [
    ...parent.session.deriveMessages(),
    createUserMessage({
      content: [{ type: 'text', text: instruction }],
      source: { kind: 'evolution-review' },
    }),
  ]
  const toolHistory = parent.session.toolHistory()
  const maxRounds = input.maxRounds ?? 4
  const actions: ReviewAction[] = []
  let finalText = ''
  let usage: ReviewUsage | undefined
  let requests = 0
  let toolCalls = 0
  markReview()
  try {
    for (let round = 0; round < maxRounds; round += 1) {
      signal.throwIfAborted()
      const assembler = new BlockAssembler()
      const stream = llm.stream({
        provider: header.config.provider,
        model: header.config.model,
        ...(header.config.reasoningEffort === undefined ? {} : { reasoningEffort: header.config.reasoningEffort }),
        ...(header.config.temperature === undefined ? {} : { temperature: header.config.temperature }),
        ...(header.config.maxTokens === undefined ? {} : { maxTokens: header.config.maxTokens }),
        messages,
        ...(header.tools === undefined ? {} : { tools: [...header.tools] as ToolSchema[] }),
        ...(toolHistory === undefined ? {} : { toolHistory }),
        signal,
      })
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
      messages.push(assistant)
      const allowedCalls = calls.filter(call => toolAllow.has(call.name))
      const batch = allowedCalls.length === 0 ? { results: [] as ReviewToolOutcome[] } : await tools.execute({ calls: allowedCalls, signal, agent: parent })
      const byCall = new Map(batch.results.map(item => [item.callId, item]))
      const allowedNames = [...toolAllow].sort().join(', ')
      for (const call of calls) {
        const item = byCall.get(call.id)
        if (item === undefined) {
          if (toolAllow.has(call.name)) throw new Error('review tool result has no matching call')
          actions.push({
            type: actionType(call.name),
            action: call.name,
            target: toolTarget(call.name, call.arguments),
            status: 'error',
          })
          messages.push(createToolResultMessage({
            callId: call.id,
            content: [{ type: 'text', text: `review tool not allowed: ${call.name}; PTC is unavailable in auxiliary review. Use these parent-visible tools directly: ${allowedNames}` }] as ContentBlock[],
            isError: true,
          }))
          continue
        }
        actions.push({
          type: actionType(call.name),
          action: call.name,
          target: toolTarget(call.name, call.arguments),
          status: item.result.isError ? 'error' : 'ok',
        })
        messages.push(createToolResultMessage({
          callId: item.callId,
          content: item.result.content,
          isError: item.result.isError,
        }))
      }
      toolCalls += calls.length
      if (parent.session.seq !== beforeSeq) throw new Error('review tool mutated the parent Session')
    }
  } finally {
    clearReview()
  }
  if (parent.session.seq !== beforeSeq) throw new Error('review mutated the parent Session')
  return {
    finalText,
    actions,
    ...(usage === undefined ? {} : { usage }),
    requests,
    toolCalls,
  }
}
