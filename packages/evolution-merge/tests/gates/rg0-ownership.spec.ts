// @tier pre-tag
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const owners: [string, string][] = [
  ['merge-state', 'src/state.ts'],
  ['runs', '../evolution-core/src/run-registry.ts'],
  ['journal', 'src/domain/commit-journal-store.ts'],
  ['receipt/unit', '../evolution-core/src/skill-store.ts'],
  ['staging', 'src/staging.ts'],
  ['tree fence', '../evolution-core/src/tree-lock.ts'],
  ['target claim', 'src/target-claim.ts'],
  ['eligibility', 'src/runtime.ts'],
  ['query', 'src/read-commands.ts'],
  ['command surface', 'src/commands.ts'],
  ['engine', '../evolution-merge-engine/package.json'],
  ['ui', '../evolution-merge-ui/src/client/Panel.ts'],
]

it('RG0 only state.ts may write merge-state directly', () => {
  const files = readdirSync(root + '/src', { recursive: true }).map(String).filter(name => name.endsWith('.ts'))
  for (const file of files) {
    if (file === 'state.ts') continue
    const source = readFileSync(root + '/src/' + file, 'utf8')
    expect(source, file).not.toContain('mergeStatePath')
  }
})

it('RG0 writer map allows only the declared row/commit writers', () => {
  const files = readdirSync(root + '/src', { recursive: true }).map(String).filter(name => name.endsWith('.ts'))
  const rowWriters = files.filter(file => /import .*\b(transactRows|dropRowV3)\b/.test(readFileSync(root + '/src/' + file, 'utf8')))
  expect(rowWriters.sort()).toEqual(['index.ts', 'pending-actions.ts', 'round2-outcome.ts', 'runtime.ts', 'scan-run.ts'])
  const legacyWriters = files.filter(file => /\b(upsertRow|dropRow|moveRow|mutateMergeState)\b/.test(readFileSync(root + '/src/' + file, 'utf8')))
  expect(legacyWriters).toEqual(['state.ts'])
  const commitWriters = files.filter(file => readFileSync(root + '/src/' + file, 'utf8').includes('port.commitMerge'))
  expect(commitWriters).toEqual(['commit-execute.ts'])
})

it('RG0 twelve owner current paths exist', () => {
  for (const [name, path] of owners) {
    if (name === 'engine') {
      expect(existsSync(root + '/../evolution-merge-engine/package.json') || existsSync(root + '/../evolution-merge-engine-g2/package.json'), name).toBe(true)
      continue
    }
    expect(existsSync(root + '/' + path), name + ' ' + path).toBe(true)
  }
})
