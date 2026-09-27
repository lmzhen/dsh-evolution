/**
 * The skill-history panel: the skills that recorded versions, the two chains of the selected skill,
 * and one action per body version (restore, behind an inline confirmation).
 *
 * The panel owns no rule: the host reports each body row with a verdict (`undoable`) computed from
 * the version facts in evolution-core, and the curator owns the words a refusal uses. This file is
 * presentation plus local state — it never subscribes to anything and it never sees the context.
 * @module @deepseek-ai/dsh-evolution-skill-history/client
 */

import { createElement, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import type { SkillRow, VersionRow, VersionsPayload } from './api.ts'

/** The face the plugin hands the component: copy plus three callbacks, never a service handle. */
export interface PanelFace {
  readonly t: (key: string) => string
  readonly loadSkills: () => Promise<readonly SkillRow[]>
  readonly loadVersions: (name: string) => Promise<VersionsPayload>
  readonly undo: (name: string, v?: number) => Promise<string>
}

/** The face one ROW needs: the panel face plus the in-flight confirmation. */
interface RowFace extends PanelFace {
  readonly restore: (v: number) => void
  readonly confirming: number | undefined
}

const root: CSSProperties = { display: 'flex', height: '100%', minHeight: '0', fontSize: '13px', color: 'var(--dsw-alias-label-primary)' }
const aside: CSSProperties = { width: '200px', flex: '0 0 200px', borderRight: '1px solid var(--dsw-alias-border-l2)', overflowY: 'auto', padding: '8px 0' }
const main: CSSProperties = { flex: '1 1 auto', minWidth: '0', overflowY: 'auto', padding: '12px 14px' }
const skillButton: CSSProperties = { display: 'block', width: '100%', textAlign: 'left', padding: '6px 12px', border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: '13px' }
const skillButtonActive: CSSProperties = { ...skillButton, background: 'var(--dsw-alias-bg-l2)', fontWeight: 600 }
const heading: CSSProperties = { margin: '0 0 4px', fontSize: '13px', fontWeight: 600 }
const hint: CSSProperties = { margin: '0 0 10px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', lineHeight: '1.5' }
const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0', borderTop: '1px solid var(--dsw-alias-border-l3)' }
const rowMeta: CSSProperties = { flex: '1 1 auto', minWidth: '0', fontFamily: 'var(--dsw-font-mono, monospace)', fontSize: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
const chip: CSSProperties = { flex: '0 0 auto', fontSize: '11px', padding: '1px 6px', borderRadius: '999px', border: '1px solid var(--dsw-alias-border-l2)', color: 'var(--dsw-alias-label-secondary)' }
const action: CSSProperties = { flex: '0 0 auto', fontSize: '12px', padding: '2px 8px', borderRadius: '6px', border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent', color: 'inherit', cursor: 'pointer' }
const note: CSSProperties = { margin: '0 0 10px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'pre-wrap' }

/** One version row: the facts, the current/plain chip, and the restore action when the row allows it. */
function versionEntry(face: RowFace, entry: VersionRow): ReactNode {
  const confirming = face.confirming === entry.v
  return createElement('div', { key: String(entry.v), style: row },
    createElement('span', { style: rowMeta },
      'v' + String(entry.v) + '  ' + entry.at + '  ' + entry.action + '  ' + String(entry.chars) + ' chars  ' + entry.hash.slice(0, 12)),
    entry.undoable === false ? createElement('span', { style: chip }, face.t('current')) : null,
    entry.undoable === true
      ? createElement('button', {
        type: 'button',
        style: action,
        onClick: () => { face.restore(entry.v) },
      }, confirming ? face.t('undo.confirm') : face.t('undo'))
      : null,
  )
}

/** One group: a heading, an optional note, and its rows. */
function group(face: RowFace, title: string, entries: readonly VersionRow[], noteText?: string): ReactNode {
  if (entries.length === 0) return null
  return createElement('section', { key: title },
    createElement('h3', { style: heading }, title),
    noteText === undefined ? null : createElement('p', { style: hint }, noteText),
    ...entries.map(entry => versionEntry(face, entry)),
  )
}

/**
 * The panel body.
 * @param face - copy, the data callbacks and the in-flight confirmation state.
 * @returns the panel element.
 */
export function SkillHistoryPanel(face: PanelFace): ReactNode {
  const [skills, setSkills] = useState<readonly SkillRow[]>([])
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [payload, setPayload] = useState<VersionsPayload | undefined>(undefined)
  const [noteText, setNoteText] = useState<string | undefined>(undefined)
  const [pending, setPending] = useState<number | undefined>(undefined)

  const failed = (error: unknown): void => {
    setNoteText(face.t('error') + ': ' + (error instanceof Error ? error.message : String(error)))
  }

  const refresh = (): void => {
    setSkills([])
    void face.loadSkills().then(setSkills).catch(failed)
  }

  const open = (name: string): void => {
    setSelected(name)
    setPayload(undefined)
    setPending(undefined)
    setNoteText(undefined)
    void face.loadVersions(name).then(setPayload).catch(failed)
  }

  const restore = (v: number): void => {
    if (selected === undefined) return
    if (pending !== v) {
      setPending(v)
      return
    }
    setPending(undefined)
    // The result sentence is the curator's — shown verbatim, then the row list is READ AGAIN because
    // the restore itself recorded a new version.
    void face.undo(selected, v).then((message) => { setNoteText(message); open(selected) }).catch(failed)
  }

  // One read on mount; every later read is a user action. There is no store and no subscription.
  useEffect(refresh, [])

  const loaded = payload !== undefined
  return createElement('div', { style: root },
    createElement('aside', { style: aside },
      skills.length === 0
        ? createElement('p', { style: hint }, face.t('empty.skills'))
        : skills.map(skill => createElement('button', {
          key: skill.name,
          type: 'button',
          style: skill.name === selected ? skillButtonActive : skillButton,
          onClick: () => { open(skill.name) },
        }, skill.name + '  (' + String(skill.versions) + ')')),
    ),
    createElement('div', { style: main },
      createElement('h2', { style: heading }, face.t('title')),
      createElement('p', { style: hint }, face.t('hint')),
      noteText === undefined ? null : createElement('p', { style: note }, noteText),
      selected === undefined ? null : (loaded ? null : createElement('p', { style: hint }, face.t('loading'))),
      loaded
        ? createElement('div', null,
          group({ ...face, restore, confirming: pending }, face.t('group.content'), payload.content),
          group({ ...face, restore, confirming: pending }, face.t('group.support'), payload.support, face.t('group.support.note')),
          payload.content.length === 0 && payload.support.length === 0 ? createElement('p', { style: hint }, face.t('empty.versions')) : null,
        )
        : null,
    ),
  )
}
