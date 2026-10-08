/**
 * G5: the platform's own view of the RUNNING profile, read through the services the platform
 * mounts — `pluginManager` (bundles, plugin rows), `configEditor` (inherited vs override) and
 * `pluginInventory` (live rows, agent presets).
 *
 * Read structurally on purpose: the family declares no dependency edge into the platform's
 * management packages, because a plane that does not mount them must render a named line, not
 * fail to load. Every reader answers `undefined` for an absent surface; the caller says what
 * that means, and no caller may re-derive the same facts by scanning the profile off disk — one
 * fact has one home.
 * @module @deepseek-ai/dsh-evolution-commands/platform-view
 */

/** One installed bundle as the platform reports it (the fields the doctor reads). */
export interface PlatformBundle {
  /** Package name. */
  readonly name: string
  /** Selected in the profile manifest; a load error means its layer was skipped. */
  readonly enabled: boolean
  /** Held by the profile's own dependencies (false = supplied by the installation). */
  readonly installed: boolean
  /** Shipped for the person to switch on. */
  readonly optional: boolean
  readonly removable: boolean
  /** Why a profile control cannot modify it, when it cannot. */
  readonly readOnlyReason?: string
  /** A management failure; `code` is the platform's own discriminant. */
  readonly error?: { readonly code?: string; readonly diagnostic?: string }
  /** The rows the bundle's patch inserts. */
  readonly rows: readonly { readonly rowId: string; readonly moduleName: string }[]
  /** Ids of rows the bundle's patch changes without declaring them. */
  readonly overrides: readonly string[]
}

/** One live Loader entry as the platform reports it. */
export interface PlatformPlugin {
  /** The Loader entry id. */
  readonly entryId: string
  /** The row id the entry carries, when the platform resolved one. */
  readonly moduleName?: string
  readonly enabled: boolean
  /** The fiber's lifecycle phase, as the platform names it. */
  readonly fiberPhase?: string
}

/** One agent preset as the platform reports it. */
export interface PlatformPreset {
  readonly id: string
  readonly name?: string
  readonly isDefault?: boolean
  /** The platform's own verdict on a preset it could not compose; absent when it is healthy. */
  readonly broken?: string
  /** Composition rows; `entryId` is null for a row that declares none. `enabled` includes
   * disabled ancestor groups, so a row the platform ships switched off is visible as such. */
  readonly rows: readonly {
    readonly entryId: string | null
    readonly moduleName?: string
    readonly enabled?: boolean | 'conditional'
  }[]
}

/** One managed entry's two layers, as `configEditor.configuration()` reports them. */
export interface PlatformConfiguration {
  /** The Loader entry the layers belong to (the platform hands over the entry itself). */
  readonly entry: { readonly options?: { readonly id?: string; readonly name?: string } }
  /** The value the inherited layers (bundle, preset) resolve to. */
  readonly inherited: unknown
  /** The user's override, when the profile patch sets one. */
  readonly override: unknown
}

/** What the running profile looks like through the platform's surfaces. */
export interface PlatformView {
  /** `pluginManager.listBundles()`; undefined when that service is not mounted. */
  readonly bundles: readonly PlatformBundle[] | undefined
  /** `pluginManager.listPlugins()`, or the inventory's own entry list; undefined when neither. */
  readonly plugins: readonly PlatformPlugin[] | undefined
  /** `configEditor.configuration()`; undefined when that service is not mounted. */
  readonly configuration: readonly PlatformConfiguration[] | undefined
  /** The inventory's agent presets; undefined outside a Web composition (that row is a Web-app one). */
  readonly presets: readonly PlatformPreset[] | undefined
}

/** The members this module calls; a missing method is a missing surface, never a guess. */
interface ManagerLike {
  listBundles?(): unknown
  listPlugins?(): unknown
}

/** The optional inventory row's service (Web compositions only). */
interface InventoryLike {
  list?(): unknown
}

/** The config editor's read of every managed entry. */
interface EditorLike {
  configuration?(): unknown
}

/** What `pluginInventory.list()` answers: the live entries and the presets they compose. */
interface InventorySnapshot {
  readonly entries?: readonly PlatformPlugin[]
  readonly agentPresets?: readonly PlatformPreset[]
}

/**
 * Call one surface, awaiting it, and require an array back.
 * @param read - the call, or undefined when the member is absent.
 * @returns the array, or undefined when the member is absent, threw, or answered something else.
 */
async function arrayOf<T>(read: (() => unknown) | undefined): Promise<readonly T[] | undefined> {
  if (read === undefined) return undefined
  try {
    const value = await read()
    return Array.isArray(value) ? value as readonly T[] : undefined
  } catch {
    // A surface that throws is an absent surface: the caller renders the named line, and this
    // module stays the one place that decides what "the platform did not answer" means.
    return undefined
  }
}

/**
 * Call one surface, awaiting it, and require an object back (the inventory answers one).
 * @param read - the call, or undefined when the member is absent.
 * @returns the object, or undefined when the member is absent, threw, or answered an array.
 */
async function objectOf<T>(read: (() => unknown) | undefined): Promise<T | undefined> {
  if (read === undefined) return undefined
  try {
    const value = await read()
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as T : undefined
  } catch {
    return undefined
  }
}

/**
 * Read every platform surface the doctor uses.
 * @param ctx - the context (services), read structurally.
 * @returns the view; each member is undefined when its surface is not mounted or did not answer.
 */
export async function readPlatformView(ctx: { get(name: string): unknown }): Promise<PlatformView> {
  const manager = ctx.get('pluginManager') as ManagerLike | undefined
  const editor = ctx.get('configEditor') as EditorLike | undefined
  const inventory = ctx.get('pluginInventory') as InventoryLike | undefined
  const listed = await objectOf<InventorySnapshot>(inventory?.list === undefined ? undefined : () => inventory.list?.())
  const plugins = await arrayOf<PlatformPlugin>(manager?.listPlugins === undefined ? undefined : () => manager.listPlugins?.())
  return {
    bundles: await arrayOf<PlatformBundle>(manager?.listBundles === undefined ? undefined : () => manager.listBundles?.()),
    // `listPlugins()` (base) and the inventory's entries (Web app) are the same platform fact;
    // the base surface wins, and a plane with only the inventory still reports live rows.
    plugins: plugins ?? listed?.entries,
    configuration: await arrayOf<PlatformConfiguration>(editor?.configuration === undefined ? undefined : () => editor.configuration?.()),
    presets: listed?.agentPresets,
  }
}
