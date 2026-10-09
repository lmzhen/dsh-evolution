/**
 * Does every artifact the release workflow DOWNLOADS have a producer in the
 * run that downloads it? (2026-10-09 incident guard, v0.17.0-rc.1.)
 *
 * Usage: node packages/scripts/verify-release-artifacts.mjs [github-dir] [--strict] [--self-test]
 *
 * `release.yml`'s `publish` job downloads the exact bytes it pushes to npm.
 * On 2026-10-09 the approval was granted and `publish` failed with
 * `Artifact not found for name: evolution-dist-baseline`: the job that produced
 * `-baseline` was retired together with the 0.1.5 line (`9e94073`), while the
 * download names stayed behind. `publish` is gated on `refs/tags/v`, so every
 * push run stayed green and the defect only surfaced after a human approval had
 * already been spent.
 *
 * The guard closes that class mechanically: a `download-artifact` name must be
 * produced by an `upload-artifact` step reachable in the SAME workflow —
 * literally, or by instantiating a composite action's
 * `${{ inputs.<name> }}` template with the calling job's `with:` value. A
 * download that names a foreign `run-id` is cross-run by construction: its name
 * then only has to exist somewhere in the repository's workflows.
 *
 * The github directory is discovered by walking up from the working directory,
 * so the same invocation works from the mirror (family gate) and from the
 * overlay checkout the composite action runs in (CI).
 * @module verify-release-artifacts
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const UPLOAD = 'actions/upload-artifact@'
const DOWNLOAD = 'actions/download-artifact@'
const TEMPLATE = /\$\{\{\s*inputs\.([A-Za-z0-9_-]+)\s*\}\}/g

/** Read a file as lines; an absent file reads as empty. */
function lines(file) {
  try {
    return readFileSync(file, 'utf8').split(/\r?\n/)
  } catch {
    return []
  }
}

/** Strip one layer of YAML quotes. */
function unquote(value) {
  const trimmed = value.trim()
  if (trimmed.length > 1 && (trimmed.startsWith('"') || trimmed.startsWith("'"))) return trimmed.slice(1, -1)
  return trimmed
}

/** Walk up from `start` until a directory holding `.github/workflows` is found. */
function findGithub(start) {
  let current = resolve(start)
  for (;;) {
    if (statSync(join(current, '.github', 'workflows'), { throwIfNoEntry: false })?.isDirectory() === true) return join(current, '.github')
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

/** List `*.yml|*.yaml` files directly inside `dir`. */
function yamlFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true, recursive: false })
  return entries.filter(entry => entry.isFile() && /\.ya?ml$/.test(entry.name)).map(entry => join(dir, entry.name))
}

/**
 * Every upload/download-artifact step of one YAML file.
 * @returns {{ line: number, kind: 'upload'|'download', name: string|undefined, crossRun: boolean }[]}
 */
