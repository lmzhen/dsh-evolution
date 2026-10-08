/* WC (0.3.56): the N-5 escape reads through the single env module. */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { allowRowCollisions } from './env.ts'

/**
 * Build the user-root Evolution preset composition from the RUNTIME platform's
 * `standard` preset rows plus the evolution delta rows (P1-1 follow-up,
 * 0.3.15): the agent-preset registry mounts ONE composition file verbatim, so
 * a delta-only `agent.cordis.yml` would produce an agent carrying only the
 * delta rows.
 *
 * Same contract as `install-layered.mjs` `generateAgentPreset` (the source
 * install path) — installer.spec pins byte parity between the two, and both
 * apply the identical row-collision contract: a delta id that overlaps a
 * standard row id fails loud by default, and `DSH_EVOLUTION_ALLOW_ROW_COLLISIONS=1`
 * downgrades it to a warning that keeps both (the row mounts twice).
 *
 * V10-14 / 0.3.53 (P1-2): BOTH composers now inject the Hermes 60-char catalog
 * cap onto the standard-sourced `- id: tool-skill` row of the composed preset
 * (see injectCatalogDescriptionCap) — the session-visible tool-skill instance
 * mounts in the preset's own standing scope, where no profile-root patch can
 * reach it. 0.3.53 moved the injection INTO the composer so
 * `/evolution preset install` (the npm user's only preset path) gets it too;
 * install-layered applies the byte-identical rule, pinned by installer.spec.
 *
 * Row ids are read from `- id:` lines; an id present in both fragments would
 * mount twice and could shadow the platform row, so it fails loud.
 * @param standardComposition - the runtime `standard` preset composition.
 * @param deltaComposition - the evolution delta fragment.
 * @returns the composed preset composition (standard rows first, then delta).
 */
export function composePresetComposition(standardComposition: string, deltaComposition: string): string {
  const standardIds = compositionRowIds(standardComposition)
  const deltaIds = compositionRowIds(deltaComposition)
  const collisions = [...deltaIds].filter(id => standardIds.has(id)).sort()
  if (collisions.length > 0 && !allowRowCollisions()) {
    throw new Error(`evolution preset composition: delta rows collide with runtime standard rows: ${collisions.join(', ')}`)
  }
  if (collisions.length > 0) {
    console.warn(`evolution preset composition: warning — delta rows collide with standard rows (${collisions.join(', ')}); keeping both (DSH_EVOLUTION_ALLOW_ROW_COLLISIONS=1)`)
  }
  return applyRowOverrides(`${standardComposition.replace(/\s+$/, '')}\n\n${deltaComposition.trim()}\n`)
}

/**
 * V10-14 (P1-2), 0.3.53: inject the Hermes 60-char catalog cap onto the
 * standard-sourced `- id: tool-skill` row of a composed preset.
 *
 * The session-visible `tool-skill` instance mounts in the agent preset's own
 * standing scope; a profile-root patch (evolution-host/cordis.patch.yml)
 * cannot reach it, so without this injection the catalog's read side runs the
 * platform default (500). Text-level rewrite in the same line-scan style as
 * compositionRowIds (no YAML library):
 *   - idempotent: a tool-skill item that already carries a `config:` key is
 *     left byte-identical, so re-running the installer never doubles the key;
 *   - the injected block carries a marker comment so a diff of the generated
 *     preset can tell composer-owned text from platform text;
 *   - a composition WITHOUT a tool-skill row is returned unchanged with a
 *     one-time warning (a renamed platform row must not brick the install,
 *     but the missed cap must be observable).
 * The source installer reads the SAME table (`row-overrides.json`) through its
 * own `injectToolSkillCap`, so the two paths cannot diverge (0.3.77).
 */
/** One entry of the shared override table (see {@link loadRowOverrides}). */
interface RowOverride {
  /** Top-level row id this override targets (`- id: <row>`). */
  row: string
  /** The child key whose presence makes the override inert (idempotence). */
  key: string
  /** Rendered, already-indented YAML lines to ensure inside the row. */
  lines: string[]
  /** Warning tail shared by both consumers; each prefixes its own logger tag. */
  missingReason: string
}

