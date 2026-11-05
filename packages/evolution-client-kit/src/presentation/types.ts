/** Shared read-only presentation types; no business state or data loading. */
import type { ReactNode } from 'react'

/** Semantic tone shared by chips and empty states. */
export type PresentationTone = 'neutral' | 'ok' | 'warn' | 'error' | 'quiet'

/** One user action rendered by DecisionFrame/EmptyState. */
export interface PresentationAction {
  readonly id: string
  readonly label: string
  readonly onSelect: () => void | Promise<void>
  readonly disabled?: boolean | undefined
  readonly busy?: boolean | undefined
  readonly title?: string | undefined
  /** Optional data-* attributes a decision needs (for example the confirmation marker). */
  readonly attributes?: Readonly<Record<string, string>> | undefined
}

/** One field a reader needs before deciding. */
export interface DecisionFact {
  readonly label: string
  readonly value: string
}

/** The only decision-card contract: singular primary, optional secondary and details. */
export interface DecisionModel {
  readonly title: string
  readonly summary?: string | undefined
  readonly facts: readonly DecisionFact[]
  readonly primary?: PresentationAction | undefined
  readonly secondary?: readonly PresentationAction[] | undefined
  readonly details?: ReactNode
}
