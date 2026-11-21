/**
 * The skill page's state machine: which skill is open, which reads are in flight, which row is
 * expanded, and the undo confirmation.
 *
 * This is a hook rather than component state so the page shell stays a thin frame around two pure
 * views. The two rules that only a state machine can hold remain here: a read takes a ticket so a
 * slow reply cannot land on another skill, and a write result is not erased by the read after it.
 * @module @deepseek-ai/dsh-evolution-ui/panels/history/client
 */
import { createElement, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { type OpenKind } from '../chrome.ts'
import { DiffBody, PreviewBody, type BodyState, type DiffState } from '../document.ts'
import { historyViewModel, type HistoryViewModel } from '../history-presentation.ts'
import { SkillHistoryRefusal, type HealthPayload, type SkillRow, type VersionsPayload, type VersionRow } from '../api.ts'
import type { RouteFailure } from '@lmzhen/dsh-evolution-client-kit/generated/route-client'
import { fillTemplate } from '@lmzhen/dsh-evolution-client-kit'
import { FailureBlock } from '@lmzhen/dsh-evolution-client-kit/generated/states'
import { FALLBACKS } from '@lmzhen/dsh-evolution-client-kit/generated/fallbacks'
import type { PanelFace } from '../Panel.ts'
import type { SkillErrorNote } from '@deepseek-ai/dsh-evolution-core/skills'

/** The one expanded row. */
interface OpenRow {
  readonly v: number
  readonly kind: OpenKind
}

/** Everything the two presentational halves need, plus the actions they call. */
export interface SkillHistoryController {
  readonly query: string
  readonly onQuery: (value: string) => void
  readonly skills: readonly SkillRow[]
  readonly visible: readonly SkillRow[]
  readonly skillsLoaded: boolean
  readonly selected: string | undefined
  readonly onOpen: (name: string) => void
  readonly healthByName: ReadonlyMap<string, HealthPayload['rows'][number]>
  readonly errorNotes: ReadonlyMap<string, readonly SkillErrorNote[]>
  readonly onRefresh: () => void
  readonly noteText: string | undefined
  readonly noteError: boolean
  readonly failureNode: ReactNode
  readonly loaded: boolean
  readonly versionsFailed: string | undefined
  readonly model: HistoryViewModel | undefined
  readonly pending: number | undefined
  readonly expanded: OpenRow | undefined
  readonly expandedOf: (row: VersionRow) => ReactNode
  readonly onRestore: (v: number, unitId?: string) => void
  readonly onCancelRestore: () => void
  readonly onToggle: (v: number, kind: OpenKind) => void
}

/** The shared four-state failure block, spoken through this bundle's keys. */
function failureBlock(t: (key: string) => string, failure: RouteFailure): ReactNode {
  const translate = (key: string, values?: Readonly<Record<string, string | number>>): string => {
    const text = t(key)
    return values === undefined ? text : fillTemplate(text, values)
  }
  return FailureBlock({ failure, t: translate, fallback: FALLBACKS['skill-history'] })
}

/**
 * Own the skill page's reads and transient state.
 * @param face - copy plus the data callbacks.
 * @returns the state and callbacks the list/detail views render.
 */
export function useSkillHistory(face: PanelFace): SkillHistoryController {
  const controlledSelection = face.onSelect !== undefined
  const controlledQuery = face.onQuery !== undefined
  const [localSelected, setLocalSelected] = useState<string | undefined>(undefined)
  const [localQuery, setLocalQuery] = useState('')
  const selected = controlledSelection ? face.selected : localSelected
  const query = controlledQuery ? face.query ?? '' : localQuery
  const [skills, setSkills] = useState<readonly SkillRow[]>([])
  // Whether the first list read has LANDED. Without it an empty list renders the empty state while the
  // answer is still in flight, and a reader cannot tell "nothing recorded" from "not read yet" (E7).
  const [skillsLoaded, setSkillsLoaded] = useState(false)
  // G5/W7 S6b: the panel-level failure as the classified four-state object (rendered with the shared
  // block + the command fallback). Row-level read failures keep their inline sentences.
  const [failure, setFailure] = useState<RouteFailure | undefined>(undefined)
  const [payload, setPayload] = useState<VersionsPayload | undefined>(undefined)
  // T5-09 (S3.4): the version read needs a FAILED state of its own. `payload === undefined` covered
  // both "still reading" and "the read failed", so a failed read left the pane saying 读取中… — the
  // pane lied while the notice above it told the truth. The sentence is kept for the placeholder.
  const [versionsFailed, setVersionsFailed] = useState<string | undefined>(undefined)
  const [noteText, setNoteText] = useState<string | undefined>(undefined)
  const [noteError, setNoteError] = useState(false)
  const [pending, setPending] = useState<number | undefined>(undefined)
  const [expanded, setExpanded] = useState<OpenRow | undefined>(undefined)
  const [diffs, setDiffs] = useState<ReadonlyMap<number, DiffState>>(new Map())
  const [bodies, setBodies] = useState<ReadonlyMap<number, BodyState>>(new Map())
  const [healthByName, setHealthByName] = useState<ReadonlyMap<string, HealthPayload['rows'][number]>>(new Map())
  const [errorNotes, setErrorNotes] = useState<ReadonlyMap<string, readonly SkillErrorNote[]>>(new Map())
  // Every rows read takes a ticket, and only the newest one may write state. Without it a slow reply
  // for skill A lands while B is open: B would show A's rows, and B's restore buttons would post A's
  // version number at B's name — a write against the wrong skill.
  const readTicket = useRef(0)

  const failureSource = useRef<'read' | 'write' | undefined>(undefined)
  const failed = (error: unknown, source: 'read' | 'write' = 'read'): void => {
    failureSource.current = source
    setNoteError(true)
    setNoteText(source === 'write'
      ? face.t('undo.failed')
      : face.t('error.hint') + '\n' + face.t('error') + ': '
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
   * @param keepContent - keep the current rows while the re-read lands.
   */
  const showVersions = (name: string, onFailure: (error: unknown) => void = failed, keepContent = false): void => {
    const ticket = readTicket.current + 1
    readTicket.current = ticket
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

  /** Open a skill from the list: the owner stores the selection and this hook loads it. */
  const open = (name: string): void => {
    if (name !== selected) {
      setNoteText(undefined)
      setNoteError(false)
    }
    if (controlledSelection) face.onSelect?.(name)
    else setLocalSelected(name)
  }

  /** What the refresh control does: both reads again, and the sentence stays. */
  const refresh = (): void => {
    face.invalidateStats?.()
    reloadSkills()
    if (selected !== undefined) showVersions(selected, failed, true)
  }

  useEffect(() => {
    if (selected === undefined || selected === '') {
      setPayload(undefined)
      setVersionsFailed(undefined)
      setPending(undefined)
      setExpanded(undefined)
      setDiffs(new Map())
      setBodies(new Map())
      return
    }
    showVersions(selected)
  }, [selected, face.selectionRevision])

  const restore = (v: number, unitId?: string): void => {
    if (selected === undefined) return
    if (pending !== v) {
      setPending(v)
      return
    }
    setPending(undefined)
    const name = selected
    // The write result is localized here; the host sentence is a CLI/diagnostic
    // message and is not shown in the eight-locale UI. The rows are READ AGAIN
    // because the restore itself recorded a new version.
    void face.undo(name, unitId === undefined ? v : undefined, unitId).then(() => {
      showVersions(name, () => {
        failureSource.current = 'read'
        setFailure(undefined)
        setNoteError(false)
        setNoteText(face.t('undo.reloaded'))
      })
      succeeded(unitId === undefined ? face.format('undo.success', { n: v }) : face.t('undo.successUnit'))
    }).catch((error: unknown) => { failed(error, 'write') })
  }

  /**
   * Expand one row, or collapse it: one row is open at a time, and each kind keeps its own lazy read.
   * @param v - the version whose row was clicked.
   * @param kind - which expansion the row should show.
   */
  const toggle = (v: number, kind: OpenKind): void => {
    if (selected === undefined) return
    const cached = kind === 'diff' ? diffs.get(v) : bodies.get(v)
    if (expanded !== undefined && expanded.v === v && expanded.kind === kind) {
      // A FAILED expansion is not an answer: clicking it again retries instead of collapsing.
      if (cached?.kind !== 'failed') {
        setExpanded(undefined)
        return
      }
    }
    setExpanded({ v, kind })
    // A cached answer costs nothing and must not invalidate a read already in flight.
    if (cached !== undefined && cached.kind !== 'failed') return
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

  useEffect(() => {
    const loadStats = face.loadStats
    const loadHealth = face.loadHealth
    if (loadStats === undefined && loadHealth === undefined) return
    let live = true
    const fromStats = loadStats === undefined
      ? undefined
      : loadStats().then((snapshot) => {
        if (!live) return
        setHealthByName(new Map(snapshot.rows
          .filter(row => row.health !== null)
          .map(row => [row.name, {
            name: row.name,
            verdict: row.health!.verdict,
            bodyChars: row.health!.bodyChars,
            supportFiles: row.health!.supportFiles,
            findings: row.health!.findings,
          }])))
        setErrorNotes(new Map(snapshot.rows
          .filter(row => row.errorNotes !== null)
          .map(row => [row.name, row.errorNotes!])))
      }).catch(() => { /* fall back to the legacy health read below */ })
    const read = loadStats !== undefined
      ? fromStats
      : loadHealth!().then((payload) => {
        if (!live) return
        setHealthByName(new Map(payload.rows.map(row => [row.name, row])))
      })
    void read?.catch(() => { /* the aggregate read is optional */ })
    return () => { live = false }
  }, [face.loadStats, face.loadHealth])

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

  const failureNode = failure === undefined
    ? null
    : createElement('div', { className: 'evo-hist-failure' }, failureBlock(face.t, failure))

  return {
    query,
    onQuery: controlledQuery ? face.onQuery! : setLocalQuery,
    skills,
    visible,
    skillsLoaded,
    selected,
    onOpen: open,
    healthByName,
    errorNotes,
    onRefresh: refresh,
    noteText,
    noteError,
    failureNode,
    loaded,
    versionsFailed,
    model,
    pending,
    expanded,
    expandedOf,
    onRestore: restore,
    onCancelRestore: cancelRestore,
    onToggle: toggle,
  }
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
