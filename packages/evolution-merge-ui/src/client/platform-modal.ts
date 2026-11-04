/** Platform Modal reached through the rc.3 client module table. */
import type { ReactNode } from 'react'

declare function require(id: string): unknown

export interface PlatformModalProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly title: string
  readonly closeLabel: string
  readonly children?: ReactNode
  readonly headless?: boolean
  readonly className?: string
}

export type PlatformModalComponent = (props: PlatformModalProps) => ReactNode

const PLATFORM_UI_MODULE = '@deepseek-ai/dsh-client-ui-primitives'
let cached: PlatformModalComponent | null | undefined

/** The platform Modal, or undefined in a non-browser/SSR render or a deployment without the row. */
export function platformModal(): PlatformModalComponent | undefined {
  if (cached !== undefined) return cached ?? undefined
  if (typeof window === 'undefined') { cached = null; return undefined }
  try {
    const row = require(PLATFORM_UI_MODULE) as { Modal?: unknown }
    cached = typeof row.Modal === 'function' ? row.Modal as PlatformModalComponent : null
  } catch { cached = null }
  return cached ?? undefined
}
