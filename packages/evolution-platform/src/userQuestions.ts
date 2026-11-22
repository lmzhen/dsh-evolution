/**
 * The human-question implementation half of the family's platform boundary.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { AskedQuestions, UserQuestionsPort } from './contract/index.ts'

export type { AskedQuestions, UserQuestion, UserQuestionOption, UserQuestionsPort } from './contract/index.ts'

interface UserQuestionsServiceLike {
  ask(request: unknown): Promise<AskedQuestions>
}

/** Resolve the user-questions port; undefined means the host has no such service. */
export function userQuestionsPort(ctx: Context): UserQuestionsPort | undefined {
  // platform-declaration anchor: userQuestions is declared in core PLATFORM_SERVICE_PROBES.
  const service = ctx.get('userQuestions') as UserQuestionsServiceLike | undefined
  if (service === undefined || typeof service.ask !== 'function') return undefined
  return { ask: (request) => service.ask(request) }
}
