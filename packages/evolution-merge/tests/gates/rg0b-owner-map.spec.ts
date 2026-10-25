// @tier pre-tag
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const mergeRoot = fileURLToPath(new URL('../..', import.meta.url))
const coreRoot = fileURLToPath(new URL('../../../evolution-core/src', import.meta.url))
const all = (root: string): string[] => readdirSync(root, { recursive: true }).map(String).filter(name => name.endsWith('.ts'))

function defining(root: string, name: string): string[] {
  return all(root).filter(file => new RegExp('(async )?function ' + name + '\\b').test(readFileSync(root + '/' + file, 'utf8')))
}

const owners: Array<[string, string, string, string]> = [
  ['journal', mergeRoot + '/src', 'writeJournal', 'domain/commit-journal-store.ts'],
  ['staging', mergeRoot + '/src', 'createStaging', 'staging.ts'],
  ['staged-file', mergeRoot + '/src', 'writeStagedFile', 'staging-files.ts'],
  ['receipt', coreRoot, 'unitReceiptPath', 'unit-storage.ts'],
  ['runs', coreRoot, 'runsFile', 'run-registry.ts'],
  ['tree', coreRoot, 'treeLockFile', 'tree-lock.ts'],
  ['target', mergeRoot + '/src', 'withGuard', 'target-claim.ts'],
  ['claim', mergeRoot + '/src', 'acquireClaim', 'domain/claim.ts'],
]

it('each remaining owner has exactly one writer definition', () => {
  for (const [name, root, fn, expected] of owners) {
    const defs = defining(root, fn).map(file => file.replace(/\\/g, '/'))
    expect(defs, name + ':' + fn).toEqual([expected])
  }
})

it('query/command/engine/UI are declared read/consumer surfaces', () => {
  const forbidden = /\b(transactRows|dropRowV3|upsertRow|dropRow|mutateMergeState|mergeStatePath)\b/
  for (const path of ['read-commands.ts', 'commands.ts']) {
    const text = readFileSync(mergeRoot + '/src/' + path, 'utf8')
    expect(forbidden.test(text), path).toBe(false)
  }
  const engine = existsSync(mergeRoot + '/../evolution-merge-engine/package.json') ? mergeRoot + '/../evolution-merge-engine' : mergeRoot + '/../evolution-merge-engine-g2'
  const ui = mergeRoot + '/../evolution-merge-ui'
  for (const root of [engine + '/src', ui + '/src']) {
    const hits = readdirSync(root, { recursive: true }).map(String).filter(name => /\.(ts|tsx|js)$/.test(name)).filter(name => forbidden.test(readFileSync(root + '/' + name, 'utf8')))
    expect(hits, root).toEqual([])
  }
})
