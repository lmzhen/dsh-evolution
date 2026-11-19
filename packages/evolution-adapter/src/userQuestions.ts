/**
 * The human-question half of the family's host platform boundary.
 *
 * `ask` is the only face the skill-write confirmation gate needs; the platform
 * owns live-root admission and delivery. The port returns the bare answer shape
 * so feature code does not import the user-questions package.
 */
import type { Context } from '@deepseek-ai/cordis'

export interface UserQuestionOption {
  readonly label: string
}

export interface UserQuestion {
  readonly id: string
  readonly header?: string
  readonly question: string
  readonly options?: readonly UserQuestionOption[]
}

export interface AskedQuestions {
  readonly answers: readonly {
    readonly id: string
    readonly selected: readonly string[]
  }[]
}

export interface UserQuestionsPort {
  ask(request: {
    readonly questions: readonly UserQuestion[]
    readonly agent?: unknown
    readonly signal?: AbortSignal
  }): Promise<AskedQuestions>
}

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
