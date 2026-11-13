#!/usr/bin/env node
/**
 * gates/views — the registry -> generated views renderer (manifest + CONTRIBUTING table).
 *
 * Both the generator and the verifier import this, so "what the view should say" has ONE
 * implementation. A second renderer would be the same drift the registry refactor removes.
 */
import { LANES, profilesOf } from './model.mjs'

export const TABLE_HEADER = '| # | Command | Working tree |'

/** Canonical serialisation order: the artifact is a stable public shape, so key order is fixed. */
export function renderGate(entry) {
  const gate = { id: entry.id, kind: entry.kind, human: entry.title, argv: entry.argv === undefined ? null : entry.argv, tree: entry.tree }
  gate.profiles = profilesOf(entry)
  for (const field of ['argvProblem', 'command', 'reason', 'owner', 'expiry', 'timeoutMs', 'localSafe', 'localSafeReason', 'drillCmd', 'noDrillReason', 'needs', 'after']) {
    if (entry[field] !== undefined) gate[field] = entry[field]
  }
  gate.lanes = [...entry.lanes].sort((left, right) => LANES.indexOf(left) - LANES.indexOf(right))
  if (entry.registration !== undefined) gate.registration = entry.registration
  // CI override layer: the runner applies it only when CI is set (local runs keep the table form).
  if (entry.ci !== undefined) gate.ci = entry.ci
  return gate
}

export function renderManifestGates(registry) {
  return registry.map(renderGate)
}

/** The human appendix carries the table-origin half (`gate-NN`) only; CI-only rows have no number. */
export function renderTableRows(gates) {
  return gates
    .filter((gate) => /^gate-\d{2}$/.test(gate.id))
    .map((gate) => ({ n: Number(gate.id.slice(5)), title: gate.human, tree: gate.tree }))
    .sort((left, right) => left.n - right.n)
}

export function renderTableBlock(rows) {
  return [TABLE_HEADER, '|---|---|---|', ...rows.map((row) => '| ' + row.n + ' | ' + row.title + ' | ' + row.tree + ' |')].join('\n')
}

/** Replace the gate table block in a CONTRIBUTING.md text; throws when the header is missing. */
export function renderContributing(text, block) {
  const lines = text.split('\n')
  const start = lines.findIndex((line) => line.startsWith(TABLE_HEADER))
  if (start < 0) throw new Error('CONTRIBUTING.md carries no gate table header (' + TABLE_HEADER + ')')
  let end = start + 1
  while (end < lines.length && /^\|/.test(lines[end])) end += 1
  return [...lines.slice(0, start), ...block.split('\n'), ...lines.slice(end)].join('\n')
}
