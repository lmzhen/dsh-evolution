/**
 * Citation resolution for skill bodies and support files (design §5.2).
 *
 * WHY this exists beside `supportRefs` (skill-store.ts): that scanner answers
 * "does this text contain a path-shaped token", which is the right question
 * when a package is being ARCHIVED — every such path may dangle — and the wrong
 * one when a section is only being MOVED, where nothing leaves and the only
 * thing that changes is the directory a citation is read from. Measured false
 * positives of the token scan: a URL tail (`https://host/references/x.md`), a
 * category path the original Hermes documents as legitimate
 * (`skills/scripts/foo.py`), and a prose command line
 * (`npm run scripts/build.mjs`).
 *
 * CONTRACT: a token whose path STARTS WITH a support directory is a citation of
 * this skill and is resolved from the SKILL ROOT, in whichever file it is
 * written. A token that merely contains a support directory further along its
 * path belongs to something else: it is reported as `foreign` and never
 * resolved.
 *
 * PURE: existence is decided against the caller's file list, so identical
 * inputs always answer the same report.
 */

/** Support directories that make a path a citation of the owning skill. */
export const CITATION_SUPPORT_DIRS: readonly string[] = ['references', 'templates', 'scripts', 'assets']

/** How one path-shaped token was classified. */
export type CitationKind =
  /** Starts with a support directory: a citation of this skill. */
  | 'citation'
  /** Inside a fenced code block: illustrative, never resolved. */
  | 'fence'
  /** Tail of a URL. */
  | 'url'
  /** Contains a support directory further along its path (`skills/scripts/foo.py`). */
  | 'foreign'
  /** A command line naming a path (`npm run scripts/build.mjs`). */
  | 'prose'

/** One scanned token with its classification and resolution. */
export interface CitationRef {
  /** The matched token, verbatim, after trailing sentence punctuation is stripped. */
  raw: string
  /** 1-based line number in the scanned content. */
  line: number
  /** Skill-root-relative target, or null when the token is not a citation of this skill. */
  target: string | null
  /** The base a citation is read from; this scanner resolves the skill root only. */
  base: 'root'
  kind: CitationKind
  /** Whether `target` names a file in the caller's file list. */
  exists: boolean
  /** `#fragment` carried by the token, when present. */
  fragment?: string | undefined
}

/** One scan of a body or support file. */
export interface CitationReport {
  refs: readonly CitationRef[]
  /** Citations whose target is provably absent from the file list. */
  dangling: readonly CitationRef[]
  /** Citations a non-recursive listing cannot decide (target sits under a listed directory). */
  unverified: readonly CitationRef[]
  /** Path-shaped tokens that are not citations of this skill (foreign/url/prose/fence). */
  foreign: readonly CitationRef[]
  /** True when the scan stopped at the budget: a partial report never reads as clean. */
  truncated: boolean
}

/** Scan budget: bounded so a pathological body cannot stall a maintenance run. */
export const DEFAULT_CITATION_REF_BUDGET = 500

/** Words that introduce an executable command rather than a citation. */
const PROSE_COMMAND_PREFIXES: readonly string[] = ['npm', 'pnpm', 'yarn', 'npx', 'node', 'python', 'python3', 'bash', 'sh', 'git', 'gh', 'run']