/**
 * One table, two generation paths: `row-overrides.json` at the PACKAGE ROOT
 * states what a generated preset must carry beyond the platform composition,
 * and the source installer (`scripts/install-layered.mjs`) reads the same file.
 * The path resolves from both `src/` and the built `lib/`, which is why the
 * file sits at the root and ships in `files`.
 *
 * Before 0.3.77 each side carried its own hand-kept copy of this table; they
 * happened to stay byte-identical, which is exactly the kind of agreement no
 * test can keep — the entries are now data, and a divergence is impossible.
 */
const ROW_OVERRIDES_URL = new URL('../row-overrides.json', import.meta.url)
let cachedOverrides: RowOverride[] | undefined

/**
 * Read and validate the shared override table.
 * @returns the entries, in file order. A malformed table fails LOUD: a composer
 * that silently skipped an entry would ship a preset running the platform
 * default while nothing downstream reported it.
 */
export function loadRowOverrides(): RowOverride[] {
  if (cachedOverrides !== undefined) return cachedOverrides
  const parsed: unknown = JSON.parse(readFileSync(fileURLToPath(ROW_OVERRIDES_URL), 'utf8'))
  if (!Array.isArray(parsed)) {
    throw new Error('evolution-core: row-overrides.json must be an array of override entries')
  }
  const entries: RowOverride[] = []
  for (const [index, entry] of parsed.entries()) {
    const candidate = entry as Partial<RowOverride> | null
    if (candidate === null || typeof candidate !== 'object'
      || typeof candidate.row !== 'string' || candidate.row === ''
      || typeof candidate.key !== 'string' || candidate.key === ''
      || !Array.isArray(candidate.lines) || candidate.lines.some(line => typeof line !== 'string')
      || typeof candidate.missingReason !== 'string') {
      throw new Error(`evolution-core: row-overrides.json entry ${index} is malformed (row/key/lines/missingReason are required)`)
    }
    entries.push({ row: candidate.row, key: candidate.key, lines: candidate.lines, missingReason: candidate.missingReason })
  }
  cachedOverrides = entries
  return entries
}

/**
 * Ensure every {@link RowOverride} inside its target row.
 *
 * Key-level by construction: we INSERT the override's own lines and leave a row
 * that already carries the key byte-identical, so a re-run never doubles a key.
 * This is the deliberate opposite of the platform's patch layers, where an
 * override REPLACES `config` wholesale — the difference is why the composer can
 * add a key without erasing the platform's own config defaults.
 */
function applyRowOverrides(composition: string, overrides: RowOverride[] = loadRowOverrides()): string {
  let lines = composition.split('\n')
  for (const override of overrides) {
    lines = applyOneOverride(lines, override)
  }
  return lines.join('\n')
}

function applyOneOverride(lines: string[], override: RowOverride): string[] {
  const rowRe = new RegExp('^- id:\\s*' + override.row.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$')
  let found = false
  for (let i = 0; i < lines.length; i += 1) {
    if (!rowRe.test(lines[i] ?? '')) continue
    found = true
    // Walk the item's continuation lines (indented) up to the next item or
    // top-level line; a blank line terminates the item block.
    let end = i
    let hasConfig = false
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j] ?? ''
      if (next.trim() === '') break
      if (!/^\s/.test(next)) break
      // v22 (PRE-3): anchor `config:` to the ITEM's own child indent (exactly
      // two spaces — the `- id:` row sits at column 0). The old `\s+` form
      // matched a `config:` at ANY depth inside the item's sub-maps, so a
      // platform preset that grew a nested config map silently skipped the
      // cap injection with no diagnostic (the missed-cap warn fires only when
      // the ROW itself is absent).
      if (new RegExp('^ {2}' + override.key + ':(\\s|$)').test(next)) hasConfig = true
      end = j
    }
    if (hasConfig) continue
    lines.splice(end + 1, 0, ...override.lines)
    i = end + override.lines.length
  }
  if (!found) console.warn('evolution preset composition: warning — ' + override.missingReason)
  return lines
}

