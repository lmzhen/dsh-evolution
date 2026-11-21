/**
 * Dist-artifact binding for release evidence (W10/E3).
 *
 * `artifactSha256` used to be a declared 64-hex string nobody compared with the bytes about to
 * publish. This module is the one reader of the packed dist: the evidence records the exact tarball
 * set, and the pre-publish guard recomputes it. Only `.tgz` files count — those are the npm bytes.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SHA256 = /^[a-f0-9]{64}$/
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * Hash one file.
 * @param {string} path
 * @returns {string}
 */
function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/**
 * Read the packed tarball set. Throws when the directory is absent or carries no tarball; the
 * caller turns that into `cannot decide`, never into an empty pass.
 * @param {string} dir
 * @returns {{ count: number, files: Array<{ name: string, sha256: string }> }}
 */
export function readDistArtifacts(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error('dist directory does not exist: ' + dir)
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.tgz'))
    .sort()
    .map((name) => {
      const path = join(dir, name)
      if (!statSync(path).isFile()) throw new Error('dist entry is not a file: ' + path)
      return { name, sha256: sha256File(path) }
    })
  if (files.length === 0) throw new Error('dist directory carries no *.tgz tarball: ' + dir)
  return { count: files.length, files }
}

/**
 * Compare one evidence `artifacts` block with the actual packed tarballs.
 * @param {unknown} evidence - parsed release-evidence.json.
 * @param {string} dir - dist directory containing the tarballs about to publish.
 * @returns {string[]} problem strings; empty means the exact set matches.
 */
export function verifyEvidenceArtifacts(evidence, dir) {
  const problems = []
  if (!isObject(evidence)) return ['release-evidence: not an object']
  const actual = readDistArtifacts(dir)
  const recorded = evidence.artifacts
  if (!isObject(recorded) || !Array.isArray(recorded.files)) return ['release: artifacts is missing; cannot bind the evidence to dist']
  const expected = new Map()
  for (const [index, file] of recorded.files.entries()) {
    if (!isObject(file) || typeof file.name !== 'string' || file.name === '' || typeof file.sha256 !== 'string' || !SHA256.test(file.sha256)) {
      problems.push('release: artifacts.files[' + String(index) + '] must carry name and sha256')
      continue
    }
    expected.set(file.name, file.sha256)
  }
  if (recorded.count !== actual.count || recorded.count !== recorded.files.length) {
    problems.push('release: artifacts.count ' + String(recorded.count) + ' does not equal the recorded/actual file count')
  }
  for (const file of actual.files) {
    const recordedHash = expected.get(file.name)
    if (recordedHash === undefined) problems.push('release: dist tarball ' + file.name + ' is not recorded in artifacts')
    else if (recordedHash !== file.sha256) problems.push('release: dist tarball ' + file.name + ' sha256 differs from artifacts')
  }
  for (const name of expected.keys()) {
    if (!actual.files.some((file) => file.name === name)) problems.push('release: artifacts records ' + name + ' but dist has no such tarball')
  }
  return problems
}
