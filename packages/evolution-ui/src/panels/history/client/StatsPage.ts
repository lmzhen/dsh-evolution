/**
 * Data overview: the whole skill library as one sortable, read-only table.
 *
 * The page owns presentation state (query/filter/sort), never transport rules. Its only write-like
 * action is "open this skill", which switches the workbench to the existing detail view; the table
 * itself mutates nothing.
 * @module @deepseek-ai/dsh-evolution-ui/panels/history/client
 */
import { createElement, useEffect, useMemo, useState } from 'react'
import { DataTable, DATA_TABLE_CSS, type DataTableColumn, type DataTableSort } from '@lmzhen/dsh-evolution-client-kit'
import { formatLocalDateTime } from '@lmzhen/dsh-evolution-client-kit'
import type { SkillStatsFilter, SkillStatsRow, SkillStatsSnapshot, SkillStatsSortKey } from '@deepseek-ai/dsh-evolution-core/skills'
import { filterRows, sortRows } from './table-model.ts'

/** The data and callbacks the stats page consumes; no service handle. */
export interface StatsFace {
  readonly t: (key: string) => string
  readonly loadStats: () => Promise<SkillStatsSnapshot>
  readonly openSkill: (name: string) => void
  readonly onOrganize: () => void
}

type LoadState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly snapshot: SkillStatsSnapshot }
  | { readonly status: 'failed'; readonly message: string }

const FILTERS: readonly { readonly id: SkillStatsFilter; readonly key: string }[] = [
  { id: 'all', key: 'stats.filter.all' },
  { id: 'attention', key: 'stats.filter.attention' },
  { id: 'recent', key: 'stats.filter.recent' },
]

function numberText(value: number | null): string {
  return value === null ? '—' : value.toLocaleString()
}

function lastAtText(value: string | null): string {
  return value === null ? '—' : formatLocalDateTime(value, { seconds: false }) ?? '—'
}

function statusKey(verdict: string | undefined): string {
  if (verdict === 'warn' || verdict === 'needs-restructure') return 'health.verdict.' + verdict
  if (verdict === 'healthy') return 'stats.verdict.healthy'
  return 'stats.verdict.unknown'
}

function statusTone(verdict: string | undefined): string {
  if (verdict === 'warn' || verdict === 'needs-restructure') return 'is-warn'
  if (verdict === 'healthy') return 'is-ok'
  return 'is-muted'
}

/**
 * Render the stats page.
 * @param face - copy and the one stats read, plus the skill-open navigation callback.
 * @returns the whole page body.
 */