/**
 * Row ids of a composition fragment (line scan, no YAML library).
 *
 * PLAN S5.9 (2026-09-16, audit P2-27): the id extraction accepts INDENTED
 * `- id:` rows too, so a collision hidden in a nested group is still caught —
 * the old `^- id:` anchored at column 0 and was blind to exactly the rows an
 * upstream group nesting would produce. Twin of `rowIds` in
 * `scripts/install-layered.mjs` (installer.spec pins detection parity).
 * Boundary (current, deliberate): DETECTION covers nested rows, while the
 * override INJECTION anchors (`applyOneOverride` below) still match top-level
 * rows only — the injection indent contract (`^ {2}key:`) is defined against a
 * column-0 row.
 */
function compositionRowIds(composition: string): Set<string> {
  const ids = new Set<string>()
  for (const line of composition.split('\n')) {
    const match = /^\s*- id:\s*(\S+)/.exec(line)
    // C-25 (v10 audit): the old `match[1] ?? ''` was a dead expression (the
    // regex guarantees group 1 exists), and an empty id would have poisoned
    // the collision set anyway. Delta-INTERNAL duplicate ids remain
    // undetected by design (deferred — see the v10 ledger).
    const id = match?.[1]
    if (id) ids.add(id)
  }
  return ids
}

/** The platform package a DECLARATIVE preset row names (0.2.x replaced preset directories with it). */
export const AGENT_PRESET_PACKAGE = '@deepseek-ai/dsh-agent-preset'

/** Identity and display metadata of one generated preset row. */
export interface PresetRowIdentity {
  /** The composition row id (`- id:`); what {@link mergePresetRow} replaces by. */
  readonly rowId: string
  /** The preset id the platform registry keys on (`evolution` / `evolution-ptc`). */
  readonly id: string
  /** Display name in the preset picker. */
  readonly name: string
  /** One-line description in the preset picker. */
  readonly description: string
  /** Sort order among the registered presets. */
  readonly order: number
}

/**
 * Compose the DECLARATIVE preset row from the platform base composition and the family delta.
 *
 * 0.2.x removed the directory mechanism: `dsh-agent-preset` is an ordinary composition row whose
 * `config.plugins` carries the preset's complete child plugin list
 * (`packages/preset/agent-preset/src/index.ts`, `agent-preset-registry/src/definition.ts` — the
 * definition has NO base/extends field, which is why the platform base is merged in here).
 *
 * The composition itself is {@link composePresetComposition}: same row-collision contract and the
 * same `row-overrides.json` injection, applied while the composed rows are still at column 0 — the
 * override anchors are defined against a column-0 `- id:` row, so the indentation that puts them
 * under `plugins:` must come last.
 * @param baseComposition - the platform base preset patch/composition rows.
 * @param deltaComposition - the family delta rows.
 * @param identity - row id, preset id, display fields and order.
 * @returns the row text, newline-terminated, ready to merge into a profile patch.
 */

/**
 * Drop the blank lines that merely separate block-sequence items, keeping the ones INSIDE a block
 * literal (`key: |` / `>`): there a blank line is part of the value, and filtering it flattened a
 * platform base preset's multi-paragraph prompt into one paragraph (G6 review, P1).
 * @param text - the composition rows.
 * @returns the rows with the separating blank lines removed.
 */
function denseBlockSequence(text: string): string {
  const out = []
  let scalarIndent = -1
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    const indent = line.length - line.trimStart().length
    if (scalarIndent >= 0 && trimmed !== '' && indent <= scalarIndent) scalarIndent = -1
    if (scalarIndent < 0) {
      const match = /^(\s*)[\w".-]+:\s*[|>]/.exec(line)
      if (match !== null) scalarIndent = (match[1] ?? '').length
    }
    if (trimmed === '' && scalarIndent < 0) continue
    out.push(line)
  }
  return out.join('\n')
}

export function composePresetRow(
  baseComposition: string,
  deltaComposition: string,
  identity: PresetRowIdentity,
): string {
  const composed = composePresetComposition(baseComposition, deltaComposition)
  const plugins = denseBlockSequence(composed)
    .split('\n')
    // A kept blank line stays BLANK: indenting it would add trailing spaces to a block scalar's
    // value (the shape the platform's own base patches use is a truly empty line).
    .map(line => (line === '' ? '' : '      ' + line))
    .join('\n')
  return [
    '- id: ' + identity.rowId,
    "  name: '" + AGENT_PRESET_PACKAGE + "'",
    '  config:',
    '    id: ' + identity.id,
    // No trailing commas: the row is YAML, and the platform's own patch parser rejects a
    // JSON-style comma after a block mapping entry (pinned by the parse case in
    // evolution-host/tests/installer-preset-base.spec.ts).
    '    name: ' + JSON.stringify(identity.name),
    '    description: ' + JSON.stringify(identity.description),
    '    order: ' + String(identity.order),
    '    plugins:',
    plugins,
    '',
  ].join('\n')
}

