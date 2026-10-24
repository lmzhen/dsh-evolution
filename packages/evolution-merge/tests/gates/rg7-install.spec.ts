// @tier pre-tag
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const dist = fileURLToPath(new URL('../../../dist/', import.meta.url))
const family = ['merge', 'merge-engine', 'merge-g2', 'merge-ui'].map(name => join(dist, 'lmzhen-dsh-evolution-' + name + '-0.30.18.tgz'))
const installed = process.env.RG7_INSTALL_DIR ?? 'D:/dsh/skill-merge/merge-pipeline/artifacts/gates/RG7/install4'

it('RG7 install smoke ships the four tarballs and installs the merge package', () => {
  for (const file of family) expect(existsSync(file), file).toBe(true)
  const pkgPath = join(installed, 'node_modules', '@lmzhen', 'dsh-evolution-merge', 'package.json')
  expect(existsSync(pkgPath), pkgPath).toBe(true)
  expect(JSON.parse(readFileSync(pkgPath, 'utf8')).version).toBe('0.30.18')
  const all = 'D:/dsh/skill-merge/merge-pipeline/artifacts/gates/RG7/install-all/node_modules/@lmzhen'
  for (const name of ['dsh-evolution-all', 'dsh-evolution-preset', 'dsh-evolution-host']) expect(existsSync(join(all, name, 'package.json')), name).toBe(true)
})
