#!/usr/bin/env node
/**
 * Type-check the whole family test tree against an explicit platform base.
 *
 * The platform graph is version-pinned. Rather than committing a tree or machine
 * paths, take the platform base tsconfig at run time (`--base`) and the global
 * declaration root for the core runtime packages (`--types-root`), generate a
 * temporary config, run tsc, then delete it.
 *
 *   node packages/evolution-commands/scripts/verify-tests-types.mjs \
 *     --base <platform root> --types-root <dir with cordis/lib/types>
 */
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import ts from 'typescript'

const args = process.argv.slice(2)
const valueOf = (flag) => {
  const index = args.indexOf(flag)
  const value = index < 0 ? undefined : args[index + 1]
  if (value === undefined || value.startsWith('--')) {
    console.error('verify-tests-types: ' + flag + ' needs a value')
    process.exit(2)
  }
  return value
}
const baseDir = resolve(valueOf('--base'))
const typesRoot = resolve(valueOf('--types-root'))
const basePath = join(baseDir, 'tsconfig.base.json')
const read = ts.readConfigFile(basePath, ts.sys.readFile)
if (read.error) {
  console.error('verify-tests-types: cannot read ' + basePath)
  process.exit(2)
}
const paths = { ...(read.config.compilerOptions?.paths ?? {}) }
for (const pkg of ['cordis', 'cosmokit', 'schemastery', 'cordis-plugin-loader', 'cordis-plugin-include', 'cordis-plugin-group', 'cordis-plugin-timer', 'cordis-plugin-hmr', 'cordis-plugin-logger-console']) {
  paths['@deepseek-ai/' + pkg] = [join(typesRoot, pkg, 'lib', 'types', 'index.d.ts')]
}
paths['@deepseek-ai/cordis/src/context.ts'] = [join(typesRoot, 'cordis', 'lib', 'types', 'context.d.ts')]
const configPath = join(baseDir, '.tsconfig.tests.tmp.json')
const config = {
  extends: basePath,
  compilerOptions: {
    noEmit: true, declaration: false, declarationMap: false, composite: false, incremental: false,
    rewriteRelativeImportExtensions: false, typeRoots: [resolve(typesRoot, '..', '@types')], paths,
  },
  include: existsSync(join(baseDir, 'packages', 'evolution'))
    ? ['packages/evolution/evolution-*/tests/**/*.ts', 'packages/evolution/test-support/**/*.ts']
    : ['packages/evolution-*/tests/**/*.ts', 'packages/test-support/**/*.ts'],
}
writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')
const tsc = findUp(baseDir, 'node_modules/typescript/bin/tsc')
if (tsc === undefined) {
  console.error('verify-tests-types: no node_modules/typescript above ' + baseDir)
  process.exit(2)
}
const result = spawnSync(process.execPath, [tsc, '-p', configPath, '--pretty', 'false'], { cwd: baseDir, stdio: 'inherit' })
rmSync(configPath, { force: true })
process.exit(result.status ?? 1)

function findUp(start, rel) {
  for (let dir = start; ; dir = dirname(dir)) {
    const candidate = join(dir, rel)
    if (existsSync(candidate)) return candidate
    if (dirname(dir) === dir) return undefined
  }
}

