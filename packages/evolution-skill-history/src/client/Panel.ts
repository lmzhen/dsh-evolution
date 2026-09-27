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
import type { SkillRow, VersionDiffRow, VersionRow, VersionsPayload } from './api.ts'

/** The face the plugin hands the component: copy plus callbacks, never a service handle. */
export interface PanelFace {
  readonly t: (key: string) => string
  /** Fill one copy key's `{n}` slots (the dictionaries own the sentences). */
  readonly format: (key: string, values: Record<string, string | number>) => string
  readonly loadSkills: () => Promise<readonly SkillRow[]>
  readonly loadVersions: (name: string) => Promise<VersionsPayload>
  readonly loadDiff: (name: string, v: number) => Promise<VersionDiffRow>
  readonly undo: (name: string, v?: number) => Promise<string>
}

/** What one expanded row holds: the diff, still loading, or a refusal. */
type DiffState = { kind: 'loading' } | { kind: 'ready'; diff: VersionDiffRow } | { kind: 'failed'; message: string }

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

/** One version row: what happened, when, how big, and what it is against. */
function versionRow(
  face: PanelFace,
  row: VersionRow,
  confirming: number | undefined,
  openDiff: number | undefined,
  diff: DiffState | undefined,
  restore: (v: number) => void,
  cancelRestore: () => void,
  toggleDiff: (v: number) => void,
): ReactNode {
  const parts: ReactNode[] = [
    createElement('span', { key: 'v', className: 'evo-hist-row-meta' }, 'v' + String(row.v)),
    createElement('span', { key: 'action' }, face.t('action.' + row.actionKind)),
    createElement('span', { key: 'time', className: 'evo-hist-row-meta' }, localTime(row.at) + ' · ' + ageText(face, row.age)),
  ]
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
      onClick: () => { toggleDiff(row.v) },
    }, openDiff === row.v ? face.t('diff.hide') : face.t('diff.show')))
  }
  return createElement('div', { key: String(row.v), className: 'evo-hist-row' },
    createElement('div', { className: 'evo-hist-row-body' },
      createElement('div', { className: 'evo-hist-row-title' }, parts),
      row.summary === undefined || row.summary === ''
        ? null
        : createElement('div', { className: 'evo-hist-row-summary' }, row.summary),
      openDiff === row.v && diff !== undefined ? diffBody(face, diff) : null,
    ),
    createElement('div', { className: 'evo-hist-actions' }, actions),
  )
}

/** The expanded body of one row: the diff, a loading line, or the refusal. */
function diffBody(face: PanelFace, diff: DiffState): ReactNode {
  if (diff.kind === 'loading') return createElement('p', { className: 'evo-hist-note' }, face.t('diff.loading'))
  if (diff.kind === 'failed') return createElement('p', { className: 'evo-hist-note', 'data-error': 'true' }, diff.message)
  const against = diff.diff.against === null
    ? face.t('diff.first')
    : face.format('diff.against', { n: diff.diff.against })
  return createElement('div', null,
    createElement('p', { className: 'evo-hist-note' },
      against + ' · ' + face.format('diff.added', { n: diff.diff.linesAdded })
      + ' · ' + face.format('diff.removed', { n: diff.diff.linesRemoved })
      + (diff.diff.truncated ? ' · ' + face.t('diff.truncated') : '')),
    diffBlock(diff.diff),
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
      state.openDiff,
      state.diffs.get(entry.v),
      state.restore,
      state.cancelRestore,
      state.toggleDiff,
    )),
  )
}

/** The per-render state the row builders read. */
interface RowState {
  readonly confirming: number | undefined
  readonly openDiff: number | undefined
  readonly diffs: ReadonlyMap<number, DiffState>
  readonly restore: (v: number) => void
  readonly cancelRestore: () => void
  readonly toggleDiff: (v: number) => void
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
  const [openDiff, setOpenDiff] = useState<number | undefined>(undefined)
  const [diffs, setDiffs] = useState<ReadonlyMap<number, DiffState>>(new Map())
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
    setOpenDiff(undefined)
    setDiffs(new Map())
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

  const toggleDiff = (v: number): void => {
    if (selected === undefined) return
    if (openDiff === v) {
      setOpenDiff(undefined)
      return
    }
    setOpenDiff(v)
    if (diffs.has(v)) return
    const name = selected
    // The diff read takes the SAME ticket as a rows read: a slow reply for a skill the operator has
    // already left must not land in the next skill's map, where the version numbers would name a
    // different body.
    const ticket = readTicket.current + 1
    readTicket.current = ticket
    setDiffs(current => new Map(current).set(v, { kind: 'loading' }))
    void face.loadDiff(name, v).then((diff) => {
      if (readTicket.current !== ticket) return
      setDiffs(current => new Map(current).set(v, { kind: 'ready', diff }))
    }).catch((error: unknown) => {
      if (readTicket.current !== ticket) return
      const message = face.t('error') + ': ' + (error instanceof Error ? error.message : String(error))
      setDiffs(current => new Map(current).set(v, { kind: 'failed', message }))
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

  const rowState: RowState = { confirming: pending, openDiff, diffs, restore, cancelRestore, toggleDiff }
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
              'aria-current': skill.name === selected ? 'true' : undefined,
              onClick: () => { open(skill.name) },
            },
            createElement('span', { className: 'evo-hist-skill-line' },
              createElement('span', { className: 'evo-hist-skill-name' }, skill.name),
              createElement('span', { className: 'evo-hist-skill-count' }, String(skill.versions) + ' ' + face.t('versions.count')),
            ),
            createElement('span', { className: 'evo-hist-skill-desc' }, oneLine(skill.description) + ' · ' + face.t(stateKey(skill))),
            )),
      ),
    ),
    createElement('div', { className: 'evo-hist-main' },
      createElement('div', { className: 'evo-hist-head' },
        createElement('h2', { className: 'evo-hist-title' }, face.t('title')),
        createElement('button', { type: 'button', className: 'evo-hist-button', onClick: refresh }, face.t('refresh')),
      ),
      createElement('p', { className: 'evo-hist-hint' }, face.t('hint')),
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
