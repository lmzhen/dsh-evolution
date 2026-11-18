/**
 * The left rail of the skill page: search plus the skill list.
 *
 * It is presentational: the page owns selection and read state, this file only draws the aside so the
 * state machine and the markup stop growing inside one 380-line component.
 * @module @deepseek-ai/dsh-evolution-ui/panels/history/client
 */
import { createElement, useEffect, useRef, type ReactNode } from 'react'
import { emptyState, searchField, skillLine, type Copy } from '../chrome.ts'
import type { SkillRow } from '../api.ts'

/** The health facts the row chip needs; both the old aggregate and the stats rows provide them. */
export interface SkillListHealth {
  readonly verdict: string
  readonly bodyChars: number | null
  readonly findings: number
}

export interface SkillListProps {
  readonly copy: Copy
  readonly query: string
  readonly onQuery: (value: string) => void
  readonly skills: readonly SkillRow[]
  readonly visible: readonly SkillRow[]
  readonly skillsLoaded: boolean
  readonly selected: string | undefined
  readonly onOpen: (name: string) => void
  readonly healthByName: ReadonlyMap<string, SkillListHealth>
}

/**
 * Render the skill list aside.
 * @param props - copy, search state and the visible rows.
 * @returns the aside element.
 */
export function SkillList(props: SkillListProps): ReactNode {
  const listRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const current = listRef.current?.querySelector<HTMLElement>('[aria-current="true"]')
    if (current !== null && current !== undefined && typeof current.scrollIntoView === 'function') {
      current.scrollIntoView({ block: 'nearest' })
    }
  }, [props.selected, props.visible])
  return createElement('aside', { className: 'evo-hist-aside' },
    searchField(props.copy, props.query, props.onQuery),
    createElement('div', { className: 'evo-hist-list', ref: listRef },
      props.skills.length === 0
        ? emptyState(props.copy.t(props.skillsLoaded ? 'empty.skills' : 'loading'))
        : props.visible.length === 0
          ? emptyState(props.copy.t('search.none'))
          : props.visible.map(skill => skillLine(
            props.copy,
            skill,
            skill.name === props.selected,
            () => { props.onOpen(skill.name) },
            props.healthByName.get(skill.name),
          ))),
  )
}