function artifactSteps(file) {
  const text = lines(file)
  const steps = []
  for (let i = 0; i < text.length; i += 1) {
    const head = /^(\s*)-\s+uses:\s*(\S+)(?:\s+#.*)?$/.exec(text[i])
    if (head === null) continue
    const uses = head[2]
    const kind = uses.includes(UPLOAD) ? 'upload' : uses.includes(DOWNLOAD) ? 'download' : undefined
    if (kind === undefined) continue
    const indent = head[1].length
    let name
    let crossRun = false
    for (let j = i + 1; j < text.length; j += 1) {
      const next = /^(\s*)-\s+\S/.exec(text[j])
      if (next !== null && next[1].length <= indent) break
      const named = /^\s*name:\s*(.+?)\s*$/.exec(text[j])
      if (named !== null && name === undefined) name = unquote(named[1])
      if (/^\s*run-id:\s*\S/.test(text[j])) crossRun = true
    }
    steps.push({ line: i + 1, kind, name, crossRun })
  }
  return steps
}

/**
 * Steps of one workflow that run a local composite action, with the inputs that
 * step passes: `{ job, action, inputs }`. A composite action is used as a STEP
 * inside a job (`- uses: ./.github/actions/<name>`), so the inputs live under
 * that step's `with:` block.
 */
function compositeSteps(file) {
  const text = lines(file)
  const steps = []
  let job
  for (let i = 0; i < text.length; i += 1) {
    const header = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(text[i])
    if (header !== null) {
      job = header[1]
      continue
    }
    const uses = /^(\s*)-\s+uses:\s*\.\/\.github\/actions\/([A-Za-z0-9._-]+)\s*(?:#.*)?$/.exec(text[i])
    if (uses === null) continue
    const indent = uses[1].length
    const inputs = new Map()
    for (let j = i + 1; j < text.length; j += 1) {
      if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(text[j])) break
      const next = /^(\s*)-\s+\S/.exec(text[j])
      if (next !== null && next[1].length <= indent) break
      const input = /^\s+([A-Za-z0-9_-]+):\s*(\S.*?)\s*$/.exec(text[j])
      if (input !== null) inputs.set(input[1], unquote(input[2]))
    }
    steps.push({ job, action: uses[2], inputs })
  }
  return steps
}

/** Instantiate an upload template with a calling job's inputs; undefined when dynamic. */
function instantiate(template, inputs) {
  let value = template
  for (const match of template.matchAll(TEMPLATE)) {
    const key = match[1]
    if (!inputs.has(key)) return undefined
    value = value.replace(new RegExp('\\$\\{\\{\\s*inputs\\.' + key + '\\s*\\}\\}', 'g'), inputs.get(key))
  }
  return value
}

/** Names one workflow file can produce in its own run. */
function producedBy(workflow, actionDirs) {
  const produced = new Set()
  for (const step of artifactSteps(workflow)) {
    if (step.kind !== 'upload' || step.name === undefined) continue
    if (!step.name.includes('{{')) produced.add(step.name)
  }
  for (const step of compositeSteps(workflow)) {
    for (const actionFile of actionDirs.get(step.action) ?? []) {
      for (const artifact of artifactSteps(actionFile)) {
        if (artifact.kind !== 'upload' || artifact.name === undefined) continue
        const value = instantiate(artifact.name, step.inputs)
        if (value !== undefined) produced.add(value)
      }
    }
  }
  return produced
}

/** Judge one `.github` directory. */
function check(github) {
  const actionRoot = join(github, 'actions')
  const actionDirs = new Map()
  for (const entry of readdirSync(actionRoot, { withFileTypes: true, throwIfNoEntry: false }) ?? []) {
    if (entry.isDirectory()) actionDirs.set(entry.name, yamlFiles(join(actionRoot, entry.name)))
  }
  const workflows = yamlFiles(join(github, 'workflows'))
  const perFile = new Map()
  const every = new Set()
  for (const workflow of workflows) {
    const produced = producedBy(workflow, actionDirs)
    perFile.set(workflow, produced)
    for (const name of produced) every.add(name)
  }
  const violations = []
  let downloads = 0
  let crossRun = 0
  let dynamic = 0
  for (const workflow of workflows) {
    const produced = perFile.get(workflow)
    for (const step of artifactSteps(workflow)) {
      if (step.kind !== 'download') continue
      downloads += 1
      if (step.name === undefined) {
        dynamic += 1
        continue
      }
      if (step.name.includes('{{')) {
        dynamic += 1
        continue
      }
      if (step.crossRun) {
        crossRun += 1
        if (!every.has(step.name)) violations.push(`${workflow}:${step.line}: cross-run download \`${step.name}\` is produced by no workflow`)
        continue
      }
      if (!produced.has(step.name)) {
        const known = [...produced].sort().join(', ') || '(none)'
        violations.push(`${workflow}:${step.line}: download \`${step.name}\` has no producer in this workflow — produced here: ${known}`)
      }
    }
  }
  return { code: violations.length > 0 ? 1 : 0, violations, workflows: workflows.length, downloads, crossRun, dynamic }
}

/** Four fixtures: matching, missing producer, cross-run, dynamic name. */
function selfTest() {
  const root = join(tmpdir(), `verify-release-artifacts-${process.pid}`)
  const write = (rel, body) => {
    const file = join(root, rel)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, body, 'utf8')
  }
  const action = [
    'name: ev-validate',
    'inputs:',
    '  artifact_suffix:',
    '    required: true',
    'runs:',
    '  using: composite',
    '  steps:',
    '    - uses: actions/upload-artifact@v4',
    '      with:',
    '        name: evolution-dist-${{ inputs.artifact_suffix }}',
    '        path: dist',
    '',
  ].join('\n')
  const cases = [
    {
      label: 'matching download',
      expect: 0,
      body: [
        'name: good',
        'on: push',
        'jobs:',
        '  compat-check:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: ./.github/actions/ev-validate',
        '        with:',
        '          artifact_suffix: released',
        '  publish:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: actions/download-artifact@v4',
        '        with:',
        '          name: evolution-dist-released',
        '',
      ].join('\n'),
    },
    {
      label: 'retired suffix',
      expect: 1,
      body: [
        'name: bad',
        'on: push',
        'jobs:',
        '  compat-check:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: ./.github/actions/ev-validate',
        '        with:',
        '          artifact_suffix: released',
        '  publish:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: actions/download-artifact@v4',
        '        with:',
        '          name: evolution-dist-baseline',
        '',
      ].join('\n'),
    },
    {
      label: 'cross-run download',
      expect: 0,
      body: [
        'name: cross',
        'on: push',
        'jobs:',
        '  compat-check:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: ./.github/actions/ev-validate',
        '        with:',
        '          artifact_suffix: released',
        '  publish:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: actions/download-artifact@v4',
        '        with:',
        '          name: evolution-dist-released',
        '          run-id: 12345',
        '',
      ].join('\n'),
    },
    {
      label: 'dynamic name',
      expect: 0,
      body: [
        'name: dynamic',
        'on: push',
        'jobs:',
        '  publish:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: actions/download-artifact@v4',
        '        with:',
        '          name: ${{ env.ARTIFACT }}',
        '',
      ].join('\n'),
    },
  ]
  try {
    const wrong = []
    for (const [index, item] of cases.entries()) {
      // one directory per case: a shared fixture would let case N's violation leak into case N+1
      write(`case-${index + 1}/.github/actions/ev-validate/action.yml`, action)
      write(`case-${index + 1}/.github/workflows/${item.label.replace(/ /g, '-')}.yml`, item.body)
      const result = check(join(root, `case-${index + 1}`, '.github'))
      if (result.code !== item.expect) wrong.push(`${item.label} expected ${item.expect} got ${result.code}${result.violations.length > 0 ? ` (${result.violations.join('; ')})` : ''}`)
    }
    if (wrong.length > 0) return { code: 1, output: `verify-release-artifacts --self-test: ${wrong.join('; ')}` }
    return { code: 0, output: `verify-release-artifacts --self-test: OK — ${cases.length} fixture(s) judged as expected (matching 0, retired suffix 1, cross-run 0, dynamic 0)` }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const argv = process.argv.slice(2)
const unknown = argv.filter(arg => arg.startsWith('--') && arg !== '--strict' && arg !== '--self-test')
if (unknown.length > 0) {
  console.error(`verify-release-artifacts: unknown flag ${unknown.join(', ')} — usage: verify-release-artifacts.mjs [github-dir] [--strict] [--self-test]`)
  process.exit(1)
}
const github = findGithub(argv.find(arg => !arg.startsWith('--')) ?? process.cwd())
if (github === undefined) {
  console.error('verify-release-artifacts: no .github/workflows directory found above the working directory')
  process.exit(1)
}
if (argv.includes('--self-test')) {
  const result = selfTest()
  console.log(result.output)
  if (result.code !== 0) process.exit(result.code)
}
const report = check(github)
if (report.code !== 0) {
  for (const violation of report.violations) console.error(`verify-release-artifacts: ${violation}`)
  console.error(`verify-release-artifacts: ${report.violations.length} unwired download(s) in ${report.workflows} workflow(s)`)
  process.exit(report.code)
}
console.log(`verify-release-artifacts: OK — ${report.workflows} workflow(s), ${report.downloads} download(s) all have producers (${report.crossRun} cross-run, ${report.dynamic} dynamic)`)
