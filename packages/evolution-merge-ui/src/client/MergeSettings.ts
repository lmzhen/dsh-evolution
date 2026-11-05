/** The merge settings summary: two read-only state chips and one settings path. */
import { createElement, type ReactNode } from 'react'
import type { MergeViewPayload } from './api.ts'

type Translate = (key: string, values?: Readonly<Record<string, string | number>>) => string

function SettingChip({ section, label, value, disabled, missing, t }: { section: string; label: string; value: boolean | undefined; disabled: boolean; missing: boolean; t: Translate }): ReactNode {
  const text = missing ? t('settings.capabilityMissing') : disabled ? t('settings.capabilityDisabled') : value === true ? t('settings.on') : t('settings.off')
  const state = missing ? 'missing' : disabled ? 'unavailable' : value === true ? 'on' : 'off'
  return createElement('span', { 'data-role': 'settings-section', 'data-section': section, 'data-disabled': missing || disabled ? 'true' : 'false', 'data-state': state },
    createElement('span', { 'data-role': 'settings-label' }, label),
    createElement('span', { 'data-role': 'settings-value', 'data-value': state }, text),
  )
}

/**
 * Render the read-only approval state without the old large settings card.
 * @param props - the merge view and translator.
 * @returns two chips and the one current settings path.
 */
export function MergeSettings({ view, t }: { view: MergeViewPayload; t: Translate }): ReactNode {
  const platform = view.approval.platformWrite
  const platformCapability = platform?.capability === true
  const platformFallback = platform?.enabled ?? false
  return createElement('div', { 'data-role': 'settings-card' },
    createElement('h3', { 'data-role': 'settings-title' }, t('settings.title')),
    createElement('p', { 'data-role': 'settings-path' }, t('settings.openPlatformPath')),
    createElement('div', { 'data-role': 'settings-chips' },
      createElement(SettingChip, { section: 'merge-approval', label: t('settings.mergeApproval'), value: view.approval.mergeApproval, disabled: false, missing: false, t }),
      createElement(SettingChip, { section: 'platform-write', label: t('settings.platformWrite'), value: platformFallback, disabled: platformCapability === false, missing: platform === undefined, t }),
    ),
  )
}
