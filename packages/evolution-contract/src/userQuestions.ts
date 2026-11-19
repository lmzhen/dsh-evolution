/**
 * The human-question half of the family's platform contract.
 */
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
