#!/usr/bin/env node
/**
 * Ratchet the family's host platform boundary.
 *
 * Target invariant: only evolution-core/src/platform/** and
 * evolution-client-kit/src/** may import @deepseek-ai/dsh-* service packages;
 * @deepseek-ai/cordis and @deepseek-ai/schemastery are framework primitives and
 * stay allowed. The current tree predates the boundary, so existing violations
 * are recorded in platform-boundary-baseline.json; --check rejects new ones and
 * --strict also rejects stale entries once a phase removes an import.
 *
 * Usage: node verify-platform-boundary.mjs --check [--strict] [--json]
 *        node verify-platform-boundary.mjs --write-baseline
 * Exit: 0 pass, 1 violation, 2 cannot decide.
 */
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { createRequire } from 'node:module'
import { resolvePlatformLineRoot } from './lib-platform-line.mjs'

const argv = process.argv.slice(2)
const writeBaseline = argv.includes('--write-baseline')
const check = argv.includes('--check') || !writeBaseline
const strict = argv.includes('--strict')
const json = argv.includes('--json')
if (!writeBaseline && !check) {
  console.error('verify-platform-boundary: usage: --check [--strict] | --write-baseline')
  process.exit(2)
}

const familyRoot = resolvePlatformLineRoot(import.meta.url)
const baselinePath = join(familyRoot, 'packages', 'scripts', 'platform-boundary-baseline.json')
const allowed = [
  join('packages', 'evolution-core', 'src', 'platform') + sep,
  join('packages', 'evolution-client-kit', 'src') + sep,
]
const skipDirs = new Set(['node_modules', 'lib', 'dist', 'vendor', '.release-staging', '.release-staging.next'])
const familyPackage = (spec) => spec === '@deepseek-ai/dsh-memory' || spec === '@deepseek-ai/dsh-skill-usage' || spec.startsWith('@deepseek-ai/dsh-evolution-')

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name)) walk(path, out)
      continue
    }
    if (/\.(ts|mts|tsx)$/.test(entry.name) && !/\.spec\.ts$/.test(entry.name)) out.push(path)
  }
}

const files = []
const packagesDir = join(familyRoot, 'packages')
for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const src = join(packagesDir, entry.name, 'src')
  try { if (statSync(src).isDirectory()) walk(src, files) } catch { /* package without src */ }
}

let ts
try {
  const require = createRequire(join(familyRoot, 'package.json'))
  ts = require('typescript')
} catch (error) {
  console.error('verify-platform-boundary: cannot resolve typescript from ' + familyRoot + ' (' + String(error) + '); install the repo dependencies')
  process.exit(2)
}

function specifiersOf(file) {
  const text = readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const specs = []
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
      specs.push(node.moduleSpecifier.text)
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0])) {
      specs.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return specs
}

const violations = []
for (const file of files) {
  const rel = relative(familyRoot, file).split(sep).join('/')
  if (allowed.some((prefix) => rel.startsWith(prefix.split(sep).join('/')))) continue
  for (const spec of specifiersOf(file)) {
    if (spec.startsWith('@deepseek-ai/dsh-') && !familyPackage(spec)) violations.push({ file: rel, specifier: spec })
  }
}
const keyOf = (v) => v.file + '::' + v.specifier
const unique = [...new Map(violations.map((v) => [keyOf(v), v])).values()]
unique.sort((a, b) => a.file.localeCompare(b.file) || a.specifier.localeCompare(b.specifier))

if (writeBaseline) {
  const payload = { version: 1, violations: unique.map((v) => ({ file: v.file, specifier: v.specifier })) }
  writeFileSync(baselinePath, JSON.stringify(payload, null, 2) + '\n')
  console.log('verify-platform-boundary: wrote ' + unique.length + ' baseline violation(s) to ' + baselinePath)
  process.exit(0)
}

if (!existsSync(baselinePath)) {
  console.error('verify-platform-boundary: no baseline at ' + baselinePath + '; run --write-baseline once, or remove the boundary rule')
  process.exit(2)
}
let baseline
try {
  baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
} catch (error) {
  console.error('verify-platform-boundary: unreadable baseline: ' + String(error))
  process.exit(2)
}
const baseKeys = new Set((baseline.violations ?? []).map(keyOf))
const liveKeys = new Set(unique.map(keyOf))
const added = unique.filter((v) => !baseKeys.has(keyOf(v)))
const stale = (baseline.violations ?? []).filter((v) => !liveKeys.has(keyOf(v)))
const result = { live: unique.length, baseline: baseKeys.size, added, stale }
if (json) console.log(JSON.stringify(result, null, 1))
else {
  console.log('verify-platform-boundary: live=' + unique.length + ' baseline=' + baseKeys.size + ' added=' + added.length + ' stale=' + stale.length)
  for (const v of added.slice(0, 20)) console.log('  NEW ' + v.file + ' -> ' + v.specifier)
  for (const v of stale.slice(0, 20)) console.log('  STALE ' + v.file + ' -> ' + v.specifier)
}
const failed = added.length > 0 || (strict && stale.length > 0)
if (failed) {
  console.error('verify-platform-boundary: FAILED — move the import behind core/platform (or client-kit), then rerun --write-baseline only if the baseline is intentionally refreshed')
  process.exit(1)
}
console.log('verify-platform-boundary: OK — no new boundary violation' + (strict ? ' and no stale baseline entry' : ''))
process.exit(0)