export function StatsPage(face: StatsFace): ReturnType<typeof createElement> {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<SkillStatsFilter>('all')
  const [sort, setSort] = useState<DataTableSort>({ key: 'bodyChars', dir: 'desc' })

  useEffect(() => {
    let live = true
    setLoad({ status: 'loading' })
    void face.loadStats().then(snapshot => {
      if (live) setLoad({ status: 'ready', snapshot })
    }).catch((error: unknown) => {
      if (live) setLoad({ status: 'failed', message: error instanceof Error ? error.message : String(error) })
    })
    return () => { live = false }
  }, [face.loadStats])

  const snapshot = load.status === 'ready' ? load.snapshot : null
  const visible = useMemo(() => {
    if (snapshot === null) return []
    const needle = query.trim().toLocaleLowerCase()
    const filtered = filterRows(snapshot.rows, filter).filter(row => needle === ''
      || row.name.toLocaleLowerCase().includes(needle)
      || row.description.toLocaleLowerCase().includes(needle))
    return sortRows(filtered, sort.key as SkillStatsSortKey, sort.dir)
  }, [snapshot, query, filter, sort])

  const onSort = (key: string): void => {
    setSort(current => current.key === key
      ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'name' ? 'asc' : 'desc' })
  }

  const Table = DataTable<SkillStatsRow>
  const columns: readonly DataTableColumn<SkillStatsRow>[] = [
    {
      key: 'name',
      label: face.t('stats.col.skill'),
      sortable: true,
      render: row => createElement('div', { className: 'evo-stats-skill' },
        createElement('button', {
          type: 'button',
          className: 'evo-stats-skill-name',
          onClick: () => { face.openSkill(row.name) },
          title: face.t('stats.openSkill'),
        }, row.name),
        createElement('div', { className: 'evo-stats-skill-desc' }, row.description || '—')),
    },
    {
      key: 'verdict',
      label: face.t('stats.col.status'),
      sortable: true,
      render: row => createElement('span', { className: 'evo-stats-pill ' + statusTone(row.health?.verdict) }, face.t(statusKey(row.health?.verdict))),
    },
    { key: 'bodyChars', label: face.t('stats.col.body'), align: 'right', sortable: true, render: row => numberText(row.health?.bodyChars ?? null) },
    { key: 'supportFiles', label: face.t('stats.col.support'), align: 'right', sortable: true, render: row => numberText(row.health?.supportFiles ?? null) },
    { key: 'versions', label: face.t('stats.col.versions'), align: 'right', sortable: true, render: row => numberText(row.versions) },
    { key: 'useCount', label: face.t('stats.col.use'), align: 'right', sortable: true, render: row => numberText(row.usage?.useCount ?? null) },
    { key: 'viewCount', label: face.t('stats.col.view'), align: 'right', sortable: true, render: row => numberText(row.usage?.viewCount ?? null) },
    { key: 'feedback', label: face.t('stats.col.feedback'), align: 'right', sortable: true, render: row => numberText(row.feedback) },
    { key: 'lastAt', label: face.t('stats.col.lastAt'), sortable: true, render: row => lastAtText(row.lastAt) },
  ]

  const totals = snapshot?.totals
  return createElement('div', { className: 'evo-stats-page' },
    createElement('header', { className: 'evo-stats-hero' },
      createElement('div', null,
        createElement('div', { className: 'evo-stats-eyebrow' }, face.t('stats.eyebrow')),
        createElement('h2', { className: 'evo-stats-title' }, face.t('stats.title')),
        createElement('p', { className: 'evo-stats-lede' }, face.t('stats.lede'))),
      createElement('button', { type: 'button', className: 'evo-stats-primary', onClick: () => { face.onOrganize() } }, '+ ', face.t('stats.organize'))),
    createElement('div', { className: 'evo-stats-summary' },
      createElement('div', { className: 'evo-stats-stat' }, createElement('span', null, face.t('stats.total.skills')), createElement('b', null, totals === undefined ? '—' : totals.skills.toLocaleString())),
      createElement('div', { className: 'evo-stats-stat is-warn' }, createElement('span', null, face.t('stats.total.attention')), createElement('b', null, totals === undefined ? '—' : totals.needsAttention.toLocaleString())),
      createElement('div', { className: 'evo-stats-stat' }, createElement('span', null, face.t('stats.total.body')), createElement('b', null, totals === undefined ? '—' : numberText(totals.bodyChars))),
      createElement('div', { className: 'evo-stats-stat is-ok' }, createElement('span', null, face.t('stats.total.success')), createElement('b', null, totals?.successes === null || totals === undefined ? '—' : (totals.successes.offload + totals.successes.condense + totals.successes.extract).toLocaleString()))),
    createElement('div', { className: 'evo-stats-toolbar' },
      createElement('label', { className: 'evo-stats-search' },
        createElement('span', { className: 'evo-stats-search-mark', 'aria-hidden': 'true' }, '⌕'),
        createElement('input', {
          value: query,
          onChange: (event: { target: { value: string } }) => { setQuery(event.target.value) },
          placeholder: face.t('stats.search'),
          'aria-label': face.t('stats.search'),
        })),
      createElement('div', { className: 'evo-stats-filters', role: 'group', 'aria-label': face.t('stats.filter.label') },
        FILTERS.map(entry => createElement('button', {
          key: entry.id,
          type: 'button',
          className: 'evo-stats-filter' + (filter === entry.id ? ' is-active' : ''),
          onClick: () => { setFilter(entry.id) },
        }, face.t(entry.key))))),
    load.status === 'failed'
      ? createElement('div', { className: 'evo-stats-failure' }, face.t('stats.failed') + '：' + load.message)
      : load.status === 'loading'
        ? createElement('div', { className: 'evo-stats-loading' }, face.t('loading'))
        : createElement('div', { className: 'evo-stats-table-card' },
          createElement('div', { className: 'evo-stats-table-head' },
            createElement('strong', null, face.t('stats.tableTitle')),
            createElement('span', null, face.t('stats.tableHint'))),
          createElement(Table, {
            rows: visible,
            columns,
            rowKey: (row: SkillStatsRow) => row.name,
            sort,
            onSort,
            caption: face.t('stats.tableTitle'),
            empty: createElement('div', { className: 'evo-stats-empty' },
              createElement('strong', null, face.t('stats.empty')),
              createElement('span', null, face.t('stats.emptyHint'))),
          })))
}

