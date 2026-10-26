#!/usr/bin/env node
/**
 * Negative-capable self-test for requirements-as-code.
 *
 * A gate that cannot fail is not a gate: every case below constructs a broken
 * fixture and asserts the CLI exits non-zero with a named problem. The healthy
 * control proves the same path also reaches green.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const VERIFY = join(HERE, 'verify-requirements.mjs')
const GEN = join(HERE, 'gen-requirements.mjs')
const failures = []

function run(script, root, args) {
  const result = spawnSync(process.execPath, [script, root, ...args], { encoding: 'utf8' })
  let json = null
  try { json = JSON.parse(result.stdout) } catch { /* not every call emits JSON */ }
  return { code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', json }
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
}

function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'dsh-requirements-'))
  const root = join(base, 'packages')
  const req = join(root, 'scripts', 'requirements')
  mkdirSync(req, { recursive: true })
  mkdirSync(join(root, 'evolution-merge', 'tests'), { recursive: true })
  writeJson(join(root, 'evolution-merge', 'package.json'), { name: 'evolution-merge', version: '0.0.0' })
  writeFileSync(join(root, 'evolution-merge', 'tests', 'sample.spec.ts'), "import { it } from 'vitest'\nit('scope ok', () => {})\n")
  writeJson(join(req, 'index.json'), {
    schema: 1,
    baseline: 'fixture',
    authority: [{ id: 'v1', rank: 4 }],
    groups: [{ id: 'scope', file: '10-scope.json', title: 'Scope' }],
    aliases: {},
    universe: { total: 1, sourceCounts: { v1: 1 } },
  })
  writeJson(join(req, '10-scope.json'), {
    items: [{
      id: 'FR-SCOPE-01',
      kind: 'FR',
      title: 'scope rule',
      statement: 'Only managed skills are processed.',
      priority: 'P2',
      authority: 'v1',
      scoring: true,
      owner: 'evolution-merge',
      criteria: [{ id: 'AC-1', text: 'unmanaged pair is refused' }],
      supersedes: [],
    }],
  })
  writeJson(join(req, 'evidence.json'), {
    records: [{
      id: 'FR-SCOPE-01',
      criterion: 'AC-1',
      kind: 'test',
      ref: 'evolution-merge/tests/sample.spec.ts#scope ok',
      verdict: 'pass',
      grade: 'A',
      checkedAt: '2026-10-26',
    }],
  })
  const generated = run(GEN, root, [])
  if (generated.code !== 0) failures.push('fixture: gen failed: ' + generated.stderr.trim())
  return { base, root, req }
}

function cleanup(base) {
  rmSync(base, { recursive: true, force: true, maxRetries: 5 })
}

function assert(label, condition, detail) {
  if (!condition) failures.push(label + ': ' + detail)
}

const valid = fixture()
try {
  const green = run(VERIFY, valid.root, ['--strict', '--json'])
  assert('healthy control', green.code === 0, 'expected exit 0, got ' + green.code + ' ' + green.stderr.trim())
  assert('healthy control status', green.json?.status === 'pass', 'status=' + String(green.json?.status))
  assert('healthy control count', green.json?.counts?.satisfied === 1, 'satisfied=' + String(green.json?.counts?.satisfied))

  const check = run(GEN, valid.root, ['--check'])
  assert('generated docs current', check.code === 0, 'expected 0, got ' + check.code + ': ' + check.stderr.trim())

  // A hand edit is drift by definition.
  writeFileSync(join(valid.root, 'REQUIREMENTS.md'), readFileSync(join(valid.root, 'REQUIREMENTS.md'), 'utf8') + '\nhand edit\n')
  const stale = run(GEN, valid.root, ['--check'])
  assert('hand-edited doc is stale', stale.code === 1, 'expected 1, got ' + stale.code)
} finally {
  cleanup(valid.base)
}

// Duplicate IDs must be rejected.
const duplicate = fixture()
try {
  const groupPath = join(duplicate.req, '10-scope.json')
  const group = JSON.parse(readFileSync(groupPath, 'utf8'))
  group.items.push({ ...group.items[0] })
  writeJson(groupPath, group)
  const result = run(VERIFY, duplicate.root, ['--json'])
  assert('duplicate id', result.code === 1 && result.json?.problems?.some(message => message.includes('duplicate requirement id')), 'code=' + result.code + ' problems=' + JSON.stringify(result.json?.problems))
} finally {
  cleanup(duplicate.base)
}

// A satisfied claim without evidence must not be possible.
const noEvidence = fixture()
try {
  writeJson(join(noEvidence.req, 'evidence.json'), { records: [] })
  const result = run(VERIFY, noEvidence.root, ['--strict', '--json'])
  assert('missing evidence', result.code === 1, 'expected 1, got ' + result.code)
  assert('missing evidence status', result.json?.items?.find(item => item.id === 'FR-SCOPE-01')?.status === 'unverified', 'status=' + String(result.json?.items?.[0]?.status))
} finally {
  cleanup(noEvidence.base)
}

