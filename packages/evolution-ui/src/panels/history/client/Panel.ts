/**
 * The panel: one read, one open skill, one open row — and the faces that draw them.
 *
 * Everything a PERSON reads is decided elsewhere: what a row says is core's (`skill-row-cells.ts`,
 * shipped with the row), the words are the dictionary's, the tool face is `chrome.ts` and the reading
 * face is `document.ts`. What is left here is the STATE — which skill is open, which row is expanded,
 * which reads are in flight — and the two rules that only a state machine can hold: a read takes a
 * ticket so a slow reply cannot land on another skill, and a write reports its own result instead of
 * being erased by the read that follows it.
 * @module @deepseek-ai/dsh-evolution-ui/panels/history/client
 */
import { createElement, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { emptyState, groupHeading, notice, panelHead, searchField, skillLine, versionRow, type Copy, type OpenKind } from './chrome.ts'
import { DiffBody, PreviewBody, type BodyState, type DiffState } from './document.ts'
import { historyViewModel } from './history-presentation.ts'
import { SkillHistoryRefusal, type SkillRow, type VersionBodyRow, type VersionDiffRow, type VersionsPayload, type VersionRow } from './api.ts'
import type { RouteFailure } from '@lmzhen/dsh-evolution-client-kit/generated/route-client'
import { FailureBlock } from '@lmzhen/dsh-evolution-client-kit/generated/states'
import { FALLBACKS } from '@lmzhen/dsh-evolution-client-kit/generated/fallbacks'
import type { MarkdownWords } from './markdown.ts'

/** What the panel is handed: the dictionary seat, the renderer's words, and the host's callbacks. */
export interface PanelFace extends Copy {
  /** The two words the platform Markdown renderer needs; the dictionary owns them. */
  readonly markdownWords: MarkdownWords
  readonly loadSkills: () => Promise<readonly SkillRow[]>
  readonly loadVersions: (name: string) => Promise<VersionsPayload>
  readonly loadDiff: (name: string, v: number) => Promise<VersionDiffRow>
  readonly loadBody: (name: string, v: number) => Promise<VersionBodyRow>
  readonly undo: (name: string, v?: number, unitId?: string) => Promise<string>
  /** One explicit navigation request: select this skill when the revision is new. */
  readonly focusSkill?: string | undefined
  readonly focusRevision?: number | undefined
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
/** Fill the generated block's `{slot}` copies with this bundle's dictionary. */
function fillCopy(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (match, slot: string) => {
    const value = values[slot]
    return value === undefined ? match : String(value)
  })
}

/** The shared four-state failure block, spoken through this bundle's keys. */
function failureBlock(t: (key: string) => string, failure: RouteFailure): ReactNode {
  const translate = (key: string, values?: Readonly<Record<string, string | number>>): string => {
    const text = t(key)
    return values === undefined ? text : fillCopy(text, values)
  }
  return FailureBlock({ failure, t: translate, fallback: FALLBACKS['skill-history'] })
}

export function SkillHistoryPanel(face: PanelFace): ReactNode {
  const [skills, setSkills] = useState<readonly SkillRow[]>([])
  // Whether the first list read has LANDED. Without it an empty list renders the empty state while the
  // answer is still in flight, and a reader cannot tell "nothing recorded" from "not read yet" (E7).
  const [skillsLoaded, setSkillsLoaded] = useState(false)
  // G5/W7 S6b: the panel-level failure as the classified four-state object (rendered with the shared
  // block + the command fallback). Row-level read failures keep their inline sentences.
  const [failure, setFailure] = useState<RouteFailure | undefined>(undefined)
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [payload, setPayload] = useState<VersionsPayload | undefined>(undefined)
  // T5-09 (S3.4): the version read needs a FAILED state of its own. `payload === undefined` covered
  // both "still reading" and "the read failed", so a failed read left the pane saying 读取中… — the
  // pane lied while the notice above it told the truth. The sentence is kept for the placeholder.
  const [versionsFailed, setVersionsFailed] = useState<string | undefined>(undefined)
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

  const failureSource = useRef<'read' | 'write' | undefined>(undefined)
  const failed = (error: unknown, source: 'read' | 'write' = 'read'): void => {
    failureSource.current = source
    setNoteError(true)
    setNoteText(face.t('error.hint') + '\n' + face.t('error') + ': '
      + (error instanceof Error ? error.message : String(error)))
    setFailure(error instanceof SkillHistoryRefusal ? error.failure : { kind: 'server', status: 0 })
  }

  const succeeded = (message: string): void => {
    setNoteError(false)
    setNoteText(message)
  }

  /** A successful read clears only the read failure; a write result is not erased by a later read. */
  const clearReadFailure = (): void => {
    if (failureSource.current !== 'read') return
    failureSource.current = undefined
    setFailure(undefined)
    setNoteError(false)
    setNoteText(undefined)
  }

  /** The sentence one failed read carries, in ONE place: every reader below reports the same way. */
  const failedMessage = (error: unknown): string => face.t('error') + ': ' + (error instanceof Error ? error.message : String(error))

  /** Load one version body under the shared read ticket; used by the current default and the toggle. */
  const loadPreview = (name: string, v: number): void => {
    const ticket = readTicket.current + 1
    readTicket.current = ticket
    setBodies(current => new Map(current).set(v, { kind: 'loading', ticket }))
    void face.loadBody(name, v).then((body) => {
      if (readTicket.current !== ticket) { setBodies(current => dropIfTicket(current, v, ticket)); return }
      setBodies(current => new Map(current).set(v, { kind: 'ready', body, ticket }))
    }).catch((error: unknown) => {
      if (readTicket.current !== ticket) { setBodies(current => dropIfTicket(current, v, ticket)); return }
      setBodies(current => new Map(current).set(v, { kind: 'failed', message: failedMessage(error), ticket }))
    })
  }

  /** Read the skills again, keeping the sentence: a re-read is not an answer to anything. */
  const reloadSkills = (): void => {
    // `finally`, not `then`: a FAILED read is an answer too — the reader gets the empty list plus the
    // error sentence instead of a spinner that never stops.
    void face.loadSkills().then((next) => { setSkills(next); clearReadFailure() }).catch(failed).finally(() => { setSkillsLoaded(true) })
  }

  /**
   * Show one skill's chains, keeping the sentence. A re-read that FAILS reports through the caller's
   * own handler, so the failure of a read can never erase the write it was reading after.
   * @param name - the skill to open.
   * @param onFailure - what to do with a failed read.
   */
  const showVersions = (name: string, onFailure: (error: unknown) => void = failed, keepContent = false): void => {
    const ticket = readTicket.current + 1
    readTicket.current = ticket
    setSelected(name)
    if (!keepContent) {
      setPayload(undefined)
      setVersionsFailed(undefined)
      setPending(undefined)
      setExpanded(undefined)
      setDiffs(new Map())
      setBodies(new Map())
    }
    void face.loadVersions(name).then((next) => {
      if (readTicket.current !== ticket) return
      setPayload(next)
      clearReadFailure()
      if (keepContent) return
      const current = historyViewModel(next).current[0]
      if (current !== undefined) {
        setExpanded({ v: current.v, kind: 'preview' })
        loadPreview(name, current.v)
      }
    }).catch((error: unknown) => {
      if (readTicket.current !== ticket) return
      // T5-09: the pane needs its own answer, not only the notice.
      setVersionsFailed(failedMessage(error))
      onFailure(error)
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
    if (selected !== undefined) showVersions(selected, failed, true)
  }

  useEffect(() => {
    if (face.focusSkill === undefined || face.focusSkill === '') return
    showVersions(face.focusSkill)
  }, [face.focusSkill, face.focusRevision])

  const restore = (v: number, unitId?: string): void => {
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
    void face.undo(name, unitId === undefined ? v : undefined, unitId).then((message) => {
      showVersions(name, (error) => {
        setNoteError(true)
        setNoteText(message + '\n' + face.t('error') + ': ' + (error instanceof Error ? error.message : String(error)))
      })
      succeeded(message)
    }).catch((error: unknown) => { failed(error, 'write') })
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
    if (kind === 'diff') {
      setDiffs(current => new Map(current).set(v, { kind: 'loading', ticket }))
      void face.loadDiff(name, v).then((diff) => {
        if (readTicket.current !== ticket) { setDiffs(current => dropIfTicket(current, v, ticket)); return }
        setDiffs(current => new Map(current).set(v, { kind: 'ready', diff, ticket }))
      }).catch((error: unknown) => {
        if (readTicket.current !== ticket) { setDiffs(current => dropIfTicket(current, v, ticket)); return }
        setDiffs(current => new Map(current).set(v, { kind: 'failed', message: failedMessage(error), ticket }))
      })
      return
    }
    loadPreview(name, v)
  }

  // One read on mount; every later read is a user action. There is no store and no subscription.
  useEffect(reloadSkills, [])

  const needle = query.trim().toLowerCase()
  const visible = useMemo(() => needle === ''
    ? skills
    : skills.filter(skill => skill.name.toLowerCase().includes(needle) || skill.description.toLowerCase().includes(needle)),
  [skills, needle])

  const loaded = payload !== undefined
  const model = payload === undefined ? undefined : historyViewModel(payload)
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
        onRestore: () => { restore(row.v, row.unitId) },
        onCancel: cancelRestore,
        onToggle: (kind: OpenKind) => { toggle(row.v, kind) },
      })))
  }

  return createElement('div', { className: 'evo-hist-frame' },
    createElement('div', { className: 'evo-hist-root' },
    createElement('aside', { className: 'evo-hist-aside' },
      searchField(face, query, setQuery),
      createElement('div', { className: 'evo-hist-list' },
        skills.length === 0
          ? emptyState(face.t(skillsLoaded ? 'empty.skills' : 'loading'))
          : visible.length === 0
            ? emptyState(face.t('search.none'))
            : visible.map(skill => skillLine(face, skill, skill.name === selected, () => { open(skill.name) })))),
    createElement('div', { className: 'evo-hist-main' },
      panelHead(face, refresh, selected ?? face.t('bodyTitle')),
      notice(noteText, noteError),
      failure === undefined ? null : createElement('div', { className: 'evo-hist-failure' }, failureBlock(face.t, failure)),
      // The explanation is for the screen that has nothing else on it (W12): a reader who can see
      // versions does not need to be told what a version is.
      selected === undefined
        ? [
          emptyState(face.t(skills.length === 0 ? (skillsLoaded ? 'empty.skills.main' : 'loading') : 'empty.pick'), 'empty'),
          createElement('p', { key: 'hint', className: 'evo-hist-hint' }, face.t('hint')),
        ]
        : loaded
          ? null
          // T5-09: three states, three sentences — a failed read must not render as "still reading".
          : emptyState(versionsFailed === undefined ? face.t('loading') : `${face.t('empty.versions.failed')} — ${versionsFailed}`),
      loaded && model !== undefined
        ? createElement('div', { className: 'evo-hist-reader' },
          model.current.length === 0 ? null : createElement('section', { key: 'current', className: 'evo-hist-current' },
            ...groupHeading(face.t('group.current'), undefined),
            ...model.current.map(row => versionRow({
              copy: face, row,
              confirming: pending === row.v,
              open: expanded !== undefined && expanded.v === row.v ? expanded.kind : undefined,
              expanded: expandedOf(row),
              onRestore: () => { restore(row.v, row.unitId) },
              onCancel: cancelRestore,
              onToggle: (kind: OpenKind) => { toggle(row.v, kind) },
            }))),
          group(face.t('group.history'), model.older, undefined),
          model.support.length === 0 ? null : group(face.t('group.support'), model.support, face.t('group.support.note')),
          model.hasAny ? null : createElement('p', { className: 'evo-hist-hint' }, face.t('empty.versions')))
        : null)))
}

/**
 * Drop a superseded lazy read ONLY if the entry still belongs to that read.
 *
 * P2-30: deleting by version key alone let a stale reply erase a NEWER read that
 * had already reached `ready`, leaving the expanded row blank with no retry path.
 * @param current - the cache.
 * @param key - the version whose entry is dropped.
 * @param ticket - the read that is being abandoned.
 * @returns a new cache without that entry, or the current cache when it is not ours.
 */
function dropIfTicket<K, V extends { readonly ticket?: number | undefined }>(current: ReadonlyMap<K, V>, key: K, ticket: number): ReadonlyMap<K, V> {
  return current.get(key)?.ticket === ticket ? without(current, key) : current
}

function without<K, V>(current: ReadonlyMap<K, V>, key: K): Map<K, V> {
  const next = new Map(current)
  next.delete(key)
  return next
}