/** Page styles; tokenVars is applied by the workbench shell. */
export const STATS_CSS = [
  DATA_TABLE_CSS,
  '.evo-stats-page{display:flex;flex-direction:column;min-width:0;min-height:0;height:100%;padding:24px 26px;overflow:auto;gap:16px}',
  '.evo-stats-hero{display:flex;align-items:flex-end;justify-content:space-between;gap:24px}',
  '.evo-stats-eyebrow{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--evo-accent,#2f6b58);font-weight:700;margin-bottom:7px}',
  '.evo-stats-title{margin:0;font-size:24px;line-height:1.2;font-weight:700;color:var(--dsw-alias-label-primary,#20261f)}',
  '.evo-stats-lede{margin:7px 0 0;max-width:680px;color:var(--dsw-alias-label-secondary,#6f766d);font-size:13px;line-height:1.6}',
  '.evo-stats-primary{flex:0 0 auto;height:38px;padding:0 14px;border:0;border-radius:9px;background:var(--evo-accent,#2f6b58);color:#fff;font:inherit;font-size:12.5px;font-weight:650;cursor:pointer}',
  '.evo-stats-primary:focus-visible{outline:var(--evo-focus-ring,2px solid #2f6b58);outline-offset:2px}',
  '.evo-stats-summary{display:flex;flex-wrap:wrap;gap:8px}',
  '.evo-stats-stat{display:flex;align-items:center;justify-content:space-between;gap:18px;min-width:132px;padding:9px 12px;border:1px solid var(--dsw-alias-border-l2,#e5e2da);border-radius:10px;background:var(--dsw-alias-bg-layer-1,#fff)}',
  '.evo-stats-stat span{font-size:11px;color:var(--dsw-alias-label-tertiary,#9aa096)}',
  '.evo-stats-stat b{font-size:16px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary,#20261f)}',
  '.evo-stats-stat.is-warn b{color:var(--evo-warn,#b26a3c)}',
  '.evo-stats-stat.is-ok b{color:var(--evo-accent,#2f6b58)}',
  '.evo-stats-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
  '.evo-stats-search{display:flex;align-items:center;gap:7px;flex:1 1 240px;height:36px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2,#e5e2da);border-radius:9px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-tertiary,#9aa096)}',
  '.evo-stats-search-mark{font-size:16px}',
  '.evo-stats-search input{flex:1;min-width:0;border:0;outline:0;background:transparent;color:var(--dsw-alias-label-primary,#20261f);font:inherit;font-size:12px}',
  '.evo-stats-filters{display:flex;gap:5px}',
  '.evo-stats-filter{height:32px;padding:0 11px;border:1px solid var(--dsw-alias-border-l2,#e5e2da);border-radius:8px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-secondary,#6f766d);font:inherit;font-size:11.5px;font-weight:600;cursor:pointer}',
  '.evo-stats-filter.is-active{border-color:#bdd3c8;background:var(--evo-accent-weak,#e7f0eb);color:var(--evo-accent,#2f6b58)}',
  '.evo-stats-filter:focus-visible,.evo-stats-skill-name:focus-visible{outline:var(--evo-focus-ring,2px solid #2f6b58);outline-offset:2px}',
  '.evo-stats-table-card{border:1px solid var(--dsw-alias-border-l2,#e5e2da);border-radius:12px;background:var(--dsw-alias-bg-layer-1,#fff);overflow:hidden;min-height:0}',
  '.evo-stats-table-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1,#f0eee8)}',
  '.evo-stats-table-head strong{font-size:12px;font-weight:650;color:var(--dsw-alias-label-primary,#20261f)}',
  '.evo-stats-table-head span{font-size:10.5px;color:var(--dsw-alias-label-tertiary,#9aa096)}',
  '.evo-stats-skill{display:flex;flex-direction:column;gap:2px;min-width:220px}',
  '.evo-stats-skill-name{align-self:flex-start;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-primary,#20261f);font:inherit;font-size:12px;font-weight:650;text-align:left;cursor:pointer;border-bottom:1px solid transparent}',
  '.evo-stats-skill-name:hover{color:var(--evo-accent,#2f6b58);border-bottom-color:#bdd3c8}',
  '.evo-stats-skill-desc{max-width:300px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-tertiary,#9aa096);font-size:10.5px}',
  '.evo-stats-pill{display:inline-flex;align-items:center;height:19px;padding:0 7px;border-radius:999px;font-size:10px;font-weight:650;white-space:nowrap}',
  '.evo-stats-pill.is-warn{background:#fbf0e7;color:#b26a3c}',
  '.evo-stats-pill.is-ok{background:#e7f0eb;color:#2f6b58}',
  '.evo-stats-pill.is-muted{background:#f1f0eb;color:#868a80}',
  '.evo-stats-loading,.evo-stats-failure{padding:32px 16px;border:1px solid var(--dsw-alias-border-l2,#e5e2da);border-radius:10px;text-align:center;color:var(--dsw-alias-label-secondary,#6f766d);font-size:12px}',
  '.evo-stats-failure{color:#a5482b;border-color:#efd6c9;background:#fbf6f2}',
  '.evo-stats-empty{display:flex;flex-direction:column;gap:4px;align-items:center}',
  '.evo-stats-empty strong{font-size:12px;font-weight:650;color:var(--dsw-alias-label-secondary,#6f766d)}',
  '@media (max-width:760px){.evo-stats-page{padding:16px}.evo-stats-hero{align-items:flex-start;flex-direction:column}.evo-stats-title{font-size:20px}}',
].join('')



