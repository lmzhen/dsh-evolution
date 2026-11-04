import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { resolveOverlay } from '../scripts/lib-env.mjs'

/**
 * Declared TypeScript launcher for crash tests.
 *
 * The old specs spawned `node_modules/.bin/tsx.cmd`, which the flat mirror does
 * not install (the platform overlay owns tsx). Resolve tsx from this tree first,
 * then from the platform overlay, and always launch its JS CLI with the current
 * Node executable — no shell, no Windows .cmd shim.
 */
export function resolveTsxCli(): string {
  const explicit = process.env.FAMILY_TSX_CLI
  if (explicit !== undefined && explicit !== '') {
    if (existsSync(explicit)) return explicit
    throw new Error('FAMILY_TSX_CLI does not exist: ' + explicit)
  }
  const roots = [process.cwd(), resolveOverlay()]
  for (const root of roots) {
    if (root === null) continue
    try {
      const require = createRequire(join(root, 'package.json'))
      const pkg = require.resolve('tsx/package.json')
      const cli = join(dirname(pkg), 'dist', 'cli.mjs')
      if (existsSync(cli)) return cli
    } catch { /* try the next declared root */ }
  }
  throw new Error('tsx launcher not found: install tsx or set FAMILY_TSX_CLI')
}

export function spawnTsx(scriptPath: string, args: string[] = [], options: SpawnOptions = { stdio: 'ignore' }): ChildProcess {
  return spawn(process.execPath, [resolveTsxCli(), scriptPath, ...args], options)
}
