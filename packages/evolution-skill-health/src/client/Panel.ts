/**
 * The panel body: a four-state summary plus the list aggregated BY RULE.
 *
 * It renders plain data and callbacks handed in by the sidebar (`inject`), never a service, and it
 * holds no facts of its own. Two rules of the house are visible here: a rule whose threshold is not
 * calibrated yet is NAMED WITHOUT A NUMBER (the number is the thing we do not have), and a skill
 * that could not be read is listed as unreadable — silence would read as a pass.
 * @module @deepseek-ai/dsh-evolution-skill-health/client
 */

import { createElement, type ReactNode } from 'react'
import type { LocaleSeat } from './seam.ts'

/** One finding, as the host reports it: `line` is null when the position cannot be named. */
export interface HealthFinding {
  rule: string
  count: number
  line: string | null
  /** False for a rule whose threshold is not calibrated: the rule is named, the count is not shown. */
  countIsMeaningful: boolean
}

/** One skill row. `readable: false` is its own verdict — never folded into `ok`. */
export interface HealthRow {
  name: string
  verdict: 'ok' | 'warn' | 'error' | 'unreadable'
  findings: HealthFinding[]
}

/** What the sidebar hands the component. */
export interface HealthFace {
  rows: HealthRow[]
  /** True when the host could not finish the scan: the counts below are then a lower bound. */
  truncated: boolean
  /** Opens the skill-history panel for one skill, when that panel is present. */
  openHistory?: (name: string) => void
}

/** Kinds in the order the summary reads them. */
const KINDS = ['ok', 'warn', 'error', 'unreadable'] as const

/** One row per rule, with the skills that carry it — the view the report is actually read in. */
function byRule(rows: readonly HealthRow[]): Array<{ rule: string; count: number; skills: string[] }> {
  const table = new Map<string, { rule: string; count: number; skills: string[] }>()
  for (const row of rows) {
    for (const finding of row.findings) {
      const entry = table.get(finding.rule) ?? { rule: finding.rule, count: 0, skills: [] }
      entry.count = finding.countIsMeaningful ? entry.count + finding.count : entry.count
      entry.skills.push(row.name)
      table.set(finding.rule, entry)
    }
  }
  return [...table.values()].sort((a, b) => b.skills.length - a.skills.length || a.rule.localeCompare(b.rule))
}

/** The rule table: name always, count only when the threshold behind it is calibrated. */
function ruleTable(face: HealthFace, t: (key: string) => string): ReactNode {
  const rows = byRule(face.rows)
  return createElement('table', null,
    createElement('thead', null, createElement('tr', null,
      createElement('th', null, t('col.rule')),
      createElement('th', null, t('col.skills')),
      createElement('th', null, t('col.count')),
    )),
    createElement('tbody', null, rows.map(entry => createElement('tr', { key: entry.rule },
      createElement('td', null, entry.rule),
      createElement('td', null, entry.skills.join(', ')),
      createElement('td', null, entry.count === 0 ? t('line.unknown') : String(entry.count)),
    ))),
  )
}

/**
 * Render the panel.
 * @param props - the face (`{ rows, truncated, openHistory? }`) and the locale seat's translator.
 * @returns the panel body.
 */
export function SkillHealthPanel(props: { face: HealthFace; locale: LocaleSeat }): ReactNode {
  const t = props.locale.bind('evolution-skill-health')
  const counts = new Map(KINDS.map(kind => [kind, props.face.rows.filter(row => row.verdict === kind).length]))
  const summary = t('counts')
    .replace('{ok}', String(counts.get('ok') ?? 0))
    .replace('{warn}', String(counts.get('warn') ?? 0))
    .replace('{error}', String(counts.get('error') ?? 0))
    .replace('{unreadable}', String(counts.get('unreadable') ?? 0))
  return createElement('section', null,
    createElement('p', null, summary),
    props.face.truncated ? createElement('p', null, t('loading.failed')) : null,
    props.face.rows.length === 0 ? createElement('p', null, t('empty.noneReported')) : null,
    createElement('h3', null, t('group.byRule')),
    ruleTable(props.face, t),
    props.face.rows.filter(row => row.verdict === 'unreadable').map(row =>
      createElement('p', { key: row.name + ':unreadable' }, row.name + ' — ' + t('unreadable.note'))),
  )
}
