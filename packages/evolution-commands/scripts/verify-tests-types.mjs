#!/usr/bin/env node
/**
 * Type-check a family package's tests against an explicit platform declaration root.
 *
 * The platform graph is version-pinned: a 0.2.2 tree cannot judge 0.3 code. Instead of
 * checking in a fake platform tree or absolute paths, this script takes the root at run
 * time (`--types-root`) and generates a temporary tsconfig from the family's own paths.
 *
 * Usage:
 *   node packages/evolution-commands/scripts/verify-tests-types.mjs \
 *     --types-root <dir containing @deepseek-ai/*\/lib/types/index.d.ts> [--package evolution-commands]
 *
 * In CI, pass the built platform declaration root of the same `platform-line.json`; locally,
 * pass a global dsh install of the matching platform version. No generated file is kept.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import ts from 'typescript'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, '..')
const familyRoot = dirname(packageRoot)
const findUp = (start, rel) => {
  let dir = start
  for (;;) {
    const candidate = join(dir, rel)
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}
const basePath = findUp(familyRoot, 'tsconfig.base.json')
if (basePath === undefined) {
  console.error('verify-tests-types: no tsconfig.base.json above ' + familyRoot)
  process.exit(2)
}
const baseDir = dirname(basePath)
const args = process.argv.slice(2)
const valueOf = (flag) => {
  const index = args.indexOf(flag)
  if (index < 0) return undefined
  const value = args[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(flag + ' needs a value')
  return value
}
const typesRoot = valueOf('--types-root')
if (typesRoot === undefined) {
  console.error('verify-tests-types: --types-root <platform @deepseek-ai parent> is required')
  process.exit(2)
}
const read = ts.readConfigFile(basePath, ts.sys.readFile)
if (read.error) {
  console.error('verify-tests-types: cannot read ' + basePath)
  process.exit(2)
}
const paths = {}
for (const [key, value] of Object.entries(read.config.compilerOptions?.paths ?? {})) {
  if (key.startsWith('@deepseek-ai/dsh-evolution')) {
    paths[key] = value.map((entry) => {
      const rel = relative(packageRoot, resolve(baseDir, entry))
      return rel.startsWith('.') ? rel : './' + rel
    })
    continue
  }
  const name = key.slice('@deepseek-ai/'.length)
  const pkgName = name.split('/')[0]
  const dts = join(typesRoot, pkgName, 'lib', 'types', 'index.d.ts')
  paths[key] = existsSync(dts) ? [dts] : value
}
paths['@deepseek-ai/*'] = [join(typesRoot, '*', 'lib', 'types', 'index.d.ts')]
const cordisContext = join(typesRoot, 'cordis', 'lib', 'types', 'context.d.ts')
if (existsSync(cordisContext)) paths['@deepseek-ai/cordis/src/context.ts'] = [cordisContext]
const config = {
  extends: basePath,
  compilerOptions: {
    noEmit: true,
    declaration: false,
    declarationMap: false,
    composite: false,
    incremental: false,
    rewriteRelativeImportExtensions: false,
    paths,
  },
  include: ['tests/**/*.ts', 'src/**/*.ts', '../test-support/temp-home.ts', '../test-support/commands-stub.ts', '../test-support/fake-channel-services.ts'],
}
const configPath = join(packageRoot, '.tsconfig.tests.tmp.json')
writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')
const tsc = findUp(baseDir, 'node_modules/typescript/bin/tsc')
if (tsc === undefined) {
  console.error('verify-tests-types: no node_modules/typescript above ' + baseDir)
  process.exit(2)
}
const result = spawnSync(process.execPath, [tsc, '-p', configPath, '--pretty', 'false'], { cwd: baseDir, stdio: 'inherit' })
rmSync(configPath, { force: true })
process.exit(result.status ?? 1)

