import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock, ToolCallId } from '@deepseek-ai/dsh-llm'

/** Call one tool through the batch seam, falling back to the legacy single-call seam. */
export async function executeTool(
  ctx: Context,
  agent: unknown,
  callId: ToolCallId,
  name: string,
  argumentsText: string,
  signal: AbortSignal,
): Promise<{ content?: ContentBlock[]; isError?: boolean }> {
  const tools = ctx.get('tools') as { execute(input: unknown): Promise<unknown> } | undefined
  if (tools === undefined) throw new Error('tools service is not mounted')
  try {
    const batch = await tools.execute({
      calls: [{ type: 'tool-call', id: callId, name, arguments: argumentsText }],
      signal,
      agent,
    }) as { results?: readonly { result?: { content?: ContentBlock[]; isError?: boolean } }[] }
    const result = batch.results?.[0]?.result
    if (result !== undefined) return result
  } catch {
    // Legacy test lines expose the single-call seam; the production target uses the batch seam above.
  }
  return await tools.execute({
    callId,
    name,
    arguments: JSON.parse(argumentsText),
    agent,
    signal,
  }) as { content?: ContentBlock[]; isError?: boolean }
}
