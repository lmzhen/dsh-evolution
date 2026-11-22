/**
 * The ONE door to the platform's client primitive module row.
 *
 * Browser bundles keep `@deepseek-ai/dsh-client-ui-primitives` external and the
 * loader's `require` is the only way to reach it. Every family panel asks this
 * module, so a platform row rename is one change instead of one per panel.
 */
export const PLATFORM_UI_MODULE = '@deepseek-ai/dsh-client-ui-primitives'

type ClientRequire = (id: string) => unknown

// The build wrapper declares this module-local binding before the bundled body; it is the loader's
// factory `require`, not a page global. `typeof` is safe when the source is imported directly in tests.
declare const __dshClientRequire: ClientRequire | undefined

/** The loader's factory require, scoped to this bundle. */
function clientRequire(): ClientRequire | undefined {
  return typeof __dshClientRequire === 'function' ? __dshClientRequire : undefined
}

/** The module row, or undefined in a deployment that does not compose it. */
export function platformUiModule(): Record<string, unknown> | undefined {
  try {
    const row = clientRequire()?.(PLATFORM_UI_MODULE)
    return typeof row === 'object' && row !== null ? row as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}
