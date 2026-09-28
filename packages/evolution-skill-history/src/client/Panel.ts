/**
 * The panel: one read, one open skill, one open row — and the faces that draw them.
 *
 * Everything a PERSON reads is decided elsewhere: what a row says is core's (`skill-row-cells.ts`,
 * shipped with the row), the words are the dictionary's, the tool face is `chrome.ts` and the reading
 * face is `document.ts`. What is left here is the STATE — which skill is open, which row is expanded,
 * which reads are in flight — and the two rules that only a state machine can hold: a read takes a
 * ticket so a slow reply cannot land on another skill, and a write reports its own result instead of
 * being erased by the read that follows it.
 * @module @deepseek-ai/dsh-evolution-skill-history/client
 */
import { createElement, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { emptyState, groupHeading, notice, panelHead, searchField, skillLine, versionRow, type Copy, type OpenKind } from './chrome.ts'
import { DiffBody, PreviewBody, type BodyState, type DiffState } from './document.ts'
import type { SkillRow, VersionBodyRow, VersionDiffRow, VersionsPayload, VersionRow } from './api.ts'
import type { MarkdownWords } from './markdown.ts'

/** What the panel is handed: the dictionary seat, the renderer's words, and the host's callbacks. */
export interface PanelFace extends Copy {
  /** The two words the platform Markdown renderer needs; the dictionary owns them. */
  readonly markdownWords: MarkdownWords
  readonly loadSkills: () => Promise<readonly SkillRow[]>
  readonly loadVersions: (name: string) => Promise<VersionsPayload>
  readonly loadDiff: (name: string, v: number) => Promise<VersionDiffRow>
  readonly loadBody: (name: string, v: number) => Promise<VersionBodyRow>
  readonly undo: (name: string, v?: number) => Promise<string>
}

/** The one expanded row. */
interface OpenRow {
  readonly v: number
  readonly kind: OpenKind
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

  /** What the refresh control does: both reads again, and the sentence stays. */
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
    // write already happened, so replacing it with \u201ccould not load\u201d would report the wrong thing.
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
  /** Drop the pending confirmation: the control that opened it must not be the only way out. */
  const cancelRestore = (): void => { setPending(undefined) }

  /** What one row shows when it is the open one. */
  const expandedOf = (row: VersionRow): ReactNode => {
    if (expanded === undefined || expanded.v !== row.v) return null
    if (expanded.kind === 'diff') {
      const state = diffs.get(row.v)
      return state === undefined ? null : createElement(DiffBody, { face, diff: state })
    }
    const state = bodies.get(row.v)
    return state === undefined ? null : createElement(PreviewBody, { face, body: state })
  }

  /** One group: a heading, an optional note, and its rows. */
  const group = (title: string, entries: readonly VersionRow[], noteText2: string | undefined): ReactNode => {
    if (entries.length === 0) return null
    return createElement('section', { key: title },
      ...groupHeading(title, noteText2),
      ...entries.map(row => versionRow({
        copy: face,
        row,
        confirming: pending === row.v,
        open: expanded !== undefined && expanded.v === row.v ? expanded.kind : undefined,
        expanded: expandedOf(row),
        onRestore: () => { restore(row.v) },
        onCancel: cancelRestore,
        onToggle: (kind: OpenKind) => { toggle(row.v, kind) },
      })))
  }

  return createElement('div', { className: 'evo-hist-root' },
    createElement('aside', { className: 'evo-hist-aside' },
      searchField(face, query, setQuery),
      createElement('div', { className: 'evo-hist-list' },
        skills.length === 0
          ? emptyState(face.t('empty.skills'))
          : visible.length === 0
            ? emptyState(face.t('search.none'))
            : visible.map(skill => skillLine(face, skill, skill.name === selected, () => { open(skill.name) })))),
    createElement('div', { className: 'evo-hist-main' },
      panelHead(face, refresh),
      notice(noteText, noteError),
      // The explanation is for the screen that has nothing else on it (W12): a reader who can see
      // versions does not need to be told what a version is.
      selected === undefined
        ? [
          emptyState(face.t(skills.length === 0 ? 'empty.skills' : 'empty.pick')),
          createElement('p', { key: 'hint', className: 'evo-hist-hint' }, face.t('hint')),
        ]
        : loaded
          ? null
          : emptyState(face.t('loading')),
      loaded
        ? createElement('div', null,
          group(face.t('group.content'), payload.content, undefined),
          group(face.t('group.support'), payload.support, face.t('group.support.note')),
          payload.content.length === 0 && payload.support.length === 0
            ? createElement('p', { className: 'evo-hist-hint' }, face.t('empty.versions'))
            : null)
        : null))
}

/**
 * The lazy-read cache without one key.
 *
 * A read that a later toggle superseded must leave nothing behind: `loading` is not an answer, and
 * the cache also serves as the \u201cdo not read twice\u201d guard, so an abandoned entry would refuse every
 * later read of that row and leave it saying \u201cloading\u201d until the page is reloaded.
 * @param current - the cache.
 * @param key - the version whose entry is dropped.
 * @returns a new cache without that key.
 */
function without<K, V>(current: ReadonlyMap<K, V>, key: K): Map<K, V> {
  const next = new Map(current)
  next.delete(key)
  return next
}