/** The patch-entry key that ADDS a row: a plain entry overrides the row with the same id, so a
 * preset the platform does not ship has to arrive inside an `insert` entry
 * (`packages/boot/app-boot/tests/user-patches.spec.ts:47-64`). */
const PATCH_INSERT_KEY = 'insert'

/**
 * Wrap a composed row as the patch entry a profile patch needs.
 *
 * The row {@link composePresetRow} returns starts at column 0; a patch entry's list nests it four
 * spaces deeper. Wrapping is a separate step because the same row text is also what
 * {@link mergePresetRow} matches by id, and because the composer's override anchors are defined
 * against column-0 rows.
 * @param row - the row text, as {@link composePresetRow} returns it.
 * @returns the patch entry text, newline-terminated.
 */
export function composePresetInsert(row: string): string {
  const body = row.replace(/\s+$/, '').split('\n').map(line => '    ' + line).join('\n')
  return `- ${PATCH_INSERT_KEY}:\n${body}\n`
}

/**
 * The row list a platform base preset patch carries under `config.plugins`, dedented to column 0.
 *
 * A base preset arrives as a whole patch entry — `- insert:` / `- id: preset-standard` /
 * `config:` / `plugins:` — because that is how the platform ships it
 * (`packages/bundle/web-app/presets/standard.patch.yml`). The preset's own list is the
 * SHALLOWEST `plugins:` line: a child row may carry a key by that name far deeper.
 * @param patchText - the base preset patch file's text.
 * @returns the plugin rows, dedented and newline-terminated.
 * @throws {Error} when the patch carries no `plugins:` list.
 */
export function basePresetPlugins(patchText: string): string {
  const lines = patchText.split('\n')
  let at = -1
  let indent = Number.POSITIVE_INFINITY
  for (const [index, line] of lines.entries()) {
    const match = /^(\s*)plugins:\s*$/.exec(line)
    const width = match?.[1]?.length
    if (width === undefined) continue
    if (width < indent) {
      indent = width
      at = index
    }
  }
  if (at < 0) throw new Error('evolution preset composition: the base preset patch carries no `plugins:` list')
  const block: string[] = []
  for (const line of lines.slice(at + 1)) {
    if (line.trim() === '') {
      block.push(line)
      continue
    }
    if (line.length - line.trimStart().length <= indent) break
    block.push(line)
  }
  while (block.length > 0 && block[block.length - 1]?.trim() === '') block.pop()
  const widths = block.filter(line => line.trim() !== '').map(line => line.length - line.trimStart().length)
  const dedent = widths.length === 0 ? 0 : Math.min(...widths)
  return block.map(line => line.slice(0, dedent).trim() === '' ? line.slice(dedent) : line).join('\n') + '\n'
}

/** The row id a family preset occupies: the platform ships \`preset-standard\` for id `standard`
 * (`packages/bundle/web-app/presets/standard.patch.yml`), so a family preset id mirrors it. */
export function presetRowId(id: string): string {
  return `preset-${id}`
}

/**
 * The patch entry a profile patch receives for one preset: base rows plus the family delta, wrapped
 * as \`- insert:\`.
 *
 * The two halves are also exposed on their own — {@link composePresetRow} for the row, so
 * {@link mergePresetRow} can match it by id, and {@link basePresetPlugins} to read the platform
 * base out of a shipped patch.
 * @param basePatchText - the platform base preset patch's text.
 * @param deltaComposition - the family delta rows.
 * @param identity - row id, preset id, display fields and order.
 * @returns the patch entry text, newline-terminated.
 */
export function composePresetEntry(
  basePatchText: string,
  deltaComposition: string,
  identity: PresetRowIdentity,
): string {
  return composePresetInsert(composePresetRow(basePresetPlugins(basePatchText), deltaComposition, identity))
}