// An alias must resolve to a real canonical ID.
const badAlias = fixture()
try {
  const indexPath = join(badAlias.req, 'index.json')
  const index = JSON.parse(readFileSync(indexPath, 'utf8'))
  index.aliases = { 'V2-X': { canonical: 'MISSING', kind: 'change-record' } }
  writeJson(indexPath, index)
  const result = run(VERIFY, badAlias.root, ['--json'])
  assert('bad alias', result.code === 1 && result.json?.problems?.some(message => message.includes('unknown canonical id')), 'code=' + result.code)
} finally {
  cleanup(badAlias.base)
}

// A test ref that names a missing test must not count as evidence.
const badRef = fixture()
try {
  const evidencePath = join(badRef.req, 'evidence.json')
  const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'))
  evidence.records[0].ref = 'evolution-merge/tests/sample.spec.ts#does not exist'
  writeJson(evidencePath, evidence)
  const result = run(VERIFY, badRef.root, ['--json'])
  assert('missing test name', result.code === 1 && result.json?.problems?.some(message => message.includes('test name not found')), 'code=' + result.code)
} finally {
  cleanup(badRef.base)
}

// A bare matcher (#it() / #describe()) is not a test name: it would let any spec file pass.
const bareMatcher = fixture()
try {
  const evidencePath = join(bareMatcher.req, 'evidence.json')
  const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'))
  evidence.records[0].ref = 'evolution-merge/tests/sample.spec.ts#it('
  writeJson(evidencePath, evidence)
  const result = run(VERIFY, bareMatcher.root, ['--json'])
  assert('bare matcher ref', result.code === 1 && result.json?.problems?.some(message => message.includes('concrete test')), 'code=' + result.code)
} finally {
  cleanup(bareMatcher.base)
}

// A change-record (V2-*) is an alias, not a scored requirement.
const changeRecord = fixture()
try {
  const groupPath = join(changeRecord.req, '10-scope.json')
  const group = JSON.parse(readFileSync(groupPath, 'utf8'))
  group.items.push({
    id: 'V2-SCOPE-01', kind: 'CHANGE', title: 'change record', statement: 'v2 change record.',
    priority: 'P2', authority: 'v1', scoring: false, owner: 'evolution-merge',
    criteria: [{ id: 'AC-1', text: 'record only' }], supersedes: [],
  })
  writeJson(groupPath, group)
  const indexPath = join(changeRecord.req, 'index.json')
  const index = JSON.parse(readFileSync(indexPath, 'utf8'))
  index.aliases = { 'V2-SCOPE-01': { canonical: 'FR-SCOPE-01', kind: 'change-record' } }
  index.universe = { total: 2, sourceCounts: { v1: 1, v2: 1 } }
  writeJson(indexPath, index)
  assert('change-record fixture gen', run(GEN, changeRecord.root, []).code === 0, 'gen failed')
  const result = run(VERIFY, changeRecord.root, ['--strict', '--json'])
  assert('change-record not scored', result.code === 0, 'expected 0, got ' + result.code + ' ' + JSON.stringify(result.json?.problems))
} finally {
  cleanup(changeRecord.base)
}

// A cannot-decide criterion is partial; strict must fail.
const partial = fixture()
try {
  const evidencePath = join(partial.req, 'evidence.json')
  const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'))
  evidence.records[0].verdict = 'cannot-decide'
  writeJson(evidencePath, evidence)
  assert('partial fixture gen', run(GEN, partial.root, []).code === 0, 'gen failed')
  const result = run(VERIFY, partial.root, ['--strict', '--json'])
  assert('partial strict fails', result.code === 1 && result.json?.items?.find(item => item.id === 'FR-SCOPE-01')?.status === 'partial', 'code=' + result.code + ' status=' + String(result.json?.items?.[0]?.status))
} finally {
  cleanup(partial.base)
}

// docDrift is a document property that strict must refuse to ignore.
const drift = fixture()
try {
  const groupPath = join(drift.req, '10-scope.json')
  const group = JSON.parse(readFileSync(groupPath, 'utf8'))
  group.items[0].docDrift = true
  writeJson(groupPath, group)
  assert('drift fixture gen', run(GEN, drift.root, []).code === 0, 'gen failed')
  const result = run(VERIFY, drift.root, ['--strict', '--json'])
  assert('docDrift strict fails', result.code === 1 && result.json?.problems?.some(message => message.includes('docDrift')), 'code=' + result.code)
} finally {
  cleanup(drift.base)
}

// An empty registry is cannot-decide, not pass.
const empty = fixture()
try {
  writeJson(join(empty.req, '10-scope.json'), { items: [] })
  const indexPath = join(empty.req, 'index.json')
  const index = JSON.parse(readFileSync(indexPath, 'utf8'))
  index.universe = { total: 0, sourceCounts: {} }
  writeJson(indexPath, index)
  const result = run(VERIFY, empty.root, ['--json'])
  assert('empty registry', result.code === 2, 'expected 2, got ' + result.code)
} finally {
  cleanup(empty.base)
}

if (failures.length > 0) {
  for (const failure of failures) console.error('requirements.selftest: FAIL — ' + failure)
  process.exit(1)
}
console.log('requirements.selftest: OK — 2 controls + 7 negative fixtures')
