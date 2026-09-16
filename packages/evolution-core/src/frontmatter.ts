/**
 * Frontmatter parsing, normalization and validation for skill Markdown files.
 *
 * Split out of skill-store.ts (S2-1): pure functions over file text, no store
 * state. skill-store.ts re-exports the same names it exported before the split,
 * so the package export surface is unchanged.
 */

// S2.1 (PLAN 2026-09-16, audit P2-1): the `yaml` package — the SAME dependency
// the upstream platform catalog uses (skill-filesystem: `import { parse as
// parseYaml } from 'yaml'`, `yaml: ^2.4.2`) — replaces js-yaml. js-yaml speaks
// YAML 1.1 full schema while the platform speaks YAML 1.2 core, so the family
// and the platform read different values out of the SAME bytes: a plain
// `description: 2026-09-16` was a Date here (rejected by the string-contract
// plumbing) and the literal string there; the reverse split (`+.inf` written
// unquoted) made the platform read a float and ignore a whole file the family
// listed. Verified against js-yaml 4 by the PLAN S2.1 (2026-09-16)
// pair-compare: the value-level differences are
// confined to dates/timestamps and the 1.1 binary-int form (`0b101`); 1.1
// bool words (yes/no/on/off), hex/octal/leading-zero ints, exponent floats
// and .inf/.nan already read identically, and both parsers throw on the
// same unloadable blocks (duplicate keys included), so the lenient fallback
// verdicts are unchanged.
import { parse as parseYaml } from 'yaml'
import { AUTHORING_DESCRIPTION_BAR, SKILL_NAME_RE } from './constants.ts'
import { DEFAULT_SKILL_LIMITS } from './limits.ts'
import type { SkillLimits } from './limits.ts'

export interface Frontmatter {
  name?: string
  description?: string
  [key: string]: unknown
}

/**
 * Shared frontmatter block detection (P3-3 single owner): opening line `---`
 * and closing line exactly `---`. Used by `parseFrontmatter`,
 * `frontmatterCatalogInvalid` and `normalizeFrontmatter` so the three can
 * never disagree about where the block ends (the loose `indexOf('\n---')`
 * form matched `\n----` and was replaced by this strict line rule).
 *
 * V27 G2.1: both fence lines are matched EXACTLY, tolerating only a trailing
 * `\r` — the same rule the upstream filesystem catalog uses
 * (`skill-filesystem.parseFrontmatter`). The former `.trim()` comparison
 * accepted ` --- `, so an indented fence loaded in the family while the
 * platform ignored the file: family visibility split from platform visibility,
 * which is exactly what a strict-YAML frontmatter is supposed to prevent.
 */
/**
 * S1.1 (v37 P1-4): the frontmatter block is split on LF and every line keeps its
 * own `\r`, so the byte-preserving rebuild (`lines.join('\n')`) is exact. Line
 * MATCHERS must therefore look at a CR-stripped view: JS `.` does not match `\r`,
 * so `(.*)$` never reaches the end of a CRLF line.
 * @param line - one block line, possibly CR-terminated.
 * @returns the line without its trailing CR.
 */
function withoutCr(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line
}

export function frontmatterBlock(content: string): { block: string; lines: string[]; end: number; nl: string } | null {
  if (!content.trimStart().startsWith('---')) return null
  // S1.1 (v37 P1-4): the block is located by splitting on '\n' and tolerating a
  // trailing '\r' on every line — the rule upstream `skill-filesystem` uses. The
  // old "the whole file picks ONE newline style" test made a MIXED-ending file
  // (LF first line plus any CRLF later: PowerShell Add-Content, an editor, a git
  // hunk conversion) look like a file with NO frontmatter — every family write was
  // refused with a misleading message while the platform read the same bytes fine.
  // Lines keep their '\r', so joining them with '\n' reproduces the original bytes;
  // `nl` reports the file's FIRST line ending and is used only to rebuild text.
  const firstBreak = content.indexOf('\n')
  const nl = firstBreak > 0 && content[firstBreak - 1] === '\r' ? '\r\n' : '\n'
  const lines = content.split('\n')
  const opening = (lines[0] ?? '').replace(/\r$/, '')
  if (opening !== '---') return null
  let end = -1
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (line === undefined) continue
    if (line === '---' || line === '---\r') { end = i; break }
  }
  if (end < 0) return null
  return { block: lines.slice(1, end).join('\n'), lines, end, nl }
}

