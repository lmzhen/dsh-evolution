/**
 * Command-only actions. Approval decisions are a separate host API and must never
 * be represented as a copyable command here.
 * @module @deepseek-ai/dsh-evolution-client-kit
 */
import { createElement, useState } from 'react'
import type { ReactNode } from 'react'

/** One user-facing action whose effect is copying an exact command. */
export interface ActionRef {
  readonly id: string
  readonly label: string
  readonly command: string
  /** False renders the action disabled with no clipboard attempt. */
  readonly enabled?: boolean
  /** Optional in-UI confirmation before the write; the callback owns the dialog. */
  readonly confirm?: (action: ActionRef) => boolean
}

/** User-facing copy states; `copied` is set only after the clipboard accepted the text. */
export type CopyStatus = 'idle' | 'copying' | 'copied' | 'failed'

/** Labels the host surface supplies in its own language. */
export interface CommandCopyLabels {
  readonly copy: string
  readonly copying: string
  readonly copied: string
  readonly failed: string
}

/** Props for the shared copy control. */
export interface CommandCopyButtonProps {
  readonly action: ActionRef
  readonly writeClipboard: (text: string) => Promise<boolean>
  readonly labels: CommandCopyLabels
  readonly className?: string | undefined
}

/**
 * Copy one command and report the host verdict.
 * @param action - the command action.
 * @param writeClipboard - platform clipboard writer.
 * @param confirm - optional in-UI confirmation.
 * @returns the settled copy status.
 */
export async function copyAction(
  action: ActionRef,
  writeClipboard: (text: string) => Promise<boolean>,
  confirm?: (action: ActionRef) => boolean,
): Promise<CopyStatus> {
  if (action.enabled === false) return 'idle'
  if (confirm !== undefined && !confirm(action)) return 'idle'
  if (action.confirm !== undefined && !action.confirm(action)) return 'idle'
  try {
    return await writeClipboard(action.command) ? 'copied' : 'failed'
  } catch {
    return 'failed'
  }
}

/**
 * Render one command-copy action with real success/failure feedback.
 * @param props - action, clipboard writer, and localized labels.
 * @returns the button and its status line.
 */
export function CommandCopyButton({ action, writeClipboard, labels, className }: CommandCopyButtonProps): ReactNode {
  const [status, setStatus] = useState<CopyStatus>('idle')
  const text = status === 'copying' ? labels.copying : status === 'copied' ? labels.copied : status === 'failed' ? labels.failed : labels.copy
  return createElement('span', { className },
    createElement('button', {
      type: 'button',
      disabled: action.enabled === false || status === 'copying',
      'aria-label': action.label,
      onClick: () => {
        setStatus('copying')
        void copyAction(action, writeClipboard).then(setStatus)
      },
    }, action.label),
    createElement('span', { role: 'status', 'aria-live': 'polite' }, text === labels.copy ? '' : text),
  )
}
