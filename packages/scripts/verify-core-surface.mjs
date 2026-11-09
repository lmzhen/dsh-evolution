#!/usr/bin/env node
/** Guard the core root barrel: write-engine modules live in the ./write subpath. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.argv[2] ?? process.cwd()
const index = readFileSync(join(root, 'packages/evolution-core/src/index.ts'), 'utf8')
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
const write = readFileSync(join(root, 'packages/evolution-core/src/write.ts'), 'utf8')
for (const path of writeOwned) if (!write.includes("'./" + path.slice(2) + "'")) {
  console.error('verify-core-surface: ./write does not export ' + path)
  process.exit(1)
}
console.log('verify-core-surface: root star exports ' + String(stars.length) + ' (<=75); write modules are subpath-only')