/**
 * One frontmatter read (V27 G2.1): the values, the body, and every signal the
 * strict-YAML platform catalog derives from the same block. Returned by
 * {@link parseFrontmatter} so a caller never has to parse the block twice to
 * reach a description and the catalog verdict.
 */
export interface FrontmatterRead {
  frontmatter: Frontmatter
  body: string
  /** Raw entries whose UNQUOTED value the strict catalog cannot load as
   * written. Quotes are included, so a value already normalized by the write
   * path (`normalizeFrontmatter`) is never re-flagged. */
  unsafeValues: Array<{ key: string; value: string }>
  /** Whether the frontmatter is not valid AS WRITTEN for the strict platform
   * catalog: the strict parser rejects the block, or an unquoted value would
   * read as something other than its text (a dropped ` # ` comment, a
   * number/bool shorthand the catalog refuses as a string field), or a
   * platform string field carries a non-string value. The write path quotes
   * such a value on its next edit. */
  catalogInvalid: boolean
  /** Platform string fields (`name`/`description`/`whenToUse`) whose YAML value
   * is not a string: the strict catalog reads such a field as ABSENT and, for an
   * absent name/description, ignores the whole file (P2-9/v37). */
  platformStringSplit: PlatformStringSplit[]
}

/**
 * Raw-line scan of a frontmatter block: the single owner of "which entries the
 * strict catalog cannot load". `frontmatterCatalogInvalid` publishes it and
 * `normalizeFrontmatter` decides each rewrite with the same predicate
 * (`yamlPlainScalarNeedsQuotes`), so the audit verdict and the write path can
 * never disagree. Only single-line `key: value` entries are judged; a line with
 * embedded breaks is skipped.
 */
function unsafeFrontmatterEntries(block: string, nl: string): Array<{ key: string; value: string }> {
  const found: Array<{ key: string; value: string }> = []
  for (const line of block.split(nl)) {
    const clean = withoutCr(line)
    if (clean.includes('\n') || clean.includes('\r')) continue
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(clean)
    if (!match) continue
    const key = match[1]
    if (key === undefined) continue
    const value = (match[2] ?? '').trim()
    if (yamlPlainScalarNeedsQuotes(value)) found.push({ key, value })
  }
  return found
}

/**
 * Frontmatter fields the platform catalog reads as STRINGS (`stringField` /
 * `optionalString` in `skill-filesystem`): any other YAML type reads as
 * ABSENT there, and an absent `name`/`description` makes the catalog ignore the
 * whole file. The family publishes text for these keys anyway (its lenient
 * read), which is the one split a write must not create.
 */
const PLATFORM_STRING_FIELDS: readonly string[] = ['name', 'description', 'whenToUse']

/** One `name`/`description`/`whenToUse` entry the strict catalog cannot read as
 * a string, with the YAML kind the parser found. */
export interface PlatformStringSplit {
  key: string
  /** The YAML type read for this field. `scalar` covers number/boolean (the
   * E-47 auto-quote repair handles those); `sequence`/`mapping` are the shapes
   * no rewrite can repair without inventing text — see `validateFrontmatter`. */
  kind: 'sequence' | 'mapping' | 'scalar' | 'null'
}

interface StrictFrontmatterValues {
  values: Map<string, string>
  split: PlatformStringSplit[]
}

