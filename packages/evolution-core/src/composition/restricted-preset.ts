// Build one restricted preset DEFINITION by cloning the live parent preset rows and appending the
// single restrictor row. The parent rows are read through agentPresets.readDocument (the Loader's
// own YAML dialect), so the child keeps every base row the parent had.
import * as yaml from 'js-yaml'

// The Loader's entry-list YAML dialect: `JSON_SCHEMA` plus one `!!js` scalar tag whose node keeps
// the source text for activation-time evaluation. It is DEFINED here rather than imported from the
// platform's include package: the family library has to load in a tree where only the family libs
// are built (the CI overlay runs the family tests against platform sources without building the
// platform), and the two definitions must round-trip the same documents. The shape (JSON_SCHEMA
// extended with the js tag, node `{ __jsExpr }`) is pinned by the parent document the registry
// hands back and by its golden tests.
const JsExpr = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: (data: string) => typeof data === 'string',
  construct: (data: string) => ({ __jsExpr: data }),
  represent: (data) => (data as { __jsExpr: string }).__jsExpr,
})
export const entryListSchema = yaml.JSON_SCHEMA.extend(JsExpr)
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
  const parsed = yaml.load(content, { schema: entryListSchema })
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
