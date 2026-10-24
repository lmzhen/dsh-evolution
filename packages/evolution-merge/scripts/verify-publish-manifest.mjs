import { readFileSync } from 'node:fs'
const target = process.argv[2]
const expected = process.argv[3]
if (!target) { console.error('usage: node scripts/verify-publish-manifest.mjs <packed-package.json> [expected-version]'); process.exit(2) }
const pkg = JSON.parse(readFileSync(target, 'utf8'))
const want = expected ?? pkg.version
const dep = pkg.dependencies?.['@deepseek-ai/dsh-evolution-merge-engine']
const exact = typeof dep === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(dep)
if (!exact) { console.error('PUBLISH MANIFEST FAIL: merge-engine dependency is not exact: ' + String(dep)); process.exit(1) }
if (dep !== want) { console.error('PUBLISH MANIFEST FAIL: merge-engine dependency ' + dep + ' != expected ' + want); process.exit(1) }
for (const [name, range] of Object.entries({ ...(pkg.dependencies ?? {}), ...(pkg.peerDependencies ?? {}) })) {
  if (typeof range === 'string' && range.includes('workspace:')) { console.error('PUBLISH MANIFEST FAIL: workspace range remains for ' + name + ': ' + range); process.exit(1) }
}
if (typeof pkg.version !== 'string' || pkg.version === '') { console.error('PUBLISH MANIFEST FAIL: missing package version'); process.exit(1) }
console.log('PUBLISH MANIFEST OK merge-engine=' + dep + ' merge=' + pkg.version)