/**
 * Frontmatter values as the STRICT platform catalog reads them — the `yaml`
 * package (YAML 1.2 core schema, the same dependency the platform's
 * skill-filesystem parses with — see the import note above),
 * the parser `normalizeFrontmatter` also verifies rewrites with — or `null`
 * when the block is not loadable as a YAML mapping. Also reports the platform
 * string fields whose value is not a string ({@link PlatformStringSplit}).
 *
 * Scalars publish their text (`name`, `description`, `whenToUse` are strings by
 * contract; a number/boolean-shaped value keeps the text the family always
 * published), a flow or block sequence publishes its inline `[a, b]` form
 * (`relatedSkillNames` scans names out of it), and a nested mapping publishes
 * nothing — no consumer in this family reads one, and a lossy string could be
 * picked up by a routing field. A string value is trimmed: YAML's block-scalar
 * chomping appends a newline that the family's single-line routing fields never
 * carried.
 */
function strictFrontmatterValues(block: string): StrictFrontmatterValues | null {
  // An empty or comment-only block has no entries and is NOT a parser failure:
  // the catalog's complaint about it is the missing name, which
  // `validateFrontmatter` reports.
  if (block.trim() === '') return { values: new Map(), split: [] }
  let loaded: unknown
  try {
    loaded = parseYaml(block)
  } catch {
    return null
  }
  if (loaded === null || loaded === undefined) return { values: new Map(), split: [] }
  if (typeof loaded !== 'object' || Array.isArray(loaded)) return null
  const values = new Map<string, string>()
  const split: PlatformStringSplit[] = []
  for (const [key, value] of Object.entries(loaded as Record<string, unknown>)) {
    if (typeof value !== 'string' && PLATFORM_STRING_FIELDS.includes(key)) {
      split.push({ key, kind: value === null || value === undefined ? 'null' : Array.isArray(value) ? 'sequence' : typeof value === 'object' ? 'mapping' : 'scalar' })
    }
    if (typeof value === 'string') { values.set(key, value.trim()); continue }
    if (typeof value === 'number' || typeof value === 'boolean') { values.set(key, String(value)); continue }
    if (Array.isArray(value)) { values.set(key, `[${value.map(item => String(item)).join(', ')}]`); continue }
  }
  return { values, split }
}

/**
 * Lenient line scan, used only for a block the strict parser rejects: the
 * family keeps routing a legacy file the platform refuses, and
 * `catalogInvalid` reports the split instead of hiding it. Values are trimmed
 * and unquoted exactly as before.
 */
