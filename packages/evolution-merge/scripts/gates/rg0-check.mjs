import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const args = new Map()
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1])
const repo = args.get('--repo') ?? process.cwd()
const artifact = args.get('--artifact') ?? join(process.cwd(), 'artifacts', 'gates', 'RG0')
const src = join(repo, 'packages', 'evolution-merge', 'src')
const checks = []
const add = (name, ok, detail) => checks.push({ name, ok, detail })

const owners = ['state.ts', 'commit-execute.ts', 'domain/commit-journal-store.ts', 'staging.ts', 'target-claim.ts', 'adapters/library.ts']
for (const path of owners) add('owner:' + path, existsSync(join(src, path)), 'owner path exists')

const recovery = existsSync(join(src, 'commit-recovery.ts')) ? readFileSync(join(src, 'commit-recovery.ts'), 'utf8') : ''
add('recovery-no-skill-write', recovery !== '' && !recovery.includes('writeText(skillBodyPath') && !recovery.includes('writeText(skillFilePath') && !recovery.includes('restoreFromArchive'), 'recovery must not write skills')
const commit = existsSync(join(src, 'commit-execute.ts')) ? readFileSync(join(src, 'commit-execute.ts'), 'utf8') : ''
add('commit-port-only', commit.includes('port.commitMerge') && !commit.includes('applyTreeChange'), 'commit via CommitPort')

const files = existsSync(src) ? readdirSync(src, { recursive: true }).filter(name => String(name).endsWith('.ts')) : []
const raw = files.filter(file => readFileSync(join(src, String(file)), 'utf8').includes('applyTreeChange('))
add('no-raw-tree-writer', raw.length === 0, raw.length === 0 ? 'none' : raw.join(', '))

const matrix = join(artifact, 'ownership-matrix.md')
add('matrix-present', existsSync(matrix), matrix)
const matrixText = existsSync(matrix) ? readFileSync(matrix, 'utf8') : ''
for (const owner of ['merge-state 行', 'runs 索引', 'commit journal', 'receipt/unit evidence', 'staging', 'tree fence', 'target claim', 'eligibility facts', 'Facts/QueuePage', 'CommandSpec/Surface', 'engine', 'UI client']) add('matrix-row:' + owner, matrixText.includes(owner), 'owner row present')

let commitSha = args.get('--commit') ?? 'unknown'
if (commitSha === 'unknown') try { commitSha = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() } catch {}
const digestEntries = []
const addDigest = (label, path) => { if (existsSync(path)) digestEntries.push(label + ':' + readFileSync(path, 'utf8')) }
if (existsSync(src)) for (const name of readdirSync(src, { recursive: true }).map(String).filter(name => name.endsWith('.ts'))) addDigest('src/' + name, join(src, name))
for (const rel of ['tests/gates/rg0-ownership.spec.ts', 'tests/gates/rg0-consistency.spec.ts', 'tests/gates/rg0-port-boundary.spec.ts']) addDigest(rel, join(repo, 'packages/evolution-merge', rel))
addDigest('scripts/gates/rg0-check.mjs', join(repo, 'packages/evolution-merge/scripts/gates/rg0-check.mjs'))
for (const rel of ['packages/evolution-core/src/run-registry.ts', 'packages/evolution-core/src/tree-lock.ts', 'packages/evolution-core/src/skill-store.ts', 'packages/evolution-merge-engine/package.json', 'packages/evolution-merge-ui/src/client/Panel.ts']) addDigest(rel, join(repo, rel))
addDigest('ownership-matrix.md', matrix)
const treeDigest = createHash('sha256').update(digestEntries.sort().join('\n')).digest('hex')
const ok = checks.every(check => check.ok)
if (!existsSync(artifact)) mkdirSync(artifact, { recursive: true })
const signoff = (args.get('--signoff') ?? '').split(',').map(name => name.trim()).filter(name => name !== '')
const required = ['Lead', 'chief-architect', 'platform-backend', 'frontend-engineer']
const signed = required.every(name => signoff.includes(name))
const status = ok ? (signed ? 'pass' : 'in-progress') : 'fail'
const priorPath = join(artifact, 'result.json')
const prior = existsSync(priorPath) ? JSON.parse(readFileSync(priorPath, 'utf8')) : null
const priorSpecs = Array.isArray(prior?.commands) ? prior.commands.filter(command => String(command.cmd).includes('vitest')) : []
const gateName = args.get('--gate') ?? 'RG0'
const result = { gate: gateName, status, commit: commitSha, treeDigest, date: new Date().toISOString(), commands: [{ cmd: 'node packages/evolution-merge/scripts/gates/rg0-check.mjs --repo ' + repo + ' --artifact ' + artifact + ' --commit ' + commitSha + ' --gate ' + gateName + (signoff.length === 0 ? '' : ' --signoff ' + signoff.join(',')), cwd: repo, exitCode: status === 'pass' ? 0 : 1, artifact: matrix }, ...priorSpecs], artifacts: [matrix], reviewers: signoff, kill: [] , checks }
writeFileSync(join(artifact, 'result.json'), JSON.stringify(result, null, 2) + '\n')
console.log((status === 'pass' ? 'RG0 PASS' : status === 'in-progress' ? 'RG0 IN-PROGRESS (checks pass; signoff missing)' : 'RG0 FAIL') + ' checks=' + checks.length)
for (const check of checks) if (!check.ok) console.error('FAIL ' + check.name + ': ' + check.detail)
process.exit(status === 'pass' ? 0 : 1)