/**
 * The text of one row's own patch item, or null when the patch carries no such row.
 *
 * The comparison unit for a freshness check: this is byte-for-byte what {@link composePresetEntry}
 * writes for the same row id, whether the row sits inside an \`- insert:\` entry (installer-written)
 * or at column 0 (saved by the Web editor).
 * @param patchText - the patch text.
 * @param rowId - the row id to read.
 * @returns the item's text, newline-terminated, or null.
 */
export function presetRowBody(block: string): string {
  const lines = block.split('\n')
  if (!/^- insert:\s*$/.test(lines[0] ?? '')) return block
  return lines.slice(1).map(line => (line.startsWith('    ') ? line.slice(4) : line)).join('\n')
}

/**
 * The row BODY of a patch block, whichever form it is in.
 *
 * {@link presetRowBlock} returns the enclosing item verbatim: an installer-written row sits inside
 * `- insert:` while a row the platform's Web editor saved IS that column-0 item. A comparison must
 * compare like with like — comparing the raw block against `composePresetEntry()` (which always
 * starts with `- insert:`) reported DIFFERS for every editor-saved row, forever (G6 review, P2), and
 * the remedy it printed (`re-run the installer`) was refused by the `exists; use --force` guard.
 * @param block - a block as {@link presetRowBlock} returns it.
 * @returns the row text, `- insert:` unwrapped and its four-space indent stripped.
 */
export function presetRowBlock(patchText: string, rowId: string): string | null {
  const lines = patchText.split('\n')
  const span = rowBlockSpan(lines, rowId)
  if (span === null) return null
  const block = [...lines.slice(span.start, span.end)]
  while (block.length > 0 && (block[block.length - 1] ?? '').trim() === '') block.pop()
  return block.join('\n') + '\n'
}

/** The package every shipped base preset patch declares its row with
 * (`packages/bundle/web-app/presets/standard.patch.yml`). The platform's only bundle carrying
 * preset patches today; a bundle a caller mounts is probed beside it. */
const PLATFORM_BUNDLE_PACKAGE = '@deepseek-ai/dsh-web-app'

/**
 * What `DSH_AGENT_PRESET_ROOT` must name: a directory holding the platform base preset patches
 * under their shipped file names (`<base>.patch.yml`) — e.g. a copy of a same-version platform
 * tree's `packages/bundle/web-app/presets/`. The desktop application is the shape that needs it:
 * its platform packages live inside `resources/app.asar`, so there is no plain
 * `node_modules/@deepseek-ai/dsh-web-app/presets/` on disk for a source installer to read.
 */
export const AGENT_PRESET_ROOT_HINT = 'point DSH_AGENT_PRESET_ROOT at a directory holding <base>.patch.yml (copy it out of a same-version dsh tree: packages/bundle/web-app/presets/)'

/** Where {@link resolveBasePresetPatch} looks, in order. */
export interface BasePresetPatchSources {
  /** Explicit preset root (`DSH_AGENT_PRESET_ROOT`); an ANSWER, never a fallback head. */
  readonly root?: string | undefined
  /** Module-graph probe for the bundle package — the only candidate that reaches inside an Electron
   * `app.asar`. Receives `@deepseek-ai/dsh-web-app/package.json` and returns its path. */
  readonly resolve?: ((specifier: string) => string) | undefined
  /** Target profile directory; its `node_modules` holds the bundles it mounts. */
  readonly profileDir?: string | undefined
  /** Bundle package names to probe under `<profileDir>/node_modules`. */
  readonly bundles?: readonly string[] | undefined
  /** Directory the ancestor walk starts from — the caller's own file location. */
  readonly fromDir: string
}

/**
 * Resolve the platform patch file one `--base` names.
 *
 * 0.2.x ships each base preset as a bundle patch layer
 * (`packages/bundle/web-app/presets/<base>.patch.yml`, declared in that package's
 * `dsh.bundle.patch`), so the FILE — not a preset directory — is the base a family row is composed
 * from. Candidates, in order: an explicit `DSH_AGENT_PRESET_ROOT`; a module-graph probe when the
 * caller supplies one (a desktop/Electron host resolves the bundle inside `app.asar`, where no file
 * walk can reach); the target profile's own `node_modules`; then, walking up from the caller,
 * every `presets/` directory of a checkout's bundle packages, then every
 * `@deepseek-ai/dsh-<name>/presets/` directory of an installed tree.
 *
 * A base with no patch file is REFUSED with every probed candidate listed: composing a family preset
 * from another base's rows would mount rows the user did not ask for, with nothing saying so.
 * @param base - the base name, already validated against `evolution-agent/bases.json`.
 * @param sources - the roots to probe.
 * @returns the patch file's absolute path.
 * @throws {Error} when no candidate exists.
 */