function lenientFrontmatterValues(block: string, nl: string): Map<string, string> {
  const values = new Map<string, string>()
  const blockLines = block.split(nl)
  for (let i = 0; i < blockLines.length; i += 1) {
    const line = withoutCr(blockLines[i] ?? '')
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (!match) continue
    const [, key, value] = match
    if (key === undefined || value === undefined) continue
    // V27 G0.3 (core-a-07): a block scalar's VALUE is the more-indented lines
    // that follow its indicator, not the indicator itself. Reading only the
    // header line published the literal ">" as the description — the skill
    // loaded, but its routing information was gone (and the maintenance audit
    // then flagged a file the platform catalog loads happily). Folding (`>`)
    // joins the lines with single spaces and keeps a blank line as a break;
    // literal (`|`) keeps the line structure — the value a strict YAML reader
    // produces for the same block.
    const header = /^([>|])[+-]?\d*$/.exec(value.trim())
    if (header !== null) {
      const fold = header[1] === '>'
      const parts: string[] = []
      let scan = i + 1
      for (; scan < blockLines.length; scan += 1) {
        const raw = blockLines[scan] ?? ''
        if (raw.trim() === '') { parts.push('') ; continue }
        if (!/^\s/.test(raw)) break // dedented → the next frontmatter key
        parts.push(raw.trim())
      }
      while (parts.length > 0 && parts[parts.length - 1] === '') parts.pop()
      let folded = ''
      for (const part of parts) {
        if (part === '') {
          // A blank line ends the paragraph: one break, never a run of them.
          if (folded !== '' && !folded.endsWith('\n')) folded += '\n'
          continue
        }
        if (folded === '' || folded.endsWith('\n')) folded += part
        else folded += ` ${part}`
      }
      values.set(key, (fold ? folded : parts.join('\n')).trim())
      i = scan - 1
      continue
    }
    values.set(key, value.trim().replace(/^["']|["']$/g, ''))
  }
  return values
}

/** What one frontmatter block says, before any body requirement is applied. */
interface FrontmatterBlockRead {
  frontmatter: Frontmatter
  body: string
  unsafeValues: Array<{ key: string; value: string }>
  /** The strict parser rejected the block outright. */
  strictFailed: boolean
  /** Platform string fields the strict parser could not read as text (empty
   * when the block itself failed to parse — `strictFailed` owns that case). */
  platformStringSplit: PlatformStringSplit[]
}

/**
 * The single read of a SKILL.md frontmatter block: values, body and every
 * strict-catalog signal, computed once. `null` only when the file has no
 * frontmatter block; the body may be empty. {@link parseFrontmatter} and
 * {@link frontmatterCatalogInvalid} are its two projections.
 *
 * @param content - the SKILL.md text.
 * @returns the block read, or `null` when there is no block.
 */
function readFrontmatterBlock(content: string): FrontmatterBlockRead | null {
  const found = frontmatterBlock(content)
  if (!found) return null
  const body = found.lines.slice(found.end + 1).join('\n').trim()
  const strict = strictFrontmatterValues(found.block)
  const values = strict?.values ?? lenientFrontmatterValues(found.block, found.nl)
  const frontmatter: Frontmatter = {}
  for (const [key, value] of values) frontmatter[key] = value
  return {
    frontmatter,
    body,
    unsafeValues: unsafeFrontmatterEntries(found.block, found.nl),
    strictFailed: strict === null,
    platformStringSplit: strict?.split ?? [],
  }
}

/**
 * Parse a SKILL.md: its frontmatter values and body, or `null` when the file
 * has no frontmatter block or no body. Every consumer of frontmatter values
 * goes through here — the write path's validation, `list()`'s published
 * description, `relatedSkillNames` and the audit — so all of them read the same
 * bytes the same way.
 *
 * @param content - the SKILL.md text.
 * @returns the read, or `null` when there is no block or no body.
 */
export function parseFrontmatter(content: string): FrontmatterRead | null {
  const read = readFrontmatterBlock(content)
  if (!read || !read.body) return null
  return {
    frontmatter: read.frontmatter,
    body: read.body,
    unsafeValues: read.unsafeValues,
    catalogInvalid: read.strictFailed || read.unsafeValues.length > 0 || read.platformStringSplit.length > 0,
    platformStringSplit: read.platformStringSplit,
  }
}

/**
 * Whether this file's frontmatter is valid as written for the strict platform
 * catalog (see `FrontmatterRead.catalogInvalid`). Body-independent (a body-less
 * file is still judged), and derived from the same read as `parseFrontmatter` —
 * so the audit's verdict and the values the family publishes for one file can
 * never disagree (V27 G2.1).
 *
 * @param content - the SKILL.md text.
 * @returns `true` when the strict parser rejects the block or an unquoted value would read as something else.
 */
export function frontmatterCatalogInvalid(content: string): boolean {
  const read = readFrontmatterBlock(content)
  if (read !== null) return read.strictFailed || read.unsafeValues.length > 0 || read.platformStringSplit.length > 0
  // v28 G2.3 (CORE-SK-02): fail closed for the DETECTION failures this guard
  // exists for — a BOM-prefixed fence or mixed line endings make the block
  // undetectable to the byte-exact extractor while a real YAML parser (the
  // platform's) may still read it, so "catalog-valid" here was the one
  // fail-open verdict in this file. Probe: strip the BOM and normalize CRLF,
  // then re-extract; if the block appears, report the split risk. A file with
  // no fence at all, or a genuinely unterminated block, stays "not
  // applicable" — structure health owns that verdict and body-only files
  // must not flood the catalogInvalid channel.
  const probed = frontmatterBlock(content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'))
  return probed !== null
}

/** YAML plain-scalar hazards that make an UNQUOTED frontmatter value
 * unloadable to the platform catalog (strict YAML parser): `: ` (mapping
 * separator), ` #` (comment start), a trailing `:` (a mapping marker),
 * or a leading YAML indicator. The evolution `parseFrontmatter` is
 * deliberately lenient, so violations silently split family-visibility from
 * platform-visibility (0.3.11 inkos-harness case: the description carried
 * "…: " and the catalog dropped the whole skill). Already-quoted values and
 * well-formed flow collections (`[a, b]` / `{a: b}`) are considered safe.
 * 0.3.16 (E-47): null/bool/number-shaped plain scalars are flagged too — they
 * parse as booleans/numbers on the platform while the family keeps the string
 * (a `description: true` split-brain).
 * This rule is only the FAST PATH — the write path re-verifies every rewrite
 * with the real YAML parser (see normalizeFrontmatter), so an incomplete
 * approximation can never corrupt a multiline flow value (P3-4). */
export function yamlPlainScalarNeedsQuotes(value: string): boolean {
  if (value.length === 0) return false
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) return false
  if (/^\[.*\]$/.test(value) || /^\{.*\}$/.test(value)) return false
  // V27 G0.3 (core-a-07): a block scalar header (`>` / `|`, optionally with a
  // chomping/indent modifier) is NOT a plain scalar that needs quotes — it is
  // the legal YAML form for a multi-line value whose CONTINUATION LINES carry
  // the content. Quoting it ("description: >") re-reads as the literal string
  // ">" and, because the continuation lines stay indented underneath, makes the
  // whole rewritten block unparsable: the real-parser verification then failed
  // and every create/update/patch of such a skill was rejected with advice
  // ("wrap the value in double quotes") that would corrupt the value. The
  // indicator is only meaningful in the value position — a leading `>`/`|`
  // inside a longer value (`>x`, `|foo`) still needs quoting below.
  if (/^[>|][+-]?\d*$/.test(value)) return false
  if (value.includes(': ')) return true
  if (value.includes(' #')) return true
  if (value.endsWith(':')) return true
  // v28 G2.2 (CORE-SK-01): the full YAML 1.2 core scalar set the strict
  // parser coerces to null/bool/number — ints (dec/hex/octal), exponent
  // floats, .inf/.nan — not just plain decimals. A value like `0x1F` used to
  // pass the fast path unquoted, so the platform catalog read a NUMBER while
  // the family published the string `31` (the E-47 split-brain this guard
  // exists for) and no self-heal ever fired.
  // S2.1 (PLAN 2026-09-16): this branch carries the SIGNED infinity forms
  // (`+.inf`/`-.inf`) — under the platform's `yaml` parser (and js-yaml
  // alike, per the pair-compare) they coerce to ±Infinity, so an unquoted
  // `description: +.inf` made the catalog read a float and drop the file while
  // the family listed it. Quoted, both sides read the string.
  // NaN is UNSIGNED in both parsers (review B-P2): `+.nan`/`-.nan` are plain
  // strings, so flagging them quoted a correct value and raised a false
  // catalog-invalid verdict — only bare `.nan` belongs in this table.
  // The 1.1 bool words (yes/no/on/off) deliberately stay OUT of the table:
  // under YAML 1.2 core — and under js-yaml 4 too, per the对拍 — they are
  // plain strings on both sides, so quoting them would be redundant churn.
  // The null/true/false/~ entries remain for parser-fallback safety: any
  // YAML 1.1 full parser reintroduced here WOULD coerce those, and the table
  // keeps the write path honest if that ever happens.
  if (/^(?:null|true|false|~)$/i.test(value)) return true
  if (/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/.test(value)) return true
  if (/^0x[0-9a-f]+$/i.test(value)) return true
  if (/^0o[0-7]+$/.test(value)) return true
  if (/^(?:[-+]?\.inf|\.nan)$/i.test(value)) return true
  if (/^[-?:,[\]{}#&*!|>'\"%@`\s]/.test(value)) return true
  return false
}

export interface FrontmatterNormalizeResult {
  content: string
  changed: boolean
  /** Frontmatter keys whose values were auto-quoted. */
  fields: string[]
  /** Values that cannot be auto-quoted safely (control characters, or a
   * rewrite that failed the real-parser verification — a multiline flow
   * collection line etc. is left untouched and reported here, so the write
   * path rejects instead of silently damaging a value; 0.3.14). */
  issues: string[]
}

/**
 * Normalize a SKILL.md frontmatter block into catalog-loadable YAML: values
 * that YAML forbids unquoted get quotes — double quotes normally, single
 * quotes (with `''` doubling) when the value contains `"` or `\` (both legal
 * unescaped inside single-quoted YAML). Idempotent; only single-line
 * `key: value` entries are touched; body text is never modified; line-ending
 * style is preserved. **Every rewrite is re-verified with the real YAML
 * parser** (`yaml` — the package the platform's skill-filesystem catalog parses
 * with, YAML 1.2 core schema; PLAN S2.1, 2026-09-16 — the former "js-yaml, the
 * same parser" claim was false: js-yaml speaks YAML 1.1 full and diverged on
 * dates, timestamps and 1.1 int forms): if the
 * rewritten block no longer parses, or a rewritten value's parsed content
 * differs from the original, the rewrite is rolled back and reported in
 * `issues` (fail-loud, never a silent value corruption — P3-4).
 *
 * V10-02 (P2-3): the rewrite decision is PER LINE — each entry parses its own
 * value, so a duplicated key can never route one entry's unsafe value into a
 * different line's rewrite (the old key→Map lookup rewrote the FIRST (safe)
 * line with the SECOND line's quoted value, and the last-wins YAML reader
 * masked the damage). A duplicated key is itself invalid input and is
 * reported in `issues` (the write path refuses) instead of being rewritten.
 */
export function normalizeFrontmatter(content: string): FrontmatterNormalizeResult {
  const block = frontmatterBlock(content)
  if (!block) return { content, changed: false, fields: [], issues: [] }
  // S1.1: `nl` is no longer needed here — every line keeps its own CR and the
  // rebuild joins on LF, which reproduces the original bytes.
  const { lines, end } = block
  const fields: string[] = []
  const issues: string[] = []
  // Detection shares the predicate with the audit side
  // (frontmatterCatalogInvalid): normalize and catalog-invalid detection
  // can never disagree.
  const seen = new Set<string>()
  const originalValues = new Map<string, string>()
  let changed = false
  for (let i = 1; i < end; i++) {
    const raw = lines[i]
    if (raw === undefined) continue
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(withoutCr(raw))
    if (!match) continue
    const key = match[1]
    if (key === undefined) continue
    // V10-02 (P2-3): parse THIS line's own value (quotes included) — never a
    // same-key value from another line.
    const value = (match[2] ?? '').trim()
    if (seen.has(key)) {
      issues.push(`${key}: duplicate frontmatter key — remove the repeated entry and retry`)
      continue
    }
    seen.add(key)
    if (!yamlPlainScalarNeedsQuotes(value)) continue
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) {
      issues.push(`${key}: value contains control characters — clean them manually`)
      continue
    }
    // 0.3.11 fix: single-quote fallback so a `"`/`\` value stays fixable
    // through the write path (no catch-22 on legacy descriptions).
    const quoted = value.includes('"') || value.includes('\\')
      ? `'${value.replace(/'/g, "''")}'`
      : `"${value}"`
    // S1.1: keep the line's own CR — the block is split on LF now, so the line
    // ending lives in the string itself (join('\n') restores the original bytes).
    lines[i] = `${key}: ${quoted}${raw.endsWith('\r') ? '\r' : ''}`
    originalValues.set(key, value)
    fields.push(key)
    changed = true
  }
  // V10-02 (P2-3): any issue (duplicate key, control characters) refuses the
  // whole rewrite — the write path rejects instead of shipping a partial fix.
  if (issues.length > 0) return { content, changed: false, fields: [], issues }
  if (!changed) return { content, changed: false, fields: [], issues }
  // 0.3.14: verify the rewritten block with the real parser — the fast-path
  // rule can mis-detect a multiline flow collection (`[a,` + continuation)
  // or any shape the plain-scalar approximation does not know. A failure must
  // roll back, never ship a value mutation.
  const rewrittenBlock = lines.slice(1, end).join('\n')
  try {
    const parsed = parseYaml(rewrittenBlock) as Record<string, unknown>
    for (const key of fields) {
      if (String(parsed[key]) !== originalValues.get(key)) {
        throw new Error(`rewritten value for ${key} differs from the original`)
      }
    }
    return { content: lines.join('\n'), changed: true, fields, issues }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return {
      content,
      changed: false,
      fields: [],
      issues: [`frontmatter rewrite verification failed (${reason}) — quoting skipped; wrap this value manually`],
    }
  }
}

/**
 * Skill names referenced by a SKILL.md's `related_skills` frontmatter
 * (B-line G3, rc.44): the single parsing source for the quality references
 * factor and the learning-graph edges. The DSH frontmatter parser keeps the
 * YAML value as a string (`"[a, b]"`), so names are scanned out of it; each
 * must satisfy the skill-name shape and the referencing skill itself is
 * excluded. Pure and deduplicated.
 */
export function relatedSkillNames(content: string, exclude?: string): string[] {
  const parsed = parseFrontmatter(content)
  if (!parsed) return []
  const raw = parsed.frontmatter['related_skills']
  if (typeof raw !== 'string') return []
  const names = new Set<string>()
  // F-321 (0.3.25): the old bare `[a-z0-9][a-z0-9-]*` scan matched an inner
  // fragment of a CamelCase word — `MySkill` produced the junk token `y` (and
  // would match `kill` in `Skill`-suffixed names), which then fed the quality
  // references factor and learning-graph edges. A name token is only a real
  // reference when it is delimited (no letter/digit/hyphen/underscore on
  // either side), so a camel/underscored word is skipped wholesale instead of
  // leaking fragments.
  for (const match of Array.from(raw.matchAll(/(?<![A-Za-z0-9_-])[a-z0-9][a-z0-9-]*(?![A-Za-z0-9_-])/g))) {
    const target = match[0]
    if (target && SKILL_NAME_RE.test(target) && target !== exclude) names.add(target)
  }
  return [...names]
}

/** S1.2 (v37 P2-1): the content limit applies to the bytes that LAND ON DISK.
 * Every write normalizes with `trimEnd() + '\n'`, so judging the raw argument let
 * a 100_000-character body with no trailing newline land as 100_001 bytes — and
 * every later patch/update of that skill was then refused, which made it
 * unmaintainable through `skill_manage` with no repair path at all. */
function skillMdOnDisk(content: string): string {
  return content.trimEnd() + '\n'
}

/** Whether `content` would exceed `limit` once written. */
export function exceedsContentLimit(content: string, limit: number): boolean {
  return skillMdOnDisk(content).length > limit
}

/** S1.2: the repair path — a write that makes an already-over-limit file smaller.
 * Only a NET SHRINK is exempt; an equal or larger write stays refused. */
export function shrinksOverLimit(next: string, current: string | null | undefined, limit: number): boolean {
  if (current === null || current === undefined || !exceedsContentLimit(current, limit)) return false
  return skillMdOnDisk(next).length < skillMdOnDisk(current).length
}

export function validateFrontmatter(
  content: string,
  expectedName?: string,
  limits: SkillLimits = DEFAULT_SKILL_LIMITS,
  /** On-disk bytes, so a NET SHRINK of an over-limit file is allowed (S1.2). */
  current?: string | null,
): string | null {
  const parsed = parseFrontmatter(content)
  // V27 G2.1: name the exact rule (the one the upstream catalog applies) —
  // "start and end with YAML frontmatter" left a ` --- ` fence, or a block with
  // no body, to be discovered by trial and error.
  if (!parsed) return 'SKILL.md must start with a `---` line, close the frontmatter with another exact `---` line (only a trailing `\\r` is tolerated), and include a body below it.'
  // P2-9 (v37): a SEQUENCE/MAPPING under a platform string field is refused —
  // the catalog drops the whole file while the family publishes synthesized
  // text. Number/boolean stay repairable (E-47 auto-quotes them).
  const unreadable = parsed.platformStringSplit.filter(entry => entry.kind === 'sequence' || entry.kind === 'mapping')
  if (unreadable.length > 0) {
    const named = unreadable.map(entry => `"${entry.key}" (a YAML ${entry.kind})`).join(', ')
    return `Frontmatter field ${named} must be a string: the platform skill catalog reads such a field as absent and ignores the whole file. ` +
      'Write plain text, or wrap the value in double quotes to keep it literally.'
  }
  if (!parsed.frontmatter.name) return 'Frontmatter must include a name field.'
  // C-12 (v10 audit): single-source the name shape — the inline copy of
  // SKILL_NAME_RE could silently drift from constants.ts.
  if (!SKILL_NAME_RE.test(parsed.frontmatter.name)) return `Invalid skill name "${parsed.frontmatter.name}" — use lowercase letters, digits, and hyphens.`
  if (parsed.frontmatter.name.length > limits.maxNameLength) return `Skill name exceeds ${limits.maxNameLength} characters.`
  if (expectedName && parsed.frontmatter.name !== expectedName) return `Frontmatter name "${parsed.frontmatter.name}" does not match target skill "${expectedName}".`
  if (!parsed.frontmatter.description) return 'Frontmatter must include a description field.'
  const description = parsed.frontmatter.description
  if (description.length > limits.maxDescriptionLength) return `Description exceeds ${limits.maxDescriptionLength} characters.`
  // S1.2: the limit is judged on the bytes that will land on disk, and a NET
  // SHRINK of an already-over-limit file is allowed (the repair path).
  if (exceedsContentLimit(content, limits.maxSkillContentChars) && !shrinksOverLimit(content, current, limits.maxSkillContentChars)) {
    return `SKILL.md content exceeds ${limits.maxSkillContentChars} characters. ` +
      'Consider splitting into a smaller SKILL.md with supporting files.'
  }
  return null
}

/** Hermes authoring quality bar for descriptions — see constants.ts
 * (0.3.16 T-4 moved the single source there; the public re-export sits behind
 * the package root, which re-exports constants anyway). */

export interface AuthoringFeedback {
  /** Frontmatter description length in characters (0 when absent). */
  descriptionChars: number
  /** Whether the description exceeds the authoring bar (60) while still passing the platform limit. */
  over60: boolean
  /** Whether the description contains a colon (the standard requires double-quote wrapping). */
  hasColon: boolean
  /** Advice lines appended to mutation success messages. */
  lines: string[]
}

/**
 * Advisory authoring feedback (P0): evaluate frontmatter against the
 * authoring bar WITHOUT changing platform validation semantics. The bar is
 * the quality target, `validateFrontmatter`'s limits are the compatibility
 * floor, and this bridge layer tells the model when its text would be
 * truncated or route-poor instead of silently shipping it.
 */
export function authoringFeedback(frontmatter: Frontmatter): AuthoringFeedback {
  const description = frontmatter.description ?? ''
  const over60 = description.length > AUTHORING_DESCRIPTION_BAR
  const hasColon = description.includes(':')
  const lines: string[] = []
  lines.push(over60
    ? `Description is ${description.length}/60 characters — exceeds the 60-char authoring bar (Hermes standard; the catalog truncates at the configured platform cap).`
    : `Description ${description.length}/60 characters — within the authoring bar.`)
  if (hasColon) lines.push('Description contains a colon — wrap the whole value in double quotes.')
  return { descriptionChars: description.length, over60, hasColon, lines }
}

/** A1-15 (v18) / P2-2 (v19): the io layer marks an error `committed: true` when
 * the rename landed and only the directory fsync failed. Every single-file
 * writer must treat that as "written, durability unconfirmed" — never as a
 * plain failure (which a caller would retry, or a two-phase caller roll back).
 * v28 G2.1 (EVO-IO-05): this is a delegation to the seam's own
 * `isCommittedWarning` — the marker predicate has exactly one definition. */
