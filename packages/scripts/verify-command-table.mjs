#!/usr/bin/env node
/**
 * G7.4 (C7): the command TABLE and the command DISPATCH must agree.
 *
 * C7's fallback is "缺表项 ⇒ 该子命令不得上线（不存在'未登记但可用'）", so this gate walks both
 * directions:
 *
 *   A. every table entry carries the C7 shape (usage + summary + readonly);
 *   B. every entry's `usage` is a line the ONE parser accepts (its name is the entry's name);
 *   C. every subcommand the DISPATCH answers has a table entry, and every table name is answered
 *      somewhere in the command source. The count of branches still dispatched by their own regex is
 *      REPORTED (they are the remaining G7.4 migration), not failed.
 *
 * Usage: node packages/scripts/verify-command-table.mjs [packages-root]
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { stripComments } from './lib-source-text.mjs'

const root = process.argv[2] ?? 'packages'
// The command surface is TypeScript: import it through a file URL (Node strips the types).
const pkg = resolve(root, 'evolution-commands/src')
const { COMMAND_ENTRIES, entryName, entryFlags } = await import(pathToFileURL(join(pkg, 'registry.ts')).href)
const { parseSubcommand, isParseFailure } = await import(pathToFileURL(join(pkg, 'parse.ts')).href)
const sourcePath = join(pkg, 'index.ts')
const source = stripComments(readFileSync(sourcePath, 'utf8'))
const problems = []

// A: the C7 shape.
for (const entry of COMMAND_ENTRIES) {
  if (typeof entry.usage !== 'string' || entry.usage === '') problems.push('an entry carries no usage')
  if (typeof entry.summary !== 'string' || entry.summary === '') problems.push(entry.usage + ': carries no summary')
  if (typeof entry.readonly !== 'boolean') problems.push(entry.usage + ': carries no readonly flag (C7)')
}

// B: the usage line reads as documentation FOR this entry: its first token is the name the table
// derives, and every flag it mentions is well-formed (`--flag` or `--flag=<value>`). A usage string is
// NOT a command line — brackets, <placeholders> and `|` variants are how the table talks to a reader.
for (const entry of COMMAND_ENTRIES) {
  const first = entry.usage.split(' ')[0].split('|')[0]
  if (first === '' || !/^[a-z][a-z-]*$/.test(first)) problems.push(entry.usage + ': does not start with a subcommand name')
  if (first !== entryName(entry)) problems.push(entry.usage + ': the table names it "' + entryName(entry) + '"')
  for (const flag of entryFlags(entry)) {
    if (!new RegExp('\\' + flag + '(=|\\s|\\]|$|\\|)').test(entry.usage)) problems.push(entry.usage + ': mentions ' + flag + ' in an unreadable form')
  }
}

// C: dispatch ↔ table, both directions.
const tableNames = new Set(COMMAND_ENTRIES.map(entryName))
const dispatched = new Set()
for (const match of source.matchAll(/([A-Za-z]+Parsed)\.name [!=]== '([a-z]+)'/g)) dispatched.add(match[2])
for (const match of source.matchAll(/subcommandOf\(input, '([a-z]+)'/g)) dispatched.add(match[1])
for (const name of dispatched) {
  if (!tableNames.has(name)) problems.push('the dispatch answers "' + name + '" but the table has no entry for it (C7)')
}
for (const name of tableNames) {
  const answered = new RegExp("'" + name + "'").test(source) || new RegExp('\\b' + name + '\\b').test(source)
  if (!answered) problems.push('the table declares "' + name + '" but the command source never answers it')
}
// D (P2): the parser's value-flag list and the table's usage lines are two declarations of ONE fact —
// which flags take a value. Until this ran, adding a value flag to the table and forgetting the
// parser (or vice versa) was silent drift: the parser would either swallow the next token as a value
// or leave it as a stray positional. Both directions are asserted here.
const { VALUE_FLAGS } = await import(pathToFileURL(join(pkg, 'parse.ts')).href)
const takingInUsage = new Set()
for (const entry of COMMAND_ENTRIES) {
  for (const match of entry.usage.matchAll(/--([a-z][a-z-]*)/g)) {
    // Value-taking in a USAGE line means the flag is followed by `=` or by a value token — not by the
    // closing bracket of an optional group (`[--facts]`) and not by another flag.
    const tail = entry.usage.slice(match.index + match[0].length)
    if (tail.startsWith('=') || /^\s+(?!\[?--)[^\s\]|]/.test(tail)) takingInUsage.add(match[1])
  }
}
for (const flag of takingInUsage) {
  if (!VALUE_FLAGS.includes(flag)) {
    problems.push('the table spells --' + flag + ' with a value, but the parser does not list it in VALUE_FLAGS ' +
      '(it would leave the value as a stray positional)')
  }
}
for (const flag of VALUE_FLAGS) {
  if (!takingInUsage.has(flag)) {
    problems.push('the parser lists --' + flag + ' as value-taking, but no usage line spells it with a value ' +
      '(a stale entry: it would swallow the next token)')
  }
}
// The remaining migration: branches that still answer with their own regex instead of the parser.
const regexBranches = (source.match(/^ {8}const [A-Za-z]+ = \/\^/gm) ?? []).length

if (problems.length > 0) {
  console.error('verify-command-table: ' + problems.length + ' problem(s)')
  for (const problem of problems) console.error('  ' + problem)
  process.exit(1)
}
console.log('verify-command-table: OK — ' + COMMAND_ENTRIES.length + ' table entr(ies), ' +
  dispatched.size + ' parser-dispatched name(s); ' + regexBranches + ' branch(es) still dispatched by their own regex')
