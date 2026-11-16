/**
 * The ONE door to the platform's client primitive module row.
 *
 * Browser bundles keep `@deepseek-ai/dsh-client-ui-primitives` external and the
 * loader's `require` is the only way to reach it. Every family panel asks this
 * module, so a platform row rename is one change instead of one per panel.
 */
export const PLATFORM_UI_MODULE = '@deepseek-ai/dsh-client-ui-primitives'

declare function require(id: string): unknown

/** The module row, or undefined in a deployment that does not compose it. */
export function platformUiModule(): Record<string, unknown> | undefined {
  try {
    const row = require(PLATFORM_UI_MODULE)
    return typeof row === 'object' && row !== null ? row as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}