const TOKEN_RE = /(?:references|templates|scripts|assets)\/[A-Za-z0-9._/-]+/g
const TOKEN_CHAR_RE = /[A-Za-z0-9._/-]/
const FENCE_RE = /^\s*(`{3,}|~{3,})/
const TRAILING_PUNCT_RE = /[.,;:]+$/
/** A citation's final segment must look like \u0060name.ext\u0060: a bare \u0060.\u0060 or a dotless
 * segment is a directory mention, not a file. */
const FILE_SEGMENT_RE = /^[^.].*\.[^.]+$/
const FRAGMENT_RE = /^#([A-Za-z0-9._-]+)/

/** Whether the token starting at `start` is the argument of a shell command. */
function isProseCommand(line: string, start: number): boolean {
  const head = line.slice(0, start).trimEnd()
  if (head === '') return false
  const word = head.split(/\s+/).pop() ?? ''
  return PROSE_COMMAND_PREFIXES.includes(word)
}

/** The token's final path segment (`references/a/b.md` -> `b.md`). */
function lastSegmentOf(target: string): string {
  return target.slice(target.lastIndexOf('/') + 1)
}

/** The token's parent directory within the skill (`references/a/b.md` -> `references/a`). */
function parentDirOf(target: string): string {
  const cut = target.lastIndexOf('/')
  return cut <= 0 ? '' : target.slice(0, cut)
}

/** Classify one token by its first path segment. */
function classifyToken(token: string): CitationKind {
  const head = token.split('/')[0] ?? ''
  return CITATION_SUPPORT_DIRS.includes(head) ? 'citation' : 'foreign'
}

/**
 * Resolve every path-shaped token in `content`.
 * @param input - content, the skill-root-relative path of its owner, the skill's
 *   file list, and an optional scan budget.
 * @returns the refs plus the dangling and foreign subsets; `truncated` marks a
 *   report that stopped at the budget.
 */
export function resolveCitations(input: {
  content: string
  file: string
  files: readonly string[]
  budget?: number | undefined
}): CitationReport {
  const budget = input.budget ?? DEFAULT_CITATION_REF_BUDGET
  const files = new Set(input.files.map(path => path.replace(/\\/g, '/')))
  const refs: CitationRef[] = []
  const seen = new Set<string>()
  let truncated = false
  let fence: string | null = null
  const lines = input.content.split('\n')
  for (let index = 0; index < lines.length && !truncated; index += 1) {
    const rawLine = lines[index] ?? ''
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    const fenceMark = FENCE_RE.exec(line)
    if (fenceMark) {
      const marker = fenceMark[1] ?? ''
      fence = fence === null ? marker.slice(0, 1) : null
      continue
    }
    for (const match of line.matchAll(TOKEN_RE)) {
      const matched = match[0]
      const matchedAt = match.index
      let start = matchedAt
      while (start > 0 && TOKEN_CHAR_RE.test(line[start - 1] ?? '')) start -= 1
      const prefix = line.slice(0, start)
      const tail = line.slice(matchedAt + matched.length)
      const fragment = FRAGMENT_RE.exec(tail)?.[1]
      const token = matched.replace(TRAILING_PUNCT_RE, '')
      const scanned = line.slice(start, matchedAt + matched.length)
      const classified: CitationKind = fence !== null
        ? 'fence'
        : prefix.endsWith(':') && line.slice(start, start + 2) === '//'
          ? 'url'
          : isProseCommand(line, start)
            ? 'prose'
            : classifyToken(scanned)
      // A citation names a FILE: a dotless last segment is a directory mention
      // (`references/templates/scripts` in prose), and a `..` segment is a
      // traversal — a different defect class the old scanner also skipped. Both
      // are prose unless the listing proves the path is a real entry.
      const traversal = scanned.split('/').includes('..')
      const namesFile = !traversal && (FILE_SEGMENT_RE.test(lastSegmentOf(scanned)) || files.has(token))
      const kind: CitationKind = classified === 'citation' && !namesFile ? 'prose' : classified
      const target = kind === 'citation' ? token : null
      const key = `${index}|${kind}|${target ?? token}`
      if (seen.has(key)) continue
      seen.add(key)
      refs.push({
        raw: token,
        line: index + 1,
        target,
        base: 'root',
        kind,
        exists: target !== null && files.has(target),
        ...(fragment === undefined ? {} : { fragment }),
      })
      if (refs.length >= budget) {
        truncated = true
        break
      }
    }
  }
  const citations = refs.filter(ref => ref.kind === 'citation')
  const undecidable = (ref: CitationRef): boolean => {
    const target = ref.target
    return target !== null && !ref.exists && files.has(parentDirOf(target))
  }
  return {
    refs,
    dangling: citations.filter(ref => !ref.exists && !undecidable(ref)),
    unverified: citations.filter(undecidable),
    foreign: refs.filter(ref => ref.kind !== 'citation'),
    truncated,
  }
}

/** The sanctioned body hook (design §5.6): a list item whose payload is
 * exactly one support-file path, so the file stays discoverable in the body. */
export const HOOK_LINE_RE = /^- [^\n]{1,60} → ((?:references|templates|scripts|assets)\/[a-z0-9][a-z0-9._/-]*)$/

/** The retirement escape hatch (design §5.6): a standalone body comment that
 * names the support file it exempts and the reason it must survive. The path
 * is part of the marker because the proposal list is per FILE, and a reason is
 * required — an unexplained exemption is what this hook exists to prevent. */
export const KEEP_LINE_RE = /^<!--\s*keep:\s*((?:references|templates|scripts|assets)\/[a-z0-9][a-z0-9._/-]*)\s+(\S[^>]*?)\s*-->$/

/** Whether a skill-relative path names a FILE rather than a directory: the same
 * rule the scanner applies to a token's final segment (`name.ext`). The support
 * listing is one level deep and includes directory entries (a real library has
 * `references/archive`), which no pointer or retirement list may treat as a file.
 * @param path - a skill-root-relative support path.
 * @returns true when the final segment is file-shaped.
 */
export function isFileShapedPath(path: string): boolean {
  return FILE_SEGMENT_RE.test(path.slice(path.lastIndexOf('/') + 1))
}

/** Result of one hook scan over a body. */
export interface BodyHookScan {
  /** Targets named by a sanctioned hook line, in file order, deduplicated. */
  targets: readonly string[]
  /** Target -> the reason its `keep` marker records. */
  kept: ReadonlyMap<string, string>
}

/**
 * Scan a body for sanctioned hooks and `keep` markers.
 * @param content - the SKILL.md body (frontmatter included).
 * @returns hook targets plus the `keep` reasons keyed by target.
 */
export function scanBodyHooks(content: string): BodyHookScan {
  const targets: string[] = []
  const seen = new Set<string>()
  const kept = new Map<string, string>()
  // A hook-shaped line inside a fenced block is sample text, not a pointer.
  let fence: string | null = null
  for (const rawLine of content.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    const fenceMark = FENCE_RE.exec(line)
    if (fenceMark) {
      fence = fence === null ? (fenceMark[1] ?? '').slice(0, 1) : null
      continue
    }
    if (fence !== null) continue
    const keep = KEEP_LINE_RE.exec(line)
    if (keep?.[1] !== undefined) {
      kept.set(keep[1], (keep[2] ?? '').trim())
      continue
    }
    const target = HOOK_LINE_RE.exec(line)?.[1]
    if (target === undefined || seen.has(target)) continue
    seen.add(target)
    targets.push(target)
  }
  return { targets, kept }
}