export function resolveBasePresetPatch(base: string, sources: BasePresetPatchSources): string {
  const file = `${base}.patch.yml`
  const explicit = sources.root?.trim()
  if (explicit !== undefined && explicit !== '') {
    const path = join(explicit, file)
    if (!existsSync(path)) {
      throw new Error(`evolution preset composition: DSH_AGENT_PRESET_ROOT is set but ${path} does not exist — ${AGENT_PRESET_ROOT_HINT}`)
    }
    return path
  }
  const probes: string[] = []
  const probe = (path: string): string | undefined => {
    probes.push(path)
    return existsSync(path) ? path : undefined
  }
  if (sources.resolve !== undefined) {
    const probeSpecifier = `${PLATFORM_BUNDLE_PACKAGE}/presets/${file}`
    // The failure is a CANDIDATE miss, not an error: the caller's module graph may simply not carry
    // the bundle (a headless profile), and the file candidates below still apply.
    try {
      const found = probe(sources.resolve(probeSpecifier))
      if (found !== undefined) return found
    } catch {
      probes.push(`node module graph: ${probeSpecifier}`)
    }
  }
  if (sources.profileDir !== undefined && sources.profileDir !== '') {
    for (const name of new Set([PLATFORM_BUNDLE_PACKAGE, ...(sources.bundles ?? [])])) {
      const found = probe(join(sources.profileDir, 'node_modules', ...name.split('/'), 'presets', file))
      if (found !== undefined) return found
    }
  }
  for (let level = sources.fromDir; level !== dirname(level); level = dirname(level)) {
    const bundleRoot = join(level, 'packages', 'bundle')
    for (const name of listDirectories(bundleRoot)) {
      const found = probe(join(bundleRoot, name, 'presets', file))
      if (found !== undefined) return found
    }
    const scopeRoot = join(level, 'node_modules', '@deepseek-ai')
    for (const name of listDirectories(scopeRoot)) {
      if (!name.startsWith('dsh-')) continue
      const found = probe(join(scopeRoot, name, 'presets', file))
      if (found !== undefined) return found
    }
  }
  // Desktop roots are probed LAST (G6 review, P2): they hold SOME platform version's copy, while
  // the tree this code runs in is the one the profile is built against.
  for (const root of installRoots(sources.fromDir)) {
    for (const shape of DESKTOP_RESOURCE_SHAPES) {
      const found = probe(join(root, ...shape, 'dsh', 'node_modules', '@deepseek-ai', 'dsh-web-app', 'presets', file))
      if (found !== undefined) return found
      const scanned = probeDesktopScope(join(root, ...shape), file, probes)
      if (scanned !== undefined) return scanned
    }
  }
  throw new Error(
    `evolution preset composition: cannot find the runtime platform '${base}' preset patch — `
    + `no candidate carries presets/${file}. A base with no runtime patch is refused rather than `
    + 'composed from another base: the generated preset must follow the platform it runs on. '
    + `Probed (in order): ${probes.join(', ')}. On a desktop install the platform packages live `
    + `inside resources/app.asar and no plain file exists — ${AGENT_PRESET_ROOT_HINT}`,
  )
}

/** The Electron resource layouts a desktop installation exposes its unpacked packages under. */
const DESKTOP_RESOURCE_SHAPES = [
  ['resources', 'app.asar.unpacked'],
  ['resources', 'app', 'resources', 'app.asar.unpacked'],
]

/**
 * Installation directories a desktop/Electron tree may sit at, probed before the source walk.
 *
 * The default Windows desktop location plus every ancestor that carries an
 * `resources/app.asar.unpacked` directory (a script run from inside an installation).
 * @param fromDir - the caller's own directory.
 * @returns the candidate installation roots.
 */
