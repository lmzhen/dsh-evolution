import { expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 0.3.73 guard: the platform's wake primitives are PROTOTYPE methods.
 *
 * `Agent.followup` / `Agent.inject` / `Agent.steer` live on the ReactLoopAgent
 * prototype and call `this.send(...)` (packages/core/agent-loop/src/agent.ts).
 * Extracting one into a local (`const followup = agent.followup`) and calling
 * the detached reference drops the receiver: every delivery threw
 * `TypeError: Cannot read properties of undefined (reading 'send')`, each call
 * site's catch demoted that to a console warning, and the review's cadence reset
 * ran anyway — the prompt was silently consumed from 2026-09-07 to 0.3.73 while
 * the unit suites stayed green (their stubs are bound arrow properties, where a
 * detached call still works).
 *
 * This guard pins the call FORM over production sources: a wake primitive is
 * only ever called ON its receiver. Tests are skipped on purpose (they exercise
 * the detached shape as a control) and the detector proves itself on the exact
 * shape that shipped, so a broken pattern cannot pass vacuously.
 */
const WAKE = 'followup|inject|steer'

/** `file:line (primitive)` for every local that extracts a wake primitive. */
function detachedWakeSites(rel: string, text: string): string[] {
  const out: string[] = []
  text.split(/\r?\n/).forEach((line, index) => {
    const code = line.split('//')[0] ?? ''
    // `.*` (not `[^=]*`): the receiver shape contains `=>` in its function types.
    const assigned = new RegExp('(?:const|let)\\s+[A-Za-z_$][\\w$]*\\s*=\\s*.*\\.(' + WAKE + ')\\s*\\)?\\s*$').exec(code)
    const destructured = new RegExp('(?:const|let)\\s*\\{[^}]*\\b(' + WAKE + ')\\b[^}]*\\}\\s*=\\s*[A-Za-z_$]').exec(code)
    const primitive = assigned?.[1] ?? destructured?.[1]
    if (primitive !== undefined) out.push(`${rel}:${index + 1} (${primitive})`)
  })
  return out
}

interface SourceFile {
  /** Family-relative path, identical in every tree the family is checked out in. */
  key: string
  text: string
}

/** Every TypeScript source file under each package's src directory. */
function sourceFiles(): SourceFile[] {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const out: SourceFile[] = []
  for (const pkg of readdirSync(root)) {
    const src = join(root, pkg, 'src')
    try {
      if (!statSync(src).isDirectory()) continue
    } catch { continue }
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) {
          walk(full)
          continue
        }
        if (!entry.endsWith('.ts')) continue
        out.push({ key: pkg + '/src/' + entry, text: readFileSync(full, 'utf8') })
      }
    }
    walk(src)
  }
  return out
}

it('0.3.73: no production source extracts a wake primitive from its receiver', () => {
  // Detector self-proof: the exact shape that shipped must be flagged, and the
  // fixed shape (call on the receiver) must not be.
  expect(detachedWakeSites('sample.ts', 'const followup = (agent as { followup?: (m: unknown) => void }).followup')).toHaveLength(1)
  expect(detachedWakeSites('sample.ts', 'const { inject } = invocation.agent')).toHaveLength(1)
  expect(detachedWakeSites('sample.ts', 'wake.followup(message)')).toEqual([])
  expect(detachedWakeSites('sample.ts', "if (typeof wake.followup === 'function') wake.followup(message)")).toEqual([])

  const files = sourceFiles()
  // No vacuous pass: an empty or truncated walk would make the assertion below
  // meaningless (the same discipline as the library-limits guard).
  expect(files.length).toBeGreaterThan(50)
  const sites: string[] = []
  for (const file of files) sites.push(...detachedWakeSites(file.key, file.text))
  expect(sites).toEqual([])
})
