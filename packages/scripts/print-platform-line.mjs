#!/usr/bin/env node
/** Print/validate platform-line.json (CI platform-line job entry: --github-output|--json|--check). */
import { appendFileSync } from 'node:fs'
import { OUTPUT_KEYS, readPlatformLine, resolvePlatformLineRoot } from './lib-platform-line.mjs'

const args = process.argv.slice(2)
const known = new Set(['--github-output', '--json', '--check'])
const unknown = args.filter((arg) => !known.has(arg))
if (unknown.length > 0) {
  console.error('usage: print-platform-line.mjs [--github-output|--json|--check] — unknown flag: ' + unknown.join(' '))
  process.exit(2)
}
const root = resolvePlatformLineRoot(import.meta.url)
const platformLine = readPlatformLine(root)

if (args.includes('--github-output')) {
  const out = process.env.GITHUB_OUTPUT
  if (out === undefined || out === '') {
    console.error('print-platform-line: --github-output requires GITHUB_OUTPUT')
    process.exit(1)
  }
  for (const [key, outputName] of Object.entries(OUTPUT_KEYS)) {
    appendFileSync(out, outputName + '=' + platformLine[key] + '\n')
  }
} else if (args.includes('--json')) {
  console.log(JSON.stringify(platformLine, null, 2))
} else {
  console.log('platform-line: OK — version=' + platformLine.version + ' floor=' + platformLine.floor + ' peers=' + platformLine.peersRange + ' engines=' + platformLine.enginesRange)
}