function installRoots(fromDir: string): string[] {
  const roots: string[] = []
  const localAppData = process.env.LOCALAPPDATA
  if (process.platform === 'win32' && localAppData !== undefined && localAppData !== '') {
    roots.push(join(localAppData, 'Programs', 'DeepSeek Harness'))
  }
  for (let level = fromDir; level !== dirname(level); level = dirname(level)) {
    if (existsSync(join(level, 'resources', 'app.asar.unpacked'))) roots.push(level)
  }
  return roots
}

/**
 * Probe every `@deepseek-ai/dsh-*` package under one unpacked resource root.
 * @param resourceRoot - e.g. `<install>/resources/app.asar.unpacked`.
 * @param file - the patch file name to look for.
 * @param probes - the caller's probe log, appended to for the failure report.
 * @returns the patch path when one exists.
 */
function probeDesktopScope(resourceRoot: string, file: string, probes: string[]): string | undefined {
  const scopeRoot = join(resourceRoot, 'dsh', 'node_modules', '@deepseek-ai')
  for (const name of listDirectories(scopeRoot)) {
    if (!name.startsWith('dsh-')) continue
    const path = join(scopeRoot, name, 'presets', file)
    probes.push(path)
    if (existsSync(path)) return path
  }
  return undefined
}

/**
 * Subdirectories of one directory, or none when it does not exist: a missing level is an ordinary
 * miss on a candidate walk, not a failure.
 * @param dir - the directory to list.
 * @returns the directory names.
 */
function listDirectories(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name)
  } catch {
    return []
  }
}

/**
 * The block of one row id: the enclosing column-0 list item and the row's own first line.
 *
 * An installer-written row sits inside `- insert:` (four spaces deeper); a row the Web editor
 * saved is that column-0 item itself. Both must be replaced whole, so the span reaches back to the
 * enclosing item and forward to the next one.
 * @param lines - the patch text's lines.
 * @param rowId - the row id to locate.
 * @returns the span, or null when the patch carries no such row.
 */
function rowBlockSpan(lines: string[], rowId: string): { start: number; end: number; rowStart: number } | null {
  const rowRe = new RegExp('^\\s*- id:\\s*' + rowId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$')
  const rowStart = lines.findIndex(line => rowRe.test(line))
  if (rowStart < 0) return null
  let start = rowStart
  while (start > 0 && !/^- /.test(lines[start] ?? '')) start -= 1
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^- /.test(lines[index] ?? '')) {
      end = index
      break
    }
  }
  return { start, end, rowStart }
}

/**
 * Remove one row from a patch, taking its `- insert:` item with it when that item holds nothing
 * else (an empty insert entry is left-over structure the platform would keep parsing).
 * @param patchText - the patch text to edit.
 * @param rowId - the row id to remove.
 * @returns the patch text, newline-terminated; byte-identical when the id is absent.
 */
export function removePresetRow(patchText: string, rowId: string): string {
  const lines = patchText.split('\n')
  const span = rowBlockSpan(lines, rowId)
  if (span === null) return patchText
  const rowLine = lines[span.rowStart] ?? ''
  const rowIndent = rowLine.length - rowLine.trimStart().length
  const nested = rowIndent > 0
  const siblings = lines.slice(span.start + 1, span.end).filter((line) => {
    const width = line.length - line.trimStart().length
    return width === rowIndent && line.trimStart().startsWith('- ')
  }).length
  // A nested row inside an entry that holds others is removed alone — before it or after it
  // alike; the entry itself goes when it held nothing else (an empty insert entry is structure the
  // platform would keep parsing).
  const cut = nested && siblings > 1
    ? { start: span.rowStart, end: rowSiblingEnd(lines, span.rowStart, span.end) }
    : span
  const kept = [...lines.slice(0, cut.start), ...lines.slice(cut.end)]
  // Byte discipline: only whole trailing EMPTY lines the cut left behind are dropped. A kept
  // line's own terminator is never rewritten — a CRLF file's last line ends with `\r`, and
  // trimming it (or collapsing interior blank lines) made install→uninstall non-reversible.
  while (kept.length > 1 && (kept[kept.length - 1] ?? '') === '') kept.pop()
  const text = kept.join('\n')
  if (text === '') return ''
  return text.endsWith('\n') ? text : text + '\n'
}

