/** Platform SegmentedTabs reached through the rc.3 client module table. */
import type { ReactNode } from 'react'
import { platformUiModule } from '@lmzhen/dsh-evolution-client-kit'

export interface SegmentedTabItem {
  readonly value: string
  readonly label: ReactNode
  readonly id: string
  readonly panelId: string
}

export type SegmentedTabsComponent = (props: {
  readonly items: readonly SegmentedTabItem[]
  readonly value: string
  readonly onChange: (value: string) => void
  readonly label: string
}) => ReactNode

let cached: SegmentedTabsComponent | null | undefined

/** The platform component, or undefined when this deployment has no module row. */
export function platformSegmentedTabs(): SegmentedTabsComponent | undefined {
  if (cached !== undefined) return cached ?? undefined
  try {
    const row = platformUiModule()
    cached = typeof row?.SegmentedTabs === 'function' ? row.SegmentedTabs as SegmentedTabsComponent : null
  } catch { cached = null }
  return cached ?? undefined
}
