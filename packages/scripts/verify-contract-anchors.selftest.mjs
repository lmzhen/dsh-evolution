#!/usr/bin/env node
/**
 * Selftest for lib-contract-anchor.mjs (W9-g3-b): the grader must be able to go RED.
 *
 * Fixtures, not the real upstream tree, so the proof travels with the repo: an export, a class
 * member, a literal, a renamed symbol and a text-only registration.
 */
import { anchorSymbol, declaresSymbol, gradeAnchor } from './lib-contract-anchor.mjs'

const cases = [
  {
    name: 'exported type',
    source: "export type ToolCallId = Branded<'ToolCallId'>\n",
    anchor: { anchor: "export type ToolCallId = Branded<'ToolCallId'>" },
    expect: { grade: 'symbol', symbol: 'ToolCallId' },
  },
  {
    name: 'class member',
    source: '  async snapshotEvents(since: number): Promise<Event[]> { return [] }\n',
    anchor: { anchor: 'snapshotEvents(' },
    expect: { grade: 'symbol', symbol: 'snapshotEvents' },
  },
  {
    name: 'interface field',
    source: '  readonly attachments?: boolean\n',
    anchor: { anchor: 'readonly attachments?: boolean' },
    expect: { grade: 'symbol', symbol: 'attachments' },
  },
  {
    name: 'literal event name (text kind)',
    source: "  'tool/ptc-dispatch',\n",
    anchor: { anchor: "'tool/ptc-dispatch',", kind: 'text' },
    expect: { grade: 'text' },
  },
  {
    name: 'RENAMED symbol is missing',
    source: '  async snapshotEventsFixed(since: number) { return [] }\n',
    anchor: { anchor: 'snapshotEvents(' },
    expect: { grade: 'missing', symbol: 'snapshotEvents' },
  },
  {
    name: 'declaration moved but text kept → text grade',
    source: "export type ToolCallId = Branded<'ToolCallId'>\n",
    anchor: { anchor: "Branded<'ToolCallId'>" },
    expect: { grade: 'text' },
  },
]

let failed = 0
for (const testCase of cases) {
  const actual = gradeAnchor(testCase.source, testCase.anchor)
  const ok = actual.grade === testCase.expect.grade
    && (testCase.expect.symbol === undefined || actual.symbol === testCase.expect.symbol)
  if (!ok) {
    failed += 1
    console.error('  FAIL  ' + testCase.name + ': expected ' + JSON.stringify(testCase.expect) + ', got ' + JSON.stringify(actual))
  } else {
    console.log('  ok    ' + testCase.name + ' → ' + actual.grade)
  }
}

// The helpers themselves must not be vacuous.
if (anchorSymbol('no identifier here') !== null) { console.error('  FAIL  anchorSymbol returned a name for a pure literal'); failed += 1 }
if (!declaresSymbol('const CONTEXT_ORDERS = {}', 'CONTEXT_ORDERS')) { console.error('  FAIL  declaresSymbol missed a const'); failed += 1 }

console.log('verify-contract-anchors.selftest: ' + (cases.length + 2 - failed) + '/' + (cases.length + 2) + ' check(s) passed')
process.exit(failed === 0 ? 0 : 1)
