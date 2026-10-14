// test-support/mutation-fixture.ts - the ONE fixture source for the four negative classes
// (G4; the plan names them 真空根 / 未声明跨包 import / 占位符参数 / 非命令 cmd).
//
// Why it exists: these classes were embedded inside guard-scripts.spec.ts, mixed one-per-test
// with a green run against the real tree. Retiring the green half (G5) must not take the
// negative coverage with it, and a class must have ONE fixture definition that the judge which
// owns it consumes:
//
//   vacuumRoot                 -> the guards        (guard-scripts.negative.spec.ts)
//   undeclaredCrossPackageImport -> dependency-closure (guard-scripts.negative.spec.ts)
//   placeholderArgument        -> the executor      (verify-verdict-records.mjs)
//   nonCommandCommand          -> the executor      (verify-verdict-records.mjs)
//
// Two-stage assertion (the family discipline): a fixture asserts the EXIT SEMANTICS and the
// JUDGED OBJECT'S NAME. A red that names nothing is not actionable, and a green with no object
// name is not evidence.
import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tempRoot } from './temp-home.ts'

export interface FixtureFile { path: string; content: string }
export interface GuardRun { code: number | null; stdout: string; stderr: string }
export interface TwoStageExpectation { code: number; names: string[] }
export interface TwoStageResult { exitOk: boolean; missingNames: string[]; detail: string }

/** Write a synthetic tree under a fresh temp root; returns the root. */
export async function writeTree(prefix: string, files: FixtureFile[]): Promise<string> {
  const root = await tempRoot(prefix)
  for (const file of files) {
    const full = join(root, file.path)
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, file.content, 'utf8')
  }
  return root
}

/** Run a guard to completion; a non-zero exit is DATA here, never an exception. */
export async function runGuard(script: string, args: string[]): Promise<GuardRun> {
  return await new Promise<GuardRun>((resolve) => {
    execFile(process.execPath, [script, ...args], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error === null ? 0 : (error as { code?: number | string }).code
      resolve({ code: typeof code === 'number' ? code : (error === null ? 0 : 1), stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
    })
  })
}

/** The shape assertion every case starts with: a run is { code, stdout, stderr } and nothing else. */
export function assertRunShape(run: GuardRun): void {
  if (typeof run.code !== 'number') throw new Error('fixture shape: run.code is not a number')
  if (typeof run.stdout !== 'string' || typeof run.stderr !== 'string') throw new Error('fixture shape: run streams are not strings')
}

/** Stage 1: the exit semantics. Stage 2: every judged object is NAMED in the output. */
export function twoStage(run: GuardRun, expected: TwoStageExpectation): TwoStageResult {
  const output = run.stdout + run.stderr
  const missingNames = expected.names.filter(name => !output.includes(name))
  const exitOk = run.code === expected.code
  return {
    exitOk,
    missingNames,
    detail: 'exit=' + String(run.code) + ' (expected ' + String(expected.code) + ')' + (missingNames.length === 0 ? '' : '; output never names ' + missingNames.join(', ')),
  }
}

/** Class: an empty root must be a loud failure, never a vacuum pass. */
export async function vacuumRoot(): Promise<string> {
  return await writeTree('neg-vacuum-', [])
}

/** Class: a package importing another family package without declaring it. */
export async function undeclaredCrossPackageImport(): Promise<string> {
  return await writeTree('neg-closure-', [
    { path: 'demo-pkg/package.json', content: JSON.stringify({ name: '@deepseek-ai/dsh-demo-pkg', version: '0.0.0' }) },
    { path: 'demo-pkg/src/index.ts', content: "import { SkillLibrary } from '@deepseek-ai/dsh-evolution-core'\n" },
  ])
}

/** Class: an import of a package the manifest does not declare is the SAME defect as above. */
export const CROSS_PACKAGE_IMPORT_NAME = 'dsh-evolution-core'

/** Class: a declaration row whose executable form carries a placeholder argument. */
export const PLACEHOLDER_ROW = { id: 'probe-placeholder', argv: ['node', 'x.mjs', '<plane home>'], placeholder: '<plane home>' }

/** Class: a declaration row whose argv[0] is a flag, not a command. */
export const NON_COMMAND_ROW = { id: 'probe-noncommand', argv: ['--check'], flag: '--check' }