/**
 * The end of one nested row's own block inside a patch entry.
 * @param lines - the patch text's lines.
 * @param rowStart - the row's `- id:` line.
 * @param itemEnd - the enclosing item's end.
 * @returns the index of the next sibling row, or the item's end.
 */
function rowSiblingEnd(lines: string[], rowStart: number, itemEnd: number): number {
  const indent = (lines[rowStart] ?? '').length - (lines[rowStart] ?? '').trimStart().length
  for (let index = rowStart + 1; index < itemEnd; index += 1) {
    const line = lines[index] ?? ''
    if (line.trim() === '') continue
    const width = line.length - line.trimStart().length
    if (width === indent && line.trimStart().startsWith('- ')) return index
    if (width < indent) return index
  }
  return itemEnd
}

/**
 * Merge one generated row into a composition (a profile patch) by row id.
 *
 * Idempotent by construction: an existing row with the same `- id:` is REPLACED whole — its block
 * is the enclosing column-0 list item, so an installer-written row inside `- insert:` and a
 * Web-editor-saved row at column 0 are both matched by {@link rowBlockSpan} — and anything else in
 * the patch stays byte-identical, because the patch usually carries rows this installer knows
 * nothing about. A missing row is appended.
 *
 * The platform seeds a fresh profile patch with the empty list `[]`
 * (`packages/boot/app-boot/src/profile.ts`, `PROFILE_PATCH_FILENAME`), which is a COMPLETE YAML
 * document: a block sequence appended after it is not parsable. That seed is therefore replaced, not
 * extended.
 * @param patchText - the current patch text (`''` for a fresh one).
 * @param row - the row text, as {@link composePresetRow} returns it.
 * @param rowId - the row id to replace or append.
 * @returns the merged patch text, newline-terminated.
 */
export function mergePresetRow(patchText: string, row: string, rowId: string): string {
  const lines = patchText.split('\n')
  const block = row.replace(/\s+$/, '').split('\n')
  const span = rowBlockSpan(lines, rowId)
  if (span === null) {
    // Only the SEAM is normalized. The platform seed (`[]`, `[ ]`, `[] # empty`) is a COMPLETE flow
    // sequence a block sequence may not follow, so that one line goes; every other byte the author
    // wrote stays — a blank line inside a block scalar (`section: |`) is part of the VALUE, and
    // filtering the whole file rewrote user content on install (G6 review, P1).
    const seedIndex = lines.findIndex(line => EMPTY_PATCH_SEED_RE.test(line))
    const base = seedIndex >= 0 ? [...lines.slice(0, seedIndex), ...lines.slice(seedIndex + 1)] : [...lines]
    const kept = trimTrailingBlankLines(base)
    return (kept.length === 0 ? block : [...kept, ...block]).join('\n') + '\n'
  }
  const merged = [...lines.slice(0, span.start), ...block, ...lines.slice(span.end)]
  // Same byte discipline on the replace path: no global blank-line collapsing, and no `\s+$` trim
  // (it ate the trailing \r of a CRLF file's last line).
  return trimTrailingBlankLines(merged).join('\n') + '\n'
}

/** The empty patch list the platform seeds a profile patch with; see {@link mergePresetRow}. */
export const EMPTY_PATCH_SEED = '[]'

/** The seed in any spelling the platform accepts (`[]`, `[ ]`, `[] # empty`). */
const EMPTY_PATCH_SEED_RE = /^\s*\[\s*\](\s*#.*)?\s*$/

/** Drop trailing blank lines only: a kept line's own terminator (a CRLF file's `\r`) is never touched. */
function trimTrailingBlankLines(lines: string[]): string[] {
  const out = [...lines]
  while (out.length > 0 && (out[out.length - 1] ?? '').trim() === '') out.pop()
  return out
}

/**
 * The text to write when a patch is left with no entries.
 *
 * A zero-byte patch file is not what the platform writes or parses; its own seed is the empty list.
 * @param patchText - the text {@link removePresetRow} returned.
 * @returns the platform's empty-list seed when nothing is left, the text otherwise.
 */
export function presetPatchText(patchText: string): string {
  return patchText.trim() === '' ? `${EMPTY_PATCH_SEED}\n` : patchText
}
