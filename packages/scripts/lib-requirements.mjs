#!/usr/bin/env node
/**
 * requirements-as-code: one canonical requirement registry, one evidence ledger,
 * generated views. This module is the only reader/renderer; verify/gen/selftest share it.
 *
 * A requirement is a definition. Whether it is satisfied is computed from evidence,
 * never stored as a hand-written status. A doc-drift flag is a document property, not
 * a requirement status.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const SCHEMA = 1
export const STATUSES = ['satisfied', 'partial', 'gap', 'n/a', 'unverified']
export const EVIDENCE_KINDS = new Set(['test', 'real-host', 'review', 'audit', 'doc'])
export const VERDICTS = new Set(['pass', 'fail', 'cannot-decide', 'skipped'])
const GRADE_RANK = { A: 2, B: 1, C: 0 }
const GRADES = new Set(Object.keys(GRADE_RANK))
// requirements-as-code design §4.3: only tests / real-host / independent review may carry
// grade A. Documents and audit notes are traceability, not behavioral proof.
const KIND_MAX_GRADE = { test: 'A', 'real-host': 'A', review: 'A', audit: 'B', doc: 'B' }

export class RequirementsLoadError extends Error {
  constructor(message) {
    super(message)
    this.name = 'RequirementsLoadError'
  }
}

export function requirementsDir(root) {
  return join(root, 'scripts', 'requirements')
}

export function docsPaths(root) {
  return {
    requirements: join(root, 'REQUIREMENTS.md'),
    traceability: join(root, 'REQUIREMENTS-TRACEABILITY.md'),
  }
}

function readJson(path, label) {
  if (!existsSync(path)) throw new RequirementsLoadError(label + ' is missing at ' + path)
  let value
  try {
    value = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new RequirementsLoadError(label + ' is not valid JSON at ' + path + ': ' + String(error.message))
  }
  return value
}

function asArray(value) {
  return Array.isArray(value) ? value : null
}

function problem(list, message) {
  list.push(message)
}

export function loadRequirements(root) {
  const dir = requirementsDir(root)
  const index = readJson(join(dir, 'index.json'), 'requirements index')
  if (index?.schema !== SCHEMA) throw new RequirementsLoadError('requirements index.schema must be ' + SCHEMA)
  const groups = asArray(index.groups)
  if (groups === null || groups.length === 0) throw new RequirementsLoadError('requirements index.groups must be a non-empty array')
  const items = []
  for (const group of groups) {
    if (typeof group?.id !== 'string' || typeof group?.file !== 'string') throw new RequirementsLoadError('each group needs id and file')
    const groupItems = readJson(join(dir, group.file), 'requirements group ' + group.id)
    const rows = asArray(groupItems?.items)
    if (rows === null) throw new RequirementsLoadError('group ' + group.id + ' must carry an items array')
    for (const row of rows) items.push({ ...row, group: group.id })
  }
  const evidenceDoc = readJson(join(dir, 'evidence.json'), 'requirements evidence')
  const evidence = asArray(evidenceDoc?.records)
  if (evidence === null) throw new RequirementsLoadError('requirements evidence.records must be an array')
  return { root, dir, index, items, evidence }
}

function itemById(items) {
  const map = new Map()
  for (const item of items) if (typeof item?.id === 'string') map.set(item.id, item)
  return map
}

function authorityRank(index) {
  const map = new Map()
  for (const row of asArray(index.authority) ?? []) {
    if (typeof row?.id === 'string' && Number.isInteger(row.rank)) map.set(row.id, row.rank)
  }
  return map
}

function reaches(edges, from, target, seen = new Set()) {
  if (from === target) return true
  if (seen.has(from)) return false
  seen.add(from)
  for (const next of edges.get(from) ?? []) {
    if (reaches(edges, next, target, seen)) return true
  }
  return false
}

function resolveRef(root, ref, testNameRequired) {
  if (typeof ref !== 'string' || ref.trim() === '') return 'ref is empty'
  const [rel, name] = ref.split('#', 2)
  const candidates = [root, resolve(root, '..'), resolve(root, '../..')]
  let found = null
  for (const base of candidates) {
    const path = join(base, rel)
    if (existsSync(path)) {
      found = path
      break
    }
  }
  if (found === null) return 'ref path does not exist: ' + rel
  if (testNameRequired) {
    if (!name) return 'test ref must be path#test-name: ' + ref
    if (name === 'it(' || name === 'describe(') return 'test ref must name a concrete test, not a bare matcher: ' + ref
    let text
    try {
      text = readFileSync(found, 'utf8')
    } catch (error) {
      return 'test ref cannot be read: ' + String(error.message)
    }
    if (!text.includes(name)) return 'test name not found in ' + rel + ': ' + name
  }
  return null
}

export function validateRequirements(model) {
  const problems = []
  const { index, items, evidence } = model
  const byId = itemById(items)
  const ranks = authorityRank(index)
  if (ranks.size === 0) problem(problems, 'index.authority must name at least one authority')
  const groupIds = new Set()
  for (const group of asArray(index.groups) ?? []) {
    if (groupIds.has(group?.id)) problem(problems, 'duplicate group id: ' + String(group?.id))
    groupIds.add(group?.id)
  }
  const seen = new Set()
  for (const item of items) {
    const id = typeof item?.id === 'string' ? item.id : '(missing id)'
    if (typeof item?.id !== 'string' || item.id.trim() === '') problem(problems, 'item has no id')
    if (seen.has(id)) problem(problems, 'duplicate requirement id: ' + id)
    seen.add(id)
    if (typeof item?.statement !== 'string' || item.statement.trim() === '') problem(problems, id + ' has no statement')
    if (typeof item?.title !== 'string' || item.title.trim() === '') problem(problems, id + ' has no title')
    if (typeof item?.owner !== 'string' || item.owner.trim() === '') problem(problems, id + ' has no owner')
    else if (!existsSync(join(model.root, item.owner, 'package.json'))) problem(problems, id + ' owner package does not exist: ' + item.owner)
    if (!ranks.has(item?.authority)) problem(problems, id + ' has unknown authority: ' + String(item?.authority))
    if (item?.priority !== undefined && !['P0', 'P1', 'P2', 'P3'].includes(item.priority)) problem(problems, id + ' has invalid priority: ' + String(item.priority))
    if (item?.scoring !== undefined && typeof item.scoring !== 'boolean') problem(problems, id + ' scoring must be boolean')
    const criteria = asArray(item?.criteria)
    if (criteria === null || criteria.length === 0) problem(problems, id + ' has no criteria')
    else {
      const criterionIds = new Set()
      for (const criterion of criteria) {
        if (typeof criterion?.id !== 'string' || criterion.id.trim() === '') problem(problems, id + ' has a criterion without id')
        if (typeof criterion?.text !== 'string' || criterion.text.trim() === '') problem(problems, id + ' criterion ' + String(criterion?.id) + ' has no text')
        if (criterionIds.has(criterion?.id)) problem(problems, id + ' has duplicate criterion ' + String(criterion?.id))
        criterionIds.add(criterion?.id)
      }
    }
    const supersedes = asArray(item?.supersedes)
    if (supersedes !== null) {
      for (const target of supersedes) {
        if (typeof target !== 'string' || !byId.has(target)) problem(problems, id + ' supersedes an unknown id: ' + String(target))
        else if (target === id) problem(problems, id + ' cannot supersede itself')
      }
    }
  }
  const edges = new Map()
  for (const item of items) {
    if (Array.isArray(item?.supersedes)) edges.set(item.id, item.supersedes.filter(target => typeof target === 'string'))
  }
  for (const item of items) {
    const id = String(item?.id)
    for (const target of Array.isArray(item?.supersedes) ? item.supersedes : []) {
      if (typeof target !== 'string' || !byId.has(target)) continue
      const fromRank = ranks.get(item.authority)
      const toRank = ranks.get(byId.get(target)?.authority)
      if (fromRank !== undefined && toRank !== undefined && fromRank < toRank) problem(problems, id + ' (rank ' + fromRank + ') cannot supersede higher authority ' + target + ' (rank ' + toRank + ')')
    }
    let cycle = false
    for (const target of edges.get(id) ?? []) {
      if (reaches(edges, target, id)) cycle = true
    }
    if (cycle) problem(problems, 'supersedes cycle includes ' + id)
  }
  const aliases = index.aliases === undefined ? {} : index.aliases
  if (aliases === null || typeof aliases !== 'object' || Array.isArray(aliases)) problem(problems, 'index.aliases must be an object')
  else {
    for (const [alias, row] of Object.entries(aliases)) {
      if (typeof row?.canonical !== 'string' || !byId.has(row.canonical)) problem(problems, 'alias ' + alias + ' points to an unknown canonical id: ' + String(row?.canonical))
      if (alias === row?.canonical) problem(problems, 'alias ' + alias + ' cannot point to itself')
      if (Object.prototype.hasOwnProperty.call(aliases, row?.canonical)) problem(problems, 'alias ' + alias + ' points to another alias ' + row.canonical + '; canonical targets must be canonical')
    }
  }
  const universe = index.universe
  if (universe === undefined || typeof universe !== 'object') problem(problems, 'index.universe is required')
  else {
    if (!Number.isInteger(universe.total) || universe.total !== items.length) problem(problems, 'index.universe.total=' + String(universe.total) + ' does not match items.length=' + items.length)
    if (universe.sourceCounts !== undefined) {
      if (typeof universe.sourceCounts !== 'object' || Array.isArray(universe.sourceCounts)) problem(problems, 'index.universe.sourceCounts must be an object')
      else {
        const sum = Object.values(universe.sourceCounts).reduce((total, value) => total + (Number.isInteger(value) ? value : 0), 0)
        if (sum !== universe.total) problem(problems, 'index.universe.sourceCounts sum=' + sum + ' does not match total=' + universe.total)
      }
    }
  }
  for (const record of evidence) {
    const id = typeof record?.id === 'string' ? record.id : '(missing id)'
    const criterion = typeof record?.criterion === 'string' ? record.criterion : '(missing criterion)'
    const item = byId.get(id)
    if (!item) problem(problems, 'evidence names unknown requirement: ' + id)
    else if (!Array.isArray(item.criteria) || !item.criteria.some(row => row?.id === criterion)) problem(problems, id + ' evidence names unknown criterion: ' + criterion)
    if (!EVIDENCE_KINDS.has(record?.kind)) problem(problems, id + ' evidence kind is invalid: ' + String(record?.kind))
    if (!VERDICTS.has(record?.verdict)) problem(problems, id + ' evidence verdict is invalid: ' + String(record?.verdict))
    if (!GRADES.has(record?.grade)) problem(problems, id + ' evidence grade is invalid: ' + String(record?.grade))
    if (record?.kind === 'test') {
      const refProblem = resolveRef(model.root, record?.ref, true)
      if (refProblem) problem(problems, id + ' ' + refProblem)
    } else if (record?.kind === 'doc') {
      const refProblem = resolveRef(model.root, record?.ref, false)
      if (refProblem) problem(problems, id + ' ' + refProblem)
    } else if (record?.kind === 'review') {
      if (typeof record?.reviewer !== 'string' || typeof record?.checkedAt !== 'string') problem(problems, id + ' review evidence needs reviewer and checkedAt')
    } else if (record?.kind === 'real-host') {
      if (typeof record?.runId !== 'string' || typeof record?.artifact !== 'string') problem(problems, id + ' real-host evidence needs runId and artifact')
    } else if (record?.kind === 'audit') {
      if (typeof record?.source !== 'string' && typeof record?.ref !== 'string') problem(problems, id + ' audit evidence needs source or ref')
    }
  }
  return problems
}

export function loadBaseline(model) {
  if (typeof model.index.baseline !== 'string') return null
  const path = join(model.dir, 'baseline-' + model.index.baseline + '.json')
  if (!existsSync(path)) return null
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    return value && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}

export function evaluateRequirements(model) {
  const { items, evidence } = model
  const byCriterion = new Map()
  for (const record of evidence) {
    if (typeof record?.id !== 'string' || typeof record?.criterion !== 'string') continue
    const key = record.id + '\u0000' + record.criterion
    const rows = byCriterion.get(key) ?? []
    rows.push(record)
    byCriterion.set(key, rows)
  }
  const results = []
  for (const item of items) {
    const criteria = Array.isArray(item.criteria) ? item.criteria : []
    const details = []
    let anyFail = false
    let anyCannot = false
    let anyMissing = false
    let anyGradeShort = false
    const requiredGrade = item.priority === 'P0' || item.priority === 'P1' ? 'A' : 'B'
    for (const criterion of criteria) {
      const records = byCriterion.get(item.id + '\u0000' + criterion.id) ?? []
      if (records.length === 0) {
        anyMissing = true
        details.push({ criterion: criterion.id, verdict: 'missing', grade: null, reason: 'no evidence' })
        continue
      }
      let worst = 'pass'
      let worstGrade = 'A'
      for (const record of records) {
        const verdict = record.verdict === 'skipped' ? 'cannot-decide' : record.verdict
        if (verdict === 'fail') worst = 'fail'
        else if (verdict === 'cannot-decide' && worst !== 'fail') worst = 'cannot-decide'
        const decisionRecord = record.kind === 'doc' && ['A', 'DEC', 'Q', 'DESIGN'].includes(item.authority)
        const cap = decisionRecord ? 'A' : (KIND_MAX_GRADE[record.kind] ?? 'A')
        const effectiveGrade = GRADE_RANK[record.grade] < GRADE_RANK[cap] ? record.grade : cap
        if (GRADE_RANK[effectiveGrade] < GRADE_RANK[worstGrade]) worstGrade = effectiveGrade
      }
      if (worst === 'fail') anyFail = true
      else if (worst === 'cannot-decide') anyCannot = true
      if (worst === 'pass' && GRADE_RANK[worstGrade] < GRADE_RANK[requiredGrade]) anyGradeShort = true
      details.push({ criterion: criterion.id, verdict: worst, grade: worstGrade, requiredGrade, reason: null })
    }
    let status
    if (item.disposition === 'n/a' || item.disposition === 'waived') status = 'n/a'
    else if (anyFail) status = 'gap'
    else if (anyMissing && details.every(row => row.verdict === 'missing')) status = 'unverified'
    else if (anyMissing || anyCannot || anyGradeShort) status = 'partial'
    else status = 'satisfied'
    const docDrift = item.docDrift === true || (item.docDrift !== undefined && item.docDrift !== false && item.docDrift !== null)
    results.push({ item, status, docDrift, details })
  }
  return results
}

export function summarize(results) {
  const counts = { total: results.length, satisfied: 0, partial: 0, gap: 0, 'n/a': 0, unverified: 0, docDrift: 0, scored: 0 }
  for (const row of results) {
    counts[row.status] += 1
    if (row.docDrift) counts.docDrift += 1
    if (row.item.scoring !== false && row.status !== 'n/a') counts.scored += 1
  }
  const audit = {
    satisfied: counts.satisfied,
    partial: counts.partial,
    gap: counts.gap,
    drift: counts.docDrift,
    'n/a': counts['n/a'],
    unverified: counts.unverified,
  }
  return { counts, audit }
}

export function strictProblems(model, results) {
  const problems = validateRequirements(model)
  for (const row of results) {
    if (row.item.scoring === false) continue
    if (row.status !== 'satisfied' && row.status !== 'n/a') problems.push(row.item.id + ' is ' + row.status + ' (strict requires satisfied or n/a)')
    if (row.docDrift) problems.push(row.item.id + ' has docDrift (strict requires the document refreshed)')
  }
  return problems
}

function cell(value) {
  return String(value).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()
}

function evidenceSummary(row, results) {
  const details = results.find(entry => entry.item === row)?.details ?? []
  return details.map(detail => detail.verdict + (detail.grade ? ':' + detail.grade : '')).join(', ')
}

export function renderRequirements(model, results, baseline) {
  const { counts, audit } = summarize(results)
  const lines = []
  lines.push('# 需求基线')
  lines.push('')
  lines.push('> GENERATED from packages/scripts/requirements/ — do not edit this file.')
  lines.push('> 定义在 requirements registry，状态由 evidence 计算；外部文档只是历史来源。')
  lines.push('')
  lines.push('## 状态汇总')
  lines.push('')
  lines.push('| total | satisfied | partial | gap | n/a | unverified | docDrift | scored |')
  lines.push('| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |')
  lines.push('| ' + counts.total + ' | ' + counts.satisfied + ' | ' + counts.partial + ' | ' + counts.gap + ' | ' + counts['n/a'] + ' | ' + counts.unverified + ' | ' + counts.docDrift + ' | ' + counts.scored + ' |')
  lines.push('')
  if (baseline?.counts) {
    lines.push('历史审计基线（' + String(baseline.source ?? 'baseline') + '）：total ' + baseline.counts.total + ' / satisfied ' + baseline.counts.satisfied + ' / partial ' + baseline.counts.partial + ' / gap ' + baseline.counts.gap + ' / drift ' + baseline.counts.drift + ' / n/a ' + baseline.counts['n/a'] + ' / unverified ' + baseline.counts.unverified + '。')
  }
  lines.push('当前证据计算：satisfied ' + audit.satisfied + ' / partial ' + audit.partial + ' / gap ' + audit.gap + ' / drift ' + audit.drift + ' / n/a ' + audit['n/a'] + ' / unverified ' + audit.unverified + '。')
  lines.push('')
  lines.push('## 权威顺序')
  lines.push('')
  for (const row of model.index.authority ?? []) lines.push('- ' + row.id + ' (rank ' + row.rank + ')')
  lines.push('')
  for (const group of model.index.groups ?? []) {
    const rows = results.filter(row => row.item.group === group.id)
    lines.push('## ' + group.title + ' (' + group.id + ')')
    lines.push('')
    lines.push('| ID | 状态 | 优先级 | 权威 | owner | 需求 |')
    lines.push('| --- | --- | --- | --- | --- | --- |')
    for (const row of rows) {
      lines.push('| ' + cell(row.item.id) + ' | ' + row.status + (row.docDrift ? ' (docDrift)' : '') + ' | ' + cell(row.item.priority ?? '') + ' | ' + cell(row.item.authority ?? '') + ' | ' + cell(row.item.owner ?? '') + ' | ' + cell(row.item.statement ?? '') + ' |')
    }
    lines.push('')
    for (const row of rows) {
      lines.push('### ' + row.item.id + ' ' + row.item.title)
      lines.push('')
      lines.push(row.item.statement)
      lines.push('')
      for (const criterion of row.item.criteria ?? []) {
        const detail = row.details.find(entry => entry.criterion === criterion.id)
        lines.push('- ' + criterion.id + ' ' + criterion.text + ' → ' + (detail?.verdict ?? 'missing') + (detail?.grade ? ' (' + detail.grade + ')' : ''))
      }
      lines.push('')
    }
  }
  return lines.join('\n') + '\n'
}

export function renderTraceability(model, results) {
  const lines = []
  lines.push('# 需求可追溯矩阵')
  lines.push('')
  lines.push('> GENERATED from packages/scripts/requirements/ — do not edit this file.')
  lines.push('')
  lines.push('| ID | 状态 | 优先级 | 权威 | owner | criteria | evidence |')
  lines.push('| --- | --- | --- | --- | --- | ---: | --- |')
  for (const row of results) {
    const summary = evidenceSummary(row.item, results)
    lines.push('| ' + cell(row.item.id) + ' | ' + row.status + (row.docDrift ? ' (docDrift)' : '') + ' | ' + cell(row.item.priority ?? '') + ' | ' + cell(row.item.authority ?? '') + ' | ' + cell(row.item.owner ?? '') + ' | ' + String((row.item.criteria ?? []).length) + ' | ' + cell(summary) + ' |')
  }
  return lines.join('\n') + '\n'
}

export function docsCurrent(model, results, baseline) {
  const paths = docsPaths(model.root)
  const wanted = {
    [paths.requirements]: renderRequirements(model, results, baseline),
    [paths.traceability]: renderTraceability(model, results),
  }
  const problems = []
  for (const [path, expected] of Object.entries(wanted)) {
    if (!existsSync(path)) problems.push('generated document is missing: ' + path)
    else if (readFileSync(path, 'utf8') !== expected) problems.push('generated document is stale: ' + path)
  }
  return problems
}
