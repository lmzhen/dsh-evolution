#!/usr/bin/env node
/** Guard the core root barrel: write-engine modules live in the ./write subpath. */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join as joinPath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = process.argv[2] ?? process.cwd()
const scriptSibling = joinPath(dirname(fileURLToPath(import.meta.url)), '..', 'evolution-core')
const packageRoot = existsSync(join(root, 'packages/evolution-core'))
  ? join(root, 'packages/evolution-core')
  : existsSync(join(root, 'evolution-core'))
    ? join(root, 'evolution-core')
    : scriptSibling
const index = readFileSync(join(packageRoot, 'src/index.ts'), 'utf8')
const stars = [...index.matchAll(/^export \* from '([^']+)'/gm)].map(match => match[1])
const writeOwned = ['./write-kernel.ts', './mutation-unit.ts', './mutation-storage-adapter.ts', './unit-claim.ts', './unit-journal.ts', './unit-storage.ts']
const leaked = stars.filter(path => writeOwned.includes(path))
if (leaked.length > 0) {
  console.error('verify-core-surface: write modules leaked back into the root barrel: ' + leaked.join(', '))
  process.exit(1)
}
if (stars.length > 75) {
  console.error('verify-core-surface: root star exports grew to ' + String(stars.length) + ' (budget 75)')
  process.exit(1)
}
const write = readFileSync(join(packageRoot, 'src/write.ts'), 'utf8')
for (const path of writeOwned) if (!write.includes("'./" + path.slice(2) + "'")) {
  console.error('verify-core-surface: ./write does not export ' + path)
  process.exit(1)
}
console.log('verify-core-surface: root star exports ' + String(stars.length) + ' (<=75); write modules are subpath-only')
