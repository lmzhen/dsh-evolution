/** The read-only `params` surface: provider rows filtered by group, text or JSON. */
import type { HostLocale, SettingsProviderLike } from '@deepseek-ai/dsh-evolution-core'
import { PARAM_EXPOSURE } from '@deepseek-ai/dsh-evolution-core'
import type { CommandResult } from '@deepseek-ai/dsh-evolution-adapter/contract'
import { hostErrorText } from '../host-locale.ts'
import {
  paramGroups,
  paramSurfaceRows,
  renderParamJson,
  renderParamRows,
  type ParamSectionView,
} from '../params.ts'
import type { ParsedCommand } from '../parse.ts'

/** What the params handler needs. */
export interface ParamsCommandContext {
  readonly command: ParsedCommand
  readonly provider: SettingsProviderLike | undefined
  readonly locale: HostLocale
}

const ok = (text: string): CommandResult => ({ kind: 'success', text })
const err = (text: string): CommandResult => ({ kind: 'error', text })

/**
 * Render the parameter registry. Unreadable provider is a refusal, not an empty override set.
 * @param context - command, settings provider and locale.
 * @returns the rows/JSON, or the settings/group error.
 */
export function runParamsCommand(context: ParamsCommandContext): CommandResult {
  const { command, provider, locale } = context
  const sections = new Map<string, ParamSectionView>()
  if (provider?.describe !== undefined) {
    try {
      for (const descriptor of provider.describe({ redactSecrets: false })) {
        const section: ParamSectionView = {}
        if (descriptor.user !== undefined) section.user = descriptor.user
        const resolved = descriptor.value
        if (typeof resolved === 'object' && resolved !== null) section.value = resolved as Record<string, unknown>
        sections.set(descriptor.ns, section)
      }
    } catch (error) {
      return err(hostErrorText(locale, 'e-307-the-settings-service-could', { a1: error instanceof Error ? error.message : String(error) }))
    }
  }
  const rows = paramSurfaceRows(sections, PARAM_EXPOSURE)
  const groupFlag = command.flags.get('group')
  const group = typeof groupFlag === 'string' ? groupFlag : undefined
  const selected = group === undefined ? rows : rows.filter(row => row.group === group)
  if (group !== undefined && selected.length === 0) {
    return err(hostErrorText(locale, 'e-308-unknown-parameter-group-group', { a1: group, a2: paramGroups(PARAM_EXPOSURE).join(', ') }))
  }
  if (command.flags.get('json') === true) return ok(renderParamJson(selected))
  return ok(renderParamRows(selected, { providerMounted: provider !== undefined }))
}
