// Build one restricted preset DEFINITION by cloning the live parent preset rows and appending the
// single restrictor row. The parent rows are read through agentPresets.readDocument (the Loader's
// own YAML dialect), so the child keeps every base row the parent had.
import { load } from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import {
  RESTRICTED_PRESET_DISPLAY,
  RESTRICTED_TOOLS_ROW_ID,
  RESTRICTOR_MODULE,
  restrictedPresetId,
  normalizeAllow,
  type RestrictedPresetKind,
} from './preset-ids.ts'

export interface PresetDocumentLike {
  readonly agentPreset: string
  readonly content: string
}

export interface PresetRegistryLike {
  readDocument(agentPreset: string): Promise<PresetDocumentLike>
  register(definition: RestrictedPresetDefinition): Promise<() => Promise<void>>
}

export interface RestrictedPresetDefinition {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly order: number
  readonly plugins: readonly unknown[]
}

export interface RestrictedPresetRequest {
  readonly kind: RestrictedPresetKind
  readonly parentPresetId: string
  readonly allow: readonly string[]
}

export type RestrictedPresetState =
  | { readonly kind: 'ready'; readonly presetId: string; readonly parentPresetId: string; readonly allow: readonly string[] }
  | { readonly kind: 'failed'; readonly code: 'E-324'; readonly reason: string }


export function parsePresetRows(content: string): readonly unknown[] {
  const parsed = load(content, { schema: entryListSchema })
  if (!Array.isArray(parsed)) throw new Error('E-324: parent preset composition is not a top-level list')
  return parsed as readonly unknown[]
}

export function composeRestrictedPresetDefinition(
  source: PresetDocumentLike,
  req: RestrictedPresetRequest,
): RestrictedPresetDefinition {
  const allow = normalizeAllow(req.allow)
  if (allow.length === 0) throw new Error('E-324: restricted preset needs a non-empty allow set')
  const rows = parsePresetRows(source.content)
  const display = RESTRICTED_PRESET_DISPLAY[req.kind]
  const restrictorRow = { id: RESTRICTED_TOOLS_ROW_ID, name: RESTRICTOR_MODULE, config: { allow, presetId: restrictedPresetId(req.kind) } }
  return {
    id: restrictedPresetId(req.kind),
    name: display.name,
    description: display.description,
    order: display.order,
    plugins: [...rows, restrictorRow],
  }
}
