#!/usr/bin/env node
/**
 * G4 (contracts C5/C6): every DECLARED field is rendered, and every deliberate exception is declared.
 *
 * "声明了就必被引用或删除" — the plan's own wording. Two directions, both derived from single sources:
 *
 *   A. DECLARED => RENDERED. Every field in the GENERATED client view
 *      (`evolution-settings-ui/src/client/generated-params.ts`, itself generated from the registry)
 *      must have a rendering branch for its `control` in `ParamCard.ts`. A control nobody renders is a
 *      field the browser half declares and silently drops.
 *   B. EXCEPTION <=> NO PLATFORM PIECE. The platform's field spec offers number/text only, so a
 *      switch/select field has no platform piece and MUST appear in the C6 table
 *      (`scripts/client-exceptions.json`, shape `{fieldId, reason, owner}`). The table is checked in
 *      BOTH directions: a switch/select field without an entry is an undeclared self-kept control
 *      (C6: "例外要显式，不许顺手自留"), and an entry naming a field the generated view no longer
 *      carries is a stale exception.
 *   C. SHAPE. Each entry carries a non-empty reason and owner; ids are unique.
 *
 * Usage: node packages/scripts/verify-declarations.mjs [packages-root]
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { stripComments } from './lib-source-text.mjs'

const root = process.argv[2] ?? 'packages'
const here = resolve(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const problems = []

const readFields = () => {
  const text = readFileSync(join(root, 'evolution-settings-ui', 'src', 'client', 'generated-params.ts'), 'utf8')
  const fields = []
  const re = /\{\s*id: '([^']+)',[\s\S]*?control: '(number|switch|select|text)'/g
  let match
  while ((match = re.exec(text)) !== null) fields.push({ id: match[1], control: match[2] })
  return fields
}

const fields = readFields()
if (fields.length === 0) problems.push('the generated client view carries no field — is generated-params.ts stale?')

// A: declared => rendered.
const card = stripComments(readFileSync(join(root, 'evolution-settings-ui', 'src', 'client', 'ParamCard.ts'), 'utf8'))
for (const kind of new Set(fields.map((field) => field.control))) {
  if (!new RegExp("control === '" + kind + "'").test(card)) {
    problems.push('control "' + kind + '" is declared by the generated view but ParamCard.ts renders no branch for it')
  }
}

// B: exception <=> no platform piece (the platform spec has number/text only).
const table = JSON.parse(readFileSync(join(here, 'client-exceptions.json'), 'utf8'))
const declared = new Map()
for (const entry of table.exceptions ?? []) {
  const id = String(entry.fieldId ?? '')
  if (id === '') { problems.push('an exception carries no fieldId'); continue }
  if (declared.has(id)) problems.push(id + ': declared twice in the C6 table')
  declared.set(id, entry)
  if (String(entry.reason ?? '') === '') problems.push(id + ': the exception carries no reason')
  if (String(entry.owner ?? '') === '') problems.push(id + ': the exception carries no owner')
}
const needsException = new Set(fields.filter((field) => field.control === 'switch' || field.control === 'select').map((field) => field.id))
for (const id of needsException) {
  if (!declared.has(id)) problems.push(id + ': a ' + (fields.find((field) => field.id === id)?.control ?? '') + ' field has no platform piece but is not in the C6 table (declare the exception)')
}
for (const id of declared.keys()) {
  if (!needsException.has(id)) problems.push(id + ': listed in the C6 table but the generated view does not carry it as a platform-piece-less field (stale exception)')
}

if (problems.length > 0) {
  console.error('verify-declarations: ' + problems.length + ' problem(s)')
  for (const problem of problems) console.error('  ' + problem)
  process.exit(1)
}
console.log('verify-declarations: OK — ' + fields.length + ' declared field(s) rendered; ' +
  needsException.size + ' exception(s) declared against a platform piece that does not exist')
