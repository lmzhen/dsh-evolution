/**
 * The panel body: a four-state summary plus the list aggregated BY RULE.
 *
 * It renders plain data and callbacks handed in by the sidebar (`inject`), never a service, and it
 * holds no facts of its own. Two rules of the house are visible here: a rule whose threshold is not
 * calibrated yet is NAMED WITHOUT A NUMBER (the number is the thing we do not have), and a skill
 * that could not be read is listed as unreadable — silence would read as a pass.
 * @module @deepseek-ai/dsh-evolution-skill-health/client
 */

import { createElement, useEffect, useState, type ReactNode } from 'react'
// The stylesheet is scoped to this class; without it on the root element the panel renders unstyled.
import { CSS_TAG_ID } from './styles.ts'
import type { HealthOutcome } from './api.ts'

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
  /** Reads the scan result from the host route. Absent faces render their seeded rows unchanged. */
  loadRows?: () => Promise<HealthOutcome>
  /** The seat's translator for this bundle's dictionary — the panel never reaches for a service. */
  t: (key: string) => string
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

/** The verdict a rule's row speaks in: the worst one among the skills that carry it. */
function worstVerdict(face: HealthFace, skills: readonly string[]): string {
  const order = ['error', 'warn', 'unreadable', 'ok']
  let worst = 'ok'
  for (const row of face.rows) {
    if (!skills.includes(row.name)) continue
    if (order.indexOf(row.verdict) < order.indexOf(worst)) worst = row.verdict
  }
  return worst
}

/** The rule table: a grid so counts line up, with a tone bar per row and skill pills. */
function ruleTable(face: HealthFace, t: (key: string) => string): ReactNode {
  const rows = byRule(face.rows)
  const cell = (role: string, children: ReactNode, key?: string): ReactNode =>
    createElement('div', key === undefined ? { 'data-role': role } : { 'data-role': role, key }, children)
  return createElement('div', { 'data-role': 'rule-table' },
    createElement('div', { 'data-role': 'rule-row', 'data-role-head': 'true' },
      createElement('div', { 'data-role': 'rule-name' }, t('col.rule')),
      createElement('div', { 'data-role': 'skills' }, t('col.skills')),
      createElement('div', { 'data-role': 'rule-count' }, t('col.count')),
    ),
    rows.map(entry => createElement('div', {
      key: entry.rule,
      'data-role': 'rule-row',
      'data-tone': worstVerdict(face, entry.skills),
    },
    cell('rule-name', entry.rule),
    cell('skills', entry.skills.map((name, i) => createElement('span', { 'data-role': 'skill-pill', key: name + ':' + String(i), title: name }, name))),
    cell('rule-count', entry.count === 0 ? t('count.notCalibrated') : String(entry.count)),
    )),
  )
}

/**
 * Render the panel.
 * @param props - the face (`{ rows, truncated, openHistory? }`) and the locale seat's translator.
 * @returns the panel body.
 */
export function SkillHealthPanel(face: HealthFace): ReactNode {
  const t = face.t
  // The face seeds the first paint; the host route replaces it once read. A refusal keeps the seed
  // (so the counts stay a lower bound) and reports the host's own sentence instead of a verdict.
  const [view, setView] = useState<HealthFace>(face)
  const [failed, setFailed] = useState<string | undefined>(undefined)
  useEffect(() => {
    const load = face.loadRows
    if (load === undefined) return
    let live = true
    load()
      .then((outcome) => {
        if (!live) return
        // G4/4.2: this is the ONLY read trigger in this card, so there is no stale-vs-fresh race to
        // guard today (measured: one effect, no refresh, no focus listener). If a second trigger is
        // ever added, it must take a read ticket exactly as skill-history/Panel.ts and
        // settings-ui/PendingCard.ts do - a later-arriving older answer would otherwise overwrite it.
        if (outcome.ok) setView({ ...face, rows: outcome.payload.rows, truncated: outcome.payload.truncated })
        else setFailed(outcome.message)
      })
      .catch((error: unknown) => { if (live) setFailed(String(error)) })
    return () => { live = false }
  }, [face])
  const counts = new Map(KINDS.map(kind => [kind, view.rows.filter((row: HealthRow) => row.verdict === kind).length]))
  // Four verdict cards, not one sentence: the number is the fact a reader scans for, and the tone
  // bar carries the severity. A verdict with no rows still shows its zero — silence would read as
  // 'not checked' rather than 'nothing found'.
  const stats = createElement('div', { 'data-role': 'stats' },
    KINDS.map(kind => createElement('div', { key: kind, 'data-role': 'stat', 'data-tone': kind },
      createElement('div', { 'data-role': 'stat-value' }, String(counts.get(kind) ?? 0)),
      createElement('div', { 'data-role': 'stat-label' }, t('verdict.' + kind)),
    )),
  )
  return createElement('section', { className: CSS_TAG_ID },
    createElement('p', { 'data-role': 'hint' }, t('hint')),
    stats,
    view.truncated ? createElement('p', { 'data-role': 'note' }, t('loading.failed')) : null,
    failed === undefined ? null : createElement('p', { 'data-role': 'note' }, t('read.failed') + ' ' + failed),
    view.rows.length === 0 ? createElement('p', { 'data-role': 'note' }, t('empty.noneReported')) : null,
    createElement('h3', { 'data-role': 'group-title' }, t('group.byRule')),
    ruleTable(view, t),
    view.rows.filter((row: HealthRow) => row.verdict === 'unreadable').map((row: HealthRow) =>
      createElement('p', { key: row.name + ':unreadable', 'data-role': 'note' }, row.name + ' — ' + t('unreadable.note'))),
  )
}
