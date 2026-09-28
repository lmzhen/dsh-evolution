/**
 * The skill-history panel: the skills that recorded versions, the two chains of the selected skill,
 * and one action per body version (restore, behind an inline confirmation).
 *
 * The panel owns no rule and no arithmetic: the host reports each row with its whole verdict
 * (`undoable`, the vocabulary key `actionKind`, the `age` bucket, `charsDelta`, `summary`) and this
 * file substitutes WORDS through the locale dictionary and renders. It never subscribes to anything
 * and never sees the context.
 *
 * State rules, each pinned by a live pass or a component spec: a restore's result sentence stays on
 * screen while the rows are read again; nothing is read on a poll (mount, opening a skill, the
 * refresh button, after a restore); a late reply for a skill the operator has already left is
 * discarded by its ticket; and the diff is fetched only when a row is expanded.
 * @module @deepseek-ai/dsh-evolution-skill-history/client
 */

import { createElement, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { SkillRow, VersionBodyRow, VersionDiffRow, VersionRow, VersionsPayload } from './api.ts'
import { renderMarkdown, type MarkdownWords } from './markdown.ts'

/** The face the plugin hands the component: copy plus callbacks, never a service handle. */
export interface PanelFace {
  readonly t: (key: string) => string
  /** Fill one copy key's `{n}` slots (the dictionaries own the sentences). */
  readonly format: (key: string, values: Record<string, string | number>) => string
  readonly loadSkills: () => Promise<readonly SkillRow[]>
  readonly loadVersions: (name: string) => Promise<VersionsPayload>
  readonly loadDiff: (name: string, v: number) => Promise<VersionDiffRow>
  readonly loadBody: (name: string, v: number) => Promise<VersionBodyRow>
  readonly undo: (name: string, v?: number) => Promise<string>
  /** The two words the platform Markdown renderer needs; the dictionary owns them. */
  readonly markdownWords: MarkdownWords
}

/** What one expanded row holds: the diff, still loading, or a refusal. */
type DiffState = { kind: 'loading' } | { kind: 'ready'; diff: VersionDiffRow } | { kind: 'failed'; message: string }

/** What one expanded preview holds. */
type BodyState = { kind: 'loading' } | { kind: 'ready'; body: VersionBodyRow } | { kind: 'failed'; message: string }

/** Which expansion a row shows. Only one row is expanded at a time. */
type OpenKind = 'diff' | 'preview'

/** The one expanded row. */
interface OpenRow {
  readonly v: number
  readonly kind: OpenKind
}

/** Cut a description to one line's worth of characters (the CSS ellipsises the rest). */
function oneLine(text: string): string {
  const firstLine = text.split('\n')[0] ?? ''
  return firstLine.length > 120 ? firstLine.slice(0, 119) + '…' : firstLine
}

/** The local time an ISO timestamp names, as the operator's own clock shows it. */
function localTime(at: string): string {
  const parsed = Date.parse(at)
  if (Number.isNaN(parsed)) return at
  const date = new Date(parsed)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return String(date.getFullYear()) + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
    + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
}

/** The state word one skill row carries, from the facts the listing reported. */
function stateKey(skill: SkillRow): string {
  if (skill.protectionUnknown) return 'state.unknown'
  if (skill.protectedBy !== null) return 'state.protected'
  return skill.managed ? 'state.managed' : 'state.foreign'
}

/**
 * The one clause an action word needs: what the recorded artifact IS. It rides the action word's
 * `title` instead of widening the row (a parenthetical in the sentence pushed time and size aside).
 * @param face - copy plus the data callbacks.
 * @param row - the version row whose action is being named.
 * @returns the clause, or undefined for the actions that need none.
 */
function actionNote(face: PanelFace, row: VersionRow): string | undefined {
  if (row.actionKind === 'delete') return face.t('action.delete.note')
  if (row.actionKind === 'archive') return face.t('action.archive.note')
  return undefined
}

/**
 * The lazy-read cache without one key.
 *
 * A read that a later toggle superseded must leave nothing behind: `loading` is not an answer, and
 * the cache also serves as the "do not read twice" guard, so an abandoned entry would refuse every
 * later read of that row and leave it saying "loading" until the page is reloaded.
 * @param current - the cache.
 * @param key - the version whose entry is dropped.
 * @returns a new cache without that key.
 */
function without<K, V>(current: ReadonlyMap<K, V>, key: K): Map<K, V> {
  const next = new Map(current)
  next.delete(key)
  return next
}

/** The relative-time sentence for one row's bucket. */
function ageText(face: PanelFace, age: VersionRow['age']): string {
  if (age.unit === 'now') return face.t('time.now')
  // One of a unit is spelled on its own: "1 minutes ago" is the kind of seam a reader notices.
  return age.n === 1 ? face.t('time.' + age.unit + '.one') : face.format('time.' + age.unit, { n: age.n })
}

/** The character delta of one row, or null when it is the first version. */
function deltaText(face: PanelFace, row: VersionRow): string | null {
  if (row.charsDelta === undefined || row.charsDelta === 0) return null
  return row.charsDelta > 0
    ? face.format('row.delta.up', { n: row.charsDelta })
    : face.format('row.delta.down', { n: -row.charsDelta })
}

/** One `<pre>` rendering of a diff: added lines marked `+`, removed ones `-`. */
function diffBlock(diff: VersionDiffRow): ReactNode {
  const rows: ReactNode[] = []
  for (const hunk of diff.hunks) {
    for (const [index, line] of hunk.oldText.split('\n').entries()) {
      if (hunk.oldText === '' && line === '') continue
      rows.push(createElement('div', { key: 'old-' + String(index), className: 'evo-hist-pre-del' }, '- ' + line))
    }
    for (const [index, line] of hunk.newText.split('\n').entries()) {
      if (hunk.newText === '' && line === '') continue
      rows.push(createElement('div', { key: 'new-' + String(index), className: 'evo-hist-pre-add' }, '+ ' + line))
    }
  }
  return createElement('pre', { className: 'evo-hist-pre' }, rows.length === 0 ? '±' : rows)
}

/**
 * The same diff, both sides rendered as Markdown and stacked: the removed text first, then the
 * added one. Block level on purpose — line-level interleaving of two rendered documents is a
 * different (and much larger) problem, and the source view stays one click away for exact bytes.
 * @param face - copy plus the data callbacks.
 * @param diff - the windowed change the host reported.
 * @returns the stacked blocks.
 */
function renderedBlocks(face: PanelFace, diff: VersionDiffRow): ReactNode[] | null {
  const blocks: ReactNode[] = []
  for (const [index, hunk] of diff.hunks.entries()) {
    if (hunk.oldText !== '') {
      const side = renderedSide(face, '−', 'del', hunk.oldText)
      if (side === null) return null
      blocks.push(createElement('div', { key: 'del-' + String(index) }, side))
    }
    if (hunk.newText !== '') {
      const side = renderedSide(face, '+', 'add', hunk.newText)
      if (side === null) return null
      blocks.push(createElement('div', { key: 'add-' + String(index) }, side))
    }
  }
  return blocks.length === 0 ? null : blocks
}

/**
 * One diff in the mode the reader asked for, degrading to the source view when the renderer is out.
 * @param face - copy plus the data callbacks.
 * @param diff - the windowed change the host reported.
 * @param mode - source or rendered.
 * @returns the element to draw.
 */
function diffView(face: PanelFace, diff: VersionDiffRow, mode: 'source' | 'rendered'): ReactNode {
  if (mode === 'rendered') {
    const blocks = renderedBlocks(face, diff)
    if (blocks !== null) return createElement('div', { className: 'evo-hist-render' }, blocks)
  }
  return diffBlock(diff)
}

/** One version row: what happened, when, how big, and what it is against. */
function versionRow(
  face: PanelFace,
  row: VersionRow,
  confirming: number | undefined,
  expanded: OpenRow | undefined,
  diff: DiffState | undefined,
  body: BodyState | undefined,
  restore: (v: number) => void,
  cancelRestore: () => void,
  toggle: (v: number, kind: OpenKind) => void,
): ReactNode {
  const showing = (kind: OpenKind): boolean => expanded !== undefined && expanded.v === row.v && expanded.kind === kind
  const parts: ReactNode[] = [
    createElement('span', { key: 'v', className: 'evo-hist-row-meta' }, 'v' + String(row.v)),
    createElement('span', { key: 'action', title: actionNote(face, row) }, face.t('action.' + row.actionKind)),
    // The relative age is the scannable fact; the absolute clock is the hover text (one time, not two).
    createElement('span', { key: 'time', className: 'evo-hist-row-meta', title: localTime(row.at) }, ageText(face, row.age)),
  ]
  // Which FILE a support version belongs to: legacy rows have no name recorded (the bytes carry
  // none), and saying so is better than the generic word alone.
  if (row.path !== undefined) {
    parts.push(createElement('span', { key: 'path', className: 'evo-hist-row-meta', title: row.path }, row.path))
  } else if (row.actionKind === 'support-write' || row.actionKind === 'support-remove') {
    parts.push(createElement('span', { key: 'path', className: 'evo-hist-row-meta' }, face.t('path.unrecorded')))
  }
  const delta = deltaText(face, row)
  if (delta !== null) parts.push(createElement('span', { key: 'delta', className: 'evo-hist-row-meta' }, delta))
  const actions: ReactNode[] = []
  if (row.undoable === false) actions.push(createElement('span', { key: 'current', className: 'evo-hist-capsule' }, face.t('current')))
  if (row.undoable === true) {
    // The confirmation is a second click on the same button, so it needs an exit of its own: without
    // one the only way back was clicking another row's button, which silently moved the pending write.
    if (confirming === row.v) {
      actions.push(createElement('button', {
        key: 'cancel',
        type: 'button',
        className: 'evo-hist-button',
        onClick: () => { cancelRestore() },
      }, face.t('undo.no')))
    }
    actions.push(createElement('button', {
      key: 'undo',
      type: 'button',
      className: 'evo-hist-button',
      'data-tone': confirming === row.v ? 'primary' : undefined,
      onClick: () => { restore(row.v) },
    }, confirming === row.v ? face.t('undo.confirm') : face.t('undo')))
  }
  if (row.undoable === true || row.charsDelta !== undefined) {
    actions.push(createElement('button', {
      key: 'diff',
      type: 'button',
      className: 'evo-hist-button',
      onClick: () => { toggle(row.v, 'diff') },
    }, showing('diff') ? face.t('diff.hide') : face.t('diff.show')))
  }
  // Every version can be READ as a document, support files included: that is what the body route is for.
  actions.push(createElement('button', {
    key: 'preview',
    type: 'button',
    className: 'evo-hist-button',
    onClick: () => { toggle(row.v, 'preview') },
  }, showing('preview') ? face.t('preview.hide') : face.t('preview.show')))
  return createElement('div', { key: String(row.v), className: 'evo-hist-row' },
    createElement('div', { className: 'evo-hist-row-body' },
      createElement('div', { className: 'evo-hist-row-title' }, parts),
      row.summary === undefined || row.summary === ''
        ? null
        : createElement('div', { className: 'evo-hist-row-summary' }, row.summary),
      showing('diff') && diff !== undefined ? createElement(DiffBody, { face, diff }) : null,
      showing('preview') && body !== undefined ? createElement(BodyView, { face, body }) : null,
    ),
    createElement('div', { className: 'evo-hist-actions' }, actions),
  )
}

/** One rendered side of a diff: an "old" or "new" block under a tinted edge. */
function renderedSide(face: PanelFace, mark: string, side: 'del' | 'add', text: string): ReactNode {
  const rendered = renderMarkdown(text, face.markdownWords)
  if (!rendered.ok) return null
  return createElement('div', { className: 'evo-hist-render-block evo-hist-render-' + side },
    createElement('span', { className: 'evo-hist-render-tag' }, mark),
    rendered.node,
  )
}

/**
 * One version read as a document: the platform renderer when it is there, plain text when it is not.
 * A preview therefore degrades to the exact bytes instead of blanking.
 * @param props - the face and the body state to draw.
 * @returns the element.
 */
function BodyView(props: { face: PanelFace; body: BodyState }): ReactNode {
  const { face, body } = props
  if (body.kind === 'loading') return createElement('p', { className: 'evo-hist-note' }, face.t('diff.loading'))
  if (body.kind === 'failed') return createElement('p', { className: 'evo-hist-note', 'data-error': 'true' }, body.message)
  const rendered = renderMarkdown(body.body.text, face.markdownWords)
  return createElement('div', { className: 'evo-hist-preview' },
    body.body.truncated ? createElement('p', { className: 'evo-hist-note' }, face.t('preview.truncated')) : null,
    rendered.ok ? rendered.node : createElement('pre', { className: 'evo-hist-pre' }, body.body.text),
  )
}

/**
 * The expanded body of one row: the diff, a loading line, or the refusal.
 *
 * The source/rendered toggle is LOCAL to this view: which row is open is the panel's business, but
 * how one open diff is displayed is not, so the state does not climb into the parent.
 * @param props - the face and the diff state to draw.
 * @returns the element.
 */
function DiffBody(props: { face: PanelFace; diff: DiffState }): ReactNode {
  const { face, diff } = props
  const [mode, setMode] = useState<'source' | 'rendered'>('source')
  if (diff.kind === 'loading') return createElement('p', { className: 'evo-hist-note' }, face.t('diff.loading'))
  if (diff.kind === 'failed') return createElement('p', { className: 'evo-hist-note', 'data-error': 'true' }, diff.message)
  const against = diff.diff.against === null
    ? face.t('diff.first')
    : face.format('diff.against', { n: diff.diff.against })
  const toggle = createElement('div', { className: 'evo-hist-diff-toggle' },
    createElement('button', {
      key: 'source',
      type: 'button',
      className: 'evo-hist-button',
      'data-tone': mode === 'source' ? 'primary' : undefined,
      onClick: () => { setMode('source') },
    }, face.t('diff.source')),
    createElement('button', {
      key: 'rendered',
      type: 'button',
      className: 'evo-hist-button',
      'data-tone': mode === 'rendered' ? 'primary' : undefined,
      onClick: () => { setMode('rendered') },
    }, face.t('diff.rendered')),
  )
  return createElement('div', null,
    createElement('div', { className: 'evo-hist-diff-head' },
      createElement('p', { className: 'evo-hist-note' },
        against + ' · ' + face.format('diff.added', { n: diff.diff.linesAdded })
        + ' · ' + face.format('diff.removed', { n: diff.diff.linesRemoved })
        + (diff.diff.truncated ? ' · ' + face.t('diff.truncated') : '')),
      toggle),
    diffView(face, diff.diff, mode),
  )
}

/** One group: a heading, an optional note, and its rows. */
function group(face: PanelFace, title: string, entries: readonly VersionRow[], noteText: string | undefined, state: RowState): ReactNode {
  if (entries.length === 0) return null
  return createElement('section', { key: title },
    createElement('h3', { className: 'evo-hist-group' }, title),
    noteText === undefined ? null : createElement('p', { className: 'evo-hist-hint' }, noteText),
    ...entries.map(entry => versionRow(
      face,
      entry,
      state.confirming,
      state.expanded,
      state.diffs.get(entry.v),
      state.bodies.get(entry.v),
      state.restore,
      state.cancelRestore,
      state.toggle,
    )),
  )
}

/** The per-render state the row builders read. */
interface RowState {
  readonly confirming: number | undefined
  readonly expanded: OpenRow | undefined
  readonly diffs: ReadonlyMap<number, DiffState>
  readonly bodies: ReadonlyMap<number, BodyState>
  readonly restore: (v: number) => void
  readonly cancelRestore: () => void
  readonly toggle: (v: number, kind: OpenKind) => void
}

/**
 * The panel body.
 * @param face - copy plus the data callbacks.
 * @returns the panel element.
 */
export function SkillHistoryPanel(face: PanelFace): ReactNode {
  const [skills, setSkills] = useState<readonly SkillRow[]>([])
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [payload, setPayload] = useState<VersionsPayload | undefined>(undefined)
  const [noteText, setNoteText] = useState<string | undefined>(undefined)
  const [noteError, setNoteError] = useState(false)
  const [pending, setPending] = useState<number | undefined>(undefined)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<OpenRow | undefined>(undefined)
  const [diffs, setDiffs] = useState<ReadonlyMap<number, DiffState>>(new Map())
  const [bodies, setBodies] = useState<ReadonlyMap<number, BodyState>>(new Map())
  // Every rows read takes a ticket, and only the newest one may write state. Without it a slow reply
  // for skill A lands while B is open: B would show A's rows, and B's restore buttons would post A's
  // version number at B's name — a write against the wrong skill.
  const readTicket = useRef(0)

  const failed = (error: unknown): void => {
    setNoteError(true)
    setNoteText(face.t('error.hint') + '\n' + face.t('error') + ': '
      + (error instanceof Error ? error.message : String(error)))
  }

  const succeeded = (message: string): void => {
    setNoteError(false)
    setNoteText(message)
  }

  /** Read the skills again, keeping the sentence: a re-read is not an answer to anything. */
  const reloadSkills = (): void => {
    void face.loadSkills().then(setSkills).catch(failed)
  }

  /**
   * Show one skill's chains, keeping the sentence. A re-read that FAILS reports through the caller's
   * own handler, so the failure of a read can never erase the write it was reading after.
   * @param name - the skill to open.
   * @param onFailure - what to do with a failed read.
   */
  const showVersions = (name: string, onFailure: (error: unknown) => void = failed): void => {
    const ticket = readTicket.current + 1
    readTicket.current = ticket
    setSelected(name)
    setPayload(undefined)
    setPending(undefined)
    setExpanded(undefined)
    setDiffs(new Map())
    setBodies(new Map())
    void face.loadVersions(name).then((next) => {
      if (readTicket.current === ticket) setPayload(next)
    }).catch((error: unknown) => {
      if (readTicket.current === ticket) onFailure(error)
    })
  }

  /** Open a skill from the list: another skill's sentence described another skill, so it goes away. */
  const open = (name: string): void => {
    if (name !== selected) {
      setNoteText(undefined)
      setNoteError(false)
    }
    showVersions(name)
  }

  /** What the refresh button does: both reads again, and the sentence stays. */
  const refresh = (): void => {
    reloadSkills()
    if (selected !== undefined) showVersions(selected)
  }

  const restore = (v: number): void => {
    if (selected === undefined) return
    if (pending !== v) {
      setPending(v)
      return
    }
    setPending(undefined)
    const name = selected
    // The result sentence is the curator's — shown verbatim, then the rows are READ AGAIN because the
    // restore itself recorded a new version. A re-read that fails is APPENDED to that sentence: the
    // write already happened, so replacing it with "could not load" would report the wrong thing.
    void face.undo(name, v).then((message) => {
      showVersions(name, (error) => {
        setNoteError(true)
        setNoteText(message + '\n' + face.t('error') + ': ' + (error instanceof Error ? error.message : String(error)))
      })
      succeeded(message)
    }).catch(failed)
  }

  /**
   * Expand one row, or collapse it: one row is open at a time, and each kind keeps its own lazy read.
   * @param v - the version whose row was clicked.
   * @param kind - which expansion the row should show.
   */
  const toggle = (v: number, kind: OpenKind): void => {
    if (selected === undefined) return
    if (expanded !== undefined && expanded.v === v && expanded.kind === kind) {
      setExpanded(undefined)
      return
    }
    setExpanded({ v, kind })
    // A cached answer costs nothing and must not invalidate a read already in flight.
    if (kind === 'diff' ? diffs.has(v) : bodies.has(v)) return
    const name = selected
    // Both lazy reads take the SAME ticket as a rows read: a slow reply for a skill the operator has
    // already left must not land in the next skill's map, where the version numbers would name a
    // different body (or a different file).
    const ticket = readTicket.current + 1
    readTicket.current = ticket
    const failedMessage = (error: unknown): string => face.t('error') + ': ' + (error instanceof Error ? error.message : String(error))
    if (kind === 'diff') {
      setDiffs(current => new Map(current).set(v, { kind: 'loading' }))
      void face.loadDiff(name, v).then((diff) => {
        if (readTicket.current !== ticket) { setDiffs(current => without(current, v)); return }
        setDiffs(current => new Map(current).set(v, { kind: 'ready', diff }))
      }).catch((error: unknown) => {
        if (readTicket.current !== ticket) { setDiffs(current => without(current, v)); return }
        setDiffs(current => new Map(current).set(v, { kind: 'failed', message: failedMessage(error) }))
      })
      return
    }
    setBodies(current => new Map(current).set(v, { kind: 'loading' }))
    void face.loadBody(name, v).then((body) => {
      if (readTicket.current !== ticket) { setBodies(current => without(current, v)); return }
      setBodies(current => new Map(current).set(v, { kind: 'ready', body }))
    }).catch((error: unknown) => {
      if (readTicket.current !== ticket) { setBodies(current => without(current, v)); return }
      setBodies(current => new Map(current).set(v, { kind: 'failed', message: failedMessage(error) }))
    })
  }

  // One read on mount; every later read is a user action. There is no store and no subscription.
  useEffect(reloadSkills, [])

  const needle = query.trim().toLowerCase()
  const visible = useMemo(() => needle === ''
    ? skills
    : skills.filter(skill => skill.name.toLowerCase().includes(needle) || skill.description.toLowerCase().includes(needle)),
  [skills, needle])

  const loaded = payload !== undefined
  /** Drop the pending confirmation: the button that opened it must not be the only way out. */
  const cancelRestore = (): void => { setPending(undefined) }

  const rowState: RowState = { confirming: pending, expanded, diffs, bodies, restore, cancelRestore, toggle }
  return createElement('div', { className: 'evo-hist-root' },
    createElement('aside', { className: 'evo-hist-aside' },
      createElement('div', { className: 'evo-hist-search' },
        createElement('input', {
          type: 'search',
          value: query,
          placeholder: face.t('search'),
          'aria-label': face.t('search'),
          onChange: (event: { target: { value: string } }) => { setQuery(event.target.value) },
        }),
      ),
      createElement('div', { className: 'evo-hist-list' },
        skills.length === 0
          ? createElement('p', { className: 'evo-hist-empty' }, face.t('empty.skills'))
          : visible.length === 0
            ? createElement('p', { className: 'evo-hist-empty' }, face.t('search.none'))
            : visible.map(skill => createElement('button', {
              key: skill.name,
              type: 'button',
              className: 'evo-hist-skill',
              // The row ellipsises a long name; the full one stays reachable on hover.
              title: skill.name,
              'aria-current': skill.name === selected ? 'true' : undefined,
              onClick: () => { open(skill.name) },
            },
            createElement('span', { className: 'evo-hist-skill-line' },
              createElement('span', { className: 'evo-hist-skill-name' }, skill.name),
              createElement('span', { className: 'evo-hist-skill-count' }, String(skill.versions) + ' ' + face.t('versions.count')),
            ),
            createElement('span', { className: 'evo-hist-skill-desc' }, oneLine(skill.description) + ' · ' + face.t(stateKey(skill))
              // Last changed rides the description line: the name above must not be squeezed (it is the
              // row's identity, and a longer name would only truncate sooner).
              + (skill.age === null ? '' : ' · ' + ageText(face, skill.age))),
            )),
      ),
    ),
    createElement('div', { className: 'evo-hist-main' },
      createElement('div', { className: 'evo-hist-head' },
        createElement('h2', { className: 'evo-hist-title' }, face.t('title')),
        createElement('button', { type: 'button', className: 'evo-hist-button', onClick: refresh }, face.t('refresh')),
      ),
      createElement('p', { className: 'evo-hist-hint' }, face.t('hint')),
      selected === undefined
        ? createElement('p', { className: 'evo-hist-pane-empty' }, face.t(skills.length === 0 ? 'empty.skills' : 'empty.pick'))
        : null,
      noteText === undefined ? null : createElement('p', { className: 'evo-hist-note', 'data-error': noteError ? 'true' : undefined }, noteText),
      selected === undefined ? null : (loaded ? null : createElement('p', { className: 'evo-hist-hint' }, face.t('loading'))),
      loaded
        ? createElement('div', null,
          group(face, face.t('group.content'), payload.content, undefined, rowState),
          group(face, face.t('group.support'), payload.support, face.t('group.support.note'), rowState),
          payload.content.length === 0 && payload.support.length === 0 ? createElement('p', { className: 'evo-hist-hint' }, face.t('empty.versions')) : null,
        )
        : null,
    ),
  )
}
